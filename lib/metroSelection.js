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
import { haversineMeters } from './distance.js'

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

// Precedence resolver for the app's default-metro-on-launch decision.
//
//   1. An explicit prior user selection (persisted, e.g. via the city
//      picker) always wins, regardless of location state. It is never
//      silently recalculated/replaced by a later GPS-based run.
//   2. If there's no explicit selection and location is still resolving,
//      return a "pending" result — never a metro. The caller must keep
//      waiting (show a loading state) rather than treat "not resolved yet"
//      as "unavailable."
//   3. If there's no explicit selection and a real location is available,
//      return the true nearest active metro by distance (see
//      nearestMetroByCoords above) — not a hardcoded two-metro
//      latitude-threshold guess.
//   4. Otherwise (location genuinely denied/unavailable/timed-out, not
//      merely pending), return NO metro at all — `{ metro: null, reason:
//      'needs_selection' }`. This function used to fall back to
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
  if (explicit) return { metro: explicit, reason: 'explicit' }

  if (locationState === 'pending') return { metro: null, reason: 'pending' }

  if (locationState === 'ready') {
    const nearest = nearestMetroByCoords(location, list)
    if (nearest) return { metro: nearest, reason: 'nearest' }
  }

  // Denied/unavailable/timed-out location (or a 'ready' location that
  // somehow matched no metro, e.g. no metro has coordinates yet), with no
  // explicit choice — no real signal exists for which metro to pick, so
  // pick none. See the case-4 docstring above.
  return { metro: null, reason: 'needs_selection' }
}
