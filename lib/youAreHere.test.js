import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { youAreHereLabel } from './youAreHere.js'
import { isAtPlace } from './whatsGoodAtPlace.js'
import { resolveItemLink, planItemNavigation } from './linkResolution.js'

const sauna = { id: 'b320c748-9eb2-450a-a91a-59f4fd762629', maps_lat: 44.5133, maps_lng: -88.0133, geo_radius_m: 100 }

test('case 3: a user at the item sees "You Are Here"; case: elsewhere (Phoenix) sees nothing extra and nothing is hidden', () => {
  const at = { latitude: 44.5133, longitude: -88.0133 }
  const phoenix = { latitude: 33.4484, longitude: -112.074 }
  assert.equal(isAtPlace(sauna, at), true, 'fixture sanity: a user standing on the item is at the place')
  assert.equal(youAreHereLabel(sauna, at), 'You Are Here')
  assert.equal(youAreHereLabel(sauna, phoenix), null)
  assert.equal(youAreHereLabel(sauna, null), null, 'no location permission: still no label, and no failure')
  assert.equal(youAreHereLabel(null, at), null)
})

test('opening an exact item never depends on proximity: the resolver takes only the id and has no location input', async () => {
  const sb = (row) => ({ from: (t) => ({ select: () => ({ eq: function () { return this }, maybeSingle: async () => ({ data: t === 'items' ? row : null, error: null }) }) }) })
  const r = await resolveItemLink(sb({ id: sauna.id, neighborhood_id: null }), sauna.id)
  assert.equal(r.status, 'ok')
  assert.equal(planItemNavigation(r, { cold: false }).name, 'ItemDetail')
  const src = readFileSync(new URL('./linkResolution.js', import.meta.url), 'utf8')
  assert.ok(!/expo-location|geolocation|userLocation|distance/i.test(src), 'link resolution is location-free')
})

test('ItemDetail shows the label as an addition only: the label is conditional and the item hero renders unconditionally', () => {
  const src = readFileSync(new URL('../screens/ItemDetailScreen.jsx', import.meta.url), 'utf8')
  assert.match(src, /youAreHereLabel\(item, detailUserLocation\) \? \(/)
  assert.ok(!/if \(!isAtPlaceForItem\)\s*return/.test(src), 'the screen never bails out when the user is elsewhere')
})
