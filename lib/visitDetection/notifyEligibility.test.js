import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNotifyEligibleCandidateVisit } from './notifyEligibility.js'

const BASE = {
  confidenceScore: 90,
  strongCandidateBelow: 85,
  isTester: true,
  realtimeNotificationsEnabled: true,
  silentModeEnabled: false,
  alreadyCheckedOffDuringVisit: false,
  alreadyNotified: false,
}

test('score at/above strongCandidateBelow with every other gate satisfied -> eligible', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, confidenceScore: 85 })
  assert.equal(result.eligible, true)
  assert.equal(result.reason, 'notify_eligible')
})

test('score below strongCandidateBelow -> not eligible, even if it would be status=high_confidence band (70-84)', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, confidenceScore: 84 })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'below_notify_eligible_threshold')
})

test('score well below any band -> not eligible', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, confidenceScore: 40 })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'below_notify_eligible_threshold')
})

test('missing confidenceScore -> not eligible, not a threshold miss', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, confidenceScore: null })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'missing_score_or_threshold')
})

test('missing strongCandidateBelow -> not eligible', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, strongCandidateBelow: null })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'missing_score_or_threshold')
})

test('not a visit_detection_tester -> not eligible even with a qualifying score', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, isTester: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'not_tester')
})

test('realtime_nearby_checkoff_notifications disabled -> suppressed', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, realtimeNotificationsEnabled: false })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'realtime_notifications_disabled')
})

test('candidate_visit_silent_mode enabled -> suppressed regardless of score', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, silentModeEnabled: true })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'silent_mode')
})

test('already checked off during this visit (checked_at >= arrival_at) -> suppressed', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, alreadyCheckedOffDuringVisit: true })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'already_checked_off')
})

test('already notified for this candidate visit -> suppressed (same candidate visit cannot enqueue twice)', () => {
  const result = isNotifyEligibleCandidateVisit({ ...BASE, alreadyNotified: true })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'already_notified')
})

test('already-notified check short-circuits before every other gate', () => {
  // Even a visit that would otherwise fail on every other gate should
  // report the alreadyNotified reason first — this is the dedup guarantee,
  // it must never be masked by an unrelated rejection reason.
  const result = isNotifyEligibleCandidateVisit({
    confidenceScore: 10,
    strongCandidateBelow: 85,
    isTester: false,
    realtimeNotificationsEnabled: false,
    silentModeEnabled: true,
    alreadyCheckedOffDuringVisit: true,
    alreadyNotified: true,
  })
  assert.equal(result.eligible, false)
  assert.equal(result.reason, 'already_notified')
})
