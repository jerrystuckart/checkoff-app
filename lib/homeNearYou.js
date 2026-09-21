// Home "Near you right now" — pure candidate selection, extracted for
// node:test coverage per this repo's pure-logic-extraction convention (no
// RN render harness exists).
//
// FIX (2026-09-21 field bug, follow-up to dbe0fc8): Home's Near You rail
// previously called proximitySort with includeUniversal:true / maxDistance:
// null — the same config used to intentionally mix generic (no-coordinate)
// Universal items INTO the rail. That is a defensible choice for a general
// discovery rail, but it directly produced the reported bug: "generic
// filler items with no working navigation" showing up under a label that
// says "Near You" and "right now." Worse, proximitySort's own null-location
// fallback branch (used while GPS is still resolving, e.g. right after
// HomeScreen mounts) puts the Universal/no-coordinate pool FIRST, entirely
// unsorted and un-filtered by distance — so during that pending window,
// literally the first thing a user could see under "Near You" was
// non-located filler.
//
// This module gives Home the SAME two guarantees Nearby already has (see
// lib/nearbyRanking.js, read-only reference — untouched by this fix):
//   1. hasUsableCoordinates() gate — an item without a real, sane lat/lng
//      is not eligible for a proximity surface at all, full stop.
//   2. MAX_NEARBY_RADIUS_M hard cutoff — no silent nationwide/worldwide
//      fallback just because nothing qualifies locally.
// Plus one Home-specific guarantee Nearby doesn't need (it already always
// has a location by the time it renders): while userLocation is not yet
// resolved (pending/unavailable), this returns an empty array rather than
// any fallback content — an honest "still figuring out where you are"
// empty state, never generic items mislabeled as real nearby ones.
import { proximitySort } from './proximity.js'
import { hasUsableCoordinates, MAX_NEARBY_RADIUS_M } from './nearbyRanking.js'

function getLat(item) {
  return item?.maps_lat ?? item?.mapsLat ?? null
}
function getLng(item) {
  return item?.maps_lng ?? item?.mapsLng ?? null
}

/**
 * @param {Array} rawItems  HomeScreen's already-fetched candidate pool (same
 *   shape loadNearbyRail()/mapRailItem() produces) — both universal and
 *   located items may be present; universal items are deliberately excluded
 *   here (see module doc above).
 * @param {{latitude:number, longitude:number}|null} userLocation  live
 *   location from the shared lib/currentLocation.js store, or null/undefined
 *   while GPS is still resolving or genuinely unavailable.
 * @returns {Array}  distance-sorted (nearest first), coordinate-verified,
 *   radius-bounded items, each carrying a numeric `distM` (meters) for
 *   display/navigation. Empty when userLocation is not yet ready — never a
 *   generic fallback list.
 */
export function selectHomeNearbyCandidates(rawItems, userLocation) {
  if (!userLocation) return []
  if (typeof userLocation.latitude !== 'number' || typeof userLocation.longitude !== 'number') return []

  const locatedOnly = (rawItems ?? []).filter(item => hasUsableCoordinates(getLat(item), getLng(item)))

  const { items: sorted } = proximitySort(locatedOnly, userLocation, {
    includeUniversal: false, // Near You means a real, verifiable nearby place — never generic filler
    maxDistance: MAX_NEARBY_RADIUS_M, // same hard cutoff Nearby already enforces (lib/nearbyRanking.js)
    interleave: false,
  })
  return sorted
}
