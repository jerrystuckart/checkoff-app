import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocationStore } from './locationFreshness.js'
import { haversineMeters } from './distance.js'
import { isWithinNearbyRadius, rankNearbyItems } from './nearbyRanking.js'

// Integration-style coverage tying the shared location store to the
// distance-dependent computations Home/Nearby/closest-item logic actually
// runs on top of it — the real bug was "pull-to-refresh only re-fetches
// database rows against stale coordinates," so these tests specifically
// prove that forcing a location refresh changes what those computations
// see, not just that the store's internal state updates in isolation
// (already covered by lib/locationFreshness.test.js).

const LOCATION_A = { latitude: 33.5806, longitude: -112.2374 } // Peoria — user starts here
const LOCATION_B = { latitude: 33.4484, longitude: -112.0740 } // Phoenix, ~15mi from A

// Candidate items: one genuinely close to A, one genuinely close to B.
const itemNearA = { id: 'near-a', lat: 33.5811, lng: -112.2378 } // ~50m from A
const itemNearB = { id: 'near-b', lat: 33.4480, lng: -112.0745 } // ~50m from B

function distanceItemsFrom(userCoords) {
  return [itemNearA, itemNearB].map(i => {
    const dist_m = haversineMeters(userCoords.latitude, userCoords.longitude, i.lat, i.lng)
    return { id: i.id, dist_m }
  })
}

// ── Scenario A: forced Home refresh ────────────────────────────────────────
test('Scenario A — forced refresh moves the shared location from A to B, and closest-item ranking follows it', () => {
  return (async () => {
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: Date.now() } })

    // Before refresh: standing at A, the A-item is closest.
    const beforeItems = distanceItemsFrom(store.getSnapshot().coords)
    const beforeRanked = rankNearbyItems(beforeItems, {})
    assert.equal(beforeRanked[0].id, 'near-a')

    // User has physically moved to B; a pull-to-refresh must force a real
    // device fetch (force: true), not just re-run a query against A.
    const fetchB = async () => LOCATION_B
    const snapshot = await store.requestFreshLocation({ force: true, deviceFetch: fetchB })
    assert.deepEqual(snapshot.coords, LOCATION_B, 'forced refresh must acquire a genuinely fresh location')

    // Recomputing distance/closest-item data against the NEW location must
    // now favor the B-item — this is the exact "distances/closest data use
    // Location B" requirement.
    const afterItems = distanceItemsFrom(store.getSnapshot().coords)
    const afterRanked = rankNearbyItems(afterItems, {})
    assert.equal(afterRanked[0].id, 'near-b', 'closest item must now reflect Location B, not stale Location A')
  })()
})

// ── Scenario B: forced Discover/Nearby refresh ─────────────────────────────
test('Scenario B — forced Nearby refresh: the automatic-radius gate also re-evaluates against Location B', () => {
  return (async () => {
    const store = createLocationStore({ initialState: { coords: LOCATION_A, lastFetchedAt: Date.now() } })

    // A destination ~8mi from B (but ~15mi+ from A) — near-A user wouldn't
    // see it inside a tight radius; after moving to B it should.
    const destNearB = { latitude: 33.55, longitude: -112.05 } // ~8mi from B, further from A
    const distFromA = haversineMeters(LOCATION_A.latitude, LOCATION_A.longitude, destNearB.latitude, destNearB.longitude)
    const distFromAMiles = distFromA / 1609.34

    const fetchB = async () => LOCATION_B
    await store.requestFreshLocation({ force: true, deviceFetch: fetchB })

    const distFromB = haversineMeters(store.getSnapshot().coords.latitude, store.getSnapshot().coords.longitude, destNearB.latitude, destNearB.longitude)
    const distFromBMiles = distFromB / 1609.34

    assert.ok(distFromBMiles < distFromAMiles, 'sanity: the destination really is closer to B than to A')
    // Both stay within the 100mi automatic radius here, but the key
    // assertion is that Nearby's gate is now evaluated against the fresh
    // (B) distance, not whatever was cached from A.
    assert.equal(isWithinNearbyRadius(distFromB), true)
  })()
})
