import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isWithinNearbyRadius, rankScore, rankNearbyItems, relevanceDiscount, MAX_NEARBY_RADIUS_M,
  hasUsableCoordinates,
} from './nearbyRanking.js'

const MI = 1609.34

function mkItem(id, distMiles) {
  return { id, dist_m: distMiles * MI }
}

test('max automatic Nearby radius is 100 miles', () => {
  assert.equal(Math.round(MAX_NEARBY_RADIUS_M / MI), 100)
})

// ── hasUsableCoordinates: the proximity eligibility gate ───────────────────
// Regression coverage for the San Diego no-GPS bug: items awaiting Admin's
// "Find & confirm location" were bubbling to the top of Nearby with a fake
// distance of 0 instead of being excluded.
test('hasUsableCoordinates: valid numeric coordinates are usable', () => {
  assert.equal(hasUsableCoordinates(33.5806, -112.2374), true)
})

test('hasUsableCoordinates: null or undefined coordinates are not usable', () => {
  assert.equal(hasUsableCoordinates(null, null), false)
  assert.equal(hasUsableCoordinates(undefined, undefined), false)
  assert.equal(hasUsableCoordinates(null, -112.2374), false)
  assert.equal(hasUsableCoordinates(33.5806, undefined), false)
})

test('hasUsableCoordinates: only one coordinate populated is not usable', () => {
  assert.equal(hasUsableCoordinates(33.5806, null), false)
  assert.equal(hasUsableCoordinates(null, -112.2374), false)
})

test('hasUsableCoordinates: non-numeric or non-finite coordinates are not usable', () => {
  assert.equal(hasUsableCoordinates('33.5806', '-112.2374'), false, 'string coordinates must not pass')
  assert.equal(hasUsableCoordinates(NaN, -112.2374), false)
  assert.equal(hasUsableCoordinates(33.5806, Infinity), false)
  assert.equal(hasUsableCoordinates(-Infinity, -112.2374), false)
})

test('hasUsableCoordinates: the (0, 0) "Null Island" sentinel is not usable', () => {
  assert.equal(hasUsableCoordinates(0, 0), false)
})

test('isWithinNearbyRadius is a hard cutoff at 100mi, no bands', () => {
  assert.equal(isWithinNearbyRadius(2.6 * MI), true)
  assert.equal(isWithinNearbyRadius(34 * MI), true)
  assert.equal(isWithinNearbyRadius(99 * MI), true)
  assert.equal(isWithinNearbyRadius(100 * MI), false)
  assert.equal(isWithinNearbyRadius(121 * MI), false)
  assert.equal(isWithinNearbyRadius(1462 * MI), false)
})

test('relevance discount is capped and cannot exceed 35%', () => {
  assert.equal(relevanceDiscount(0), 0)
  assert.ok(relevanceDiscount(3) > 0 && relevanceDiscount(3) < 1)
  assert.equal(relevanceDiscount(100), relevanceDiscount(1000)) // capped, doesn't keep growing
  assert.ok(relevanceDiscount(100) <= 0.35)
})

test('rankScore: no amount of relevance can make a far item score better than a near one with none', () => {
  // Even at the max possible discount, a 90mi item can't out-score a 3mi item.
  const farBestCase = rankScore(90 * MI, 1000)
  const near = rankScore(3 * MI, 0)
  assert.ok(farBestCase > near, 'far item must still score worse (higher) than the near item')
})

// ── Peoria breakfast repro ──────────────────────────────────────────────────
test('Peoria breakfast: 121mi item is excluded by the hard radius, closer items rank by distance', () => {
  const haymaker    = mkItem('haymaker', 2.6)
  const boyer       = mkItem('boyer', 2.8)
  const kissTheCook = mkItem('kiss-the-cook', 11)
  const diegoPops   = mkItem('diego-pops', 22)
  const rayoog      = mkItem('rayoog', 34)
  const rofleRofle  = mkItem('rofle-rofle', 121)

  const candidates = [haymaker, boyer, kissTheCook, diegoPops, rayoog, rofleRofle]
  const inRadius = candidates.filter(i => isWithinNearbyRadius(i.dist_m))

  assert.ok(!inRadius.some(i => i.id === 'rofle-rofle'), 'Rofle Rofle (121mi) must not enter automatic Nearby')

  const ranked = rankNearbyItems(inRadius, {})
  assert.deepEqual(ranked.map(i => i.id), ['haymaker', 'boyer', 'kiss-the-cook', 'diego-pops', 'rayoog'])
})

test('Peoria breakfast: a distant tag match cannot outrank a close item — excluded before ranking even runs', () => {
  const haymaker   = mkItem('haymaker', 2.6)
  const boyer      = mkItem('boyer', 2.8)
  const rofleRofle = mkItem('rofle-rofle', 121)

  const candidates = [haymaker, boyer, rofleRofle].filter(i => isWithinNearbyRadius(i.dist_m))
  const tagCounts = { haymaker: 2, boyer: 1, 'rofle-rofle': 5 } // Rofle "wins" on relevance alone

  const ranked = rankNearbyItems(candidates, tagCounts)
  assert.deepEqual(ranked.map(i => i.id), ['haymaker', 'boyer'])
  assert.ok(!ranked.some(i => i.id === 'rofle-rofle'))
})

test('relevance can reorder geographically comparable items without a band cliff', () => {
  // Two items a similar distance apart — a strong tag match on the
  // slightly-farther one can legitimately flip the order.
  const nearWeak   = { id: 'near-weak', dist_m: 5 * MI }
  const nearStrong = { id: 'near-strong', dist_m: 5.5 * MI }
  const ranked = rankNearbyItems([nearWeak, nearStrong], { 'near-strong': 4, 'near-weak': 0 })
  assert.deepEqual(ranked.map(i => i.id), ['near-strong', 'near-weak'])
})

// ── Tag filtering: breakfast/brunch/brunch-spot repro ──────────────────────
test('tag filtering: Milwaukee item at 1462mi is excluded from automatic Nearby even with strong tag match', () => {
  const local     = mkItem('local-brunch', 3)
  const milwaukee = mkItem('milwaukee-brunch', 1462)
  const tucson    = mkItem('tucson-brunch', 124)

  const inRadius = [local, milwaukee, tucson].filter(i => isWithinNearbyRadius(i.dist_m))
  assert.deepEqual(inRadius.map(i => i.id), ['local-brunch'])
})

// ── Location change: San Diego items must not survive a move to Peoria ────
test('location change: recomputing distance against new coords drops the old-location cluster', () => {
  const sanDiegoDistancesFromPeoriaMiles = [325, 340, 335, 338, 355] // Vista, Chula Vista, Mira Mesa, Balboa Park, Zona Centro (approx)
  const stillInRadius = sanDiegoDistancesFromPeoriaMiles.filter(mi => isWithinNearbyRadius(mi * MI))
  assert.deepEqual(stillInRadius, [], 'San Diego/Tijuana cluster must not remain after moving to Peoria')
})

// ── Pagination: a later page cannot smuggle a distant item ahead of closer ones ─
test('pagination: merging two independently-fetched pages still ranks geography-first', () => {
  const page1 = [mkItem('near-a', 2), mkItem('far-a', 121)]
  const page2 = [mkItem('near-b', 5)]

  const merged = [...page1, ...page2].filter(i => isWithinNearbyRadius(i.dist_m))
  const ranked = rankNearbyItems(merged, {})

  assert.deepEqual(ranked.map(i => i.id), ['near-a', 'near-b'])
  assert.ok(!ranked.some(i => i.id === 'far-a'), 'a later/earlier page must not reintroduce an out-of-radius item')
})

// ── No local results within radius ─────────────────────────────────────────
test('no local results: everything beyond radius yields an empty set, not a nationwide fallback', () => {
  const allFar = [mkItem('tucson', 121), mkItem('milwaukee', 1462)]
  const inRadius = allFar.filter(i => isWithinNearbyRadius(i.dist_m))
  assert.deepEqual(inRadius, [])
})
