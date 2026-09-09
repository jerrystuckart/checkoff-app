import { test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineMeters } from './distance.js'
import { hasUsableCoordinates, isWithinNearbyRadius, rankNearbyItems } from './nearbyRanking.js'
import { proximitySort } from './proximity.js'

// End-to-end regression coverage for the San Diego no-GPS bug: newly
// inserted items awaiting Admin's "Find & confirm location" (no usable
// maps_lat/maps_lng) were bubbling to the very top of Nearby with a fake
// distance of 0 (useNearby.js's old `dist ?? (item.ring_weight ?? 0) *
// 15000` fallback — most items default to ring_weight 0, so the fallback
// resolved to exactly 0). This suite exercises the same
// filter-then-rank pipeline useNearby.js/DiscoverScreen.jsx actually run,
// using the real shared primitives, not a reimplementation.

const USER = { latitude: 32.7157, longitude: -117.1611 } // San Diego

// Mirrors the exact filter+map+sort pipeline in useNearby.js's
// calcDistances() / DiscoverScreen.jsx's augmentWithDistance(): compute
// distance only for locatable items, gate on hasUsableCoordinates AND the
// radius, then rank.
function buildNearbyCandidateSet(rawItems, userCoords) {
  return rawItems
    .map(item => {
      const locatable = hasUsableCoordinates(item.maps_lat, item.maps_lng)
      const dist_m = locatable
        ? haversineMeters(userCoords.latitude, userCoords.longitude, item.maps_lat, item.maps_lng)
        : null
      return { ...item, dist_m, withinRadius: locatable && isWithinNearbyRadius(dist_m) }
    })
    .filter(item => item.withinRadius)
}

// ── 1. Valid nearby coordinates -> appears ──────────────────────────────────
test('an item with valid nearby coordinates appears in the candidate set', () => {
  const validItem = { id: 'valid', maps_lat: 32.72, maps_lng: -117.16 } // ~0.5mi away
  const candidates = buildNearbyCandidateSet([validItem], USER)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].id, 'valid')
  assert.ok(candidates[0].dist_m > 0 && candidates[0].dist_m < 2000)
})

// ── 2. Null lat/lng -> excluded ─────────────────────────────────────────────
test('an item with null maps_lat/maps_lng is excluded entirely, not assigned distance 0', () => {
  const noGpsItem = { id: 'no-gps', maps_lat: null, maps_lng: null }
  const candidates = buildNearbyCandidateSet([noGpsItem], USER)
  assert.deepEqual(candidates, [])
})

// ── 3. Only one coordinate populated -> excluded ────────────────────────────
test('an item with only one coordinate populated is excluded', () => {
  const oneCoordItem = { id: 'one-coord', maps_lat: 32.72, maps_lng: null }
  const candidates = buildNearbyCandidateSet([oneCoordItem], USER)
  assert.deepEqual(candidates, [])
})

// ── 4. Invalid/non-numeric coordinates -> excluded ──────────────────────────
test('items with invalid or non-numeric coordinates are excluded', () => {
  const items = [
    { id: 'string-coords', maps_lat: '32.72', maps_lng: '-117.16' },
    { id: 'nan-coords', maps_lat: NaN, maps_lng: -117.16 },
    { id: 'zero-zero', maps_lat: 0, maps_lng: 0 },
    { id: 'undefined-coords' }, // maps_lat/maps_lng entirely absent
  ]
  const candidates = buildNearbyCandidateSet(items, USER)
  assert.deepEqual(candidates, [])
})

// ── 5. No-GPS item cannot appear before valid nearby items ──────────────────
test('a batch of no-GPS items cannot bubble to the top ahead of valid distance-sorted items — the exact San Diego repro', () => {
  const noGpsBatch = Array.from({ length: 40 }, (_, i) => ({
    id: `no-gps-${i}`, maps_lat: null, maps_lng: null,
  }))
  const realItems = [
    { id: 'close', maps_lat: 32.716, maps_lng: -117.162 },  // ~150m away
    { id: 'medium', maps_lat: 32.74, maps_lng: -117.2 },    // few miles away
  ]

  const candidates = buildNearbyCandidateSet([...noGpsBatch, ...realItems], USER)
  const ranked = rankNearbyItems(candidates, {})

  assert.equal(ranked.length, 2, 'all 40 no-GPS items must be excluded, not just deprioritized')
  assert.deepEqual(ranked.map(i => i.id), ['close', 'medium'])
  assert.ok(!ranked.some(i => i.id.startsWith('no-gps')))
})

// ── 6. Existing 100-mile cutoff still works ─────────────────────────────────
test('the 100-mile automatic radius cutoff is unaffected by the coordinate-validity fix', () => {
  const MI = 1609.34
  const withinRadius = { id: 'in-radius', maps_lat: USER.latitude, maps_lng: USER.longitude - 0.5 } // a few miles
  const tucson = { id: 'tucson', maps_lat: 32.2226, maps_lng: -110.9747 } // ~330mi from San Diego

  const candidates = buildNearbyCandidateSet([withinRadius, tucson], USER)
  assert.deepEqual(candidates.map(i => i.id), ['in-radius'])
})

// ── 7. House of Honey still appears correctly ───────────────────────────────
test('House of Honey (valid Peoria coordinates) still appears correctly alongside a no-GPS batch', () => {
  const PEORIA_USER = { latitude: 33.5806, longitude: -112.2374 }
  const houseOfHoney = { id: 'house-of-honey', maps_lat: 33.6510485, maps_lng: -112.2556193 }
  const noGpsBatch = Array.from({ length: 5 }, (_, i) => ({ id: `no-gps-${i}`, maps_lat: undefined, maps_lng: undefined }))

  const candidates = buildNearbyCandidateSet([...noGpsBatch, houseOfHoney], PEORIA_USER)
  const ranked = rankNearbyItems(candidates, {})

  assert.deepEqual(ranked.map(i => i.id), ['house-of-honey'])
})

// ── 8. Home closest/Near You (proximitySort) cannot rank a no-GPS item ──────
test('Home\'s proximitySort never ranks a no-GPS item ahead of a distance-sorted located item', () => {
  const located = [
    { id: 'near', maps_lat: 32.716, maps_lng: -117.162, is_universal: false },
    { id: 'far', maps_lat: 32.9, maps_lng: -117.3, is_universal: false },
  ]
  const noGpsBatch = Array.from({ length: 10 }, (_, i) => ({ id: `no-gps-${i}`, maps_lat: null, maps_lng: null, is_universal: false }))

  const { items: sorted } = proximitySort([...noGpsBatch, ...located], USER, { includeUniversal: false, interleave: false })

  const locatedIds = located.map(i => i.id)
  const firstTwoIds = sorted.slice(0, 2).map(i => i.id)
  assert.deepEqual(firstTwoIds, locatedIds, 'the two located items must occupy the top of the ranking, in distance order')
  assert.ok(!sorted.slice(0, 2).some(i => i.id.startsWith('no-gps')), 'no unlocated item may appear ahead of a located one')
})

test('Home\'s "5 closest" slice is filled entirely by located items when at least 5 exist, never backfilled by no-GPS items ahead of them', () => {
  const located = Array.from({ length: 5 }, (_, i) => ({
    id: `near-${i}`,
    maps_lat: USER.latitude + i * 0.01,
    maps_lng: USER.longitude + i * 0.01,
    is_universal: false,
  }))
  const noGpsBatch = Array.from({ length: 40 }, (_, i) => ({ id: `no-gps-${i}`, maps_lat: null, maps_lng: null, is_universal: false }))

  const { items: sorted } = proximitySort([...noGpsBatch, ...located], USER, { includeUniversal: false, interleave: false })
  const top5 = sorted.slice(0, 5)

  assert.equal(top5.length, 5)
  assert.deepEqual(top5.map(i => i.id).filter(id => id.startsWith('no-gps')), [], 'no no-GPS item may occupy a top-5 slot a real located item could fill')
})
