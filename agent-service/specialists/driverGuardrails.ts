// Chief Phase 2F — cost/runaway guardrails (spec section 20). Deliberately
// simple: bounded counters checked by the driver before it does more
// work, not an elaborate budget/accounting system. Exhausting any limit
// routes the run to NEEDS_JERRY with a plain-English explanation — never
// silently stops, never loops forever.

export interface DriverGuardrails {
  /** Max M4<->M5 gap-loop iterations before escalating — prevents infinite gap research. */
  maxLoopIterations: number
  /** Max retry attempts for a single execution before escalating — prevents unbounded retry loops. */
  maxRetriesPerExecution: number
  /** Max specialist executions this driver will run concurrently (fan-out) for one project. */
  maxConcurrentExecutions: number
}

export const DEFAULT_DRIVER_GUARDRAILS: DriverGuardrails = Object.freeze({
  maxLoopIterations: 5,
  maxRetriesPerExecution: 2,
  maxConcurrentExecutions: 6,
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
