// Phase 1B/1C — the only DB-touching part of Chief Brief. Both external
// dependencies (state reads + reconciliation, run-lifecycle writes) are
// injected with real default implementations — same deliberate pattern as
// openBrainDecisions.ts (see that file's module doc): it makes every
// scenario (first brief, second brief uses the checkpoint, a failed run
// never advances it, RUNNING can't see itself, reconciliation excludes a
// task in the same pass, assessment-only performs zero writes) a pure,
// fast, fully-deterministic mock-based unit test, with no live database
// touched by the test suite.
//
// MUTATION SURFACE (Phase 1C revision of the Phase 1B invariant): this
// module writes its own agent.runs lifecycle row (RUNNING ->
// SUCCEEDED/FAILED) as before, AND may now also apply autoApplicable
// reconciliation findings via the normal transitionTask() path (see
// reconciliation.ts) — never anything else. It is SAFE today with the
// empty RECONCILIATION_RULES registry (reconciliationRules.ts): zero
// findings can ever be autoApplicable until a rule is actually registered,
// so this module makes no task-level write in current production state.
// Recommending, syncing, approving, or acting on a SUPERSESSION_PROOF/
// AMBIGUOUS finding are separate, explicit calls a caller makes
// afterward — this module never applies those, only COMPLETION_PROOF.
//
// PHASE 1D ADDITION IS ALSO READ-ONLY: this module calls
// dataSource.planActions() (selectApplicablePlan() — see actionHandlers.ts)
// to populate each brief item's proposedAction. Planning NEVER calls
// execute() and NEVER transitions anything — actionExecution.ts's
// executeAutonomousAction() is a completely separate entry point a caller
// invokes deliberately afterward, exactly like the reconciliation apply
// path stayed separate from assessment in Phase 1C. getChiefBrief() itself
// still never calls execute() for anything, regardless of any item's policy.
//
// ASSESSMENT-ONLY MODE: pass `applyReconciliation: false` to skip the
// apply step entirely (assessment still runs — findings still populate
// staleSignal — but nothing is ever transitioned). Proven by a dedicated
// test to perform zero writes beyond the run's own SUCCEEDED/FAILED
// update... actually not even that when combined with a no-op — see
// chiefBrief.test.ts.
//
// RUN LIFECYCLE (exact order matters):
//   1. read the previous SUCCEEDED chief_brief run's started_at
//   2. create this run as RUNNING (this row does not exist yet during step 1)
//   3. gather state; assess reconciliation; apply autoApplicable findings
//      (unless assessment-only); RE-FETCH so the brief reflects any
//      applied transition (a task auto-reconciled to DONE is excluded from
//      its old section by REAL state, never by a filter in the pure layer)
//   4. update the SAME row to SUCCEEDED with compact counts
//   5. on any failure, update the SAME row to FAILED with bounded error text
//
// Because step 1 always runs before step 2 creates the row, the current
// pass's own RUNNING row can never be selected as its own "previous
// successful" checkpoint — there is nothing for step 1's query to see yet.
// A run that fails (step 5) is never SUCCEEDED, so it can never become a
// future pass's checkpoint either — the checkpoint only ever advances on
// genuine success.

import {
  getNeedsJerryTasks,
  getWaitingTasks,
  getBlockedTasks,
  getTasksNeedingAction,
  getPendingDurableMemoryRecommendations,
  getDecisionsAwaitingOpenBrainSync,
  getInteractionsRequiringAction,
  getRecentTaskChanges,
  getRecentDecisionEvents,
  getRecentInteractions,
  type DecisionPromotionSummary,
} from './queries'
import { computeChiefBrief, type ChiefBriefInputs } from './chiefBriefRules'
import type { ChiefBrief, ChiefBriefSummaryCounts } from './chiefBriefTypes'
import { assessReconciliation, applyReconciliationFinding } from './reconciliation'
import type { ReconciliationFinding } from './reconciliationTypes'
import { selectApplicablePlan } from './actionHandlers'
import type { ActionPlan } from './actionPolicyTypes'
import type { JerryTaskSummary, WaitingTaskSummary, BlockedTaskSummary, TaskSummary, InteractionSummary, TaskEventSummary, DecisionEventSummary } from './types'
import { query, withWriteTransaction } from './db'
import { OwnerNotFoundError } from './errors'

const MAX_ERROR_MESSAGE_LENGTH = 2000

export interface ChiefBriefDataSource {
  needsJerryTasks(): Promise<JerryTaskSummary[]>
  waitingTasks(): Promise<WaitingTaskSummary[]>
  blockedTasks(): Promise<BlockedTaskSummary[]>
  readyTasks(now: Date): Promise<TaskSummary[]>
  pendingRecommendations(): Promise<DecisionPromotionSummary[]>
  decisionsAwaitingSync(): Promise<DecisionPromotionSummary[]>
  interactionsRequiringAction(): Promise<InteractionSummary[]>
  recentTaskChanges(since: Date): Promise<TaskEventSummary[]>
  recentDecisionEvents(since: Date): Promise<DecisionEventSummary[]>
  recentInteractions(since: Date): Promise<InteractionSummary[]>
  /** Phase 1C — read-only. Assesses reconciliation findings for exactly the tasks passed in (never fetches its own set). */
  assessReconciliation(tasks: TaskSummary[]): Promise<ReconciliationFinding[]>
  /** Phase 1C — the ONLY mutation this data source can perform. Throws if the finding isn't actually autoApplicable (see reconciliation.ts). */
  applyReconciliationFinding(finding: ReconciliationFinding, task: TaskSummary): Promise<TaskSummary>
  /** Phase 1D — read-only. Calls ONLY selectApplicablePlan() (planning) for exactly the tasks passed in — never execute(). getChiefBrief() never executes an action; see actionExecution.ts for the separate entry point that does. */
  planActions(tasks: TaskSummary[]): Promise<ActionPlan[]>
}

export interface ChiefRunRepository {
  /** The one place "since" comes from — see this module's header doc for why calling this BEFORE createRunningRun() is what makes self-reference impossible. */
  getPreviousSuccessfulRunStartedAt(): Promise<Date | null>
  createRunningRun(): Promise<string>
  markRunSucceeded(runId: string, summary: ChiefBriefSummaryCounts): Promise<void>
  markRunFailed(runId: string, message: string): Promise<void>
}

async function getChiefOwnerId(): Promise<string> {
  const rows = await query<{ id: string }>("SELECT id FROM agent.owners WHERE owner_key = 'chief'")
  if (rows.length === 0) throw new OwnerNotFoundError('chief')
  return rows[0].id
}

export function getDefaultChiefBriefDataSource(): ChiefBriefDataSource {
  return {
    needsJerryTasks: getNeedsJerryTasks,
    waitingTasks: getWaitingTasks,
    blockedTasks: getBlockedTasks,
    async readyTasks(now) {
      const all = await getTasksNeedingAction({ now })
      return all.filter((t) => t.reasons.includes('READY'))
    },
    pendingRecommendations: getPendingDurableMemoryRecommendations,
    decisionsAwaitingSync: getDecisionsAwaitingOpenBrainSync,
    interactionsRequiringAction: getInteractionsRequiringAction,
    recentTaskChanges: getRecentTaskChanges,
    recentDecisionEvents: getRecentDecisionEvents,
    recentInteractions: getRecentInteractions,
    assessReconciliation,
    applyReconciliationFinding,
    async planActions(tasks) {
      const plans = await Promise.all(tasks.map((t) => selectApplicablePlan(t)))
      return plans.filter((p): p is ActionPlan => p !== null)
    },
  }
}

export function getDefaultChiefRunRepository(): ChiefRunRepository {
  return {
    async getPreviousSuccessfulRunStartedAt() {
      const rows = await query<{ started_at: Date | null }>(
        `SELECT max(started_at) AS started_at FROM agent.runs WHERE run_type = 'chief_brief' AND status = 'SUCCEEDED'`
      )
      return rows[0]?.started_at ?? null
    },
    async createRunningRun() {
      const chiefOwnerId = await getChiefOwnerId()
      return withWriteTransaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO agent.runs (run_type, status, agent_owner_id, started_at) VALUES ('chief_brief', 'RUNNING', $1, now()) RETURNING id`,
          [chiefOwnerId]
        )
        return result.rows[0].id
      })
    },
    async markRunSucceeded(runId, summary) {
      await withWriteTransaction(async (client) => {
        await client.query(`UPDATE agent.runs SET status = 'SUCCEEDED', completed_at = now(), output_summary = $2 WHERE id = $1`, [
          runId,
          JSON.stringify(summary),
        ])
      })
    },
    async markRunFailed(runId, message) {
      await withWriteTransaction(async (client) => {
        await client.query(`UPDATE agent.runs SET status = 'FAILED', completed_at = now(), error_message = $2 WHERE id = $1`, [
          runId,
          message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
        ])
      })
    },
  }
}

export interface GetChiefBriefOptions {
  /**
   * Default true — safe today because RECONCILIATION_RULES is empty (see
   * this module's header doc): no finding can ever be autoApplicable until
   * a rule is registered, so this is a no-op in current production state
   * regardless of its value. Set false to run assessment-only (findings
   * still populate staleSignal; nothing is ever transitioned) — proves the
   * assess/apply split is real, not just a naming convention.
   */
  applyReconciliation?: boolean
}

export async function getChiefBrief(
  now: Date = new Date(),
  dataSource: ChiefBriefDataSource = getDefaultChiefBriefDataSource(),
  runRepository: ChiefRunRepository = getDefaultChiefRunRepository(),
  options: GetChiefBriefOptions = {}
): Promise<ChiefBrief> {
  const applyReconciliation = options.applyReconciliation ?? true

  // Step 1.
  const since = await runRepository.getPreviousSuccessfulRunStartedAt()

  // Step 2.
  const runId = await runRepository.createRunningRun()

  try {
    // Step 3a — initial snapshot.
    let [needsJerryTasks, waitingTasks, blockedTasks, readyTasks, pendingRecommendations, decisionsAwaitingSync, interactionsRequiringAction] =
      await Promise.all([
        dataSource.needsJerryTasks(),
        dataSource.waitingTasks(),
        dataSource.blockedTasks(),
        dataSource.readyTasks(now),
        dataSource.pendingRecommendations(),
        dataSource.decisionsAwaitingSync(),
        dataSource.interactionsRequiringAction(),
      ])

    // Step 3b — reconciliation assessment, over every non-terminal task
    // currently in the brief's task-bearing sections (not just READY —
    // staleSignal is meaningful for WAITING/BLOCKED/NEEDS_JERRY too).
    const tasksForAssessment: TaskSummary[] = [...needsJerryTasks, ...waitingTasks, ...blockedTasks, ...readyTasks]
    const findings = await dataSource.assessReconciliation(tasksForAssessment)

    // Step 3c — apply autoApplicable findings (unless assessment-only),
    // then RE-FETCH so the brief reflects real post-transition state. A
    // task reconciled to DONE this way is excluded from chiefCanHandle (or
    // wherever it was) because it is genuinely no longer READY in the
    // database by the time these lists are re-read — not because anything
    // here filters it out.
    const autoApplicable = applyReconciliation ? findings.filter((f) => f.autoApplicable) : []
    if (autoApplicable.length > 0) {
      const taskById = new Map(tasksForAssessment.map((t) => [t.id, t]))
      for (const finding of autoApplicable) {
        const task = taskById.get(finding.taskId)
        if (task) await dataSource.applyReconciliationFinding(finding, task)
      }
      ;[needsJerryTasks, waitingTasks, blockedTasks, readyTasks] = await Promise.all([
        dataSource.needsJerryTasks(),
        dataSource.waitingTasks(),
        dataSource.blockedTasks(),
        dataSource.readyTasks(now),
      ])
    }

    const [recentTaskEvents, recentDecisionEvents, recentInteractions] =
      since === null
        ? [[], [], []]
        : await Promise.all([dataSource.recentTaskChanges(since), dataSource.recentDecisionEvents(since), dataSource.recentInteractions(since)])

    // Step 3d — Phase 1D planning: read-only (planActions calls ONLY
    // selectApplicablePlan(), never execute()), over the FINAL
    // (post-reconciliation) task snapshot so a plan is never shown for a
    // task that was just auto-completed in step 3c.
    const actionPlans = await dataSource.planActions([...needsJerryTasks, ...waitingTasks, ...blockedTasks, ...readyTasks])

    const inputs: ChiefBriefInputs = {
      needsJerryTasks,
      waitingTasks,
      blockedTasks,
      readyTasks,
      pendingRecommendations,
      decisionsAwaitingSync,
      interactionsRequiringAction,
      recentTaskEvents,
      recentDecisionEvents,
      recentInteractions,
      findings,
      actionPlans,
    }

    const brief = computeChiefBrief(inputs, now, since)

    // Step 4.
    await runRepository.markRunSucceeded(runId, brief.summary)

    return brief
  } catch (err) {
    // Step 5 — best-effort; never let a logging failure mask the real error.
    await runRepository.markRunFailed(runId, err instanceof Error ? err.message : String(err)).catch(() => {})
    throw err
  }
}

export * from './chiefBriefTypes'
export { computeChiefBrief, computeResolutionOwner } from './chiefBriefRules'
export type { ChiefBriefInputs } from './chiefBriefRules'
