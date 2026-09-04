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

  script(executionId: string, outcome: TestExecutorOutcome): void {
    this.responses.set(executionId, outcome)
  }

  makeSpecialistUnavailable(specialist: string): void {
    this.unavailableSpecialists.add(specialist)
  }

  canExecute(request: SpecialistExecutionRequest): boolean {
    return !this.unavailableSpecialists.has(request.specialist)
  }

  async execute(request: SpecialistExecutionRequest): Promise<TestExecutorOutcome> {
    const scripted = this.responses.get(request.executionId)
    if (!scripted) {
      throw new Error(`TestExecutor has no scripted response for executionId "${request.executionId}" — call .script() before running this execution.`)
    }
    return scripted
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
