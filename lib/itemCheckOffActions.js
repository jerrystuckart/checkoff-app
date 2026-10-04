// Item detail check-off wording and retrospective eligibility: ONE contract, pure, no React Native / Supabase.
//
// Three different things are kept apart:
//   ordinary   an immediate completion now (normal date, normal verification)            label: "I'VE DONE THIS"
//   recent     recovering a verified candidate visit for THIS item (inbox confirm flow)   label: "Check off from a recent visit"
//   trip       a Trip Mode retrospective completion (experienced_at, TripModeCheckOffSheet) label: "Check off from this trip"
//
// Custom lists are Regular (trip_mode_enabled = false) or Trip Mode (true); both stay available in create and edit.
// The trip action exists only when the item was opened THROUGH a Trip Mode list (the route carries that exact list id) and
// everything below is verified against the database, never taken from navigation params alone. Being universal, belonging to
// someone's trip list somewhere, or opening the item from Home, Nearby, search or an email link is not trip context.
//
// The window mirrors the server trigger prevent_expired_list_checkins (verified against the live definition 2026-10-04):
//   - trip_mode_enabled and the user is a list_members row of that list (is_list_member)
//   - the list_item row belongs to that list and that item, and the item is active
//   - starts_at set: the trip does not apply before that date
//   - ends_at set: it applies until ends_at + grace days (default 7)
//   - ends_at NULL: an ongoing trip while Trip Mode stays enabled; nothing is expired merely because the date is null
// The server stays the authority for every write; this decides only what the screen offers.
import { toMetroDateString } from './seasonWindowPure.js'
import { isTripModeWindowOpen } from './tripMode.js'

export const CHECK_OFF_LABELS = Object.freeze({
  ordinary: "I'VE DONE THIS",
  recent: 'Check off from a recent visit',
  trip: 'Check off from this trip',
})

/**
 * Genuine trip context, verified. ALL must hold:
 *  - the route carries a listId and the list row fetched for that id is that list
 *  - the list is Trip Mode enabled, and the current user is a member of it (fetched, not a param)
 *  - the item's list_item row was verified to belong to THAT list and THIS item, and the item is active
 *  - starts_at (if any) has been reached; ends_at (if any) plus grace has not passed; no ends_at means ongoing
 *  - the user is not at the venue (the live flow is the primary action there)
 * @returns {{eligible: boolean, reason: string}}
 */
export function deriveTripContext({ routeListId, list, isMember, listItemVerified, itemActive = true, atVenue, now = new Date() }) {
  if (!routeListId) return { eligible: false, reason: 'no-list-context' }
  if (!list || list.id !== routeListId) return { eligible: false, reason: 'list-not-verified' }
  if (list.tripModeEnabled !== true) return { eligible: false, reason: 'not-trip-list' }
  if (isMember !== true) return { eligible: false, reason: 'not-member' }
  if (listItemVerified !== true) return { eligible: false, reason: 'list-item-not-verified' }
  if (itemActive === false) return { eligible: false, reason: 'item-inactive' }
  const timezone = list.timezone ?? 'America/Phoenix'
  const today = toMetroDateString(now.toISOString(), timezone)
  if (list.startsAt && today < list.startsAt) return { eligible: false, reason: 'trip-not-started' }
  if (list.endsAt && !isTripModeWindowOpen({ endsAt: list.endsAt, graceDays: list.graceDays, timezone, now })) {
    return { eligible: false, reason: 'trip-window-closed' }
  }
  if (atVenue === true) return { eligible: false, reason: 'at-venue' }
  return { eligible: true, reason: list.endsAt ? 'trip' : 'trip-ongoing' }
}

/**
 * A recoverable visit for exactly this item: an actionable candidate (lib/visitDetection/actionableCandidates.js, which already
 * excludes confirmed, rejected, expired, unreadable and already checked off) whose item is this item, for this user, on a
 * platform that supports recovery. Universal items never have a location candidate.
 */
export function findRecentVisitCandidate({ candidates, itemId, isUniversal, recoverySupported, now = new Date() }) {
  if (!recoverySupported || isUniversal === true || !itemId) return null
  return (candidates ?? []).find((c) =>
    c && c.itemId === itemId && !c.confirmedAt && !c.rejectedAt && (!c.expiresAt || new Date(c.expiresAt) > now)
  ) ?? null
}

/**
 * What the retrospective affordance on item detail is. The ordinary primary action is always present; this only decides
 * whether a SECOND, retrospective action exists and what it is called.
 * @returns {{kind: 'none'|'recent'|'trip', label: string|null, primaryLabel: string}}
 */
export function resolveRetroAction({ recentCandidate, trip }) {
  if (recentCandidate) return { kind: 'recent', label: CHECK_OFF_LABELS.recent, primaryLabel: CHECK_OFF_LABELS.ordinary }
  if (trip?.eligible === true) return { kind: 'trip', label: CHECK_OFF_LABELS.trip, primaryLabel: CHECK_OFF_LABELS.ordinary }
  return { kind: 'none', label: null, primaryLabel: CHECK_OFF_LABELS.ordinary }
}
