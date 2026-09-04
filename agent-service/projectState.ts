// 10. getProjectState(projectKey) — a structured operational snapshot for
// one project. Composed from three flat queries (project, its tasks, its
// current decisions) rather than one large join — at Bootstrap-v1 scale
// (dozens of tasks per project, not thousands) three simple, readable
// queries are clearer than one mega-join and are not an N+1 pattern (N+1
// specifically means one query per ROW in a loop; this is a fixed 3
// queries for the whole project regardless of how many tasks it has).
// Does not call Open Brain — operational state only, per Phase 0C scope.

import { query } from './db'
import { mapProjectRow, type ProjectRow } from './mappers'
import { getProjectTasks, getCurrentDecisions, DEFAULT_RECENT_CHANGES_WINDOW_MS } from './queries'
import type { ProjectState, ProjectStateResult, TaskStatus, TaskSummary, WaitingTaskSummary, BlockedTaskSummary, JerryTaskSummary } from './types'

// "Recently completed" for a project snapshot needs its own default
// window — proposed here at the composition layer (not inside the
// low-level getRecentlyCompletedTasks, which always requires an explicit
// `since`). 30 days is a reasonable snapshot window for a human-facing
// project view; a future Chief calling the lower-level function directly
// can choose any window it needs.
export const DEFAULT_PROJECT_STATE_COMPLETED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface ProjectStateOptions {
  now?: Date
  completedSince?: Date
}

export async function getProjectState(projectKey: string, opts: ProjectStateOptions = {}): Promise<ProjectStateResult> {
  const now = opts.now ?? new Date()
  const completedSince = opts.completedSince ?? new Date(now.getTime() - DEFAULT_PROJECT_STATE_COMPLETED_WINDOW_MS)

  const projectRows = await query<ProjectRow>(
    `SELECT p.id, p.project_key, p.name, p.project_type, p.status, p.priority,
            p.target_at, p.last_activity_at, p.summary,
            o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name
     FROM agent.projects p
     LEFT JOIN agent.owners o ON o.id = p.owner_id
     WHERE p.project_key = $1`,
    [projectKey]
  )

  if (projectRows.length === 0) {
    return { found: false, projectKey }
  }

  const project = mapProjectRow(projectRows[0])

  const allTasks = await getProjectTasks(projectKey, {}, now)
  const decisions = await getCurrentDecisions(projectKey)

  const tasksByStatus: Partial<Record<TaskStatus, TaskSummary[]>> = {}
  for (const task of allTasks) {
    if (!tasksByStatus[task.status]) tasksByStatus[task.status] = []
    tasksByStatus[task.status]!.push(task)
  }

  const waitingTasks: WaitingTaskSummary[] = (tasksByStatus.WAITING ?? []).map((t) => ({
    ...t,
    status: 'WAITING' as const,
    isDueForCheck: t.nextCheckAt !== null && t.nextCheckAt.getTime() <= now.getTime(),
  }))
  const blockedTasks: BlockedTaskSummary[] = (tasksByStatus.BLOCKED ?? []).map((t) => ({ ...t, status: 'BLOCKED' as const }))
  const needsJerryTasks: JerryTaskSummary[] = (tasksByStatus.NEEDS_JERRY ?? []).map((t) => ({ ...t, status: 'NEEDS_JERRY' as const }))

  const recentlyCompletedTasks = (tasksByStatus.DONE ?? []).filter(
    (t) => t.completedAt !== null && t.completedAt.getTime() >= completedSince.getTime()
  )

  return {
    found: true,
    state: {
      project,
      tasksByStatus,
      waitingTasks,
      blockedTasks,
      needsJerryTasks,
      recentlyCompletedTasks,
      decisions,
    },
  }
}

// Re-exported so callers of projectState.ts don't also need to import
// queries.ts just to reference the recent-changes default window.
export { DEFAULT_RECENT_CHANGES_WINDOW_MS }
