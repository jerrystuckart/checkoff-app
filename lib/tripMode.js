// Trip Mode MVP (2026-09-23) — pure client-side eligibility/date-window
// logic for retroactive list completion. Mirrors, field-for-field, the
// server-side authorization the new prevent_expired_list_checkins()
// trigger branch enforces (see
// docs/trip-mode/20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql)
// — this module is NEVER the actual authorization. Its only jobs are (1)
// restricting the date picker to dates the server will actually accept, so
// the UI doesn't offer a choice guaranteed to be rejected, and (2) deciding
// whether to show the Trip Mode entry point at all. The server trigger is
// the sole authority; a client that skips this module entirely and submits
// straight to Supabase gets the exact same server-side enforcement.
//
// Reuses toMetroDateString from lib/seasonWindowPure.js (the established,
// already-tested Intl.DateTimeFormat('en-CA', {timeZone}) pattern this
// codebase already uses for every other metro-timezone-aware date
// comparison) rather than inventing new timezone math — this is what makes
// "timezone behavior is deterministic" true by construction: it's the same
// deterministic mechanism every other date-window check in this app
// already relies on.
//
// Zero imports beyond lib/seasonWindowPure.js (itself zero-import) — no
// Supabase, no AsyncStorage, no React Native — so this loads cleanly under
// plain `node --test`, matching this codebase's established pure-logic
// convention.

import { toMetroDateString } from './seasonWindowPure.js'

/** The verification_method value the server trigger branches on. Single source of truth for the literal string. */
export const TRIP_MODE_VERIFICATION_METHOD = 'trip_list_retroactive'

/** Matches lists.trip_mode_grace_days' column default — used only as a client-side fallback display value before a real list row is loaded. */
export const DEFAULT_TRIP_MODE_GRACE_DAYS = 7

/**
 * Whether a list's Trip Mode UI entry point should be offered at all.
 * Pure combination of two already-known booleans — no date logic here.
 *
 * @param {{tripModeEnabled: boolean, isMember: boolean}} params
 * @returns {boolean}
 */
export function isTripModeAvailableForList({ tripModeEnabled, isMember }) {
  return tripModeEnabled === true && isMember === true
}

/**
 * The inclusive [minDate, maxDate] of dates the server will accept as
 * `experienced_at`, as 'YYYY-MM-DD' strings — mirrors the trigger's three
 * checks exactly:
 *   - experienced_at >= list starts_at
 *   - experienced_at <= "today" in the list's own metro timezone (can't
 *     retroactively check off something that hasn't happened yet)
 *   - experienced_at <= ends_at + graceDays
 * maxDate is the EARLIER of "today" and "ends_at + graceDays" — matching
 * the trigger's two independent upper-bound checks collapsed into one
 * picker limit.
 *
 * @param {object} params
 * @param {string|null} params.startsAt  'YYYY-MM-DD' or null (no lower bound)
 * @param {string|null} params.endsAt    'YYYY-MM-DD' or null (no upper bound from the trip window itself — "today" still applies)
 * @param {number} [params.graceDays]    defaults to DEFAULT_TRIP_MODE_GRACE_DAYS
 * @param {string} params.timezone       IANA timezone, e.g. list's resolved metro timezone
 * @param {Date} [params.now]            injectable for tests; defaults to `new Date()`
 * @returns {{minDate: string|null, maxDate: string}}
 */
export function deriveTripModeDateWindow({ startsAt, endsAt, graceDays = DEFAULT_TRIP_MODE_GRACE_DAYS, timezone, now = new Date() }) {
  const today = toMetroDateString(now.toISOString(), timezone)
  const graceEnd = endsAt ? addDaysToDateString(endsAt, graceDays) : null
  const maxDate = graceEnd && graceEnd < today ? graceEnd : today
  return { minDate: startsAt ?? null, maxDate }
}

/**
 * Whether a specific candidate 'YYYY-MM-DD' experienced_at date would be
 * accepted by the server trigger RIGHT NOW, for a given list's trip
 * window+grace. Pure predicate — used both for client-side pre-validation
 * (grey out an invalid quick-choice) and directly by this module's own
 * tests to prove parity with the trigger's date logic described in the
 * migration file.
 *
 * @param {object} params
 * @param {string} params.dateStr  'YYYY-MM-DD' candidate experienced_at
 * @param {string|null} params.startsAt
 * @param {string|null} params.endsAt
 * @param {number} [params.graceDays]
 * @param {string} params.timezone
 * @param {Date} [params.now]
 * @returns {boolean}
 */
export function isDateWithinTripModeWindow({ dateStr, startsAt, endsAt, graceDays = DEFAULT_TRIP_MODE_GRACE_DAYS, timezone, now = new Date() }) {
  if (!dateStr) return false
  const { minDate, maxDate } = deriveTripModeDateWindow({ startsAt, endsAt, graceDays, timezone, now })
  if (minDate && dateStr < minDate) return false
  if (dateStr > maxDate) return false
  return true
}

/**
 * Whether the Trip Mode window is still open for NEW submissions at all,
 * right now — mirrors the trigger's second upper-bound check (the one that
 * actually closes the door after grace expires, independent of which date
 * the user picks). A list can have `tripModeEnabled: true` and still be
 * closed for new submissions once "now" (in the list's timezone) is past
 * ends_at + graceDays.
 *
 * @param {object} params
 * @param {string|null} params.endsAt
 * @param {number} [params.graceDays]
 * @param {string} params.timezone
 * @param {Date} [params.now]
 * @returns {boolean}
 */
export function isTripModeWindowOpen({ endsAt, graceDays = DEFAULT_TRIP_MODE_GRACE_DAYS, timezone, now = new Date() }) {
  if (!endsAt) return true
  const today = toMetroDateString(now.toISOString(), timezone)
  const graceEnd = addDaysToDateString(endsAt, graceDays)
  return today <= graceEnd
}

/**
 * "Today" and "Yesterday" quick-choice dates, in the list's own timezone —
 * same toMetroDateString mechanism as everything else in this module, so
 * these two shortcuts are never off-by-one from what a manually-picked
 * identical date would resolve to.
 *
 * @param {string} timezone
 * @param {Date} [now]
 * @returns {{today: string, yesterday: string}}
 */
export function getTripModeQuickChoices(timezone, now = new Date()) {
  const today = toMetroDateString(now.toISOString(), timezone)
  const yesterdayInstant = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const yesterday = toMetroDateString(yesterdayInstant.toISOString(), timezone)
  return { today, yesterday }
}

/** 'YYYY-MM-DD' + N days -> 'YYYY-MM-DD', pure date-string arithmetic, no timezone involved (date-only, matching the trigger's own `(list_ends + make_interval(days => N))::date` arithmetic, which is also timezone-agnostic once it's already a `date`). */
function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
