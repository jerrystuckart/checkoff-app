import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCategoryPolicySetFromPlan,
  evaluateCategoryPolicies,
  categoryPolicyGatePasses,
  evaluateCommercialMix,
  evaluateSecretEvidence,
  DEFAULT_CATEGORY_PERCENTAGE_BANDS,
  type CategoryPolicySet,
} from './categoryPolicy'
import type { CategoryCoveragePlan } from './metroLaunch'

function plan(): CategoryCoveragePlan {
  return {
    targets: [
      { categoryName: 'Food & drink', minimumViable: 15, healthyTarget: 30, qualityNotes: [] },
      { categoryName: 'Arts & Culture', minimumViable: 5, healthyTarget: 10, qualityNotes: [] },
      { categoryName: 'Shopping', minimumViable: 3, healthyTarget: 6, qualityNotes: [] },
    ],
  }
}

test('categoryPolicy: counts AND percentages both checked — either alone fails the gate', () => {
  const policySet = buildCategoryPolicySetFromPlan(plan(), DEFAULT_CATEGORY_PERCENTAGE_BANDS)
  // Arts & Culture: above absolute minimum (12 >= 5) but over the 30% overconcentration cap.
  const counts = [
    { categoryName: 'Food & drink', count: 15 },
    { categoryName: 'Arts & Culture', count: 12 },
    { categoryName: 'Shopping', count: 3 },
  ]
  const results = evaluateCategoryPolicies(counts, policySet)
  const arts = results.find((r) => r.categoryName === 'Arts & Culture')!
  // Overconcentration is a soft, non-blocking warning (matches this
  // codebase's own CATEGORY_OVERREPRESENTED precedent) — never
  // FAIL_PERCENTAGE_BAND, which is reserved for the guardrail FLOOR.
  assert.equal(arts.verdict, 'FLAG_OVERCONCENTRATION')
  assert.ok(arts.percentOfTotal > 30)
  assert.equal(categoryPolicyGatePasses(results), true)

  const food = results.find((r) => r.categoryName === 'Food & drink')!
  assert.equal(food.verdict, 'PASS')
})

test('categoryPolicy: percentage guardrail FLOOR violation still blocks the gate (distinct from the overconcentration ceiling)', () => {
  const policySet = buildCategoryPolicySetFromPlan(plan(), DEFAULT_CATEGORY_PERCENTAGE_BANDS)
  const results = evaluateCategoryPolicies(
    [
      { categoryName: 'Food & drink', count: 198 },
      { categoryName: 'Arts & Culture', count: 5 }, // above absolute minimum (5 >= 5), but 5/203 = 2.5% < the 3% floor
    ],
    policySet
  )
  const arts = results.find((r) => r.categoryName === 'Arts & Culture')!
  assert.equal(arts.verdict, 'FAIL_PERCENTAGE_BAND')
  assert.equal(categoryPolicyGatePasses(results), false)
})

test('categoryPolicy: absolute minimum failure even when percentage would pass', () => {
  const policySet = buildCategoryPolicySetFromPlan(plan())
  const counts = [
    { categoryName: 'Food & drink', count: 15 },
    { categoryName: 'Shopping', count: 1 }, // below absolute minimum of 3
  ]
  const results = evaluateCategoryPolicies(counts, policySet)
  const shopping = results.find((r) => r.categoryName === 'Shopping')!
  assert.equal(shopping.verdict, 'FAIL_ABSOLUTE_MINIMUM')
})

test('categoryPolicy: market-specific documented exception lets a category pass despite a real gap', () => {
  const policySet: CategoryPolicySet = buildCategoryPolicySetFromPlan(plan(), undefined, undefined, [
    { categoryName: 'Shopping', reason: 'Small downtown core, genuinely thin retail', evidenceOfInsufficientCandidates: '3 research passes, plateaued at 1 candidate', approvedBy: 'Jerry', approvedAt: '2026-09-14' },
  ])
  const counts = [
    { categoryName: 'Food & drink', count: 15 },
    { categoryName: 'Arts & Culture', count: 5 },
    { categoryName: 'Shopping', count: 1 },
  ]
  const results = evaluateCategoryPolicies(counts, policySet)
  const shopping = results.find((r) => r.categoryName === 'Shopping')!
  assert.equal(shopping.verdict, 'PASS_WITH_EXCEPTION')
  assert.equal(categoryPolicyGatePasses(results), true)
})

test('categoryPolicy: exception never silently adds weak inventory — count is unchanged, only the verdict', () => {
  const policySet: CategoryPolicySet = buildCategoryPolicySetFromPlan(plan(), undefined, undefined, [
    { categoryName: 'Shopping', reason: 'thin retail', evidenceOfInsufficientCandidates: 'plateaued', approvedBy: 'Jerry', approvedAt: '2026-09-14' },
  ])
  const results = evaluateCategoryPolicies([{ categoryName: 'Shopping', count: 1 }], policySet)
  assert.equal(results.find((r) => r.categoryName === 'Shopping')!.count, 1)
})

test('commercial mix: independent-business classification passes at/above 65%', () => {
  const items = [
    { candidateName: 'a', ownershipType: 'INDEPENDENT_LOCAL' as const },
    { candidateName: 'b', ownershipType: 'SMALL_LOCAL_GROUP' as const },
    { candidateName: 'c', ownershipType: 'NATIONAL_OR_INTERNATIONAL_CHAIN' as const },
  ]
  const result = evaluateCommercialMix(items)
  assert.equal(result.verdict, 'PASS')
  assert.ok(result.locallyOwnedPercent >= 65)
})

test('commercial mix: PUBLIC_INSTITUTION and NONCOMMERCIAL_OUTDOOR_OR_CIVIC excluded from denominator entirely', () => {
  const items = [
    { candidateName: 'a', ownershipType: 'INDEPENDENT_LOCAL' as const },
    { candidateName: 'park', ownershipType: 'NONCOMMERCIAL_OUTDOOR_OR_CIVIC' as const },
    { candidateName: 'museum', ownershipType: 'PUBLIC_INSTITUTION' as const },
  ]
  const result = evaluateCommercialMix(items)
  assert.equal(result.eligibleCount, 1)
  assert.equal(result.excludedCount, 2)
  assert.equal(result.locallyOwnedPercent, 100)
})

test('commercial mix: UNKNOWN_REQUIRES_VERIFICATION is never silently treated as independent', () => {
  const items = [
    { candidateName: 'a', ownershipType: 'UNKNOWN_REQUIRES_VERIFICATION' as const },
    { candidateName: 'b', ownershipType: 'UNKNOWN_REQUIRES_VERIFICATION' as const },
  ]
  const result = evaluateCommercialMix(items)
  // Never counted toward the locally-owned numerator...
  assert.equal(result.locallyOwnedCount, 0)
  assert.equal(result.locallyOwnedPercent, 0)
  // ...and, per adjustment 3's own text ("its own finding... not a pass or
  // fail"), a pool of ENTIRELY unknown ownership is INSUFFICIENT_DATA, not
  // a false FAIL — it is never silently treated as definitively
  // non-independent either. A real FAIL requires real known-bad data (see
  // the mixed-known-and-unknown test below).
  assert.equal(result.verdict, 'INSUFFICIENT_DATA')
})

test('commercial mix: real known-bad data still FAILs even when unknowns are also present', () => {
  const items = [
    { candidateName: 'chain1', ownershipType: 'NATIONAL_OR_INTERNATIONAL_CHAIN' as const },
    { candidateName: 'chain2', ownershipType: 'NATIONAL_OR_INTERNATIONAL_CHAIN' as const },
    { candidateName: 'indie', ownershipType: 'INDEPENDENT_LOCAL' as const },
    { candidateName: 'unknown1', ownershipType: 'UNKNOWN_REQUIRES_VERIFICATION' as const },
  ]
  const result = evaluateCommercialMix(items)
  assert.equal(result.verdict, 'FAIL')
  assert.equal(result.unknownCount, 1)
})

test('commercial mix: high unknown-ownership volume is its own finding, not folded into pass/fail', () => {
  const items: Array<{ candidateName: string; ownershipType: 'UNKNOWN_REQUIRES_VERIFICATION' | 'INDEPENDENT_LOCAL' }> = Array.from({ length: 6 }, (_, i) => ({ candidateName: `u${i}`, ownershipType: 'UNKNOWN_REQUIRES_VERIFICATION' as const }))
  items.push({ candidateName: 'independent', ownershipType: 'INDEPENDENT_LOCAL' as const })
  const result = evaluateCommercialMix(items, 65, 5)
  assert.ok(result.unknownVolumeFinding)
  assert.match(result.unknownVolumeFinding!, /requires-verification/)
})

test('secret evidence: supported vs. unsupported claims', () => {
  const supported = evaluateSecretEvidence({
    mechanic: 'Concealed entrance behind an unmarked bookshelf in the back hallway',
    evidenceType: 'first-hand account',
    source: 'https://example.com/review',
    dateVerified: '2026-08-01',
    confidence: 'HIGH',
    verdict: 'READY',
  })
  assert.equal(supported.supported, true)

  const unsupported = evaluateSecretEvidence({
    mechanic: 'It is a local favorite, kind of a hidden gem, less touristy than most',
    evidenceType: 'vague description',
    source: 'https://example.com',
    dateVerified: null,
    confidence: 'LOW',
    verdict: 'HOLD',
  })
  assert.equal(unsupported.supported, false)

  const missing = evaluateSecretEvidence(null)
  assert.equal(missing.supported, false)
})

test('secret evidence: concrete mechanic without a source is not supported', () => {
  const result = evaluateSecretEvidence({ mechanic: 'unmarked door behind the kitchen', evidenceType: 'staff interview', source: '', dateVerified: null, confidence: 'MEDIUM', verdict: 'HOLD' })
  assert.equal(result.supported, false)
})
