// Home "Near you right now" — regression coverage for the 2026-09-21 field
// bug: after dbe0fc8 fixed the metro-HEADER/persisted-slug problem, real-
// device evidence showed Home's Near You rail still rendered generic,
// coordinate-less filler items with no working navigation. Root cause (see
// lib/homeNearYou.js's module doc): the old call into proximitySort mixed
// in Universal (no-coordinate) items unconditionally, and its null-location
// fallback branch showed that same Universal pool, entirely unsorted,
// before GPS resolved.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectHomeNearbyCandidates } from './homeNearYou.js'
import { hasUsableCoordinates, MAX_NEARBY_RADIUS_M } from './nearbyRanking.js'

const MUNICH = { latitude: 48.1351, longitude: 11.5820 }
const VIENNA = { latitude: 48.2082, longitude: 16.3738 } // ~355mi from Munich — well beyond MAX_NEARBY_RADIUS_M

function locatedItem(id, { lat, lng } = {}) {
  return { id, maps_lat: lat, maps_lng: lng, is_universal: false }
}

function universalFillerItem(id) {
  // Universal items are, by definition, not tied to a specific place —
  // this is exactly the shape of the "generic filler" reported on-device.
  return { id, maps_lat: null, maps_lng: null, is_universal: true }
}

// ── 2 & 5. Munich coordinates -> only coordinate-bearing, distance-labeled Munich-area items ──
test('with Munich coordinates, only real coordinate-bearing Munich-area items are returned, nearest first, each with a numeric distance', () => {
  const rawItems = [
    locatedItem('munich-far', { lat: MUNICH.latitude + 0.2, lng: MUNICH.longitude + 0.2 }), // a few miles out
    locatedItem('munich-near', { lat: MUNICH.latitude + 0.01, lng: MUNICH.longitude + 0.01 }), // very close
    universalFillerItem('generic-1'),
  ]
  const result = selectHomeNearbyCandidates(rawItems, MUNICH)
  assert.deepEqual(result.map(i => i.id), ['munich-near', 'munich-far'], 'nearest-first, no generic filler')
  for (const item of result) {
    assert.equal(typeof item.distM, 'number', `${item.id} must carry a numeric distance`)
    assert.ok(Number.isFinite(item.distM))
    assert.ok(hasUsableCoordinates(item.maps_lat, item.maps_lng), `${item.id} must have a valid navigation target`)
  }
})

// ── 3. Munich coordinates cannot surface a Vienna item ──────────────────────
test('with Munich coordinates, a Vienna-located item (e.g. Strudlhofstiege) is excluded by the same hard radius cutoff Nearby uses', () => {
  const rawItems = [
    locatedItem('strudlhofstiege', { lat: VIENNA.latitude, lng: VIENNA.longitude }),
    locatedItem('munich-item', { lat: MUNICH.latitude + 0.01, lng: MUNICH.longitude + 0.01 }),
  ]
  const result = selectHomeNearbyCandidates(rawItems, MUNICH)
  assert.ok(!result.some(i => i.id === 'strudlhofstiege'), 'a ~355mi-away Vienna item must never appear under Munich "Near You"')
  assert.deepEqual(result.map(i => i.id), ['munich-item'])
})

// ── 4. Coordinate-less generic items never enter Near You, regardless of location state ──
test('Universal / coordinate-less items never enter the Near You pool, with a resolved location', () => {
  const rawItems = [universalFillerItem('generic-1'), universalFillerItem('generic-2')]
  assert.deepEqual(selectHomeNearbyCandidates(rawItems, MUNICH), [])
})

test('a mixed pool with only Universal items and one valid located item -> only the located item is returned', () => {
  const rawItems = [
    universalFillerItem('generic-1'),
    locatedItem('real-place', { lat: MUNICH.latitude, lng: MUNICH.longitude }),
  ]
  const result = selectHomeNearbyCandidates(rawItems, MUNICH)
  assert.deepEqual(result.map(i => i.id), ['real-place'])
})

// ── 9 & 10. Pending/unavailable location -> honest empty state, never generic filler ──
test('pending location (null, GPS still resolving) -> empty result, never a fallback to generic items', () => {
  const rawItems = [universalFillerItem('generic-1'), locatedItem('real-place', MUNICH)]
  assert.deepEqual(selectHomeNearbyCandidates(rawItems, null), [])
})

test('unavailable location (undefined) -> empty result, same honest-empty behavior as pending', () => {
  const rawItems = [locatedItem('real-place', MUNICH)]
  assert.deepEqual(selectHomeNearbyCandidates(rawItems, undefined), [])
})

test('malformed location object (missing numeric lat/lng) is treated as not-ready -> empty result', () => {
  const rawItems = [locatedItem('real-place', MUNICH)]
  assert.deepEqual(selectHomeNearbyCandidates(rawItems, {}), [])
  assert.deepEqual(selectHomeNearbyCandidates(rawItems, { latitude: 'nope', longitude: 11 }), [])
})

// ── 6. Recomputation, not a one-shot mount-time value ────────────────────────
test('the same raw pool recomputes correctly as location transitions from pending -> resolved -> moved (proves this is a pure recompute, not a cached one-shot value)', () => {
  const rawItems = [
    locatedItem('munich-item', { lat: MUNICH.latitude + 0.01, lng: MUNICH.longitude + 0.01 }),
    locatedItem('vienna-item', { lat: VIENNA.latitude, lng: VIENNA.longitude }),
  ]

  // Mount-time: GPS not resolved yet.
  assert.deepEqual(selectHomeNearbyCandidates(rawItems, null), [])

  // GPS resolves to Munich later — same raw pool, new location -> Munich item appears.
  const afterGpsResolves = selectHomeNearbyCandidates(rawItems, MUNICH)
  assert.deepEqual(afterGpsResolves.map(i => i.id), ['munich-item'])

  // User genuinely travels to Vienna later in the same session — same raw
  // pool, new location -> result flips to the Vienna item, Munich item drops out.
  const afterTravel = selectHomeNearbyCandidates(rawItems, VIENNA)
  assert.deepEqual(afterTravel.map(i => i.id), ['vienna-item'])
})

// ── Hard radius cutoff parity with Nearby ────────────────────────────────────
test('uses the same MAX_NEARBY_RADIUS_M cutoff Nearby enforces (lib/nearbyRanking.js) — no silent nationwide fallback', () => {
  const justInside = locatedItem('just-inside', { lat: MUNICH.latitude, lng: MUNICH.longitude + 1.0 }) // well within 100mi
  const rawItems = [justInside]
  const result = selectHomeNearbyCandidates(rawItems, MUNICH)
  assert.equal(result.length, 1)
  assert.ok(result[0].distM < MAX_NEARBY_RADIUS_M)
})

// ── (0,0) Null Island footgun — same gate Nearby already relies on ──────────
test('a (0,0) "Null Island" item is rejected, not treated as usable', () => {
  const rawItems = [locatedItem('bad-geocode', { lat: 0, lng: 0 })]
  assert.deepEqual(selectHomeNearbyCandidates(rawItems, MUNICH), [])
})
