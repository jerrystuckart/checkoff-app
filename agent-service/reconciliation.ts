// Phase 1C — the DB-touching half of reconciliation. Mirrors the split
// used everywhere else in this codebase (auditRules.ts/audit.ts,
// chiefBriefRules.ts/chiefBrief.ts, openBrainDecisions.ts's repository
// pattern): reconciliationRules.ts is pure/injectable, this file wires it
// to the real database and the real transitionTask() mutation.
//
// ASSESS vs APPLY, kept genuinely separate:
//   - assessReconciliation() is read-only. Safe to call any number of
//     times, from anywhere, including just to preview findings.
//   - applyReconciliationFinding() is the ONLY place a finding can become
//     a real transition, and it goes through the exact same
//     transitionTask() path (mutations.ts) as any other status change —
//     normal STATUS_CHANGED event, normal audit trail, no parallel
//     task-history mechanism. It refuses (throws) if the finding isn't
//     actually autoApplicable, rather than silently no-oping a caller
//     mistake.

import { query } from './db'
import { transitionTask } from './mutations'
import { assessTasks, type ReconciliationReader } from './reconciliationRules'
import type { ReconciliationFinding } from './reconciliationTypes'
import type { TaskSummary } from './types'

export function getDefaultReconciliationReader(): ReconciliationReader {
  return { query }
}

export async function assessReconciliation(
  tasks: TaskSummary[],
  reader: ReconciliationReader = getDefaultReconciliationReader()
): Promise<ReconciliationFinding[]> {
  return assessTasks(tasks, reader)
}

/**
 * The narrow apply path. `task` is passed in (rather than re-fetched here)
 * so the caller controls exactly which snapshot's `updatedAt` is used for
 * transitionTask()'s optimistic-concurrency precondition — normally the
 * same snapshot the finding was assessed against moments earlier.
 */
export async function applyReconciliationFinding(finding: ReconciliationFinding, task: TaskSummary, actorOwnerKey = 'chief'): Promise<TaskSummary> {
  if (!finding.autoApplicable) {
    throw new Error(
      `Reconciliation finding for task ${finding.taskId} is not autoApplicable (evidenceCategory=${finding.evidenceCategory}) — refusing to apply. ` +
        `SUPERSESSION_PROOF and AMBIGUOUS findings are permanently recommend-only by design.`
    )
  }
  if (finding.recommendedStatus === null) {
    throw new Error(`Reconciliation finding for task ${finding.taskId} has no recommendedStatus — nothing to apply`)
  }
  if (finding.taskId !== task.id) {
    throw new Error(`Reconciliation finding is for task ${finding.taskId} but a different task (${task.id}) was passed to applyReconciliationFinding`)
  }

  const result = await transitionTask({
    taskId: finding.taskId,
    toStatus: finding.recommendedStatus,
    actorOwnerKey,
    expectedUpdatedAt: task.updatedAt,
    reconciliation: {
      evidenceCategory: finding.evidenceCategory,
      evidenceSources: finding.evidenceSources,
      evidenceSummary: finding.reason,
    },
  })
  return result.task
}

/** Applies every autoApplicable finding in `findings` whose task is present in `tasksById`. Skips (does not throw for) any finding that isn't autoApplicable — callers that want the throw-on-misuse behavior should call applyReconciliationFinding directly. */
export async function applyAutoApplicableFindings(
  findings: ReconciliationFinding[],
  tasksById: Map<string, TaskSummary>,
  actorOwnerKey = 'chief'
): Promise<TaskSummary[]> {
  const applied: TaskSummary[] = []
  for (const finding of findings) {
    if (!finding.autoApplicable) continue
    const task = tasksById.get(finding.taskId)
    if (!task) continue
    applied.push(await applyReconciliationFinding(finding, task, actorOwnerKey))
  }
  return applied
}

export * from './reconciliationTypes'
export { RECONCILIATION_RULES, assessTask, type ReconciliationRule, type ReconciliationRuleResult, type ReconciliationReader } from './reconciliationRules'
