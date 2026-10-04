// Item detail check-off wording and retrospective eligibility: ONE contract, pure, no React Native / Supabase.
//
// Three different things were being conflated under one phrase:
//   ordinary   an immediate completion now (normal date, normal verification)            label: "Check this off"
//   recent     recovering a verified candidate visit for THIS item (inbox confirm flow)   label: "Check off from a recent visit"
//   trip       a trip-window retrospective completion (experienced_at, TripModeCheckOffSheet) label: "Check off from this trip"
//
// "Check off from this trip" used to show whenever the item was opened from a list whose trip_mode_enabled was
// true and the window was "open", and an open-ended list (ends_at null) counted as open forever, so a member of an
// open-ended trip list saw it on any item (47 of the 51 items in that list are universal). Being universal, having
// experienced_at in the schema, or having once opened a trip list is not trip context. The server trigger remains
// the authority for writes; this decides only what the screen offers.
import { isTripModeWindowOpen } from './tripMode.js'
import { toMetroDateString } from './seasonWindowPure.js'

export const CHECK_OFF_LABELS = Object.freeze({
  ordinary: 'Check this off',
  recent: 'Check off from a recent visit',
  trip: 'Check off from this trip',
})

/**
 * Genuine trip context, verified (never taken from navigation params alone). ALL must hold:
 *  - the route carries a listId and the list row fetched for that id is that list
 *  - the list is trip mode enabled, and the current user is a member of it (fetched, not a param)
 *  - the item's list_item row was verified to belong to THAT list and THIS item
 *  - the list has a real finite window (starts_at and ends_at), it has begun, and today is within window + grace
 *  - the user is not at the venue (the live flow is the primary action there)
 * @returns {{eligible: boolean, reason: string}}
 */
export function deriveTripContext({ routeListId, list, isMember, listItemVerified, atVenue, now = new Date() }) {
  if (!routeListId) return { eligible: false, reason: 'no-list-context' }
  if (!list || list.id !== routeListId) return { eligible: false, reason: 'list-not-verified' }
  if (list.tripModeEnabled !== true) return { eligible: false, reason: 'not-trip-list' }
  if (isMember !== true) return { eligible: false, reason: 'not-member' }
  if (listItemVerified !== true) return { eligible: false, reason: 'list-item-not-verified' }
  if (!list.startsAt || !list.endsAt) return { eligible: false, reason: 'no-finite-trip-window' }
  const today = toMetroDateString(now.toISOString(), list.timezone ?? 'America/Phoenix')
  if (today < list.startsAt) return { eligible: false, reason: 'trip-not-started' }
  if (!isTripModeWindowOpen({ endsAt: list.endsAt, graceDays: list.graceDays, timezone: list.timezone ?? 'America/Phoenix', now })) {
    return { eligible: false, reason: 'trip-window-closed' }
  }
  if (atVenue === true) return { eligible: false, reason: 'at-venue' }
  return { eligible: true, reason: 'trip' }
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
