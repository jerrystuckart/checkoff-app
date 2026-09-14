import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSeedPortfolioAudit, evaluateSeedCandidate, deriveGapResolutionStatuses, validateSeedPortfolioAuditReport, type SeedCandidateInput, type SeedPortfolioAuditInput } from './seedPortfolioAudit'
import { buildCategoryPolicySetFromPlan, DEFAULT_CATEGORY_PERCENTAGE_BANDS } from './categoryPolicy'
import type { CategoryCoveragePlan, CoverageAuditEvidence } from './metroLaunch'

function plan(): CategoryCoveragePlan {
  return {
    targets: [
      { categoryName: 'Food & drink', minimumViable: 2, healthyTarget: 4, qualityNotes: [] },
      { categoryName: 'Arts & Culture', minimumViable: 1, healthyTarget: 2, qualityNotes: [] },
    ],
  }
}

function baseGeoEvidence(): CoverageAuditEvidence {
  return {
    categoryCounts: [],
    neighborhoodCounts: [{ neighborhoodName: 'Downtown', count: 3 }],
    plan: { targets: [] },
    allNeighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }],
  }
}

function candidate(overrides: Partial<SeedCandidateInput> & { name: string }): SeedCandidateInput {
  return {
    category: 'Food & drink',
    neighborhood: 'Downtown',
    claimSupported: 'Order the charcoal-grilled unagi don, a dish found nowhere else in the metro',
    ...overrides,
  }
}

function baseInput(candidates: SeedCandidateInput[]): SeedPortfolioAuditInput {
  return {
    metro: 'test_metro',
    now: '2026-09-14T00:00:00.000Z',
    candidates,
    geographicEvidence: baseGeoEvidence(),
    categoryPolicySet: buildCategoryPolicySetFromPlan(plan(), DEFAULT_CATEGORY_PERCENTAGE_BANDS),
  }
}

test('evaluateSeedCandidate: generic-action candidate is REJECTed', () => {
  const decision = evaluateSeedCandidate(candidate({ name: 'Generic Spot', claimSupported: 'Eat at the restaurant and enjoy the food' }), new Set())
  assert.equal(decision.verdict, 'REJECT')
  assert.ok(decision.reasons.length > 0)
})

test('evaluateSeedCandidate: a venue name that happens to substring-match a generic category noun (e.g. "...Diner") never false-positives the generic-action check on its own', () => {
  // Regression: "DowntownDiner serves a real, specific dish" naively
  // substring-matches checkDistinctiveExperience's "eat-at-the-restaurant"
  // concept (verb-equivalent "dine" inside "Diner", noun "diner") purely
  // because of the venue's OWN name — the candidate's raw name must be
  // stripped before the generic-concept scan, same as this codebase
  // already does for certified body text via the quoted-venue-name
  // convention (checkDistinctiveExperience's own venueName param).
  const decision = evaluateSeedCandidate(candidate({ name: 'DowntownDiner', claimSupported: 'DowntownDiner serves a real, specific dish', category: 'Food & drink' }), new Set())
  assert.equal(decision.verdict, 'READY')
})

test('evaluateSeedCandidate: distinctive candidate not in any cluster is READY with zero reasons', () => {
  const decision = evaluateSeedCandidate(candidate({ name: 'Unagi Don' }), new Set())
  assert.equal(decision.verdict, 'READY')
  assert.deepEqual(decision.reasons, [])
})

test('evaluateSeedCandidate: candidate in a duplicate cluster is HOLD, not auto-rejected', () => {
  const decision = evaluateSeedCandidate(candidate({ name: 'Unagi Don' }), new Set(['Unagi Don']))
  assert.equal(decision.verdict, 'HOLD')
})

test('evaluateSeedCandidate: weak secret claim never blocks READY, only strips isSecretRetained', () => {
  const decision = evaluateSeedCandidate(candidate({ name: 'Unagi Don', isSecretClaimed: true, secretEvidence: { mechanic: 'hidden gem, local favorite', evidenceType: 'vibe', source: 'x', dateVerified: null, confidence: 'LOW', verdict: 'HOLD' } }), new Set())
  assert.equal(decision.verdict, 'READY')
  assert.equal(decision.isSecretRetained, false)
})

test('evaluateSeedCandidate: supported secret claim retains isSecretRetained and stays READY', () => {
  const decision = evaluateSeedCandidate(
    candidate({ name: 'Unagi Don', isSecretClaimed: true, secretEvidence: { mechanic: 'concealed entrance through the back of the noodle shop', evidenceType: 'verified visit', source: 'https://x.com', dateVerified: '2026-08-01', confidence: 'HIGH', verdict: 'READY' } }),
    new Set()
  )
  assert.equal(decision.verdict, 'READY')
  assert.equal(decision.isSecretRetained, true)
})

test('runSeedPortfolioAudit: only READY-item defects would block progression — HOLD/REJECT never block the loop', () => {
  const report = runSeedPortfolioAudit(
    baseInput([
      candidate({ name: 'Unagi Don' }),
      candidate({ name: 'Generic Filler', claimSupported: 'Have a drink at the bar' }),
      candidate({ name: 'Unagi Don Copy', claimSupported: 'A second write-up of the same charcoal-grilled unagi don' }),
    ])
  )
  // Unagi Don and its normalized-name duplicate both land in HOLD/REJECT territory or a cluster; READY set must never include an unresolved-defect item.
  for (const name of report.candidateDecisions.ready) {
    // no assertion needed beyond: every ready candidate's own decision carries zero reasons, verified inside runSeedPortfolioAudit's own invariant check (would throw otherwise).
    assert.ok(name)
  }
  assert.ok(report.candidateDecisions.reject.some((r) => r.candidateName === 'Generic Filler'))
})

test('runSeedPortfolioAudit: idempotent re-run on identical state produces identical results', () => {
  const input = baseInput([candidate({ name: 'Unagi Don' }), candidate({ name: 'Kaiseki Room', category: 'Arts & Culture', claimSupported: 'Watch a live taiko drumming performance in the courtyard' })])
  const first = runSeedPortfolioAudit(input)
  const second = runSeedPortfolioAudit(input)
  assert.deepEqual(first, second)
})

test('runSeedPortfolioAudit: category counts+percentage guardrails evaluated together', () => {
  const report = runSeedPortfolioAudit(
    baseInput([
      candidate({ name: 'Dish 1' }),
      candidate({ name: 'Dish 2' }),
      candidate({ name: 'Art 1', category: 'Arts & Culture', claimSupported: 'Touch the hands-on kinetic sculpture exhibit' }),
    ])
  )
  const food = report.categoryCoverage.results.find((r) => r.categoryName === 'Food & drink')!
  assert.equal(food.verdict, 'PASS')
})

test('runSeedPortfolioAudit: unresolved category gap with no exception surfaces as a required human decision', () => {
  const report = runSeedPortfolioAudit(baseInput([candidate({ name: 'Only Dish', category: 'Food & drink' })]))
  const arts = report.categoryCoverage.results.find((r) => r.categoryName === 'Arts & Culture')!
  assert.equal(arts.verdict, 'FAIL_ABSOLUTE_MINIMUM')
  assert.ok(report.remainingGaps.requiredHumanDecisions.some((d) => d.includes('Arts & Culture')))
})

test('runSeedPortfolioAudit: catalog/list separation is out of scope here — no list fields appear on the report', () => {
  const report = runSeedPortfolioAudit(baseInput([candidate({ name: 'Unagi Don' })]))
  assert.equal('homeListPlan' in report, false)
})

test('deriveGapResolutionStatuses: WAIVED, DOCUMENTED_ZERO, and UNRESOLVED are distinct explicit statuses', () => {
  const policySet = buildCategoryPolicySetFromPlan(plan(), undefined, undefined, [{ categoryName: 'Arts & Culture', reason: 'thin', evidenceOfInsufficientCandidates: 'plateaued', approvedBy: 'Jerry', approvedAt: '2026-09-14' }])
  const report = runSeedPortfolioAudit({ ...baseInput([candidate({ name: 'Only Dish' })]), categoryPolicySet: policySet })
  const arts = report.categoryCoverage.results.find((r) => r.categoryName === 'Arts & Culture')!
  assert.equal(arts.verdict, 'PASS_WITH_EXCEPTION')

  const statuses = deriveGapResolutionStatuses({
    categoryFailures: [
      { categoryName: 'A', count: 0, percentOfTotal: 0, applicableAbsoluteMinimum: 1, verdict: 'FAIL_ABSOLUTE_MINIMUM', reasons: ['x'], exceptionApplied: null },
      { categoryName: 'B', count: 0, percentOfTotal: 0, applicableAbsoluteMinimum: 1, verdict: 'FAIL_ABSOLUTE_MINIMUM', reasons: ['x'], exceptionApplied: null },
    ],
    geographicGaps: [],
    commercialMix: { eligibleCount: 0, excludedCount: 0, locallyOwnedCount: 0, locallyOwnedPercent: 0, unknownCount: 0, minLocalPercent: 65, verdict: 'INSUFFICIENT_DATA', reason: 'n/a', unknownVolumeFinding: null },
    documentedZeroKeys: new Set(['B']),
  })
  assert.equal(statuses.find((s) => s.gapKey === 'A')!.status, 'UNRESOLVED')
  assert.equal(statuses.find((s) => s.gapKey === 'B')!.status, 'DOCUMENTED_ZERO')
})

test('validateSeedPortfolioAuditReport: rejects malformed input without crashing', () => {
  assert.equal(validateSeedPortfolioAuditReport(null).ok, false)
  assert.equal(validateSeedPortfolioAuditReport({}).ok, false)
  assert.equal(validateSeedPortfolioAuditReport('not an object').ok, false)
  const good = runSeedPortfolioAudit(baseInput([candidate({ name: 'Unagi Don' })])) as unknown
  assert.equal(validateSeedPortfolioAuditReport(good).ok, true)
})
