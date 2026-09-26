import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { classifyVisitProfile, assignableVisitProfile } from './profileClassifier.js'

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./__fixtures__/${n}`, import.meta.url), 'utf8'))
const labeled = load('labeled_visit_profiles.json')
const catalog = load('catalog_snapshot_2026-09-28.json') // every catalog row, incl. inactive/universal/secret/un-geocoded
const CANDIDATE_MIN = { quick_stop: 5, retail: 9, fast_casual: 10, restaurant: 15, bar: 15, attraction: 18, outdoor: 12, event: 20, landmark: 4 }
const VALID = new Set(Object.keys(CANDIDATE_MIN))

// Everything below asserts hard properties; none of them is "a percentage happened to look fine".

test('SAFETY: never assigns an unsupported item (inactive, universal, secret, un-geocoded, metro-less) — checked over the WHOLE catalog', () => {
  let assigned = 0
  for (const r of catalog) {
    const { profile, reason } = assignableVisitProfile(r)
    if (!profile) continue
    assigned++
    assert.ok(r.is_active, `inactive item assigned: ${r.id}`)
    assert.ok(!r.is_universal, `universal item assigned: ${r.id}`)
    assert.ok(!r.is_secret, `secret item assigned: ${r.id}`)
    assert.ok(r.has_coords, `un-geocoded item assigned: ${r.id}`)
    assert.ok(r.metro, `metro-less item assigned: ${r.id}`)
    assert.ok(VALID.has(profile), `unknown profile ${profile} (${reason})`)
    assert.notEqual(profile, 'manual_only')
  }
  assert.ok(assigned > 800, 'the rules should cover most of the geocoded catalog')
})

test('SAFETY: never touches an item that already has a profile — including manual_only, which a person chose', () => {
  const already = catalog.filter((r) => r.prof)
  assert.ok(already.length > 300)
  assert.ok(already.some((r) => r.prof === 'manual_only'), 'fixture must contain manual_only rows')
  for (const r of already) assert.deepEqual(assignableVisitProfile(r), { profile: null, reason: 'already_profiled' })
  assert.deepEqual(assignableVisitProfile({ ...already[0], prof: 'manual_only' }), { profile: null, reason: 'already_profiled' })
})

test('SAFETY: the classifier can never emit manual_only (or anything outside the real profile set)', () => {
  for (const r of catalog) {
    const p = classifyVisitProfile({ body: r.body, category: r.cat, isSecret: r.is_secret, isUniversal: r.is_universal }).profile
    assert.ok(p === null || VALID.has(p))
  }
})

test('each exclusion reason is exercised on real rows', () => {
  const reasons = new Set(catalog.map((r) => assignableVisitProfile(r).reason))
  for (const need of ['already_profiled', 'inactive', 'universal', 'no_coordinates', 'no_metro', 'no_confident_rule']) assert.ok(reasons.has(need), `no catalog row exercises "${need}"`)
})

test('category rules (measured against every human-assigned label) are exact where used; the fixture is large enough to mean it', () => {
  assert.ok(labeled.length > 250)
  let briefStops = 0
  for (const cat of ['Bar & drinks', 'Arts & Culture', 'Shopping', 'Travel', 'Spa & self-care', 'Play']) {
    const rows = labeled.filter((r) => r.category === cat)
    assert.ok(rows.length > 0, cat)
    for (const r of rows) {
      const c = classifyVisitProfile({ body: r.body, category: cat })
      // The one intentional disagreement: a brief-stop cue (e.g. the buchetta wine window a person labeled 'bar') yields
      // NO profile — leaving a place unassigned is the safe direction; a wrong dwell profile is not.
      if (c.reason === 'brief_stop_cue' || c.reason === 'no_named_venue') { briefStops++; continue }
      assert.equal(c.profile, r.profile, `${cat}: ${r.body}`)
    }
  }
  assert.ok(briefStops <= 6, `brief-stop / no-named-venue guards overrode ${briefStops} human labels`)
})

test('directional safety vs human labels: a wrong guess is almost never a SHORTER stay requirement than the person chose', () => {
  let predicted = 0, tooShort = 0
  for (const r of labeled) {
    const { profile } = classifyVisitProfile({ body: r.body, category: r.category })
    if (!profile) continue
    predicted++
    if (profile !== r.profile && CANDIDATE_MIN[profile] < CANDIDATE_MIN[r.profile] - 2) tooShort++
  }
  assert.ok(tooShort <= 4, `${tooShort} of ${predicted} predictions demand a materially shorter stay than the human label`)
})

test('unsure categories stay unassigned rather than getting a generic profile', () => {
  for (const category of ['Adventure', 'Social', 'Misc', 'Unknown', '']) {
    assert.equal(classifyVisitProfile({ body: 'Do the thing at the place', category }).profile, null)
  }
  for (const r of catalog.filter((x) => ['Adventure', 'Social', 'Misc'].includes(x.cat) && !x.prof)) assert.equal(assignableVisitProfile(r).profile, null)
})

test('brief-stop places (wine window, walk-up window) are never profiled, whatever the category', () => {
  const wine = "Ring the bell and order a glass of Tuscan wine through the centuries-old wine window at 'Cantina de’ Pucci'"
  assert.deepEqual(classifyVisitProfile({ body: wine, category: 'Bar & drinks' }), { profile: null, reason: 'brief_stop_cue' })
  assert.equal(classifyVisitProfile({ body: "Order at the walk-up window of 'Joe's'", category: 'Food & drink' }).profile, null)
  const real = catalog.find((r) => r.id === 'ebf3045d-70e2-48b5-9592-ebc547e7a197')
  assert.equal(assignableVisitProfile(real).profile, null)
})

test('area-, street- and trip-level items (no named venue) are never given a venue geofence', () => {
  for (const [body, category] of [['Road-trip to Las Vegas', 'Travel'], ['Go shopping in Kenosha', 'Shopping'], ['Hit up 5 different bars on Bell Road in one evening', 'Bar & drinks'], ['Drive out to the desert and stop to see the stars', 'Travel']]) {
    assert.deepEqual(classifyVisitProfile({ body, category }), { profile: null, reason: 'no_named_venue' }, body)
  }
  const named = "Order a scoop of gelato at 'Vivoli'"
  assert.equal(classifyVisitProfile({ body: named, category: 'Food & drink' }).profile, 'quick_stop')
  const dropped = catalog.filter((r) => !r.prof && r.is_active && r.has_coords && r.metro && !r.is_universal && ['Travel', 'Shopping', 'Bar & drinks', 'Arts & Culture', 'Food & drink', 'Play'].includes(r.cat) && classifyVisitProfile({ body: r.body, category: r.cat }).reason === 'no_named_venue')
  assert.ok(dropped.length >= 15 && dropped.length <= 60, `${dropped.length}`)
})

test('food defaults to the LONGER stay unless a clear quick-stop cue exists', () => {
  assert.equal(classifyVisitProfile({ body: "Order a scoop of gelato at 'Vivoli'", category: 'Food & drink' }).profile, 'quick_stop')
  assert.equal(classifyVisitProfile({ body: "Try the bistecca at 'Trattoria X'", category: 'Food & drink' }).profile, 'restaurant')
})

test('generator and the reviewed migration agree: only eligible, currently-unprofiled ids, and a matching count', () => {
  const sql = fs.readFileSync(new URL('../../supabase/migrations/20260928b_visit_profile_rule_v1.sql', import.meta.url), 'utf8')
  const ids = [...sql.matchAll(/'([0-9a-f]{8}-[0-9a-f-]{27})'/g)].map((m) => m[1])
  const byId = new Map(catalog.map((r) => [r.id, r]))
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids in migration')
  for (const id of ids) {
    const r = byId.get(id)
    assert.ok(r, `unknown id ${id}`)
    assert.ok(assignableVisitProfile(r).profile, `migration contains a row the classifier would not assign: ${id}`)
  }
  const expected = catalog.filter((r) => assignableVisitProfile(r).profile).length
  assert.equal(ids.length, expected)
  assert.ok(sql.includes('visit_profile_key IS NULL AND NOT is_universal AND is_active'), 'UPDATE must only fill empty profiles on active non-universal items')
})
