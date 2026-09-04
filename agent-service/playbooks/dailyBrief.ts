// Chief Phase 2A — the daily operating brief, extended with a Business
// Photo Outreach section. Deliberately additive, not a rewrite of
// chiefBrief.ts (Phase 1B/1C/1D, well-tested, generalizes across every
// project already): this module composes ALONGSIDE getChiefBrief(),
// using the exact same live queries.ts/workQueue.ts data, never a
// manually maintained summary.
//
// Answers, specifically for this playbook (chiefBrief.ts already answers
// the general "what completed / needs Jerry / waiting / at risk / next"
// questions across every project):
//   - How many outreach tasks are at each stage right now?
//   - How many need Jerry (corrections, photo review)?
//   - How many are stale (past their follow-up window with no evidence)?

import { getAllTasks } from '../queries'
import type { TaskSummary } from '../types'
import { BUSINESS_PHOTO_OUTREACH_SOURCE_TYPE, type BusinessPhotoOutreachStage } from './businessPhotoOutreach'
import { query } from '../db'

export interface BusinessPhotoOutreachBriefSection {
  totalTasks: number
  byStatus: Record<string, number>
  needsJerryCount: number
  waitingCount: number
  completeCount: number
  /** WAITING tasks whose nextCheckAt has already passed — the follow-up window was reached but no reconciliation pass has acted on them yet. */
  staleFollowUps: Array<{ taskId: string; title: string; nextCheckAt: Date | null }>
}

async function stageFor(taskId: string): Promise<BusinessPhotoOutreachStage | null> {
  const rows = await query<{ stage: string }>(
    `select coalesce(metadata ->> 'stage', metadata #>> '{playbookStage,stage}') as stage
     from agent.task_events
     where task_id = $1
       and event_type in ('PLAYBOOK_STAGE', 'STATUS_CHANGED')
       and (metadata ? 'stage' or metadata -> 'playbookStage' ? 'stage')
     order by changed_at desc limit 1`,
    [taskId]
  )
  return rows.length > 0 ? ((rows[0].stage ?? null) as BusinessPhotoOutreachStage | null) : null
}

export async function getBusinessPhotoOutreachBriefSection(now: Date = new Date()): Promise<BusinessPhotoOutreachBriefSection> {
  const allTasks = await getAllTasks()
  const tasks = allTasks.filter((t) => t.sourceType === BUSINESS_PHOTO_OUTREACH_SOURCE_TYPE)

  const byStatus: Record<string, number> = {}
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1

  const waitingTasks = tasks.filter((t: TaskSummary) => t.status === 'WAITING')
  const staleFollowUps = waitingTasks
    .filter((t) => t.nextCheckAt !== null && t.nextCheckAt.getTime() < now.getTime())
    .map((t) => ({ taskId: t.id, title: t.title, nextCheckAt: t.nextCheckAt }))

  return {
    totalTasks: tasks.length,
    byStatus,
    needsJerryCount: byStatus['NEEDS_JERRY'] ?? 0,
    waitingCount: byStatus['WAITING'] ?? 0,
    completeCount: byStatus['DONE'] ?? 0,
    staleFollowUps,
  }
}

export { stageFor as getBusinessPhotoOutreachStageFor }
