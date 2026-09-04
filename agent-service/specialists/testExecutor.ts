// Chief Phase 2D — deterministic fake executor for integration tests
// (spec section 29). Stands in for LOCAL_TOOL_EXECUTOR: never calls a
// real AI provider, never does real research — every response is
// pre-scripted by the test that constructs it. This is what proves the
// San Diego dry run (sanDiegoDryRun.test.ts) and the DVA/DAP dry run
// (playbooks/destinationDvaDryRun.test.ts) without performing any real
// research or destination outreach, per the explicit Phase 2D boundary.

import type { SpecialistExecutor, SpecialistExecutionRequest } from './executor'
import type { SpecialistResultEnvelope } from './types'

export type TestExecutorOutcome = SpecialistResultEnvelope | { unavailable: true; reason: string }

/**
 * Keyed by executionId so a test can script exactly one response per
 * execution — a resolver that doesn't recognize the executionId is
 * itself a test bug, not a silently-passed default, so it throws rather
 * than fabricating a generic "success."
 */
export class TestExecutor implements SpecialistExecutor {
  readonly executorType = 'LOCAL_TOOL_EXECUTOR' as const
  private responses = new Map<string, TestExecutorOutcome>()
  private unavailableSpecialists = new Set<string>()
  /**
   * Phase 2F addition — a fallback list of (predicate, responder) pairs,
   * checked IN ORDER only when no exact executionId match exists. Lets a
   * driver-level test respond by STAGE/OBJECTIVE SHAPE (e.g. "any M5
   * targeted-gap execution for the Shopping category") instead of having
   * to hand-compute every internally-generated parallel-fan-out
   * executionId — the driver test cares about behavior, not the exact
   * internal id scheme. Exact `.script()` entries still take priority,
   * so existing executionId-keyed tests are completely unaffected.
   */
  private resolvers: Array<{ matches: (request: SpecialistExecutionRequest) => boolean; respond: (request: SpecialistExecutionRequest) => TestExecutorOutcome }> = []

  script(executionId: string, outcome: TestExecutorOutcome): void {
    this.responses.set(executionId, outcome)
  }

  scriptWhen(matches: (request: SpecialistExecutionRequest) => boolean, respond: (request: SpecialistExecutionRequest) => TestExecutorOutcome): void {
    this.resolvers.push({ matches, respond })
  }

  makeSpecialistUnavailable(specialist: string): void {
    this.unavailableSpecialists.add(specialist)
  }

  canExecute(request: SpecialistExecutionRequest): boolean {
    return !this.unavailableSpecialists.has(request.specialist)
  }

  async execute(request: SpecialistExecutionRequest): Promise<TestExecutorOutcome> {
    const scripted = this.responses.get(request.executionId)
    if (scripted) return scripted
    const resolver = this.resolvers.find((r) => r.matches(request))
    if (resolver) return resolver.respond(request)
    throw new Error(`TestExecutor has no scripted response or matching resolver for executionId "${request.executionId}" (objective: "${request.objective}") — call .script() or .scriptWhen() before running this execution.`)
  }
}

/** Convenience builder for a passing envelope — tests still override whatever fields matter to the specific case. */
export function fakeEnvelope(overrides: Partial<SpecialistResultEnvelope> & Pick<SpecialistResultEnvelope, 'taskId' | 'objective' | 'evidence' | 'methodologyId' | 'methodologyVersion'>): SpecialistResultEnvelope {
  return {
    actionsPerformed: ['fake executor scripted action'],
    artifacts: [],
    confidence: 'HIGH',
    blockers: [],
    discoveredFollowUpWork: [],
    recommendedNextAction: 'proceed',
    jerryRequired: false,
    jerryReason: null,
    ...overrides,
  }
}
