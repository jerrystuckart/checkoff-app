import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchMetroSearchIndex, searchMetroIndex, buildSearchEntry, venueNamesFromBody, METRO_SEARCH_PAGE_SIZE } from './metroSearch.js'

// A small fake Supabase client: it applies the same filters the real query does, so inactive/unapproved/secret/other-metro items
// can only be excluded by the module's own query, not by the fixture.
const GB = 'metro-gb'
const PHX = 'metro-phx'
const HOODS = [
  { id: 'h-west', name: 'West Side Green Bay', metro_id: GB },
  { id: 'h-east', name: 'East Side Green Bay', metro_id: GB },
  { id: 'h-phx', name: 'Downtown Phoenix', metro_id: PHX },
]
const item = (id, body, o = {}) => ({ id, body, neighborhood_id: 'hood' in o ? o.hood : 'h-west', is_active: o.active ?? true, is_approved: o.approved ?? true, is_secret: o.secret ?? false, partners: o.partner ? { business_name: o.partner } : null, categories: o.category ? { name: o.category } : null, item_tags: (o.tags ?? []).map((name) => ({ tags: { name } })) })
const ITEMS = [
  item('sauna', "Settle into a private or community wood-fired sauna session with '920 Sauna Co'.", { category: 'Spa & self-care', tags: ['sauna', 'spa'] }), // no list membership anywhere in this fixture
  item('brew', "Get a beer in the outdoor beer garden at 'Titletown Brewing Co'.", { hood: 'h-east', category: 'Food & drink' }),
  item('hueft', "Try the Hüftgold pretzel at 'Zum Bräuhaus'.", { hood: 'h-west' }),
  item('inactive', "Visit the retired 'Old 920 Sauna' building.", { active: false }),
  item('unapproved', "Preview 'Sauna Draft Co'.", { approved: false }),
  item('secret', "Find the hidden 'Sauna Speakeasy'.", { secret: true }),
  item('phoenix-sauna', "Try the cold plunge at 'Phoenix Sauna Club'.", { hood: 'h-phx' }),
  item('orphan', "Sauna at 'Nowhere Sauna'.", { hood: null }),
]

function fakeSb(calls = []) {
  return {
    from(table) {
      const filters = []
      const q = {
        select() { return q },
        eq(col, val) { filters.push((r) => r[col] === val); return q },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return q },
        order() { return q },
        range(a, b) { q._range = [a, b]; return q },
        then(res, rej) {
          calls.push({ table, filters: filters.length, range: q._range })
          const rows = (table === 'neighborhoods' ? HOODS : ITEMS).filter((r) => filters.every((f) => f(r)))
          const out = q._range ? rows.slice(q._range[0], q._range[1] + 1) : rows
          return Promise.resolve({ data: out, error: null }).then(res, rej)
        },
      }
      return q
    },
  }
}

const gbIndex = () => fetchMetroSearchIndex(fakeSb(), GB)

test('case 1+2: "920 Sauna", "sauna" and a partial venue name find the item from anywhere (no location input exists)', async () => {
  const idx = await gbIndex()
  for (const q of ['920 Sauna', 'sauna', '920 sau', 'wood-fired sauna', 'SAUNA CO']) {
    const r = searchMetroIndex(idx, q)
    assert.ok(r.some((x) => x.id === 'sauna'), `"${q}" must return the 920 Sauna Co experience`)
  }
  assert.equal(searchMetroIndex(idx, '920 Sauna')[0].id, 'sauna', 'the venue-name match ranks first')
})

test('case 8: an item that is on no curated list stays searchable (search never consults lists, rails, saves or distance)', async () => {
  const calls = []
  await fetchMetroSearchIndex(fakeSb(calls), GB)
  assert.deepEqual([...new Set(calls.map((c) => c.table))].sort(), ['items', 'neighborhoods'], 'only neighborhoods and items are read: no lists, rails, saves, or location')
})

test('case 9: inactive, unapproved and secret items are never searchable; other metros and no-neighborhood items are excluded', async () => {
  const idx = await gbIndex()
  const ids = idx.map((e) => e.id).sort()
  assert.deepEqual(ids, ['brew', 'hueft', 'sauna'])
  const r = searchMetroIndex(idx, 'sauna')
  assert.deepEqual(r.map((x) => x.id), ['sauna'])
  assert.equal(searchMetroIndex(await fetchMetroSearchIndex(fakeSb(), PHX), 'sauna')[0].id, 'phoenix-sauna', 'a metro only ever searches its own catalog')
})

test('matches venue, experience text, neighborhood, category and tag; every word must match; ranking prefers venue names', async () => {
  const idx = await gbIndex()
  assert.equal(searchMetroIndex(idx, 'titletown')[0].id, 'brew')
  assert.equal(searchMetroIndex(idx, 'east side')[0].id, 'brew', 'neighborhood')
  assert.equal(searchMetroIndex(idx, 'spa self-care')[0].id, 'sauna', 'category + tag words')
  assert.equal(searchMetroIndex(idx, 'sauna brewing').length, 0, 'all words must match')
  assert.deepEqual(searchMetroIndex(idx, 's'), [], 'a single character is too short to search')
  assert.deepEqual(searchMetroIndex(idx, '   '), [])
})

test('accent-insensitive: umlaut, bare-Latin and transliterated spellings all match', async () => {
  const idx = await gbIndex()
  for (const q of ['Hüftgold', 'Huftgold', 'Hueftgold', 'brauhaus', 'Bräuhaus']) assert.ok(searchMetroIndex(idx, q).some((x) => x.id === 'hueft'), q)
})

test('venue names are read from straight and curly quotes; partner business names are searchable', () => {
  assert.deepEqual(venueNamesFromBody("Sip at 'A Place' and ‘Another One’."), ['A Place', 'Another One'])
  const e = buildSearchEntry({ id: 'x', body: 'Go there.', partners: { business_name: 'Partner Name LLC' } }, 'Howard')
  assert.ok(searchMetroIndex([e], 'partner name').length === 1)
})

test('large metros page past the 1000-row API limit', async () => {
  const many = Array.from({ length: METRO_SEARCH_PAGE_SIZE + 25 }, (_, i) => item(`n${i}`, `Try item ${i} at 'Venue ${i}'.`))
  ITEMS.push(...many)
  try {
    const idx = await gbIndex()
    assert.equal(idx.length, 3 + many.length)
  } finally {
    ITEMS.length -= many.length
  }
})

test('the query is scoped by metro and the safe-visibility filters (active, approved, not secret)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./metroSearch.js', import.meta.url), 'utf8')
  for (const f of [".eq('is_active', true)", ".eq('is_approved', true)", ".eq('is_secret', false)", ".eq('metro_id', metroId)", ".in('neighborhood_id', ids)"]) assert.ok(src.includes(f), f)
  assert.ok(!/geolocation|Location\.|expo-location|distance|radius/i.test(src.replace(/\/\/.*$/gm, '')), 'search is never location-based')
})

test('wiring: Search Metro is reachable from Home for the selected metro and registered as its own route (separate from Nearby)', async () => {
  const { readFileSync } = await import('node:fs')
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  const home = readFileSync(new URL('../screens/HomeScreen.jsx', import.meta.url), 'utf8')
  const entry = readFileSync(new URL('../components/HomeMetroSearchEntry.jsx', import.meta.url), 'utf8')
  const nearby = readFileSync(new URL('../screens/DiscoverScreen.jsx', import.meta.url), 'utf8')
  assert.match(app, /name="MetroSearch"\s+component=\{MetroSearchScreen\}/)
  assert.match(home, /<HomeMetroSearchEntry metro=\{selectedMetro\}/)
  assert.match(entry, /navigate\('MetroSearch', \{ metroId: metro\.id/)
  assert.ok(!/metroSearch|MetroSearch/.test(nearby), 'Nearby is untouched: Search Metro is not wired into the radius-bound Nearby search')
})
