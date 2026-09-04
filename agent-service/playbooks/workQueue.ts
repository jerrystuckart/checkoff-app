// Chief Phase 2A — "what should happen next?" across all active
// projects. Deliberately a THIN layer over queries.ts's existing
// getTasksNeedingAction/getWaitingTasks/getBlockedTasks (Phase 0C/1B) —
// this module adds the missing "why now / dependency / waiting_on"
// derivation, not a new data source. No duplicate task state, no new
// tables: every field here is read straight off the same TaskSummary
// already returned by the existing query layer.

import { getTasksNeedingAction, getWaitingTasks, getBlockedTasks, getNeedsJerryTasks } from '../queries'
import type { TaskSummary, TaskStatus } from '../types'

export type WorkQueueStatus = 'READY' | 'IN_PROGRESS' | 'WAITING' | 'BLOCKED' | 'NEEDS_JERRY' | 'DONE'

export interface WorkQueueItem {
  taskId: string
  title: string
  projectKey: string | null
  status: WorkQueueStatus
  nextAction: string | null
  /** One-line, structured explanation of why this item surfaced now — never free-text guessing. */
  whyNow: string
  dependency: { taskId: string; title: string; status: TaskStatus } | null
  waitingOn: 'EXTERNAL' | 'CHIEF' | 'JERRY' | null
  dueOrFollowUpAt: Date | null
}

function toQueueStatus(status: TaskStatus): WorkQueueStatus {
  if (status === 'BACKLOG' || status === 'CANCELED') return 'DONE' // both are out-of-queue terminal-ish states for this view
  return status
}

function whyNowFor(task: TaskSummary, reasons: string[], now: Date): string {
  const parts: string[] = []
  if (reasons.includes('NEEDS_JERRY')) parts.push('requires Jerry')
  if (reasons.includes('OVERDUE')) parts.push('past due date')
  if (reasons.includes('DUE_FOR_CHECK')) parts.push('follow-up window reached')
  if (reasons.includes('READY')) parts.push('ready to start')
  if (reasons.includes('IN_PROGRESS')) parts.push('already in progress')
  if (parts.length === 0) parts.push(`status is ${task.status}`)
  return parts.join('; ')
}

/**
 * Every active (non-terminal) task, unified into one work-queue view with
 * next_action/why_now/dependency/waiting_on/due-or-follow-up-date.
 * READY/IN_PROGRESS/NEEDS_JERRY tasks come from getTasksNeedingAction;
 * WAITING/BLOCKED are added on top so nothing active is missing from the
 * queue just because it isn't "needing action" yet.
 */
export async function getWorkQueue(now: Date = new Date()): Promise<WorkQueueItem[]> {
  const [needsAction, waiting, blocked] = await Promise.all([getTasksNeedingAction({ includeInProgress: true, now }), getWaitingTasks(), getBlockedTasks()])

  const byId = new Map<string, { task: TaskSummary; reasons: string[] }>()
  for (const t of needsAction) byId.set(t.id, { task: t, reasons: t.reasons })
  for (const t of waiting) if (!byId.has(t.id)) byId.set(t.id, { task: t, reasons: t.isDueForCheck ? ['DUE_FOR_CHECK'] : [] })
  for (const t of blocked) if (!byId.has(t.id)) byId.set(t.id, { task: t, reasons: [] })

  return [...byId.values()]
    .map(({ task, reasons }) => ({
      taskId: task.id,
      title: task.title,
      projectKey: task.project?.projectKey ?? null,
      status: toQueueStatus(task.status),
      nextAction: task.nextAction,
      whyNow: whyNowFor(task, reasons, now),
      dependency: task.blockedBy ? { taskId: task.blockedBy.id, title: task.blockedBy.title, status: task.blockedBy.status } : null,
      waitingOn: (task.status === 'WAITING'
        ? 'EXTERNAL'
        : task.status === 'NEEDS_JERRY'
          ? 'JERRY'
          : task.status === 'READY' || task.status === 'IN_PROGRESS'
            ? 'CHIEF'
            : null) as WorkQueueItem['waitingOn'],
      dueOrFollowUpAt: task.dueAt ?? task.nextCheckAt,
    }))
    .sort((a, b) => {
      const rank: Record<WorkQueueStatus, number> = { NEEDS_JERRY: 0, BLOCKED: 1, READY: 2, IN_PROGRESS: 3, WAITING: 4, DONE: 5 }
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
      const aTime = a.dueOrFollowUpAt?.getTime() ?? Infinity
      const bTime = b.dueOrFollowUpAt?.getTime() ?? Infinity
      return aTime - bTime
    })
}

/** Convenience: just the top-N next actions, for the daily brief's "what happens next" section. */
export async function getTopNextActions(limit = 5, now: Date = new Date()): Promise<WorkQueueItem[]> {
  const queue = await getWorkQueue(now)
  return queue.filter((i) => i.status === 'READY' || i.status === 'NEEDS_JERRY' || i.status === 'IN_PROGRESS').slice(0, limit)
}

/** Re-exported for callers that specifically want the NEEDS_JERRY subset with its own richer shape (jerryRequest etc). */
export { getNeedsJerryTasks }
