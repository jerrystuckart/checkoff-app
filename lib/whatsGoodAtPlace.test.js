// What's Good V1 — whatsGoodAtPlace.js unit tests. Pure, no DB/network/RN.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getForegroundPresenceRadiusM, isAtPlace, FOREGROUND_PRESENCE_CAP_M } from './whatsGoodAtPlace.js'

const HERE = { latitude: 40.0, longitude: -105.0 }

function metersAway(lat, meters) {
  // ~111,320m per degree latitude — close enough for these test distances.
  return { latitude: lat + meters / 111320, longitude: -105.0 }
}

test('FOREGROUND_PRESENCE_CAP_M is locked at 150 (decision `whats_the_thing_foreground_presence_radius`)', () => {
  assert.equal(FOREGROUND_PRESENCE_CAP_M, 150)
})

test('100m radius item: preserved as-is (below the cap)', () => {
  assert.equal(getForegroundPresenceRadiusM({ geo_radius_m: 100 }), 100)
})

test('150m radius item: preserved as-is (exactly at the cap)', () => {
  assert.equal(getForegroundPresenceRadiusM({ geo_radius_m: 150 }), 150)
})

test('300/500/5000m radii are all capped to 150', () => {
  assert.equal(getForegroundPresenceRadiusM({ geo_radius_m: 300 }), 150)
  assert.equal(getForegroundPresenceRadiusM({ geo_radius_m: 500 }), 150)
  assert.equal(getForegroundPresenceRadiusM({ geo_radius_m: 5000 }), 150)
})

test('NULL/missing geo_radius_m falls back to the 500m background default, then is capped to 150', () => {
  assert.equal(getForegroundPresenceRadiusM({ geo_radius_m: null }), 150)
  assert.equal(getForegroundPresenceRadiusM({}), 150)
})

test('accepts either snake_case or camelCase field names', () => {
  assert.equal(getForegroundPresenceRadiusM({ geoRadiusM: 100 }), 100)
})

test('isAtPlace: just inside the boundary is true, just outside is false', () => {
  const item100 = { maps_lat: HERE.latitude, maps_lng: HERE.longitude, geo_radius_m: 100 }
  assert.equal(isAtPlace(item100, metersAway(HERE.latitude, 99)), true)
  assert.equal(isAtPlace(item100, metersAway(HERE.latitude, 101)), false)
})

test('isAtPlace: exactly at the radius boundary counts as at-place (inclusive)', () => {
  const item100 = { maps_lat: HERE.latitude, maps_lng: HERE.longitude, geo_radius_m: 100 }
  assert.equal(isAtPlace(item100, metersAway(HERE.latitude, 100)), true)
})

test('isAtPlace: a large-radius item (500m) is still capped to the 150m foreground rule', () => {
  const item500 = { maps_lat: HERE.latitude, maps_lng: HERE.longitude, geo_radius_m: 500 }
  assert.equal(isAtPlace(item500, metersAway(HERE.latitude, 200)), false, '200m away must NOT be at-place even though 200m < the 500m background radius')
  assert.equal(isAtPlace(item500, metersAway(HERE.latitude, 100)), true)
})

test('isAtPlace: false when no user location, no item coordinates, or missing item', () => {
  assert.equal(isAtPlace({ maps_lat: 40, maps_lng: -105, geo_radius_m: 100 }, null), false)
  assert.equal(isAtPlace({ geo_radius_m: 100 }, HERE), false)
  assert.equal(isAtPlace(null, HERE), false)
})
