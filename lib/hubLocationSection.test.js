import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  isInsideAnyZone, buildHubExperiences, selectHubLocationSection, CLOSEST_COUNT,
} from './hubLocationSection.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// One degree of latitude ~ 111.2 km; offsets below are in metres north.
const north = (lat, m) => lat + m / 111195
const HUBS = {
  willcox: { lat: 32.2528, lng: -109.832, zone: { center_lat: 32.2528, center_lng: -109.832, radius_km: 8 } },
  positano: { lat: 40.6281, lng: 14.485, zone: { center_lat: 40.6281, center_lng: 14.485, radius_km: 7 } },
}
const item = (id, lat, lng, extra = {}) => ({ id, body: `Thing ${id}`, maps_lat: lat, maps_lng: lng, geo_radius_m: 100, is_universal: false, ...extra })
const row = (list_id, it) => ({ list_id, item: it })
const at = (h, m) => ({ latitude: north(h.lat, m), longitude: h.lng })

for (const [name, h] of Object.entries(HUBS)) {
  const mk = (id, m, x) => item(id, north(h.lat, m), h.lng, x)

  test(`${name}: inside zone and at an eligible venue -> 'at' with the nearest item`, () => {
    const items = [mk('a', 0, { partnerName: 'Venue A' }), mk('b', 400), mk('c', 900)]
    const s = selectHubLocationSection({ location: at(h, 20), zones: [h.zone], items })
    assert.equal(s.kind, 'at')
    assert.deepEqual(s.items.map(i => i.id), ['a'])
  })

  test(`${name}: between venues -> closest two in distance order`, () => {
    const items = [mk('far', 1500), mk('mid', 600), mk('near', 300), mk('farther', 3000)]
    const s = selectHubLocationSection({ location: at(h, 0), zones: [h.zone], items })
    assert.equal(s.kind, 'closest')
    assert.equal(s.items.length, CLOSEST_COUNT)
    assert.deepEqual(s.items.map(i => i.id), ['near', 'mid'])
    assert.ok(s.items[0].distM < s.items[1].distM)
  })

  test(`${name}: outside zone / missing location -> nothing`, () => {
    const items = [mk('a', 0)]
    assert.equal(selectHubLocationSection({ location: { latitude: 0, longitude: 0 }, zones: [h.zone], items }), null)
    assert.equal(selectHubLocationSection({ location: null, zones: [h.zone], items }), null)
    assert.equal(selectHubLocationSection({ location: { latitude: NaN, longitude: 1 }, zones: [h.zone], items }), null)
    assert.equal(selectHubLocationSection({ location: at(h, 0), zones: [], items }), null)
  })

  test(`${name}: zone boundary is the same radius_km haversine`, () => {
    assert.equal(isInsideAnyZone(at(h, h.zone.radius_km * 1000 - 200), [h.zone]), true)
    assert.equal(isInsideAnyZone(at(h, h.zone.radius_km * 1000 + 200), [h.zone]), false)
  })

  test(`${name}: zero and one experience`, () => {
    assert.equal(selectHubLocationSection({ location: at(h, 0), zones: [h.zone], items: [] }), null)
    const one = selectHubLocationSection({ location: at(h, 500), zones: [h.zone], items: [mk('solo', 0)] })
    assert.equal(one.kind, 'closest')
    assert.equal(one.items.length, 1)
  })

  test(`${name}: completed experiences are marked, not hidden or re-eligible`, () => {
    const s = selectHubLocationSection({
      location: at(h, 10), zones: [h.zone], items: [mk('a', 0), mk('b', 500)], completedIds: new Set(['a']),
    })
    assert.equal(s.kind, 'at')
    assert.equal(s.items[0].completed, true)
  })

  test(`${name}: moving between states never carries stale items`, () => {
    const items = [mk('a', 0), mk('b', 2000), mk('c', 2600)]
    const run = m => selectHubLocationSection({ location: at(h, m), zones: [h.zone], items })
    assert.equal(run(5).kind, 'at')
    const between = run(1000)
    assert.equal(between.kind, 'closest')
    assert.deepEqual(between.items.map(i => i.id), ['a', 'b'])
    assert.equal(selectHubLocationSection({ location: { latitude: 0, longitude: 0 }, zones: [h.zone], items }), null)
    assert.equal(run(2000).items[0].id, 'b')
  })
}

test('being nearby is not eligibility: 151m away from a 500m-radius item is not "at"', () => {
  const h = HUBS.willcox
  const s = selectHubLocationSection({ location: at(h, 151), zones: [h.zone], items: [item('a', h.lat, h.lng, { geo_radius_m: 500 })] })
  assert.equal(s.kind, 'closest')
})

test('duplicate membership across lists yields one experience; universal/unlocated/inactive dropped', () => {
  const dup = item('a', 1, 1)
  const out = buildHubExperiences([
    row('L1', dup), row('L2', dup), row('L1', item('b', 1, 1)),
    row('L1', item('u', 1, 1, { is_universal: true })),
    row('L1', item('n', null, null)),
    row('L1', item('x', 1, 1, { isActive: false })),
  ])
  assert.deepEqual(out.map(e => e.item.id), ['a', 'b'])
  assert.deepEqual(out[0].listIds, ['L1', 'L2'])
  const s = selectHubLocationSection({ location: at(HUBS.willcox, 0), zones: [HUBS.willcox.zone], items: [dup, dup] })
  assert.ok(s.items.length <= 2)
})

test('HubScreen wires the section above the lists, below spotlights, hook before early returns', () => {
  const src = readFileSync(join(__dirname, '../screens/HubScreen.jsx'), 'utf8')
  const iHook = src.indexOf('useHubLocationSection({')
  const iEarly = src.indexOf('if (loading) {')
  const iSection = src.indexOf('<HubLocationSection')
  const iSpot = src.indexOf('{/* Spotlights')
  const iLists = src.indexOf('{/* Lists */}')
  assert.ok(iHook > 0 && iHook < iEarly)
  assert.ok(iSpot < iSection && iSection < iLists)
  assert.ok(!/Linking\.openSettings|requestForegroundPermissionsAsync/.test(readFileSync(join(__dirname, 'useHubLocationSection.js'), 'utf8')), 'no new permission prompts')
})
