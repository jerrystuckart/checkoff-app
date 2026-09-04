#!/usr/bin/env node
// Developer-only manual verification tool for the Phase 0C read/query
// layer — NOT a public API, NOT exposed to the consumer app, NOT a UI.
// Prints structured results for a human to eyeball against Bootstrap v1.
// No LLM involved.
//
// Usage:
//   npm run agent:verify
//   npm run agent:verify -- --project denver_metro
//
// Requires AGENT_SERVICE_DATABASE_URL (see agent-service/README section in
// the Phase 0C deliverables writeup for what to set and why).

import {
  getActiveProjects,
  getOnHoldProjects,
  getTasksNeedingAction,
  getOverdueTasks,
  getTasksDueForCheck,
  getWaitingTasks,
  getBlockedTasks,
  getNeedsJerryTasks,
  getRecentTaskChanges,
  getRecentlyCompletedTasks,
  getProjectState,
  DEFAULT_RECENT_CHANGES_WINDOW_MS,
  closePool,
} from './index'

function printSection(title: string, data: unknown): void {
  console.log(`\n=== ${title} ===`)
  console.log(JSON.stringify(data, null, 2))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const projectFlagIndex = args.indexOf('--project')
  const projectKey = projectFlagIndex !== -1 ? args[projectFlagIndex + 1] : 'denver_metro'

  const now = new Date()

  printSection('Active projects', await getActiveProjects())
  printSection('On-hold projects', await getOnHoldProjects())
  printSection('Tasks needing action now', await getTasksNeedingAction({ now }))
  printSection('Overdue tasks', await getOverdueTasks(now))
  printSection('Tasks due for check', await getTasksDueForCheck(now))
  printSection('Waiting tasks', await getWaitingTasks({ now }))
  printSection('Waiting tasks (due-for-check only)', await getWaitingTasks({ now, dueForCheckOnly: true }))
  printSection('Blocked tasks', await getBlockedTasks())
  printSection('Needs-Jerry tasks', await getNeedsJerryTasks())
  printSection(
    `Recent task changes (last ${DEFAULT_RECENT_CHANGES_WINDOW_MS / 1000 / 60 / 60}h)`,
    await getRecentTaskChanges(new Date(now.getTime() - DEFAULT_RECENT_CHANGES_WINDOW_MS))
  )
  printSection(
    'Recently completed tasks (last 30 days)',
    await getRecentlyCompletedTasks(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
  )
  printSection(`Project state: ${projectKey}`, await getProjectState(projectKey, { now }))
}

main()
  .catch((err) => {
    console.error('[agent-service/verify] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
