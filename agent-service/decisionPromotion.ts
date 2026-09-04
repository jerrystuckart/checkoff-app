// Phase 1A — Chief's only write into the durable-memory promotion
// workflow. agent_service has EXECUTE on agent.recommend_decision_for_open_brain()
// ONLY — approve/reject/reconsider are agent_approver-only (see
// supabase/migrations/20260901_agent_decisions_promotion_workflow.sql) and
// deliberately have NO corresponding function here: agent-service's DB
// connection authenticates as agent_service and can never call them, so a
// wrapper for them here would be dead code masquerading as a supported
// operation. For Phase 1A those three are invoked directly via the
// Supabase SQL editor (as agent_approver) by Jerry — see the migration's
// own header doc.

import { getDefaultDecisionRepository, writeDecisionToOpenBrain, type DecisionOpenBrainRepository } from './openBrainDecisions'
import { getDefaultOpenBrainClient, type OpenBrainClient } from './openBrainClient'
import type { DecisionOpenBrainWriteResult } from './openBrainTypes'
import { DecisionNotFoundError, DecisionAlreadyEligibleError, DecisionRejectedForDurableMemoryError } from './errors'

export type RecommendDecisionForOpenBrainResult =
  | { status: 'RECOMMENDED'; decisionId: string }
  | { status: 'ALREADY_RECOMMENDED'; decisionId: string }

export async function recommendDecisionForOpenBrain(
  decisionId: string,
  reason: string,
  repository: DecisionOpenBrainRepository = getDefaultDecisionRepository()
): Promise<RecommendDecisionForOpenBrainResult> {
  const row = await repository.fetchDecision(decisionId)
  if (!row) throw new DecisionNotFoundError(decisionId)

  // Pre-checks mirror agent.recommend_decision_for_open_brain()'s own guards
  // — defense-in-depth at the DB layer is the real backstop (see the
  // migration), these just give a fast, typed failure without a round trip
  // when the outcome is already knowable from data already in hand.
  if (row.openBrainEligible) throw new DecisionAlreadyEligibleError(decisionId)
  if (row.durableMemoryRecommendation === 'REJECTED') throw new DecisionRejectedForDurableMemoryError(decisionId)

  const alreadyRecommended = row.durableMemoryRecommendation === 'RECOMMENDED'

  await repository.recommend(decisionId, reason)

  return alreadyRecommended ? { status: 'ALREADY_RECOMMENDED', decisionId } : { status: 'RECOMMENDED', decisionId }
}

/**
 * The one entry point that should be used to perform an actual Open Brain
 * sync for an approved decision — wraps the existing, UNCHANGED
 * writeDecisionToOpenBrain() (still exactly Phase 0F/0G/0H's proven path:
 * one capture_thought attempt, exact-lookup reconciliation, no retry) with
 * the decision_events bookkeeping the Phase 1A design called for but this
 * codebase never actually wired up until now. expectedOpenBrainThoughtId
 * is derived from the current row automatically — callers never need to
 * track sync state themselves; a replay naturally lands on the
 * already-synced verification path (LOCAL_RECORDED), which logs no new
 * event (an event is written only when something actually changed:
 * CREATED or RECONCILED_EXISTING — matching "written exactly once").
 */
export async function syncDecisionToOpenBrain(
  decisionId: string,
  actorOwnerKey = 'jerry',
  client: OpenBrainClient = getDefaultOpenBrainClient(),
  repository: DecisionOpenBrainRepository = getDefaultDecisionRepository()
): Promise<DecisionOpenBrainWriteResult> {
  const row = await repository.fetchDecision(decisionId)
  if (!row) throw new DecisionNotFoundError(decisionId)

  try {
    const result = await writeDecisionToOpenBrain({ decisionId, actorOwnerKey, expectedOpenBrainThoughtId: row.openBrainThoughtId }, client, repository)
    if (result.status === 'CREATED' || result.status === 'RECONCILED_EXISTING') {
      await repository.recordSyncEvent(decisionId, 'OPEN_BRAIN_SYNC_SUCCEEDED', `thought ${result.thoughtId}`)
    }
    return result
  } catch (err) {
    await repository.recordSyncEvent(decisionId, 'OPEN_BRAIN_SYNC_FAILED', err instanceof Error ? err.message : String(err)).catch(() => {
      // Never let a logging failure mask the real error below.
    })
    throw err
  }
}
