// Chief Phase 3C — shared test-only fixture for the new metro_finisher
// specialist. Every existing full-driver test (San Diego/Vienna dry runs,
// the various metroLaunchDriver*.test.ts files) drives a run all the way
// through M10, which now passes through METRO_FINISHER_DEEP_RESEARCH
// first. None of those tests are ABOUT the Finisher stage, so they all
// want the same thing: a minimal, structurally-valid, "nothing to report"
// MetroFinisherReport that lets the run proceed — never a hand-authored
// per-test scripted response repeated seven times over.
//
// A test that DOES want to exercise Finisher behavior scripts its own
// response for `request.specialist === 'metro_finisher'` (or the exact
// executionId) BEFORE calling this — TestExecutor's exact-match/first-
// registered-resolver-wins semantics mean this generic fallback never
// overrides a more specific script already registered by the caller, as
// long as the caller registers its own resolver first (TestExecutor
// checks resolvers in registration order and returns the first match, so
// register this fixture LAST if you want a specific scriptWhen to win, or
// don't call this helper at all in a test that scripts its own metro_finisher
// response).

import type { TestExecutor } from './testExecutor'
import { fakeEnvelope } from './testExecutor'
import type { SpecialistExecutionRequest } from './executor'
import type { MetroFinisherReport } from '../playbooks/metroFinisherReport'

export function buildPassingMetroFinisherReport(metro: string): MetroFinisherReport {
  return {
    metro,
    generatedAt: '2026-09-11T00:00:00Z',
    catalogAssessment: { currentItemCount: 0, strengths: [], weaknesses: [], categoryGaps: [], neighborhoodGaps: [] },
    cityIdentity: {
      signatureFoodAndDrink: [],
      ritualsAndTraditions: [],
      artisanAndMakerCulture: [],
      localOnlyExperiences: [],
      unusualOrHidden: [],
      sportsAndCivicCulture: [],
    },
    mustHaveMissingExperiences: [],
    enrichmentCandidates: [],
    neighborhoodRecommendations: { keep: [], split: [], add: [], reject: [] },
    themedListOpportunities: [],
    duplicateOrIdentityConcerns: [],
    finalAssessment: { readyToFinish: true, recommendedAdditionalItemRange: { min: 0, max: 0 }, highestPriorityNextActions: [] },
  }
}

/**
 * Registers a generic fallback so ANY metro_finisher call this test drives
 * through gets a clean, passing, "nothing to report" result — the correct
 * default for tests that aren't about Finisher behavior at all. Call this
 * right after constructing the TestExecutor, before other resolvers that
 * should take priority are irrelevant here since TestExecutor tries exact
 * `.script()` entries first, then resolvers in the order registered — so
 * this being registered early is fine; a test wanting different Finisher
 * behavior should use `.script(executionId, ...)` (exact match always
 * wins) rather than relying on resolver order.
 */
export function scriptPassingMetroFinisher(executor: TestExecutor): void {
  executor.scriptWhen(
    (request: SpecialistExecutionRequest) => request.specialist === 'metro_finisher',
    (request: SpecialistExecutionRequest) =>
      fakeEnvelope({
        taskId: request.executionId,
        objective: request.objective,
        evidence: { report: buildPassingMetroFinisherReport(request.metroId ?? request.projectId) },
        methodologyId: request.methodologyId,
        methodologyVersion: request.methodologyVersion,
      })
  )
}
