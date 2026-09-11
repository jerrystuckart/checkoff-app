import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFinalReadyToApplyAudit, type FinalReadyToApplyInput } from './finalReadyToApplyAudit'

// Fixture-builder pattern per homeListCertification.test.ts's own convention —
// every field genuinely passing, so a test can override ONLY the thing it's
// actually exercising and still reason about the resulting verdict.
function goodFinalAuditInput(overrides: Partial<FinalReadyToApplyInput> = {}): FinalReadyToApplyInput {
  return {
    outOfMarketContaminationVerdict: 'PASS',
    allDuplicateClustersResolved: true,
    allItemsCertified: true,
    emptyNeighborhoods: [],
    placesCompletenessVerdict: 'PASS',
    listTitlesWithInternalPrefix: [],
    homeList: { packageValid: true, itemProvenanceValid: true },
    reusedItemsAdditiveOnly: true,
    sqlSafetyVerdict: 'PASS',
    executionState: 'GENERATED',
    metroFinisherStatus: { verdict: 'PASS' },
    ...overrides,
  }
}

test('evaluateFinalReadyToApplyAudit: READY_TO_APPLY when every check, including a PASSing Metro Finisher status, is present', () => {
  const result = evaluateFinalReadyToApplyAudit(goodFinalAuditInput())
  assert.equal(result.verdict, 'READY_TO_APPLY')
})

test('evaluateFinalReadyToApplyAudit: BLOCKED when metroFinisherStatus is missing entirely — never silently skipped', () => {
  const input = goodFinalAuditInput() as unknown as Record<string, unknown>
  delete input.metroFinisherStatus
  const result = evaluateFinalReadyToApplyAudit(input as unknown as FinalReadyToApplyInput)
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('Metro Finisher') && r.includes('missing')))
})

test('evaluateFinalReadyToApplyAudit: BLOCKED when metroFinisherStatus.verdict is FAIL', () => {
  const result = evaluateFinalReadyToApplyAudit(goodFinalAuditInput({ metroFinisherStatus: { verdict: 'FAIL' } }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.toLowerCase().includes('metro finisher')))
})

test('evaluateFinalReadyToApplyAudit: BLOCKED when metroFinisherStatus.verdict is WAIVED with an empty waiverReason', () => {
  const result = evaluateFinalReadyToApplyAudit(goodFinalAuditInput({ metroFinisherStatus: { verdict: 'WAIVED', waiverReason: '' } }))
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('WAIVED') && r.includes('waiverReason')))
})

test('evaluateFinalReadyToApplyAudit: BLOCKED when metroFinisherStatus.verdict is WAIVED with waiverReason omitted entirely', () => {
  const result = evaluateFinalReadyToApplyAudit(goodFinalAuditInput({ metroFinisherStatus: { verdict: 'WAIVED' } }))
  assert.equal(result.verdict, 'BLOCKED')
})

test('evaluateFinalReadyToApplyAudit: READY_TO_APPLY when metroFinisherStatus.verdict is WAIVED with a real, named, non-empty waiverReason (the explicit-named-exception pattern)', () => {
  const result = evaluateFinalReadyToApplyAudit(
    goodFinalAuditInput({ metroFinisherStatus: { verdict: 'WAIVED', waiverReason: 'Jerry approved skipping the Finisher pass for this tiny 8-item pilot metro on 2026-09-11.' } })
  )
  assert.equal(result.verdict, 'READY_TO_APPLY', JSON.stringify(result.reasons))
})

test('evaluateFinalReadyToApplyAudit: a WAIVED metroFinisherStatus never masks an unrelated real failure (e.g. sqlSafetyVerdict FAIL still blocks)', () => {
  const result = evaluateFinalReadyToApplyAudit(
    goodFinalAuditInput({
      metroFinisherStatus: { verdict: 'WAIVED', waiverReason: 'Approved waiver.' },
      sqlSafetyVerdict: 'FAIL',
      sqlSafetyIssues: ['unsafe DROP statement found'],
    })
  )
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('SQL safety')))
})

// ---------------------------------------------------------------------------
// Existing behavior (unrelated to Metro Finisher) stays intact — a
// regression check that adding the new required field didn't change any
// other check's semantics.
// ---------------------------------------------------------------------------

test('evaluateFinalReadyToApplyAudit: empty neighborhoods alone never block, even with metroFinisherStatus present', () => {
  const result = evaluateFinalReadyToApplyAudit(goodFinalAuditInput({ emptyNeighborhoods: ['Hobart', 'Allouez'] }))
  assert.equal(result.verdict, 'READY_TO_APPLY')
})

test('evaluateFinalReadyToApplyAudit: a missing, pre-existing required check (e.g. sqlSafetyVerdict) still blocks independently of metroFinisherStatus', () => {
  const input = goodFinalAuditInput() as unknown as Record<string, unknown>
  delete input.sqlSafetyVerdict
  const result = evaluateFinalReadyToApplyAudit(input as unknown as FinalReadyToApplyInput)
  assert.equal(result.verdict, 'BLOCKED')
  assert.ok(result.reasons.some((r) => r.includes('SQL safety check: result missing')))
})
