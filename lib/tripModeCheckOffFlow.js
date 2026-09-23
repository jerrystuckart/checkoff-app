// Trip Mode MVP (2026-09-23) — pure client-side decision logic for the
// TripModeCheckOffSheet UI and its ItemDetailScreen entry point. Split out
// from lib/tripMode.js (date-window/eligibility math, already finalized
// and tested — read-only, not edited by this pass) because this module
// owns different pure decisions: which primary check-off action to show
// given geofence/membership/window state, and what insert payload shape a
// Trip Mode check-in submission builds. Zero React Native / Supabase
// imports (only lib/tripMode.js's exported constant), so this loads
// cleanly under plain `node --test`, matching this codebase's established
// pure-logic-extraction convention.

import { TRIP_MODE_VERIFICATION_METHOD } from './tripMode.js'

/**
 * Whether the "Check off from this trip" secondary entry point should be
 * offered on ItemDetailScreen right now.
 *
 * Trip Mode is only ever a secondary/alternate action — when the user is
 * genuinely at the venue (atVenue === true), this returns false and the
 * live flow stays the sole primary offer, per the hard requirement that
 * live check-off remains the default experience whenever presence is
 * confirmed. atVenue is expected to come from the same advisory,
 * never-prompting presence signal ItemDetailScreen already computes
 * elsewhere (lib/whatsGoodAtPlace.js's isAtPlace against a
 * permission-check-only cached location) — false covers both "confirmed
 * far away" and "location unknown/unavailable/denied", which is exactly
 * the "OUTSIDE the live geofence (or location unavailable)" condition
 * this gate is meant to express.
 *
 * @param {object} params
 * @param {boolean} params.tripModeEnabled  lists.trip_mode_enabled for this item's list
 * @param {boolean} params.isMember         current user is a list_members row for this list
 * @param {boolean} params.windowOpen       isTripModeWindowOpen(...) result
 * @param {boolean} params.atVenue          advisory "near this item" signal — true means the live flow is the right primary action
 * @returns {boolean}
 */
export function shouldShowTripModeEntry({ tripModeEnabled, isMember, windowOpen, atVenue }) {
  if (tripModeEnabled !== true) return false
  if (isMember !== true) return false
  if (windowOpen !== true) return false
  return atVenue !== true
}

/**
 * Trip Mode's own difficulty*multiplier points formula — identical to the
 * one already inlined at every existing check-off call site
 * (ItemDetailScreen.jsx's performCheckOff/performNearbyDone,
 * PhotoCheckInScreen.jsx's submitCheckIn: `Math.round((item?.difficulty ??
 * 1) * pointMultiplier)`). Extracted here only so it's independently
 * testable alongside this module's other pure Trip Mode logic — not a
 * behavior change from the existing formula, and not meant to replace it
 * at those other call sites.
 *
 * @param {number|null|undefined} difficulty
 * @param {number|null|undefined} pointMultiplier
 * @returns {number}
 */
export function computeTripModePointsAwarded(difficulty, pointMultiplier) {
  return Math.round((difficulty ?? 1) * (pointMultiplier ?? 1))
}

/**
 * Builds the check_ins insert payload for a Trip Mode (retroactive)
 * completion. list_item_id is mandatory — Trip Mode never has a
 * standalone path, unlike the live/photo flows' `?? null` fallback — so
 * this throws rather than silently building a payload the server trigger
 * is guaranteed to reject, or (worse) one whose missing list context lets
 * it slip past the trigger's trip-window enforcement in some future
 * refactor. experiencedAt is equally mandatory for the same reason.
 *
 * photo/memory fields are always included (as null when unused) rather
 * than conditionally spread, so every Trip Mode payload has one
 * predictable shape regardless of whether the optional "Add photo or
 * memory" step ran.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.listItemId              REQUIRED, non-null
 * @param {string|null} [params.itemId]
 * @param {number} params.pointsAwarded
 * @param {string} params.experiencedAt            'YYYY-MM-DD', REQUIRED
 * @param {string|null} [params.photoUrl]
 * @param {number|null} [params.photoWidth]
 * @param {number|null} [params.photoHeight]
 * @param {string|null} [params.personalPlace]
 * @param {string|null} [params.personalNote]
 * @param {string|null} [params.matchedCandidateVisitId]  tester-only, best-effort soft cross-reference, never required
 * @returns {object} check_ins insert payload
 */
export function buildTripModeCheckInPayload({
  userId,
  listItemId,
  itemId = null,
  pointsAwarded,
  experiencedAt,
  photoUrl = null,
  photoWidth = null,
  photoHeight = null,
  personalPlace = null,
  personalNote = null,
  matchedCandidateVisitId = null,
}) {
  if (!listItemId) {
    throw new Error('Trip Mode check-ins require a non-null list_item_id — there is no standalone path for this verification method.')
  }
  if (!experiencedAt) {
    throw new Error('Trip Mode check-ins require an experienced_at date.')
  }

  return {
    user_id: userId,
    list_item_id: listItemId,
    item_id: itemId ?? null,
    checkin_method: 'tap',
    points_awarded: pointsAwarded,
    verification_method: TRIP_MODE_VERIFICATION_METHOD,
    experienced_at: experiencedAt,
    photo_url: photoUrl,
    photo_width: photoWidth,
    photo_height: photoHeight,
    personal_place: personalPlace,
    personal_note: personalNote,
    matched_candidate_visit_id: matchedCandidateVisitId,
  }
}

/**
 * Pure decision for the 23505 (unique constraint) collision path — mirrors
 * the existing live/photo check-off sites' rule exactly: a collision on
 * the exact attempted slot (this user + this list_item_id) means a
 * matching row already exists, which is treated as a successful outcome,
 * never a failure. Extracted so "23505 collision handling produces the
 * same treat-as-success outcome as the existing live paths" is
 * independently testable without a real Supabase call.
 *
 * @param {{existingRowCount: number}} params
 * @returns {'success'|'failed'}
 */
export function resolveTripModeCollisionOutcome({ existingRowCount }) {
  return (existingRowCount ?? 0) > 0 ? 'success' : 'failed'
}
