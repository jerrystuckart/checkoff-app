// Trip Mode MVP (2026-09-23) — lib/tripModeCheckOffFlow.js unit tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldShowTripModeEntry,
  computeTripModePointsAwarded,
  buildTripModeCheckInPayload,
  resolveTripModeCollisionOutcome,
} from './tripModeCheckOffFlow.js'
import { TRIP_MODE_VERIFICATION_METHOD } from './tripMode.js'

// ---------------------------------------------------------------------------
// shouldShowTripModeEntry
// ---------------------------------------------------------------------------

test('entry point shown when enabled + member + window open + NOT at venue', () => {
  assert.equal(
    shouldShowTripModeEntry({ tripModeEnabled: true, isMember: true, windowOpen: true, atVenue: false }),
    true
  )
})

test('entry point shown when location is unavailable (atVenue undefined/null), not just when confirmed far away', () => {
  assert.equal(
    shouldShowTripModeEntry({ tripModeEnabled: true, isMember: true, windowOpen: true, atVenue: null }),
    true
  )
  assert.equal(
    shouldShowTripModeEntry({ tripModeEnabled: true, isMember: true, windowOpen: true, atVenue: undefined }),
    true
  )
})

test('live flow remains primary/unchanged when at venue: entry point hidden even with every other condition true', () => {
  assert.equal(
    shouldShowTripModeEntry({ tripModeEnabled: true, isMember: true, windowOpen: true, atVenue: true }),
    false
  )
})

test('entry point hidden when list does not have Trip Mode enabled', () => {
  assert.equal(
    shouldShowTripModeEntry({ tripModeEnabled: false, isMember: true, windowOpen: true, atVenue: false }),
    false
  )
})

test('entry point hidden when user is not a member of this list', () => {
  assert.equal(
    shouldShowTripModeEntry({ tripModeEnabled: true, isMember: false, windowOpen: true, atVenue: false }),
    false
  )
})

test('entry point hidden once the Trip Mode window has closed, even mid-trip conditions otherwise met', () => {
  assert.equal(
    shouldShowTripModeEntry({ tripModeEnabled: true, isMember: true, windowOpen: false, atVenue: false }),
    false
  )
})

// ---------------------------------------------------------------------------
// computeTripModePointsAwarded
// ---------------------------------------------------------------------------

test('points formula matches the existing difficulty * pointMultiplier convention', () => {
  assert.equal(computeTripModePointsAwarded(5, 2), 10)
  assert.equal(computeTripModePointsAwarded(3, 1.5), 5) // Math.round(4.5) -> 4? verify below
})

test('points formula rounds like Math.round (banker-free, standard JS rounding)', () => {
  assert.equal(computeTripModePointsAwarded(3, 1.5), Math.round(4.5))
})

test('points formula defaults difficulty to 1 and pointMultiplier to 1 when missing', () => {
  assert.equal(computeTripModePointsAwarded(null, null), 1)
  assert.equal(computeTripModePointsAwarded(undefined, undefined), 1)
})

// ---------------------------------------------------------------------------
// buildTripModeCheckInPayload
// ---------------------------------------------------------------------------

test('builds correct payload shape with verification_method and experienced_at set', () => {
  const payload = buildTripModeCheckInPayload({
    userId: 'user-1',
    listItemId: 'li-1',
    itemId: 'item-1',
    pointsAwarded: 5,
    experiencedAt: '2026-09-22',
  })
  assert.equal(payload.user_id, 'user-1')
  assert.equal(payload.list_item_id, 'li-1')
  assert.equal(payload.item_id, 'item-1')
  assert.equal(payload.checkin_method, 'tap')
  assert.equal(payload.points_awarded, 5)
  assert.equal(payload.verification_method, TRIP_MODE_VERIFICATION_METHOD)
  assert.equal(payload.verification_method, 'trip_list_retroactive')
  assert.equal(payload.experienced_at, '2026-09-22')
  assert.equal(payload.photo_url, null)
  assert.equal(payload.matched_candidate_visit_id, null)
})

test('includes optional photo/memory/candidate-visit fields when provided', () => {
  const payload = buildTripModeCheckInPayload({
    userId: 'user-1',
    listItemId: 'li-1',
    itemId: 'item-1',
    pointsAwarded: 5,
    experiencedAt: '2026-09-22',
    photoUrl: 'https://example.com/photo.jpg',
    photoWidth: 800,
    photoHeight: 600,
    personalPlace: 'Marienplatz',
    personalNote: 'Great beer',
    matchedCandidateVisitId: 'cv-1',
  })
  assert.equal(payload.photo_url, 'https://example.com/photo.jpg')
  assert.equal(payload.photo_width, 800)
  assert.equal(payload.photo_height, 600)
  assert.equal(payload.personal_place, 'Marienplatz')
  assert.equal(payload.personal_note, 'Great beer')
  assert.equal(payload.matched_candidate_visit_id, 'cv-1')
})

test('throws rather than building a payload with a null/missing list_item_id — no standalone Trip Mode path', () => {
  assert.throws(() => buildTripModeCheckInPayload({
    userId: 'user-1',
    listItemId: null,
    itemId: 'item-1',
    pointsAwarded: 5,
    experiencedAt: '2026-09-22',
  }), /list_item_id/)
})

test('throws when experiencedAt is missing', () => {
  assert.throws(() => buildTripModeCheckInPayload({
    userId: 'user-1',
    listItemId: 'li-1',
    itemId: 'item-1',
    pointsAwarded: 5,
    experiencedAt: null,
  }), /experienced_at/)
})

// ---------------------------------------------------------------------------
// resolveTripModeCollisionOutcome
// ---------------------------------------------------------------------------

test('collision treated as success when a matching row already exists (same as the existing live/photo check-off paths)', () => {
  assert.equal(resolveTripModeCollisionOutcome({ existingRowCount: 1 }), 'success')
  assert.equal(resolveTripModeCollisionOutcome({ existingRowCount: 3 }), 'success')
})

test('collision treated as failed when re-query finds no matching row', () => {
  assert.equal(resolveTripModeCollisionOutcome({ existingRowCount: 0 }), 'failed')
  assert.equal(resolveTripModeCollisionOutcome({ existingRowCount: null }), 'failed')
  assert.equal(resolveTripModeCollisionOutcome({}), 'failed')
})
