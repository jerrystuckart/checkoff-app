import { haversineMeters } from './distance'

const MILE_M = 1609.34

// Density-tier radii (see spec: "Density tiers" — replaces the ring model).
const TIER_RADIUS_M       = 25 * MILE_M   // Dense/Sparse are measured within this radius
const EMPTY_CHECK_RADIUS_M = 50 * MILE_M  // Empty is measured within this wider radius
const DENSE_MIN_COUNT  = 20  // 20+ located items within TIER_RADIUS_M -> dense
const EMPTY_MAX_COUNT  = 2   // <=2 located items within EMPTY_CHECK_RADIUS_M -> empty

// universal : total ratio for each tier. 8 -> ~1 in 8, 4 -> ~1 in 4.
const DENSE_RATIO  = 8
const SPARSE_RATIO = 4

// "am I in a served metro right now?" — spec names the signal (N+ located
// items within 30mi) but doesn't pin N. Using the same floor as the
// dense/sparse boundary's "not empty" case (3) — revisit if Home copy
// built on this boolean feels wrong in practice.
const IN_METRO_RADIUS_M    = 30 * MILE_M
const IN_METRO_MIN_COUNT   = 3

function getIsUniversal(item) {
  return item.isUniversal ?? item.is_universal ?? item.items?.is_universal ?? false
}

function getLat(item) {
  return item.mapsLat ?? item.maps_lat ?? item.items?.maps_lat ?? null
}

function getLng(item) {
  return item.mapsLng ?? item.maps_lng ?? item.items?.maps_lng ?? null
}

function localDateString(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Stable for the lifetime of the JS module (~one app open), different on
// the next cold start — combined with today's date this gives the
// "changes between app opens, stable within a session" shuffle the spec
// asks for.
const SESSION_START = Date.now()

function hashToInt(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0
  }
  return h
}

function mulberry32(seed) {
  let t = seed
  return function () {
    t |= 0; t = (t + 0x6D2B79F5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle(arr) {
  if (arr.length < 2) return [...arr]
  const seed = hashToInt(`${localDateString()}-${SESSION_START}`)
  const rand = mulberry32(seed)
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// Interleaves one universal item after every (ratio - 1) located items,
// cycling through the universal pool if it's shorter than needed.
function interleaveAtRatio(located, universal, ratio) {
  if (!universal.length || !Number.isFinite(ratio)) return [...located]
  const result = []
  let uIdx = 0
  located.forEach((item, i) => {
    result.push(item)
    if ((i + 1) % (ratio - 1) === 0) {
      result.push(universal[uIdx % universal.length])
      uIdx++
    }
  })
  return result
}

/**
 * <0.1mi -> "right here"; <10mi -> one decimal; >=10mi -> whole miles.
 */
export function formatDistanceLabel(meters) {
  if (meters == null) return null
  const mi = meters / MILE_M
  if (mi < 0.1) return 'right here'
  if (mi < 10) return `${mi.toFixed(1)} mi`
  return `${Math.round(mi)} mi`
}

/**
 * Pure tier classification from a list of distances (meters). Split out so
 * callers who need the density tier computed against a DIFFERENT candidate
 * set than the items being sorted (e.g. ListScreen viewing one short list,
 * where the tier must reflect the user's whole metro, not just that list's
 * item count) can compute it separately and pass it into proximitySort via
 * `options.tier` instead of letting proximitySort derive it from `items`.
 */
export function computeDensityTier(distancesM) {
  const within25mi = distancesM.filter(d => d <= TIER_RADIUS_M).length
  const within50mi = distancesM.filter(d => d <= EMPTY_CHECK_RADIUS_M).length
  const withinMetro = distancesM.filter(d => d <= IN_METRO_RADIUS_M).length

  let tier
  if (within25mi >= DENSE_MIN_COUNT) tier = 'dense'
  else if (within50mi <= EMPTY_MAX_COUNT) tier = 'empty'
  else tier = 'sparse'

  return { tier, inMetro: withinMetro >= IN_METRO_MIN_COUNT }
}

/**
 * proximitySort(items, userLocation, options)
 *
 * One engine, two configurations — see spec. `items` may be in any of the
 * shapes already in use across the codebase: flat snake_case (raw
 * Supabase rows), flat camelCase (useItems.js), or nested under `.items`
 * (fetchCuratedListItems rows).
 *
 * @param {Array} items
 * @param {{ latitude: number, longitude: number }|null} userLocation
 * @param {object} [options]
 * @param {boolean} [options.includeUniversal=true]
 * @param {number|null} [options.maxDistance=null]  meters (matches the
 *   meters convention used everywhere else in this codebase, e.g.
 *   useNearby.js's MAX_DESTINATION_M). ~500mi = 804672.
 * @param {boolean} [options.interleave=true]
 * @param {'dense'|'sparse'|'empty'|null} [options.tier=null]  externally
 *   computed density tier (e.g. from lib/densityTier.js's full-candidate-set
 *   query) to use instead of deriving one from `items`. When supplied, the
 *   returned `inMetro` is null rather than a value computed against the
 *   (likely too-small) `items` array — the caller already has a correct
 *   `inMetro` from whatever computed the tier override.
 *
 * @returns {{ items: Array, tier: 'dense'|'sparse'|'empty'|null, inMetro: boolean|null }}
 */
export function proximitySort(items, userLocation, {
  includeUniversal = true,
  maxDistance = null,
  interleave = true,
  tier: tierOverride = null,
} = {}) {
  const universalAll = includeUniversal ? items.filter(getIsUniversal) : []
  const nonUniversal = items.filter(item => !getIsUniversal(item))

  const located = []
  const unlocated = []
  for (const item of nonUniversal) {
    const lat = getLat(item)
    const lng = getLng(item)
    if (lat != null && lng != null) located.push({ item, lat, lng })
    else unlocated.push(item)
  }

  const shuffledUniversal = seededShuffle(universalAll)

  if (!userLocation) {
    // Fallback: no distances, universal-first, no error state.
    return {
      items: [...shuffledUniversal, ...nonUniversal],
      tier: null,
      inMetro: false,
    }
  }

  const { latitude: userLat, longitude: userLng } = userLocation

  const locatedSorted = located
    .map(entry => ({ ...entry, distM: haversineMeters(userLat, userLng, entry.lat, entry.lng) }))
    .filter(entry => maxDistance == null || entry.distM <= maxDistance)
    .sort((a, b) => a.distM - b.distM)

  let tier, inMetro
  if (tierOverride) {
    tier = tierOverride
    inMetro = null
  } else {
    const densityResult = computeDensityTier(locatedSorted.map(e => e.distM))
    tier = densityResult.tier
    inMetro = densityResult.inMetro
  }

  // distM (meters) attached so callers can render formatDistanceLabel().
  const locatedItems = locatedSorted.map(e => ({ ...e.item, distM: e.distM }))

  if (!interleave) {
    return {
      items: [...locatedItems, ...shuffledUniversal, ...unlocated],
      tier,
      inMetro,
    }
  }

  let finalLocated
  if (tier === 'empty') {
    // Universal-first, essentially all universal — distant located items
    // trail below (already nearest-first from locatedSorted).
    finalLocated = [...shuffledUniversal, ...locatedItems]
  } else {
    const ratio = tier === 'dense' ? DENSE_RATIO : SPARSE_RATIO
    finalLocated = interleaveAtRatio(locatedItems, shuffledUniversal, ratio)
  }

  return {
    items: [...finalLocated, ...unlocated],
    tier,
    inMetro,
  }
}
