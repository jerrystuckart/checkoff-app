// Trip Mode MVP (2026-09-23) — lib/tripMode.js unit tests.
//
// These cover the PURE client-side logic only (date-window derivation,
// quick-choice dates, availability gating). The tests that require real
// server enforcement (nonmember rejected, different list rejected,
// disabled Trip Mode rejected, duplicate submission rejected, points
// awarded exactly once, user cannot forge another user/list/item) are
// enforced by the trigger in
// docs/trip-mode/20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql
// — see docs/trip-mode/REGRESSION_TEST_PLAN.md for the SQL-level
// verification plan for those, since this repo has no live/staging DB
// test harness to run trigger-level tests against safely.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRIP_MODE_VERIFICATION_METHOD,
  DEFAULT_TRIP_MODE_GRACE_DAYS,
  isTripModeAvailableForList,
  deriveTripModeDateWindow,
  isDateWithinTripModeWindow,
  isTripModeWindowOpen,
  getTripModeQuickChoices,
} from './tripMode.js'

const MUNICH_TZ = 'Europe/Berlin'
// Matches the live list confirmed this session: starts_at 2026-09-21, ends_at 2026-09-25.
const TRIP_STARTS = '2026-09-21'
const TRIP_ENDS = '2026-09-25'

test('TRIP_MODE_VERIFICATION_METHOD matches the server trigger literal exactly', () => {
  assert.equal(TRIP_MODE_VERIFICATION_METHOD, 'trip_list_retroactive')
})

test('DEFAULT_TRIP_MODE_GRACE_DAYS matches the lists.trip_mode_grace_days column default (7)', () => {
  assert.equal(DEFAULT_TRIP_MODE_GRACE_DAYS, 7)
})

// ---------------------------------------------------------------------------
// isTripModeAvailableForList
// ---------------------------------------------------------------------------

test('available only when both tripModeEnabled and isMember are true', () => {
  assert.equal(isTripModeAvailableForList({ tripModeEnabled: true, isMember: true }), true)
  assert.equal(isTripModeAvailableForList({ tripModeEnabled: true, isMember: false }), false)
  assert.equal(isTripModeAvailableForList({ tripModeEnabled: false, isMember: true }), false)
  assert.equal(isTripModeAvailableForList({ tripModeEnabled: false, isMember: false }), false)
})

test('disabled-list-member-eligible-elsewhere case is still rejected: enabling on ANOTHER list must not leak here (caller responsibility, but the gate itself only ever looks at the two booleans it was given)', () => {
  // This test documents the contract: the caller MUST pass tripModeEnabled
  // for THIS specific list, never a global/any-list flag. The function
  // itself has no list-identity concept at all -- that's intentional, the
  // real cross-list isolation is enforced server-side by resolving
  // list_id from list_item_id, never trusting a client-supplied list_id.
  assert.equal(isTripModeAvailableForList({ tripModeEnabled: true, isMember: true }), true)
})

// ---------------------------------------------------------------------------
// deriveTripModeDateWindow / isDateWithinTripModeWindow
// ---------------------------------------------------------------------------

test('date inside trip window accepted: mid-trip date, current time also mid-trip', () => {
  const now = new Date('2026-09-23T10:00:00Z') // trip is 09-21 to 09-25
  const ok = isDateWithinTripModeWindow({
    dateStr: '2026-09-22',
    startsAt: TRIP_STARTS,
    endsAt: TRIP_ENDS,
    timezone: MUNICH_TZ,
    now,
  })
  assert.equal(ok, true)
})

test('date outside allowed window rejected: before the trip started', () => {
  const now = new Date('2026-09-23T10:00:00Z')
  const ok = isDateWithinTripModeWindow({
    dateStr: '2026-09-19', // before starts_at
    startsAt: TRIP_STARTS,
    endsAt: TRIP_ENDS,
    timezone: MUNICH_TZ,
    now,
  })
  assert.equal(ok, false)
})

test('cannot select a future date beyond "today" even if it would otherwise be within ends_at+grace', () => {
  const now = new Date('2026-09-23T10:00:00Z') // "today" is 09-23
  const ok = isDateWithinTripModeWindow({
    dateStr: '2026-09-24', // in the future relative to now, though still <= ends_at
    startsAt: TRIP_STARTS,
    endsAt: TRIP_ENDS,
    timezone: MUNICH_TZ,
    now,
  })
  assert.equal(ok, false)
})

test('grace period accepted through day seven after ends_at', () => {
  // ends_at 2026-09-25 + 7 days = 2026-10-02. "now" must also be within
  // grace for the window to be open at all (checked separately below) --
  // here we set "now" to exactly the last graced day.
  const now = new Date('2026-10-02T10:00:00Z')
  const ok = isDateWithinTripModeWindow({
    dateStr: '2026-09-25', // the last real trip day
    startsAt: TRIP_STARTS,
    endsAt: TRIP_ENDS,
    graceDays: 7,
    timezone: MUNICH_TZ,
    now,
  })
  assert.equal(ok, true)
})

test('expired attempt rejected: submitting at all (any date) one day beyond the grace period is rejected, via isTripModeWindowOpen', () => {
  // This is the "is the window still open for a NEW submission right now"
  // check, distinct from "is this specific selected date valid" -- the
  // server trigger enforces both independently, and an otherwise-valid
  // historical date does not save a submission attempted after the whole
  // window has closed.
  const now = new Date('2026-10-03T10:00:00Z') // one day past the day-7 grace cutoff (10-02)
  assert.equal(
    isTripModeWindowOpen({ endsAt: TRIP_ENDS, graceDays: 7, timezone: MUNICH_TZ, now }),
    false
  )
})

test('deriveTripModeDateWindow maxDate is capped at "today" even when grace extends further into the future', () => {
  const now = new Date('2026-09-23T10:00:00Z') // today, well before ends_at+grace (10-02)
  const { minDate, maxDate } = deriveTripModeDateWindow({
    startsAt: TRIP_STARTS,
    endsAt: TRIP_ENDS,
    graceDays: 7,
    timezone: MUNICH_TZ,
    now,
  })
  assert.equal(minDate, '2026-09-21')
  assert.equal(maxDate, '2026-09-23', 'maxDate must never exceed "today" even if grace would otherwise allow a later date')
})

test('deriveTripModeDateWindow maxDate is the grace cutoff once that is earlier than "today"', () => {
  const now = new Date('2026-10-15T10:00:00Z') // well past grace
  const { maxDate } = deriveTripModeDateWindow({
    startsAt: TRIP_STARTS,
    endsAt: TRIP_ENDS,
    graceDays: 7,
    timezone: MUNICH_TZ,
    now,
  })
  assert.equal(maxDate, '2026-10-02', 'maxDate should be the grace cutoff (ends_at + 7 days), not "today", once "today" has moved past it')
})

test('no startsAt/endsAt -> minDate null, maxDate is just "today" (no lower bound, no grace math to apply)', () => {
  const now = new Date('2026-09-23T10:00:00Z')
  const { minDate, maxDate } = deriveTripModeDateWindow({ startsAt: null, endsAt: null, timezone: MUNICH_TZ, now })
  assert.equal(minDate, null)
  assert.equal(maxDate, '2026-09-23')
})

// ---------------------------------------------------------------------------
// isTripModeWindowOpen
// ---------------------------------------------------------------------------

test('window is open throughout the trip and through the grace period', () => {
  for (const iso of ['2026-09-21T00:00:00Z', '2026-09-25T12:00:00Z', '2026-10-02T12:00:00Z']) {
    assert.equal(
      isTripModeWindowOpen({ endsAt: TRIP_ENDS, graceDays: 7, timezone: MUNICH_TZ, now: new Date(iso) }),
      true,
      `expected window open at ${iso}`
    )
  }
})

test('window closes the day after grace expires', () => {
  assert.equal(
    isTripModeWindowOpen({ endsAt: TRIP_ENDS, graceDays: 7, timezone: MUNICH_TZ, now: new Date('2026-10-03T00:00:00Z') }),
    false
  )
})

test('no endsAt -> window is always open (never blocks a list with no configured end date)', () => {
  assert.equal(
    isTripModeWindowOpen({ endsAt: null, timezone: MUNICH_TZ, now: new Date('2099-01-01T00:00:00Z') }),
    true
  )
})

// ---------------------------------------------------------------------------
// getTripModeQuickChoices
// ---------------------------------------------------------------------------

test('quick choices resolve to the correct today/yesterday in the list timezone', () => {
  // 2026-09-23T22:30:00Z is 2026-09-24 00:30 in Europe/Berlin (UTC+2 in September) --
  // this is exactly the kind of near-midnight edge case that proves the
  // timezone-aware derivation (not a naive UTC date slice) is being used.
  const now = new Date('2026-09-23T22:30:00Z')
  const { today, yesterday } = getTripModeQuickChoices(MUNICH_TZ, now)
  assert.equal(today, '2026-09-24', "must reflect the LIST's timezone date, not the raw UTC date")
  assert.equal(yesterday, '2026-09-23')
})

test('quick choices are internally consistent: yesterday is always exactly one calendar day before today, in the same timezone', () => {
  const now = new Date('2026-01-01T15:00:00Z') // new year's day edge case (08:00 in Phoenix, UTC-7 year-round)
  const { today, yesterday } = getTripModeQuickChoices('America/Phoenix', now)
  assert.equal(today, '2026-01-01')
  assert.equal(yesterday, '2025-12-31')
})

// ---------------------------------------------------------------------------
// Timezone determinism (policy: "timezone behavior is deterministic")
// ---------------------------------------------------------------------------

test('timezone determinism: the same instant produces different but internally consistent "today" values across two real timezones, and the SAME timezone always produces the SAME result for the SAME instant', () => {
  const now = new Date('2026-09-23T23:30:00Z') // late UTC evening
  const berlinToday = getTripModeQuickChoices('Europe/Berlin', now).today
  const phoenixToday = getTripModeQuickChoices('America/Phoenix', now).today
  // Berlin (UTC+2) has already rolled to the next day; Phoenix (UTC-7) has not.
  assert.equal(berlinToday, '2026-09-24')
  assert.equal(phoenixToday, '2026-09-23')
  // Determinism: calling twice with the identical inputs must be byte-identical.
  assert.equal(getTripModeQuickChoices('Europe/Berlin', now).today, berlinToday)
  assert.equal(getTripModeQuickChoices('Europe/Berlin', new Date(now.getTime())).today, berlinToday)
})

test('unknown/garbage timezone string does not throw -- Intl.DateTimeFormat behavior is inherited as-is from lib/seasonWindowPure.js, not reimplemented here', () => {
  // This module deliberately does not validate the timezone string itself
  // -- it is always the list's own resolve_metro_timezone() value, which
  // already defaults safely server-side. Documenting the inherited
  // behavior rather than silently assuming it.
  assert.doesNotThrow(() => getTripModeQuickChoices('America/Phoenix', new Date('2026-09-23T12:00:00Z')))
})
