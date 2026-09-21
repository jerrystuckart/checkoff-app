// Pure metro-selection logic — no Expo Location, no Supabase, no
// react-native, so this loads and tests fine under plain Node (see
// lib/whatsGoodAtPlace.js for the same convention: keep the decision logic
// itself pure/testable, push GPS/network I/O into a thin impure shell).
// lib/resolveDefaultMetro.js is that shell for this module.
//
// This is the single source of truth for "given what we already know (a
// persisted explicit choice, the active metros list, and the current
// location state), which metro should be selected on app open." It
// replaces HomeScreen.jsx's former inline hardcoded-Phoenix-fallback /
// Phoenix-vs-Milwaukee-by-latitude special case, which caused a real
// WiFi-only Android device physically in Vienna to default to Phoenix.
//
// Munich field-test update (2026-09-21): a PERSISTED explicit choice used
// to always win, full stop, even over a fresh 'ready' location — see this
// file's git history for the prior docstring. That was itself a bug for
// ordinary travel: a user who once picked/defaulted to Vienna (or Phoenix)
// keeps that slug in AsyncStorage forever, and it then permanently
// overrode real-time GPS once they'd physically flown to Munich, even
// though Nearby/visit-detection (which don't consult this module at all —
// they're pure coordinate/radius queries, see lib/useNearby.js and
// lib/whatsGoodAtPlace.js) correctly showed Munich the whole time. The
// precedence below now makes a genuinely 'ready' live location win over a
// DIFFERENT persisted metro, so Home/What's Good agree with Nearby/Right
// Here again. A persisted choice still wins whenever there's no live
// signal to check it against (location 'pending' or 'unavailable') — that
// is what makes a manual City Picker pick during the CURRENT session
// "stick": resolveHomeMetro only runs once per app open (HomeScreen.jsx's
// init()), and switchMetro() sets state directly without calling this
// function again, so a manual pick is never fought against mid-session.
// It's only re-checked against fresh location on the NEXT resolution (a
// cold start, or HomeScreen's foreground-return re-check) — and if the
// user has genuinely traveled somewhere else by then, physical location
// wins and the stale slug gets overwritten (by the caller — see
// screens/HomeScreen.jsx's init()) rather than fought forever.
import { haversineMeters } from './distance.js'
import { MAX_NEARBY_RADIUS_M } from './nearbyRanking.js'

// A metro only "claims" a location that's within this radius of its
// center — reuses the SAME 100-mile hard cutoff lib/nearbyRanking.js
// already established as this app's one geographic-relevance boundary
// (MAX_NEARBY_RADIUS_M), rather than inventing a second, competing
// distance concept. There is no per-metro radius_km column on
// metro_areas today (checked: only destination_zones has its own
// radius_km, a narrower/different concept — a specific point of interest
// inside a metro, not the metro's own catchment boundary), so "nearest
// metro, if within a reasonable max radius" is the correct existing
// mechanism to reuse per this module's own established nearest-by-
// distance convention (nearestMetroByCoords).
export const MAX_METRO_BOUNDARY_M = MAX_NEARBY_RADIUS_M

// Nearest active metro to `location`, by real great-circle distance. Real
// distance, not a proxy: uses the same haversineMeters calc as everywhere
// else in this app that measures real-world distance, rather than
// comparing raw lat/lng deltas — squared-degree deltas distort badly away
// from the equator (Vienna is ~48°N) and were never a reliable proxy for
// "nearest" to begin with.
// Returns null if there's no usable location or no metro has coordinates.
export function nearestMetroByCoords(location, metros) {
  if (!location || location.latitude == null || location.longitude == null) return null
  const metrosWithCoords = (metros ?? []).filter(m => m.center_lat != null && m.center_lng != null)
  if (metrosWithCoords.length === 0) return null
  return metrosWithCoords.reduce((closest, m) => {
    const d = haversineMeters(location.latitude, location.longitude, m.center_lat, m.center_lng)
    const closestD = haversineMeters(location.latitude, location.longitude, closest.center_lat, closest.center_lng)
    return d < closestD ? m : closest
  })
}

// Same as nearestMetroByCoords, but returns null if the nearest metro is
// still farther than MAX_METRO_BOUNDARY_M away — e.g. a user genuinely
// between active metros (mid-flight, a rural gap with no launched metro
// nearby) should not be silently assigned whichever metro happens to be
// least-far; that's still an arbitrary pick with no real signal behind it,
// same category of bug as the original hardcoded-Phoenix default.
export function nearestMetroWithinBoundary(location, metros) {
  const nearest = nearestMetroByCoords(location, metros)
  if (!nearest) return null
  const d = haversineMeters(location.latitude, location.longitude, nearest.center_lat, nearest.center_lng)
  return d <= MAX_METRO_BOUNDARY_M ? nearest : null
}

// Alphabetically-first active metro. NOT used by resolveHomeMetro below any
// more (see that function's case 4) — picking ANY metro with no real signal
// for it, alphabetical or otherwise, is still a silent arbitrary default,
// the same category of bug as the original hardcoded Phoenix fallback it
// once replaced. Kept only because lib/resolveDefaultMetro.js's impure
// shell still calls it for BrowseListsScreen/CreateListScreen's own
// last-resort city-selector default — those screens have no persisted
// explicit choice of their own and no "needs selection" UI state to enter,
// so a metro-blind pick is the least-bad option there. Do not call this
// from resolveHomeMetro or from HomeScreen.jsx's init().
export function fallbackMetro(metros) {
  const list = metros ?? []
  return list.length > 0 ? list[0] : null
}

// Precedence resolver for the app's default-metro-on-launch (and
// foreground-return) decision.
//
//   1. A genuinely 'ready' live location WITHIN an active metro's boundary
//      (see nearestMetroWithinBoundary/MAX_METRO_BOUNDARY_M above) always
//      wins, even over a persisted explicit choice for a DIFFERENT metro.
//      This is the Munich fix: a stale persisted Vienna/Phoenix slug must
//      not permanently outrank real GPS evidence the user has since
//      traveled somewhere else. `reason: 'nearest'` — the caller (see
//      screens/HomeScreen.jsx's init()) is expected to overwrite/refresh
//      the persisted slug to match in this case, so the stale value stops
//      fighting future resolutions instead of being fought against forever.
//      If the live location happens to match the persisted metro too,
//      that's still 'nearest' (no functional difference — there's nothing
//      to reconcile).
//   2. Otherwise, an explicit prior user selection (persisted, e.g. via
//      the city picker) wins. This is what makes a manual City Picker pick
//      "stick" for as long as this function isn't re-run with a
//      DIFFERENT ready location — resolveHomeMetro is only invoked once
//      per app open plus on any foreground-return re-check, and
//      switchMetro() itself never calls this function again, so a manual
//      pick survives the entire current session/foreground period, but
//      gets re-checked against fresh location on the next resolution
//      rather than anchoring the user permanently.
//   3. If there's no explicit selection and location is still resolving,
//      return a "pending" result — never a metro. The caller must keep
//      waiting (show a loading state) rather than treat "not resolved yet"
//      as "unavailable."
//   4. Otherwise (location genuinely denied/unavailable/timed-out or
//      'ready' but outside every active metro's boundary, with no
//      persisted choice), return NO metro at all — `{ metro: null,
//      reason: 'needs_selection' }`. This function used to fall back to
//      fallbackMetro() (alphabetically-first active metro) here, but that
//      was rejected as still being a silent, arbitrary metro fallback —
//      the same category of bug as the original hardcoded-Phoenix default,
//      just with a different (still wrong) arbitrary choice. There is no
//      real signal for which metro the user wants in this case, so this
//      function picks none; the caller (HomeScreen.jsx's init()) must
//      surface an explicit "choose your city" prompt instead, and must NOT
//      persist this state to AsyncStorage as though it were a real choice
//      — a later location fix or explicit pick must still be able to
//      resolve normally.
//
// @param {string|null} persistedSlug - metro slug from the last explicit
//   user selection, if any (e.g. AsyncStorage).
// @param {Array} metros - active metro_areas rows.
// @param {{latitude:number, longitude:number}|null} location - current
//   device coordinates, or null if none yet.
// @param {'pending'|'ready'|'unavailable'} locationState - 'pending' means
//   still waiting on permission/GPS; 'ready' means `location` is a real
//   fix; 'unavailable' means permission denied or the fetch genuinely
//   failed/timed out. Deliberately NOT a network/connectivity-type field —
//   expo-location's fix acquisition is independent of cellular vs.
//   WiFi-only connectivity, so nothing here (or in any caller) may
//   special-case network type as a location signal.
export function resolveHomeMetro({ persistedSlug, metros, location, locationState }) {
  const list = metros ?? []

  const explicit = persistedSlug
    ? list.find(m => (m.slug ?? '').toLowerCase() === String(persistedSlug).toLowerCase())
    : null

  // Case 1 — a real, in-boundary location always wins, even over a
  // persisted choice for a different metro. Checked FIRST, ahead of the
  // explicit branch, which is the core precedence change from this
  // module's prior version (see this function's docstring above).
  if (locationState === 'ready') {
    const nearest = nearestMetroWithinBoundary(location, list)
    if (nearest) return { metro: nearest, reason: 'nearest' }
  }

  // Case 2 — no in-boundary live location to check against (pending,
  // unavailable, or 'ready' but outside every metro's boundary): an
  // explicit persisted choice wins here, same as before.
  if (explicit) return { metro: explicit, reason: 'explicit' }

  if (locationState === 'pending') return { metro: null, reason: 'pending' }

  // Denied/unavailable/timed-out location (or 'ready' but no metro within
  // boundary), with no explicit choice — no real signal exists for which
  // metro to pick, so pick none. See the case-4 docstring above.
  return { metro: null, reason: 'needs_selection' }
}
