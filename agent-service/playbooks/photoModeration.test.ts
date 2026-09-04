import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessCandidate, buildDecisionPacket, verifyDecisionAuthority, coarseStatusForStage, type PhotoCandidateContext } from './photoModeration'
import { UnknownAuthorityOperationError } from './standingAuthority'

function context(overrides: Partial<PhotoCandidateContext> = {}): PhotoCandidateContext {
  return {
    candidateId: 'cand-1',
    itemId: 'item-1',
    itemBody: "Order the wings at 'Red Zone'",
    venueName: 'Red Zone',
    metroName: 'Phoenix Metro',
    source: 'community',
    status: 'needs_review',
    submittedAt: '2026-09-04T00:00:00Z',
    passesBasicSanity: true,
    malformed: false,
    isSecretItem: false,
    activeCoverCandidateId: null,
    pool: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// assessCandidate — recommendation categories
// ---------------------------------------------------------------------------

test('assessCandidate: malformed upload -> REJECT, high confidence, no visual guessing', () => {
  const result = assessCandidate(context({ malformed: true }))
  assert.equal(result.recommendation, 'REJECT')
  assert.equal(result.safety.verdict, 'FAIL')
  assert.equal(result.confidence, 'HIGH')
})

test('assessCandidate: secret item -> NEEDS_JERRY_CONTEXT regardless of anything else', () => {
  const result = assessCandidate(context({ isSecretItem: true, malformed: false }))
  assert.equal(result.recommendation, 'NEEDS_JERRY_CONTEXT')
  assert.match(result.why, /secret/i)
})

test('assessCandidate: empty pool (no images at all) -> ADD_TO_ROTATION, never SET_PRIMARY — primary selection always needs Jerry\'s visual judgment', () => {
  const result = assessCandidate(context({ pool: [] }))
  assert.equal(result.recommendation, 'ADD_TO_ROTATION')
})

test('assessCandidate: business_submission source alone never produces SET_PRIMARY or any priority-over-community reasoning — no such product policy exists', () => {
  const result = assessCandidate(
    context({ source: 'business_submission', pool: [{ id: 'existing-primary', source: 'community', isPrimary: true, displayWeight: 1 }] })
  )
  assert.notEqual(result.recommendation, 'SET_PRIMARY')
  // "no source-priority policy" (a disclaimer) is fine; an AFFIRMATIVE
  // claim that business submissions outrank/carry authority is not.
  assert.doesNotMatch(result.why, /carries? more authority|outrank/i)
  assert.doesNotMatch(result.coverWorthiness.reason, /carries? more authority|outrank/i)
})

test('assessCandidate: community source with an existing community primary -> same NEEDS_JERRY_CONTEXT outcome as business_submission — source never changes the recommendation', () => {
  const poolWithPrimary = [{ id: 'existing-primary', source: 'community' as const, isPrimary: true, displayWeight: 1 }]
  const communityResult = assessCandidate(context({ source: 'community', pool: poolWithPrimary }))
  const businessResult = assessCandidate(context({ source: 'business_submission', pool: poolWithPrimary }))
  assert.equal(communityResult.recommendation, businessResult.recommendation)
  assert.equal(communityResult.recommendation, 'NEEDS_JERRY_CONTEXT')
})

test('assessCandidate: SET_PRIMARY is never produced by structural assessment alone — it requires real visual assessment or an explicit control policy that does not exist today', () => {
  const scenarios = [
    context({ pool: [] }),
    context({ source: 'business_submission', pool: [] }),
    context({ pool: [{ id: 'existing-primary', source: 'community', isPrimary: true, displayWeight: 1 }] }),
    context({ source: 'business_submission', pool: [{ id: 'existing-primary', source: 'community', isPrimary: true, displayWeight: 1 }] }),
    context({ pool: [{ id: 'existing-primary', source: 'business_submission', isPrimary: true, displayWeight: 1 }] }),
  ]
  for (const s of scenarios) {
    assert.notEqual(assessCandidate(s).recommendation, 'SET_PRIMARY')
  }
})

test('assessCandidate: never mutates its input context object', () => {
  const ctx = context()
  const snapshot = JSON.parse(JSON.stringify(ctx))
  assessCandidate(ctx)
  assert.deepEqual(ctx, snapshot)
})

test('assessCandidate: safety/relevance/truthfulness/visualQuality are honestly UNKNOWN when not malformed — never fabricated PASS verdicts', () => {
  const result = assessCandidate(context({ malformed: false }))
  assert.equal(result.relevance.verdict, 'UNKNOWN')
  assert.equal(result.truthfulness.verdict, 'UNKNOWN')
  assert.equal(result.visualQuality.verdict, 'UNKNOWN')
  assert.notEqual(result.safety.verdict, 'PASS', 'safety should be UNKNOWN, not falsely PASS, without a real content check')
})

// ---------------------------------------------------------------------------
// Decision packet — concise format
// ---------------------------------------------------------------------------

test('buildDecisionPacket: concise, structured lines — business/place, thing, source, current cover, recommendation, why', () => {
  const ctx = context({ venueName: 'Red Zone', activeCoverCandidateId: 'other-cand' })
  const assessment = assessCandidate(ctx)
  const packet = buildDecisionPacket(ctx, assessment)
  assert.equal(packet.candidateId, 'cand-1')
  assert.ok(packet.lines.some((l) => l.includes('Red Zone')))
  assert.ok(packet.lines.some((l) => l.includes('other-cand')))
  assert.ok(packet.lines.some((l) => l.startsWith('Recommendation:')))
  assert.ok(packet.lines.length <= 6, 'decision packet must stay concise, never long prose')
})

// ---------------------------------------------------------------------------
// Standing authority — approve/reject/rotate/primary all APPROVAL_REQUIRED
// ---------------------------------------------------------------------------

test('verifyDecisionAuthority: every Jerry decision maps to an APPROVAL_REQUIRED operation, never AUTO', () => {
  for (const decision of ['approve', 'reject', 'add_to_rotation', 'remove_from_rotation', 'set_primary'] as const) {
    assert.doesNotThrow(() => verifyDecisionAuthority(decision))
  }
})

test('an unregistered decision-like operation throws rather than silently allowing', () => {
  assert.throws(() => {
    // @ts-expect-error deliberately invalid input for this test
    verifyDecisionAuthority('bogus_decision')
  }, UnknownAuthorityOperationError)
})

// ---------------------------------------------------------------------------
// Stage -> status mapping
// ---------------------------------------------------------------------------

test('coarseStatusForStage: full mapping', () => {
  assert.equal(coarseStatusForStage('NEW_CANDIDATE'), 'READY')
  assert.equal(coarseStatusForStage('GATHER_CONTEXT'), 'IN_PROGRESS')
  assert.equal(coarseStatusForStage('ASSESS'), 'IN_PROGRESS')
  assert.equal(coarseStatusForStage('NEEDS_JERRY'), 'NEEDS_JERRY')
  assert.equal(coarseStatusForStage('APPLY_DECISION'), 'IN_PROGRESS')
  assert.equal(coarseStatusForStage('COMPLETE'), 'DONE')
  assert.equal(coarseStatusForStage('BLOCKED'), 'BLOCKED')
  assert.equal(coarseStatusForStage('NEEDS_MORE_CONTEXT'), 'WAITING')
})
