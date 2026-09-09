/**
 * Shared geo-ranking rules for every "Nearby" surface (Discover screen,
 * useNearby hook, tag/text search, post-checkin re-ranking).
 *
 * Pipeline: current location -> hard maximum radius -> relevance + continuous
 * distance ranking. Geography first, relevance second:
 *   - MAX_NEARBY_RADIUS_M is a hard cutoff. Nothing beyond it enters the
 *     automatic Nearby universe, full stop — no amount of tag/search
 *     relevance can pull an out-of-radius item back in.
 *   - Inside the radius, ranking is a continuous function of raw distance
 *     with a bounded relevance discount. There are no named geographic
 *     bands (no Core/Near/Metro/Destination tiers, no distance cliffs at
 *     8/20/40 miles) — that "ring" concept is a separate, still-current
 *     product idea (an admin-set per-item content classification shown on
 *     ItemDetailScreen/PartnerPreviewScreen and edited in the desktop admin
 *     tool), but it is not used here as a ranking mechanism. Nearby doesn't
 *     store or derive a ring membership of its own.
 */

const MILES_TO_METERS = 1609.34

// Maximum automatic Nearby radius. Items at or beyond this are excluded
// outright — no silent nationwide fallback. A future "show farther away"
// mode can widen this deliberately; it must never happen implicitly via
// search/tag relevance.
export const MAX_NEARBY_RADIUS_M = 100 * MILES_TO_METERS

// A tag/text match can discount an item's effective distance by up to this
// fraction, letting relevance reorder items that are geographically
// comparable — but multiplying (not subtracting a flat amount) means the
// discount scales with distance, so it can never make a far item look
// closer than a genuinely near one. E.g. even at the max discount, a 90mi
// item (90 * 0.65 = 58.5mi effective) still can't beat a 3mi item.
const RELEVANCE_DISCOUNT_PER_TAG_MATCH = 0.05
const MAX_RELEVANCE_DISCOUNT = 0.35

// Minimum viable "does this item have a usable location for proximity
// purposes" check — the earliest shared gate every Nearby/Discover/Home
// surface must apply before an item is allowed anywhere near distance
// ranking. An item failing this must never receive a fallback/placeholder
// distance (0, or anything else) and must never be included at all, not
// even sorted last — a missing location is not "far away," it's simply
// not eligible for a proximity feature. Rejects null/undefined, non-number
// types, NaN/Infinity, and the (0, 0) "Null Island" pattern real US
// business geocoding never legitimately produces (the actual footgun this
// exists for: a never-geocoded item's lat/lng reading as falsy/zero-ish
// and silently producing a fake same-location distance instead of being
// excluded).
export function hasUsableCoordinates(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  return true
}

export function distLabel(m) {
  if (m < 160)   return 'Right here'
  if (m < 1609)  return `${Math.round(m / 100) * 100}m away`
  const mi = m / 1609.34
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

// Hard geographic cutoff — the only "gate" in the pipeline. No bands.
export function isWithinNearbyRadius(distM) {
  return distM < MAX_NEARBY_RADIUS_M
}

// Continuous relevance discount, capped so it can only reorder items whose
// raw distances are already in the same neighborhood, never overturn a
// large true distance gap.
export function relevanceDiscount(tagMatchCount) {
  return Math.min((tagMatchCount ?? 0) * RELEVANCE_DISCOUNT_PER_TAG_MATCH, MAX_RELEVANCE_DISCOUNT)
}

// Lower score = better. Pure function of raw distance and relevance —
// no ring/band lookup anywhere in the ranking path.
export function rankScore(distM, tagMatchCount) {
  return distM * (1 - relevanceDiscount(tagMatchCount))
}

// Deterministic ranking within the (already radius-filtered) nearby
// universe: continuous distance score first, raw distance as a tiebreak,
// item id as a final tiebreak for full determinism.
// `tagMatchCounts` is a map of item id (string) -> matched tag count.
export function rankNearbyItems(items, tagMatchCounts = {}) {
  return [...items].sort((a, b) => {
    const aScore = rankScore(a.dist_m ?? 9999999, tagMatchCounts[String(a.id)])
    const bScore = rankScore(b.dist_m ?? 9999999, tagMatchCounts[String(b.id)])
    if (aScore !== bScore) return aScore - bScore

    const ad = a.dist_m ?? 9999999
    const bd = b.dist_m ?? 9999999
    if (ad !== bd) return ad - bd

    return String(a.id).localeCompare(String(b.id))
  })
}
