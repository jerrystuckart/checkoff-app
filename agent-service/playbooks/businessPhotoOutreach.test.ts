import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyResponse,
  deriveNextStage,
  coarseStatusForStage,
  isSecretBranch,
  verifyAuthorityCoverage,
  BUSINESS_PHOTO_OUTREACH_PLAYBOOK,
  SECRET_BUSINESS_OUTREACH_PLAYBOOK,
  type BusinessOutreachEvidence,
} from './businessPhotoOutreach'

function evidence(overrides: Partial<BusinessOutreachEvidence> = {}): BusinessOutreachEvidence {
  return {
    token: { tokenStatus: 'unopened', openedAt: null, submittedAt: null, isSecretItem: false },
    submission: null,
    candidate: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// classifyResponse
// ---------------------------------------------------------------------------

test('classifyResponse: no submission -> no_response', () => {
  const tags = classifyResponse(evidence())
  assert.deepEqual([...tags], ['no_response'])
})

test('classifyResponse: confirmed only', () => {
  const tags = classifyResponse(evidence({ submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: null, clingRequested: false } }))
  assert.deepEqual([...tags], ['confirmed'])
})

test('classifyResponse: correction requested', () => {
  const tags = classifyResponse(
    evidence({ submission: { itemConfirmed: false, correctionStatus: 'pending_review', proposedCorrection: 'try the other thing', photoCandidateId: null, clingRequested: false } })
  )
  assert.deepEqual([...tags], ['correction_requested'])
})

test('classifyResponse: a real submission can carry MULTIPLE tags at once — confirmed + photo + cling, exactly as verified live', () => {
  const tags = classifyResponse(evidence({ submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: 'cand-1', clingRequested: true } }))
  assert.deepEqual([...tags].sort(), ['cling_requested', 'confirmed', 'photo_submitted'])
})

test('classifyResponse: no structured signal set at all -> needs_human_interpretation, never guessed', () => {
  const tags = classifyResponse(evidence({ submission: { itemConfirmed: null, correctionStatus: null, proposedCorrection: null, photoCandidateId: null, clingRequested: null } }))
  assert.deepEqual([...tags], ['needs_human_interpretation'])
})

// ---------------------------------------------------------------------------
// deriveNextStage — happy paths
// ---------------------------------------------------------------------------

test('deriveNextStage: READY_FOR_OUTREACH never auto-advances (sending is a separate step)', () => {
  const result = deriveNextStage('READY_FOR_OUTREACH', evidence())
  assert.equal(result.nextStage, 'READY_FOR_OUTREACH')
  assert.equal(result.requiresJerry, false)
})

test('deriveNextStage: WAITING_FOR_BUSINESS with no response stays put', () => {
  const result = deriveNextStage('WAITING_FOR_BUSINESS', evidence())
  assert.equal(result.nextStage, 'WAITING_FOR_BUSINESS')
})

test('deriveNextStage: WAITING_FOR_BUSINESS with any submission -> RESPONSE_CLASSIFICATION', () => {
  const result = deriveNextStage(
    'WAITING_FOR_BUSINESS',
    evidence({ submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: null, clingRequested: false } })
  )
  assert.equal(result.nextStage, 'RESPONSE_CLASSIFICATION')
})

test('deriveNextStage: confirmed-only response -> COMPLETE (nothing else to do)', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({ submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: null, clingRequested: false } })
  )
  assert.equal(result.nextStage, 'COMPLETE')
  assert.equal(result.requiresJerry, false)
})

test('deriveNextStage: correction requested -> ITEM_CONFIRMATION, escalates to Jerry', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({ submission: { itemConfirmed: false, correctionStatus: 'pending_review', proposedCorrection: 'x', photoCandidateId: null, clingRequested: false } })
  )
  assert.equal(result.nextStage, 'ITEM_CONFIRMATION')
  assert.equal(result.requiresJerry, true)
})

test('deriveNextStage: ITEM_CONFIRMATION never auto-resolves — correction resolution is APPROVAL_REQUIRED, no standing authority to do it automatically', () => {
  const result = deriveNextStage(
    'ITEM_CONFIRMATION',
    evidence({ submission: { itemConfirmed: false, correctionStatus: 'pending_review', proposedCorrection: 'x', photoCandidateId: null, clingRequested: false } })
  )
  assert.equal(result.nextStage, 'ITEM_CONFIRMATION')
  assert.equal(result.requiresJerry, true)
})

test('deriveNextStage: photo submitted -> PHOTO_SUBMITTED', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({ submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: 'cand-1', clingRequested: false } })
  )
  assert.equal(result.nextStage, 'PHOTO_SUBMITTED')
})

test('deriveNextStage: PHOTO_SUBMITTED with no admin action yet -> PHOTO_REVIEW, escalates to Jerry', () => {
  const result = deriveNextStage(
    'PHOTO_SUBMITTED',
    evidence({
      submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: 'cand-1', clingRequested: false },
      candidate: { id: 'cand-1', source: 'business_submission', status: 'needs_review', displayEligible: false, isPrimary: false },
    })
  )
  assert.equal(result.nextStage, 'PHOTO_REVIEW')
  assert.equal(result.requiresJerry, true)
})

test('deriveNextStage: PHOTO_REVIEW resolves to COMPLETE once the candidate is display_eligible', () => {
  const result = deriveNextStage(
    'PHOTO_REVIEW',
    evidence({
      submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: 'cand-1', clingRequested: false },
      candidate: { id: 'cand-1', source: 'business_submission', status: 'approved', displayEligible: true, isPrimary: false },
    })
  )
  assert.equal(result.nextStage, 'COMPLETE')
})

test('deriveNextStage: PHOTO_REVIEW resolves to COMPLETE when the candidate was rejected too (resolved either way)', () => {
  const result = deriveNextStage(
    'PHOTO_REVIEW',
    evidence({
      submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: 'cand-1', clingRequested: false },
      candidate: { id: 'cand-1', source: 'business_submission', status: 'rejected', displayEligible: false, isPrimary: false },
    })
  )
  assert.equal(result.nextStage, 'COMPLETE')
})

test('deriveNextStage: cling requested (no photo) -> CLING_REQUEST', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({ submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: null, clingRequested: true } })
  )
  assert.equal(result.nextStage, 'CLING_REQUEST')
})

test('deriveNextStage: CLING_REQUEST -> COMPLETE once the fulfillment task exists (this reducer only decides the stage; task creation is the engine\'s job)', () => {
  const result = deriveNextStage('CLING_REQUEST', evidence())
  assert.equal(result.nextStage, 'COMPLETE')
})

test('deriveNextStage: COMPLETE is terminal', () => {
  const result = deriveNextStage('COMPLETE', evidence())
  assert.equal(result.nextStage, 'COMPLETE')
})

// ---------------------------------------------------------------------------
// Escalation — needs_human_interpretation / partner questions
// ---------------------------------------------------------------------------

test('deriveNextStage: an unclassifiable response escalates to ITEM_CONFIRMATION/Jerry, never guessed forward', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({ submission: { itemConfirmed: null, correctionStatus: null, proposedCorrection: null, photoCandidateId: null, clingRequested: null } })
  )
  assert.equal(result.nextStage, 'ITEM_CONFIRMATION')
  assert.equal(result.requiresJerry, true)
})

// ---------------------------------------------------------------------------
// Secret-business branch
// ---------------------------------------------------------------------------

test('isSecretBranch reads items.is_secret only, never inferred', () => {
  assert.equal(isSecretBranch(evidence({ token: { tokenStatus: 'opened', openedAt: null, submittedAt: null, isSecretItem: true } })), true)
  assert.equal(isSecretBranch(evidence()), false)
})

test('deriveNextStage: secret branch never resolves confirmed-only to COMPLETE — no generic item confirmation exists for a secret item', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({
      token: { tokenStatus: 'submitted', openedAt: null, submittedAt: null, isSecretItem: true },
      submission: { itemConfirmed: true, correctionStatus: 'not_applicable', proposedCorrection: null, photoCandidateId: null, clingRequested: false },
    })
  )
  // confirmed-only would COMPLETE on the ordinary branch; on the secret
  // branch there's nothing else classified, so it falls to the
  // ambiguous/escalation path rather than a false "done."
  assert.notEqual(result.nextStage, 'COMPLETE')
})

test('deriveNextStage: secret branch still supports photo submission (venue/business photo, not the secret item photo)', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({
      token: { tokenStatus: 'submitted', openedAt: null, submittedAt: null, isSecretItem: true },
      submission: { itemConfirmed: null, correctionStatus: null, proposedCorrection: null, photoCandidateId: 'cand-1', clingRequested: false },
    })
  )
  assert.equal(result.nextStage, 'PHOTO_SUBMITTED')
})

test('deriveNextStage: secret branch still supports cling requests', () => {
  const result = deriveNextStage(
    'RESPONSE_CLASSIFICATION',
    evidence({
      token: { tokenStatus: 'submitted', openedAt: null, submittedAt: null, isSecretItem: true },
      submission: { itemConfirmed: null, correctionStatus: null, proposedCorrection: null, photoCandidateId: null, clingRequested: true },
    })
  )
  assert.equal(result.nextStage, 'CLING_REQUEST')
})

test('SECRET_BUSINESS_OUTREACH_PLAYBOOK has no ITEM_CONFIRMATION stage at all', () => {
  const stageKeys = SECRET_BUSINESS_OUTREACH_PLAYBOOK.stages.map((s) => s.stage)
  assert.ok(!stageKeys.includes('ITEM_CONFIRMATION' as never), `secret playbook must not offer generic item confirmation, got stages: ${stageKeys.join(', ')}`)
})

test('SECRET_BUSINESS_OUTREACH_PLAYBOOK stages are a genuine subset of the ordinary playbook, never a superset', () => {
  const ordinaryKeys = new Set(BUSINESS_PHOTO_OUTREACH_PLAYBOOK.stages.map((s) => s.stage))
  for (const s of SECRET_BUSINESS_OUTREACH_PLAYBOOK.stages) {
    assert.ok(ordinaryKeys.has(s.stage), `secret playbook stage ${s.stage} is not part of the ordinary playbook`)
  }
})

// ---------------------------------------------------------------------------
// coarseStatusForStage
// ---------------------------------------------------------------------------

test('coarseStatusForStage: full mapping matches the documented design', () => {
  assert.equal(coarseStatusForStage('READY_FOR_OUTREACH'), 'READY')
  assert.equal(coarseStatusForStage('SENT'), 'WAITING')
  assert.equal(coarseStatusForStage('WAITING_FOR_BUSINESS'), 'WAITING')
  assert.equal(coarseStatusForStage('FOLLOW_UP'), 'WAITING')
  assert.equal(coarseStatusForStage('RESPONSE_CLASSIFICATION'), 'IN_PROGRESS')
  assert.equal(coarseStatusForStage('PHOTO_SUBMITTED'), 'IN_PROGRESS')
  assert.equal(coarseStatusForStage('CLING_REQUEST'), 'IN_PROGRESS')
  assert.equal(coarseStatusForStage('ITEM_CONFIRMATION'), 'NEEDS_JERRY')
  assert.equal(coarseStatusForStage('PHOTO_REVIEW'), 'NEEDS_JERRY')
  assert.equal(coarseStatusForStage('COMPLETE'), 'DONE')
})

// ---------------------------------------------------------------------------
// Authority coverage — every stage's declared operations must be
// registered in standingAuthority.ts, checked at test time (not just at
// runtime the first time that stage fires).
// ---------------------------------------------------------------------------

test('every stage operation in both playbooks has a standing-authority entry', () => {
  assert.doesNotThrow(() => verifyAuthorityCoverage(BUSINESS_PHOTO_OUTREACH_PLAYBOOK))
  assert.doesNotThrow(() => verifyAuthorityCoverage(SECRET_BUSINESS_OUTREACH_PLAYBOOK))
})

test('completion criteria are documented and non-empty for both playbooks', () => {
  assert.ok(BUSINESS_PHOTO_OUTREACH_PLAYBOOK.successCriteria.length > 0)
  assert.ok(SECRET_BUSINESS_OUTREACH_PLAYBOOK.successCriteria.length > 0)
})
