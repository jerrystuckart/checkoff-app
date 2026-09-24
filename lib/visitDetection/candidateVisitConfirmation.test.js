// Visit Detection Stage 2 (2026-09-23) — lib/visitDetection/candidateVisitConfirmation.js unit tests.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCandidateVisitSuggestible,
  buildVisitConfirmationPayload,
  buildVisitDismissalPayload,
  formatVisitWhenLabel,
} from './candidateVisitConfirmation.js'

// ---------------------------------------------------------------------------
// isCandidateVisitSuggestible
// ---------------------------------------------------------------------------

test('suggestible: unexpired, unconverted candidate row', () => {
  assert.equal(
    isCandidateVisitSuggestible({
      status: 'medium_confidence',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    true
  )
})

test('not suggestible once already confirmed', () => {
  assert.equal(
    isCandidateVisitSuggestible({
      status: 'confirmed',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      confirmedAt: new Date().toISOString(),
    }),
    false
  )
})

test('not suggestible once already dismissed/rejected', () => {
  assert.equal(
    isCandidateVisitSuggestible({
      status: 'rejected',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      rejectedAt: new Date().toISOString(),
    }),
    false
  )
})

test('not suggestible once expired, even if status is still candidate (client hasn\'t caught up to expireStaleCandidateVisits yet)', () => {
  assert.equal(
    isCandidateVisitSuggestible({
      status: 'candidate',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }),
    false
  )
})

test('not suggestible for a status outside the pre-decision set (e.g. already "expired")', () => {
  assert.equal(
    isCandidateVisitSuggestible({
      status: 'expired',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    false
  )
})

test('suggestible with no expiresAt at all (treated as no expiry gate)', () => {
  assert.equal(
    isCandidateVisitSuggestible({ status: 'high_confidence', expiresAt: null }),
    true
  )
})

// ---------------------------------------------------------------------------
// buildVisitConfirmationPayload
// ---------------------------------------------------------------------------

test('confirmation payload: standalone item, verification_method set, matched_candidate_visit_id set', () => {
  const payload = buildVisitConfirmationPayload({
    userId: 'user-1',
    itemId: 'item-1',
    candidateVisitId: 'cv-1',
  })
  assert.equal(payload.verification_method, 'historical_visit_confirmed')
  assert.equal(payload.matched_candidate_visit_id, 'cv-1')
  assert.equal(payload.list_item_id, null)
  assert.equal(payload.item_id, 'item-1')
  assert.equal(payload.checkin_method, 'tap')
})

test('confirmation payload throws without an itemId — no standalone-less path', () => {
  assert.throws(() => buildVisitConfirmationPayload({ userId: 'user-1', itemId: null, candidateVisitId: 'cv-1' }))
})

test('confirmation payload throws without a candidateVisitId — no general confirmation bypass', () => {
  assert.throws(() => buildVisitConfirmationPayload({ userId: 'user-1', itemId: 'item-1', candidateVisitId: null }))
})

test('confirmation payload points_awarded is a placeholder (0), never trusted — server always overwrites it', () => {
  const payload = buildVisitConfirmationPayload({ userId: 'user-1', itemId: 'item-1', candidateVisitId: 'cv-1' })
  assert.equal(payload.points_awarded, 0)
})

// ---------------------------------------------------------------------------
// buildVisitDismissalPayload
// ---------------------------------------------------------------------------

test('dismissal payload sets status=rejected and a rejected_at timestamp', () => {
  const payload = buildVisitDismissalPayload()
  assert.equal(payload.status, 'rejected')
  assert.ok(!Number.isNaN(new Date(payload.rejected_at).getTime()))
})

// ---------------------------------------------------------------------------
// formatVisitWhenLabel
// ---------------------------------------------------------------------------

test('formats today correctly', () => {
  const now = new Date(2026, 8, 23, 15, 0, 0)
  const departedAt = new Date(2026, 8, 23, 14, 15, 0).toISOString()
  assert.match(formatVisitWhenLabel(departedAt, now), /^Today, ~/)
})

test('formats yesterday correctly', () => {
  const now = new Date(2026, 8, 23, 9, 0, 0)
  const departedAt = new Date(2026, 8, 22, 20, 0, 0).toISOString()
  assert.match(formatVisitWhenLabel(departedAt, now), /^Yesterday, ~/)
})

test('formats an older date with a month/day label', () => {
  const now = new Date(2026, 8, 23, 9, 0, 0)
  const departedAt = new Date(2026, 8, 18, 13, 0, 0).toISOString()
  const label = formatVisitWhenLabel(departedAt, now)
  assert.match(label, /^Sep 18, ~/)
})
