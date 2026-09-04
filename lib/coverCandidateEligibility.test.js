import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCoverCandidateEligible } from './coverCandidateEligibility.js'

const BASE = {
  isAtPlace: true,
  hasApprovedImage: false,
  isSecret: false,
  hasPendingSubmission: false,
  flagEnabled: true,
}

test('at-place, no approved image, not secret, no pending submission, flag on -> eligible', () => {
  const result = isCoverCandidateEligible(BASE)
  assert.equal(result.eligible, true)
  assert.equal(result.reason, 'eligible')
})

test('not at-place -> not eligible, even if every other condition holds (never prompt just because nearby)', () => {
  const result = isCoverCandidateEligible({ ...BASE, isAtPlace: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'not_at_place')
})

test('secret item -> not eligible in V1, regardless of other conditions', () => {
  const result = isCoverCandidateEligible({ ...BASE, isSecret: true })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'secret_item_excluded_in_v1')
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
