// Chief Phase 2F — cost/runaway guardrails (spec section 20). Deliberately
// simple: bounded counters checked by the driver before it does more
// work, not an elaborate budget/accounting system. Exhausting any limit
// routes the run to NEEDS_JERRY with a plain-English explanation — never
// silently stops, never loops forever.

export interface DriverGuardrails {
  /** Max M4<->M5 gap-loop iterations before attempting plan relaxation (see coveragePlanRelaxation.ts) — prevents infinite gap research within one plan. Never raised to brute-force an over-ambitious plan; see maxPlanRelaxationRounds instead. */
  maxLoopIterations: number
  /** Max retry attempts for a single execution before escalating — prevents unbounded retry loops. */
  maxRetriesPerExecution: number
  /** Max specialist executions this driver will run concurrently (fan-out) for one project. */
  maxConcurrentExecutions: number
  /**
   * Max times stepM4 is allowed to respond to exhausting maxLoopIterations
   * by relaxing the plan (or, if nothing is yet eligible for relaxation,
   * granting one more full maxLoopIterations budget) before escalating to
   * NEEDS_JERRY for real. Total bounded research capacity across a run is
   * therefore maxLoopIterations * (maxPlanRelaxationRounds + 1) — still a
   * small, finite number, never unlimited. A metro that still can't close
   * its (by then already-relaxed) gaps after this many rounds is treated
   * as genuinely needing a human/product decision, not a planning mistake.
   */
  maxPlanRelaxationRounds: number
  /** Min real dispatched-research attempts a gap needs before it can be classified as an unrealistic target rather than genuine missing coverage — see coveragePlanRelaxation.ts's classifyGapForRelaxation. */
  minResearchDispatchesBeforeRelaxation: number
}

export const DEFAULT_DRIVER_GUARDRAILS: DriverGuardrails = Object.freeze({
  maxLoopIterations: 5,
  maxRetriesPerExecution: 2,
  maxConcurrentExecutions: 6,
  maxPlanRelaxationRounds: 3,
  minResearchDispatchesBeforeRelaxation: 2,
})

export class GuardrailExceededError extends Error {
  constructor(
    public readonly guardrail: keyof DriverGuardrails,
    public readonly limit: number,
    public readonly actual: number
  ) {
    super(`Guardrail "${guardrail}" exceeded: limit ${limit}, actual ${actual} — routing to NEEDS_JERRY rather than continuing unbounded.`)
    this.name = this.constructor.name
  }
}

export function assertWithinGuardrail(guardrail: keyof DriverGuardrails, limit: number, actual: number): void {
  if (actual > limit) throw new GuardrailExceededError(guardrail, limit, actual)
}
