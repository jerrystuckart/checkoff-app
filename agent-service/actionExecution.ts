// Phase 1D — the autonomous execution loop. Separate entry point from
// getChiefBrief() (briefing and execution stay genuinely separate calls —
// see chiefBrief.ts's own module doc for why that split already mattered
// in Phase 1C). This is the ONLY place in agent-service that ever calls
// transitionTask() on behalf of an autonomous action handler — a handler's
// execute() reports a structured outcome; this loop is what turns that
// outcome into an actual transition, which keeps every transition this
// system can autonomously make visible in exactly one place.
//
// NARROW TRANSITION AUTHORITY (the point of this file): autonomous
// execution may ONLY ever call transitionTask() for three purposes —
//   1. claim: READY -> IN_PROGRESS (always, before any handler.execute())
//   2. an OPERATIONAL_CONDITION reported by the handler -> WAITING/BLOCKED/
//      NEEDS_JERRY only (never DONE, never CANCELED — the ActionExecuteOutcome
//      type itself excludes those from nonterminalStatus, so this isn't
//      just a runtime check)
//   3. DONE -> ONLY after handler.verifyCompletion() independently returns
//      true. A handler reporting "done" (READY_TO_VERIFY) with no
//      verifyCompletion() defined is a hard error here, not a silent
//      pass-through — a transition is never trusted as its own evidence.
// Nothing here can transition a task to CANCELED, and nothing here can be
// used to bypass reconciliation's own boundary (Phase 1C) — supersession/
// cancellation stays exclusively human-reviewed via that separate path.
//
// Phase 1E adds exactly one more capability to this loop: CLAIMED_WITH_
// PLAN_UPDATE routes to updateTaskPlan() (Phase 0D's existing safe
// task-plan mutation — no new write primitive) to advance next_action.
// This never changes task STATUS beyond the claim already made — the task
// stays IN_PROGRESS. See actionHandlers.ts's ActionExecuteOutcome doc.

import type { TaskSummary, TaskStatus } from './types'
import type { ActionHandler } from './actionHandlers'
import type { ActionExecutionResult } from './actionPolicyTypes'
import { transitionTask, updateTaskPlan, type TransitionTaskInput, type UpdateTaskPlanInput } from './mutations'
import { query } from './db'
import { TASK_SELECT, TASK_FROM } from './queries'
import { mapTaskRow, type TaskRow } from './mappers'

export interface ActionExecutionDataSource {
  fetchTask(taskId: string): Promise<TaskSummary | null>
  transition(input: TransitionTaskInput): Promise<TaskSummary>
  /** Phase 1E — routes CLAIMED_WITH_PLAN_UPDATE outcomes. Never changes status. */
  updatePlan(input: UpdateTaskPlanInput): Promise<TaskSummary>
}

export function getDefaultActionExecutionDataSource(): ActionExecutionDataSource {
  return {
    async fetchTask(taskId) {
      const rows = await query<TaskRow>(`SELECT ${TASK_SELECT} ${TASK_FROM} WHERE t.id = $1`, [taskId])
      return rows.length > 0 ? mapTaskRow(rows[0]) : null
    },
    async transition(input) {
      const result = await transitionTask(input)
      return result.task
    },
    async updatePlan(input) {
      const result = await updateTaskPlan(input)
      return result.task
    },
  }
}

/**
 * Runs one autonomous action to completion (or as far as it can safely
 * go). `expectedUpdatedAt` should be the `updatedAt` of the task snapshot
 * the plan was built from — this is re-verified against a FRESH read
 * before anything is claimed, so state that changed since the brief/plan
 * was generated is caught rather than acted on.
 *
 * Refuses (throws) rather than executing when:
 *   - handler.policy is not AUTO_ALLOWED (defense-in-depth — callers
 *     should never reach this with a non-auto handler, but this function
 *     does not trust that)
 *   - the task is no longer READY, or has been modified, since the plan
 *     was made
 *   - the handler no longer applies on re-check (its own plan() returns
 *     null against the fresh state)
 *   - a handler reports READY_TO_VERIFY but defines no verifyCompletion()
 */
export async function executeAutonomousAction(
  taskId: string,
  expectedUpdatedAt: Date,
  handler: ActionHandler,
  dataSource: ActionExecutionDataSource = getDefaultActionExecutionDataSource(),
  actorOwnerKey = 'chief'
): Promise<ActionExecutionResult> {
  if (handler.policy !== 'AUTO_ALLOWED') {
    throw new Error(`Handler for action type "${handler.actionType}" is not AUTO_ALLOWED (policy=${handler.policy}) — refusing to execute autonomously`)
  }

  // Re-fetch fresh state immediately before execution — required even
  // though the caller already had a snapshot, because time may have
  // passed between planning and this call.
  const task = await dataSource.fetchTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'READY') {
    throw new Error(`Task ${taskId} is no longer READY (now ${task.status}) — state changed since the plan was made; refusing to act on stale assumptions`)
  }
  if (task.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new Error(`Task ${taskId} was modified since the plan was made — refusing to act on stale assumptions`)
  }

  const plan = await handler.plan(task)
  if (!plan) {
    throw new Error(`Handler for "${handler.actionType}" no longer applies to task ${taskId} on re-check — refusing to execute`)
  }

  // 1. Claim. Uses transitionTask()'s existing optimistic-concurrency
  // precondition and row locking — races are already handled there
  // (Phase 0D), unchanged.
  const claimed = await dataSource.transition({
    taskId,
    toStatus: 'IN_PROGRESS',
    actorOwnerKey,
    expectedUpdatedAt: task.updatedAt,
    ownerKey: actorOwnerKey,
    idempotencyKey: `phase1d-claim:${taskId}:${handler.actionType}`,
  })

  if (!handler.execute) {
    return { status: 'CLAIMED', taskStatusAfter: claimed.status, note: `Claimed for ${handler.actionType}; this handler defines no execute() step.` }
  }

  const outcome = await handler.execute(claimed)

  if (outcome.outcome === 'CLAIMED_ONLY') {
    return { status: 'CLAIMED', taskStatusAfter: claimed.status, note: outcome.note }
  }

  if (outcome.outcome === 'CLAIMED_WITH_PLAN_UPDATE') {
    // Advances next_action only — never a status transition beyond the
    // claim already made above. updateTaskPlan() is Phase 0D's existing
    // safe task-plan mutation; nothing new is introduced here.
    const result = await dataSource.updatePlan({
      taskId,
      actorOwnerKey,
      expectedUpdatedAt: claimed.updatedAt,
      nextAction: outcome.nextAction,
    })
    return { status: 'PLAN_UPDATED', taskStatusAfter: result.status, note: outcome.note }
  }

  if (outcome.outcome === 'OPERATIONAL_CONDITION') {
    // 2. A deterministic operational condition the handler encountered —
    // routed to exactly one of WAITING/BLOCKED/NEEDS_JERRY, never
    // anything else (enforced by ActionExecuteOutcome's own type, not
    // just this runtime path).
    const result = await dataSource.transition({
      taskId,
      toStatus: outcome.nonterminalStatus,
      actorOwnerKey,
      expectedUpdatedAt: claimed.updatedAt,
      note: outcome.note,
      blockerNote: outcome.blockerNote,
      nextCheckAt: outcome.nextCheckAt,
      jerryRequest: outcome.jerryRequest,
    })
    return { status: 'RETURNED_TO_NONTERMINAL', taskStatusAfter: result.status, note: outcome.note }
  }

  // outcome.outcome === 'READY_TO_VERIFY'
  // 3. DONE only after an independent, handler-owned structured check —
  // the transition itself is never the evidence.
  if (!handler.verifyCompletion) {
    throw new Error(
      `Handler for "${handler.actionType}" reported READY_TO_VERIFY but defines no verifyCompletion() — ` +
        `a task transition can never itself be used as evidence that the underlying work occurred`
    )
  }
  const proven = await handler.verifyCompletion(claimed)
  if (!proven) {
    return {
      status: 'NOT_YET_VERIFIABLE',
      taskStatusAfter: 'IN_PROGRESS' as TaskStatus,
      note: 'Executor reported readiness but structured verification did not confirm completion — leaving task IN_PROGRESS for a future pass.',
    }
  }
  const done = await dataSource.transition({
    taskId,
    toStatus: 'DONE',
    actorOwnerKey,
    expectedUpdatedAt: claimed.updatedAt,
    note: outcome.note,
  })
  return { status: 'COMPLETED', taskStatusAfter: done.status, note: outcome.note }
}
