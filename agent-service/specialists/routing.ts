// Chief Phase 2E — executor routing (spec section 5). Chief asks "which
// AVAILABLE executor can validly perform this execution?" — never "which
// vendor owns this specialist?". Routing is by specialist role +
// methodology + required capabilities + which configured providers
// actually exist, checked via each executor's own canExecute(). If none
// qualify, the execution is EXECUTOR_UNAVAILABLE and does not advance —
// no silent fallback to a fake/manual result relabeled as automated.

import { registerExecution, markExecutorUnavailable, runExecution, type ExecutionStore, type SpecialistExecutor, type SpecialistExecutionRequest, type AcceptResultOutcome, type ExecutionRecord } from './executor'

// Provider preference policy (spec section 10) now lives in
// remoteAiExecutor.ts (RemoteAiExecutor applies it internally on every
// execute() call) — re-exported here so routing-level callers/tests have
// one place to import both execution routing and provider preference from.
export { SPECIALIST_PROVIDER_PREFERENCE, orderAdaptersForSpecialist } from './remoteAiExecutor'

/**
 * Pure selection: the first executor (in the given priority order) whose
 * own canExecute() says yes. Order matters — pass the most-preferred
 * REMOTE_AI executor(s) before any MANUAL_EXECUTOR fallback, so
 * autonomous execution is always tried first and manual is genuinely a
 * fallback, not a coin flip.
 */
export function selectExecutor(request: SpecialistExecutionRequest, executors: readonly SpecialistExecutor[]): SpecialistExecutor | null {
  return executors.find((e) => e.canExecute(request)) ?? null
}

/**
 * The routed equivalent of executor.ts's runExecution: tries every
 * candidate executor in order via selectExecutor, and only when NONE
 * qualifies does it register the execution as EXECUTOR_UNAVAILABLE
 * itself (rather than leaving that to a single executor's own
 * canExecute()=false path, which only ever knows about itself).
 */
export async function runExecutionRouted(
  store: ExecutionStore,
  request: SpecialistExecutionRequest,
  executors: readonly SpecialistExecutor[],
  now: () => string = () => new Date().toISOString()
): Promise<AcceptResultOutcome | ExecutionRecord> {
  const chosen = selectExecutor(request, executors)
  if (!chosen) {
    const record = await registerExecution(store, request, null, now)
    const tried = executors.map((e) => e.executorType).join(', ') || '(no executors configured)'
    return markExecutorUnavailable(store, record.request.executionId, `no qualified executor for specialist=${request.specialist} methodology=${request.methodologyId}/${request.methodologyVersion} — tried: ${tried}`)
  }
  return runExecution(store, request, chosen, now)
}
