import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCoverCandidateEligible } from './coverCandidateEligibility.js'

const BASE = {
  isAtPlace: true,
  hasApprovedImage: false,
  hasPendingSubmission: false,
  flagEnabled: true,
}

test('at-place, no approved image, no pending submission, flag on -> eligible', () => {
  const result = isCoverCandidateEligible(BASE)
  assert.equal(result.eligible, true)
  assert.equal(result.reason, 'eligible')
})

test('not at-place -> not eligible, even if every other condition holds (never prompt just because nearby)', () => {
  const result = isCoverCandidateEligible({ ...BASE, isAtPlace: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'not_at_place')
})

test('secret status alone never blocks eligibility: a secret item is eligible under the same conditions as a normal item', () => {
  const secret = isCoverCandidateEligible({ ...BASE, isSecret: true })
  const normal = isCoverCandidateEligible({ ...BASE, isSecret: false })
  assert.deepEqual(secret, normal)
  assert.equal(secret.eligible, true)
})

test('a secret item is still subject to every other rule (off-site, flag, existing image, pending)', () => {
  assert.equal(isCoverCandidateEligible({ ...BASE, isSecret: true, isAtPlace: false }).reason, 'not_at_place')
  assert.equal(isCoverCandidateEligible({ ...BASE, isSecret: true, flagEnabled: false }).reason, 'flag_disabled')
  assert.equal(isCoverCandidateEligible({ ...BASE, isSecret: true, hasApprovedImage: true }).reason, 'already_has_approved_image')
  assert.equal(isCoverCandidateEligible({ ...BASE, isSecret: true, hasPendingSubmission: true }).reason, 'pending_submission_exists')
})

test('item already has an approved/resolvable image -> not eligible', () => {
  const result = isCoverCandidateEligible({ ...BASE, hasApprovedImage: true })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'already_has_approved_image')
})

test('user already has an unresolved pending submission for this item -> suppressed (no duplicate prompt)', () => {
  const result = isCoverCandidateEligible({ ...BASE, hasPendingSubmission: true })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'pending_submission_exists')
})

test('feature flag disabled -> not eligible regardless of every other condition', () => {
  const result = isCoverCandidateEligible({ ...BASE, flagEnabled: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'flag_disabled')
})

test('flag_disabled short-circuits before every other check', () => {
  const result = isCoverCandidateEligible({
    isAtPlace: false,
    hasApprovedImage: true,
    isSecret: true,
    hasPendingSubmission: true,
    flagEnabled: false,
  })
  assert.equal(result.reason, 'flag_disabled')
})
