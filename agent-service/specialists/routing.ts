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

// ---------------------------------------------------------------------------
// Hard playbook/methodology isolation guard. metroLaunchDriver.ts and
// destinationHubDriver.ts both funnel every execution through this SAME
// runExecutionRouted() — the one chokepoint both drivers share — so this
// is where a Metro Launch project physically CANNOT reach a Destination
// (DVA-1/DVA-2/DAP) methodology, by construction, not by convention. A
// Metro project accidentally passed a DVA methodologyId (a bug in a
// caller, a copy-pasted request, a future driver mistake) fails loudly
// and immediately, before any executor or provider is even selected —
// never a silent misroute that burns a real AI call against the wrong
// workflow.
// ---------------------------------------------------------------------------

const DESTINATION_ONLY_METHODOLOGY_IDS: ReadonlySet<string> = new Set(['destination/dva1', 'destination/dva2', 'destination/dap'])
const DESTINATION_HUB_PLAYBOOK_KEY_GUARD = 'destination_hub_lifecycle'

function assertMethodologyAllowedForPlaybook(request: SpecialistExecutionRequest): void {
  if (DESTINATION_ONLY_METHODOLOGY_IDS.has(request.methodologyId) && request.playbookKey !== DESTINATION_HUB_PLAYBOOK_KEY_GUARD) {
    throw new Error(
      `Orchestration guard violation: methodology "${request.methodologyId}" may only be invoked by playbookKey "${DESTINATION_HUB_PLAYBOOK_KEY_GUARD}", but this request came from playbookKey "${request.playbookKey}" (projectId=${request.projectId}). A Metro Launch (or any non-Destination) project must never invoke a DVA methodology.`
    )
  }
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
  assertMethodologyAllowedForPlaybook(request)
  const chosen = selectExecutor(request, executors)
  if (!chosen) {
    const record = await registerExecution(store, request, null, now)
    const tried = executors.map((e) => e.executorType).join(', ') || '(no executors configured)'
    return markExecutorUnavailable(store, record.request.executionId, `no qualified executor for specialist=${request.specialist} methodology=${request.methodologyId}/${request.methodologyVersion} — tried: ${tried}`)
  }
  return runExecution(store, request, chosen, now)
}
