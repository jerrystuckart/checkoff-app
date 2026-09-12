// agent-service/playbooks/packetExecutionBudget.ts
//
// Chief Phase 3C, Phase A — METRO_FINISHER_PACKET_EXECUTION's budget. A
// Finisher lead is real, bounded follow-up work (research call + Places
// lookup + editorial write + certification), never an unbounded loop.
// This module is the pure stopping-rule decision: given a configured
// budget and the current queue/spend state, should the packet-execution
// stage attempt another candidate?
//
// Deliberately generic — every field is a real, caller-configured input
// (via MetroDriverDeps.packetExecutionBudget / a CLI flag or JSON file,
// see cli.ts), never a metro-specific constant baked in here. The
// exported DEFAULT_PACKET_EXECUTION_BUDGET is only a fallback for a
// caller that doesn't configure one — always overridable.
//
// Three independent stopping conditions, first one hit wins (order
// doesn't change the outcome, only which reason is reported):
//   1. Incremental spend (USD) for this stage has reached the cap —
//      checked against the SAME metroCostReport.ts-style accumulated
//      cost every other stage's usageByStage entry already tracks.
//   2. The bounded candidate-certification-attempt count has been
//      reached.
//   3. The prioritized queue of HIGH-priority (or any) leads is simply
//      empty — "stop when the queue is exhausted," never pad or force
//      more attempts just to spend the rest of the budget.

export interface PacketExecutionBudget {
  /** Max incremental USD this run may spend on METRO_FINISHER_PACKET_EXECUTION's own AI calls (research + editorial), on top of whatever the rest of the build already spent. */
  maxIncrementalSpendUsd: number
  /** Max number of candidate late-add certification ATTEMPTS (not just successes) this stage will make in one pass. */
  maxCertificationAttempts: number
}

/** A real, but generic, starting point — every field is meant to be overridden per metro via MetroDriverDeps.packetExecutionBudget (see cli.ts's --packet-execution-budget flag). */
export const DEFAULT_PACKET_EXECUTION_BUDGET: PacketExecutionBudget = {
  maxIncrementalSpendUsd: 10,
  maxCertificationAttempts: 25,
}

export interface PacketExecutionQueueState {
  /** Incremental USD spent so far by this stage (read from state.usageByStage['METRO_FINISHER_PACKET_EXECUTION'].costUsd — the same accumulated-cost mechanism metroCostReport.ts already reports). */
  spentUsd: number
  /** Candidate certification attempts already made in this pass. */
  attemptsMade: number
  /** How many prioritized leads remain in the queue, not yet attempted. */
  remainingLeads: number
}

export interface PacketExecutionContinuationDecision {
  shouldContinue: boolean
  reason: string
}

/**
 * Real, testable stopping-rule enforcement — never just a prompt
 * instruction. Called before each candidate attempt.
 */
export function evaluatePacketExecutionContinuation(budget: PacketExecutionBudget, state: PacketExecutionQueueState): PacketExecutionContinuationDecision {
  if (state.remainingLeads <= 0) {
    return { shouldContinue: false, reason: 'Queue exhausted — every prioritized lead has already been attempted (rejected or certified). Never padding to hit a budget number.' }
  }
  if (state.attemptsMade >= budget.maxCertificationAttempts) {
    return { shouldContinue: false, reason: `Certification-attempt budget reached (${state.attemptsMade}/${budget.maxCertificationAttempts} attempts) — stopping with ${state.remainingLeads} lead(s) still unattempted.` }
  }
  if (state.spentUsd >= budget.maxIncrementalSpendUsd) {
    return { shouldContinue: false, reason: `Incremental spend budget reached ($${state.spentUsd.toFixed(2)}/$${budget.maxIncrementalSpendUsd.toFixed(2)}) — stopping with ${state.remainingLeads} lead(s) still unattempted.` }
  }
  return { shouldContinue: true, reason: `Budget available ($${state.spentUsd.toFixed(2)}/$${budget.maxIncrementalSpendUsd.toFixed(2)}, ${state.attemptsMade}/${budget.maxCertificationAttempts} attempts) and ${state.remainingLeads} lead(s) remain.` }
}
