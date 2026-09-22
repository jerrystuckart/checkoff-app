// What's Good V1 — coverage-mode policy layer.
//
// CONTEXT: commit 1567427 fixed Munich showing Vienna/universal filler by
// making Universal-item exclusion UNCONDITIONAL — correct for a supported
// metro with enough local inventory, but too absolute: it also meant a user
// entirely outside CheckOff's supported geography (e.g. San Francisco — no
// metro_areas row within MAX_NEARBY_RADIUS_M of it at all, confirmed via a
// read-only query during this fix) got NOTHING from What's Good, and a
// supported-but-sparse area with 1-2 local items also got nothing instead
// of those items plus a Universal top-up. This module is the single place
// that decides, from the current location/coverage context, which of those
// policies applies — everything downstream (lib/whatsGoodOrchestrator.js's
// composition, lib/whatsGoodDataAdapter.js's final validator) branches on
// its output rather than re-deriving the policy itself.
//
// Pure, no I/O — the caller supplies the current location-resolution state
// and the real geographically-eligible LOCAL candidate pool size it already
// computed (lib/whatsGoodSelection.js's `ranked.length`, itself built from
// lib/whatsGoodDataAdapter.js's assembleWhatsGoodCandidates, which already
// applies the MAX_NEARBY_RADIUS_M cutoff — see lib/nearbyRanking.js).

/** The 5 coverage modes — see this module's doc and Step 4 of the fix plan. */
export const COVERAGE_MODE = Object.freeze({
  PENDING_LOCATION: 'PENDING_LOCATION',
  SUPPORTED_SUFFICIENT: 'SUPPORTED_SUFFICIENT',
  SUPPORTED_SPARSE: 'SUPPORTED_SPARSE',
  UNSUPPORTED: 'UNSUPPORTED',
  LOCATION_UNAVAILABLE: 'LOCATION_UNAVAILABLE',
})

// VERIFIED (not invented) real desired-card-count — extracted from the
// literal `3` that already governed this pipeline before this fix:
//   - lib/whatsGoodSelection.js's selectWhatsGood(): `ranked.slice(0, 3)`
//   - lib/whatsGoodOrchestrator.js's prior `3 - selectedItemIds.length` /
//     `finalItemIds.length < 3` (this fix replaces those literals with this
//     constant; whatsGoodSelection.js is out of this fix's scope and is left
//     with its own literal `3`, which still matches this value exactly).
// This is a named-constant EXTRACTION of an existing value, not a new one.
export const WHATS_GOOD_TARGET_COUNT = 3

/**
 * @param {object} params
 * @param {'pending'|'ready'|'unavailable'} params.locationState  Current
 *   location-resolution state. 'pending' = still resolving (first-ever
 *   fix, or the caller otherwise doesn't have a usable location yet).
 *   'unavailable' = resolution finished but there's no usable device
 *   location (denied/timed out). 'ready' = a real, current location fix.
 * @param {number} params.eligibleLocalCount  Size of the geographically-
 *   eligible LOCAL candidate pool, already computed AGAINST the
 *   coordinates this mode is being derived for. For 'ready', that's live
 *   GPS. For 'unavailable' WITH hasExplicitSelection, the caller is
 *   expected to have already computed this against the explicitly-selected
 *   city's OWN coordinates (see lib/metroSelection.js's persisted-choice
 *   mechanism, read-only reference) rather than against GPS — this
 *   function has no location math of its own, it only classifies a count.
 * @param {number} params.targetCount  The desired card count — pass
 *   WHATS_GOOD_TARGET_COUNT above (verified, not re-invented here).
 * @param {boolean} [params.hasExplicitSelection]  True when the user has an
 *   explicit, deliberately-selected city to fall back on. Only changes
 *   behavior when locationState is 'unavailable': true means "treat this
 *   like a resolved location (the explicit city's), classify normally";
 *   false/omitted means "there is truly nothing to show — LOCATION_UNAVAILABLE."
 * @returns {string}  one of COVERAGE_MODE's values.
 */
export function deriveCoverageMode({ locationState, eligibleLocalCount, targetCount, hasExplicitSelection = false }) {
  if (locationState === 'pending') return COVERAGE_MODE.PENDING_LOCATION

  if (locationState === 'unavailable' && !hasExplicitSelection) {
    return COVERAGE_MODE.LOCATION_UNAVAILABLE
  }

  // 'ready' GPS, OR 'unavailable' GPS with an explicit selection substituted
  // in its place — both are classified identically against whatever
  // eligibleLocalCount the caller computed for the relevant coordinates.
  const count = eligibleLocalCount ?? 0
  if (count >= targetCount) return COVERAGE_MODE.SUPPORTED_SUFFICIENT
  if (count >= 1) return COVERAGE_MODE.SUPPORTED_SPARSE
  return COVERAGE_MODE.UNSUPPORTED
}
