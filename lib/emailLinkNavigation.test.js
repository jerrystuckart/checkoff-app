// Explicit email/shared link navigation: contract, linking config, resolvers, metro precedence.
// Run with: node --test lib/emailLinkNavigation.test.js
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  isUuid, isMetroSlug, homeUrl, itemUrl, listUrl, metroUrl, appSchemeUrl, parseEmailLink, normalizeLinkPath, routeForIntent,
} from './emailLinkContract.js'
import { LINK_PREFIXES, LINKING_CONFIG } from './linkingConfig.js'
import {
  resolveItemLink, resolveListLink, resolveMetroLink, planItemNavigation, planListNavigation, planHomeNavigation,
} from './linkResolution.js'
import {
  setExplicitMetro, getExplicitMetro, clearExplicitMetro, subscribeExplicitMetro, metroForIntent, __resetExplicitMetroForTests,
} from './explicitMetroIntent.js'
import { resolveHomeMetro, shouldAdoptNearestMetro, nearestMetroWithinBoundary } from './metroSelection.js'

const require = createRequire(import.meta.url)
const { getStateFromPath } = require('@react-navigation/core')

const ITEM = '2f6c0f6e-8a4b-4c8e-9a53-0b4a1d9e7c11'
const LIST = '7d1b2c3a-1111-4222-8333-444455556666'
const CURATED = '9a8b7c6d-1111-4222-8333-444455556666'
const PHX = { id: 'm-phx', name: 'Phoenix Metro', slug: 'phoenix', is_active: true, center_lat: 33.4484, center_lng: -112.074 }
const FLR = { id: 'm-flr', name: 'Florence Metro', slug: 'florence', is_active: true, center_lat: 43.7731, center_lng: 11.256 }
const AMA = { id: 'm-ama', name: 'Amalfi Coast', slug: 'amalfi-coast', is_active: true, center_lat: 40.648, center_lng: 14.606, boundary_radius_km: 12 }
const MUC = { id: 'm-muc', name: 'Munich Metro', slug: 'munich', is_active: true, center_lat: 48.1372, center_lng: 11.5755 }
const VIE = { id: 'm-vie', name: 'Vienna Metro', slug: 'vienna_austria', is_active: true, center_lat: 48.2082, center_lng: 16.3738 }
const OLD = { id: 'm-old', name: 'Old Metro', slug: 'old-town', is_active: false }
const METROS = [PHX, FLR, AMA, MUC, VIE]

// ── minimal fake Supabase (equality filters only) ───────────────────────────
function fakeSb(tables) {
  return {
    from(table) {
      const filters = []
      const q = {
        select() { return q },
        eq(c, v) { filters.push([c, v]); return q },
        maybeSingle() { const r = (tables[table] ?? []).filter((x) => filters.every(([c, v]) => x[c] === v)); return Promise.resolve({ data: r[0] ?? null, error: null }) },
        then(res, rej) { const r = (tables[table] ?? []).filter((x) => filters.every(([c, v]) => x[c] === v)); return Promise.resolve({ data: r, error: null }).then(res, rej) },
      }
      return q
    },
  }
}
const DB = () => fakeSb({
  items: [
    { id: ITEM, body: 'A Phoenix thing', is_active: true, is_approved: true, neighborhood_id: 'n-phx' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', body: 'Inactive', is_active: false, is_approved: true, neighborhood_id: 'n-phx' },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', body: 'Universal', is_active: true, is_approved: true, neighborhood_id: null },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', body: 'In inactive metro', is_active: true, is_approved: true, neighborhood_id: 'n-old' },
  ],
  neighborhoods: [{ id: 'n-phx', metro_id: PHX.id }, { id: 'n-old', metro_id: OLD.id }],
  metro_areas: [...METROS, OLD],
  lists: [
    { id: LIST, title: 'Fall 2026 Munich Metro', metro_id: MUC.id, is_public: true, is_official: true, hero_image_url: 'https://img/x.png' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000001', title: 'Private', metro_id: PHX.id, is_public: false },
  ],
  curated_lists: [
    { id: CURATED, title: 'West Valley Best', tagline: 't', city_slug: 'phoenix', is_active: true, audience_groups: { name: 'Locals', emoji: 'x', tagline: 'tl' } },
    { id: 'cccccccc-0000-4000-8000-000000000001', title: 'Gone', city_slug: 'phoenix', is_active: false },
  ],
})

beforeEach(() => __resetExplicitMetroForTests())

// ── Contract: parsing ───────────────────────────────────────────────────────
test('contract: canonical builders produce one HTTPS form each', () => {
  assert.equal(homeUrl(), 'https://getcheckoff.com/open')
  assert.equal(itemUrl(ITEM), `https://getcheckoff.com/item/${ITEM}`)
  assert.equal(listUrl(LIST), `https://getcheckoff.com/list?id=${LIST}`)
  assert.equal(metroUrl('amalfi-coast'), 'https://getcheckoff.com/metro?slug=amalfi-coast')
  assert.equal(metroUrl('vienna_austria'), 'https://getcheckoff.com/metro?slug=vienna_austria')
  assert.throws(() => itemUrl('nope')); assert.throws(() => listUrl('nope')); assert.throws(() => metroUrl('a b'))
})

test('contract: Home, item, list and metro URLs parse and preserve their ids and slugs', () => {
  assert.deepEqual(parseEmailLink(homeUrl()), { type: 'home' })
  assert.deepEqual(parseEmailLink(itemUrl(ITEM)), { type: 'item', id: ITEM })
  assert.deepEqual(parseEmailLink(listUrl(LIST)), { type: 'list', id: LIST })
  assert.deepEqual(parseEmailLink(metroUrl('green-bay')), { type: 'metro', slug: 'green-bay' })
})

test('contract: older and alternate forms still parse (legacy item query, list path, metro path, custom scheme)', () => {
  assert.deepEqual(parseEmailLink(`https://getcheckoff.com/item?id=${ITEM}`), { type: 'item', id: ITEM })
  assert.deepEqual(parseEmailLink(`https://getcheckoff.com/list/${LIST}`), { type: 'list', id: LIST })
  assert.deepEqual(parseEmailLink('https://getcheckoff.com/metro/florence'), { type: 'metro', slug: 'florence' })
  assert.deepEqual(parseEmailLink(`checkoff://item/${ITEM}`), { type: 'item', id: ITEM })
  assert.deepEqual(parseEmailLink(`checkoff://item?id=${ITEM}`), { type: 'item', id: ITEM })
  assert.deepEqual(parseEmailLink(`checkoff://list?id=${LIST}`), { type: 'list', id: LIST })
  assert.deepEqual(parseEmailLink('checkoff://metro?slug=amalfi-coast'), { type: 'metro', slug: 'amalfi-coast' })
  assert.deepEqual(parseEmailLink('checkoff://home'), { type: 'home' })
  assert.deepEqual(parseEmailLink('https://www.getcheckoff.com/open'), { type: 'home' })
})

test('contract: invalid ids, unknown slugs and unsafe destinations are rejected, never routed', () => {
  assert.equal(parseEmailLink('https://getcheckoff.com/item/not-a-uuid').type, 'invalid')
  assert.equal(parseEmailLink('https://getcheckoff.com/list?id=123').type, 'invalid')
  assert.equal(parseEmailLink('https://getcheckoff.com/list').type, 'invalid')
  assert.equal(parseEmailLink('https://getcheckoff.com/metro?slug=../../etc').type, 'invalid')
  assert.equal(parseEmailLink('https://getcheckoff.com/metro').type, 'invalid')
  assert.equal(parseEmailLink('https://evil.example/item/' + ITEM).type, 'invalid')
  assert.equal(parseEmailLink('http://getcheckoff.com/open').type, 'invalid')
  assert.equal(parseEmailLink('https://getcheckoff.com.evil.example/open').type, 'invalid')
  assert.equal(parseEmailLink('javascript:alert(1)').type, 'invalid')
  assert.equal(parseEmailLink('').type, 'invalid')
  assert.equal(parseEmailLink(null).type, 'invalid')
  assert.ok(isUuid(ITEM) && !isUuid('xyz') && isMetroSlug('vienna_austria') && !isMetroSlug('x') && !isMetroSlug('a/b'))
})

test('contract: appSchemeUrl builds the custom scheme the web pages hand to an installed app', () => {
  assert.equal(appSchemeUrl({ type: 'home' }), 'checkoff://home')
  assert.equal(appSchemeUrl({ type: 'item', id: ITEM }), `checkoff://item/${ITEM}`)
  assert.equal(appSchemeUrl({ type: 'list', id: LIST }), `checkoff://list?id=${LIST}`)
  assert.equal(appSchemeUrl({ type: 'metro', slug: 'amalfi-coast' }), 'checkoff://metro?slug=amalfi-coast')
  assert.equal(appSchemeUrl({ type: 'invalid' }), null)
})

// ── Linking config: every accepted form lands on the right route with its parameter ─────
const stateOf = (url) => {
  const prefix = LINK_PREFIXES.find((p) => url.startsWith(p))
  const path = prefix ? url.slice(prefix.length) : url
  const state = getStateFromPath(normalizeLinkPath(path.startsWith('/') || prefix === 'checkoff://' ? path : '/' + path), LINKING_CONFIG)
  const leaf = state?.routes?.[0]?.state?.routes?.[0]
  return leaf ? { name: leaf.name, params: leaf.params } : null
}

test('linking: every form resolves to the exact route and preserves its id or slug', () => {
  for (const url of [`https://getcheckoff.com/item/${ITEM}`, `https://getcheckoff.com/item?id=${ITEM}`, `checkoff://item/${ITEM}`, `checkoff://item?id=${ITEM}`]) {
    assert.deepEqual(stateOf(url), { name: 'DeepLinkItemResolver', params: { id: ITEM } }, url)
  }
  for (const url of [`https://getcheckoff.com/list?id=${LIST}`, `https://getcheckoff.com/list/${LIST}`, `checkoff://list?id=${LIST}`]) {
    assert.deepEqual(stateOf(url), { name: 'DeepLinkListResolver', params: { id: LIST } }, url)
  }
  for (const url of ['https://getcheckoff.com/metro?slug=amalfi-coast', 'https://getcheckoff.com/metro/amalfi-coast', 'checkoff://metro?slug=amalfi-coast']) {
    assert.deepEqual(stateOf(url), { name: 'DeepLinkMetroResolver', params: { slug: 'amalfi-coast' } }, url)
  }
})

test('linking: Home forms open Home; unrelated routes are untouched', () => {
  for (const url of ['https://getcheckoff.com/open', 'https://getcheckoff.com/open/', 'checkoff://home', 'https://getcheckoff.com/']) {
    assert.deepEqual(stateOf(url), { name: 'Home', params: undefined }, url)
  }
  assert.equal(stateOf('https://getcheckoff.com/join/ABC123').name, 'JoinList')
  assert.equal(stateOf('https://getcheckoff.com/reset-password').name, 'ResetPassword')
  assert.equal(stateOf('https://getcheckoff.com/auth/confirm?code=1').name, 'ConfirmEmail')
  assert.equal(stateOf('https://getcheckoff.com/c/someone').name, 'DeepLinkCreatorResolver')
})

test('routeForIntent agrees with the real React Navigation state for every canonical URL', () => {
  const urls = [homeUrl(), itemUrl(ITEM), listUrl(LIST), metroUrl('amalfi-coast'), metroUrl('vienna_austria')]
  for (const url of urls) {
    const route = routeForIntent(parseEmailLink(url))
    const state = stateOf(url)
    assert.deepEqual({ screen: state.name, params: state.params }, route, url)
  }
  assert.equal(routeForIntent({ type: 'invalid' }), null)
})

test('linking: different cities produce different metro destinations, never one shared route', () => {
  const dests = ['amalfi-coast', 'florence', 'munich', 'vienna_austria', 'phoenix'].map((s) => JSON.stringify(stateOf(`https://getcheckoff.com/metro?slug=${s}`)))
  assert.equal(new Set(dests).size, 5)
})

// ── Resolvers ───────────────────────────────────────────────────────────────
test('item resolver: finds the item and derives ITS metro from the item', async () => {
  const r = await resolveItemLink(DB(), ITEM)
  assert.equal(r.status, 'ok'); assert.equal(r.item.id, ITEM); assert.equal(r.metro.slug, 'phoenix')
})

test('item resolver: invalid, missing and inactive items are controlled results, not navigation', async () => {
  assert.equal((await resolveItemLink(DB(), 'nope')).status, 'invalid')
  assert.equal((await resolveItemLink(DB(), 'dddddddd-0000-4000-8000-000000000009')).status, 'unavailable')
  assert.equal((await resolveItemLink(DB(), 'aaaaaaaa-0000-4000-8000-000000000001')).status, 'unavailable')
})

test('item resolver: a universal item or an item in an inactive metro still opens but selects no metro', async () => {
  const u = await resolveItemLink(DB(), 'aaaaaaaa-0000-4000-8000-000000000002')
  assert.equal(u.status, 'ok'); assert.equal(u.metro, null)
  const o = await resolveItemLink(DB(), 'aaaaaaaa-0000-4000-8000-000000000003')
  assert.equal(o.status, 'ok'); assert.equal(o.metro, null)
})

test('list resolver: a lists.id opens the exact List screen and derives the list metro', async () => {
  const r = await resolveListLink(DB(), LIST)
  assert.equal(r.status, 'ok'); assert.equal(r.kind, 'list'); assert.equal(r.metro.slug, 'munich')
  const plan = planListNavigation(r, { cold: false })
  assert.deepEqual(plan, { type: 'replace', name: 'List', params: { listId: LIST, title: 'Fall 2026 Munich Metro', heroImage: 'https://img/x.png' } })
})

test('list resolver: a curated_lists.id opens CuratedListPreview and derives the metro from its city', async () => {
  const r = await resolveListLink(DB(), CURATED)
  assert.equal(r.status, 'ok'); assert.equal(r.kind, 'curated'); assert.equal(r.metro.slug, 'phoenix')
  const plan = planListNavigation(r, { cold: false })
  assert.equal(plan.name, 'CuratedListPreview'); assert.equal(plan.params.curatedListId, CURATED)
})

test('list resolver: missing, inactive and PRIVATE lists are unavailable (no private list is ever opened by id)', async () => {
  assert.equal((await resolveListLink(DB(), 'eeeeeeee-0000-4000-8000-000000000009')).status, 'unavailable')
  assert.equal((await resolveListLink(DB(), 'bbbbbbbb-0000-4000-8000-000000000001')).status, 'unavailable')
  assert.equal((await resolveListLink(DB(), 'cccccccc-0000-4000-8000-000000000001')).status, 'unavailable')
  assert.equal((await resolveListLink(DB(), 'x')).status, 'invalid')
})

test('metro resolver: exact active metro by slug; unknown, inactive, destination and malformed slugs are unavailable or invalid', async () => {
  assert.equal((await resolveMetroLink(DB(), { slug: 'amalfi-coast' })).metro.id, AMA.id)
  assert.equal((await resolveMetroLink(DB(), { slug: 'FLORENCE' })).metro.id, FLR.id)
  assert.equal((await resolveMetroLink(DB(), { id: VIE.id.length ? 'ffffffff-0000-4000-8000-000000000001' : '' })).status, 'unavailable')
  for (const slug of ['positano', 'willcox', 'boulder', 'longmont', 'old-town']) {
    assert.equal((await resolveMetroLink(DB(), { slug })).status, 'unavailable', slug)
  }
  assert.equal((await resolveMetroLink(DB(), { slug: '../x' })).status, 'invalid')
  assert.equal((await resolveMetroLink(DB(), {})).status, 'invalid')
})

test('navigation plans: cold launch puts Home underneath, warm replaces, metro and home reset to Home, nothing is BrowseLists', async () => {
  const item = await resolveItemLink(DB(), ITEM)
  assert.deepEqual(planItemNavigation(item, { cold: true }).routes.map((r) => r.name), ['Home', 'ItemDetail'])
  assert.deepEqual(planItemNavigation(item, { cold: false }), { type: 'replace', name: 'ItemDetail', params: { item: item.item } })
  const list = await resolveListLink(DB(), LIST)
  assert.deepEqual(planListNavigation(list, { cold: true }).routes.map((r) => r.name), ['Home', 'List'])
  assert.deepEqual(planHomeNavigation().routes.map((r) => r.name), ['Home'])
  for (const p of [planItemNavigation(item, { cold: true }), planListNavigation(list, { cold: false }), planHomeNavigation()]) {
    assert.ok(!JSON.stringify(p).includes('BrowseLists'))
  }
})

// ── Explicit intent store ───────────────────────────────────────────────────
test('intent: set, get, clear, subscribe, and an intent set before metros load still maps to the metro', () => {
  const seen = []
  const off = subscribeExplicitMetro((i) => seen.push(i?.slug ?? null))
  setExplicitMetro(PHX, 'item_link')
  assert.equal(getExplicitMetro().slug, 'phoenix')
  assert.equal(metroForIntent(getExplicitMetro(), []), null) // metros not loaded yet
  assert.equal(metroForIntent(getExplicitMetro(), METROS).id, PHX.id)
  clearExplicitMetro('manual'); assert.equal(getExplicitMetro(), null)
  assert.deepEqual(seen, ['phoenix', null]); off()
  assert.equal(setExplicitMetro({}), null) // nothing usable: no intent created
})

// ── Metro precedence: the explicit destination wins in every case ───────────
test('precedence: explicit link beats a persisted choice, a ready in-boundary location, and the nearest metro', () => {
  const nearAmalfi = { latitude: 40.63, longitude: 14.6 }
  const r = resolveHomeMetro({ persistedSlug: 'florence', metros: METROS, location: nearAmalfi, locationState: 'ready', explicitLinkMetro: PHX })
  assert.deepEqual([r.metro.slug, r.reason], ['phoenix', 'explicit_link'])
})

test('cross metro: browsing Amalfi Coast, tapping a Phoenix item -> Phoenix', async () => {
  const item = await resolveItemLink(DB(), ITEM)
  setExplicitMetro(item.metro, 'item_link')
  const r = resolveHomeMetro({ persistedSlug: 'amalfi-coast', metros: METROS, location: { latitude: 40.63, longitude: 14.6 }, locationState: 'ready', explicitLinkMetro: getExplicitMetro() })
  assert.equal(r.metro.slug, 'phoenix')
})

test('cross metro: physically near Florence, tapping the Amalfi Coast metro link -> Amalfi Coast', async () => {
  const m = await resolveMetroLink(DB(), { slug: 'amalfi-coast' })
  setExplicitMetro(m.metro, 'metro_link')
  const nearFlorence = { latitude: 43.77, longitude: 11.25 }
  assert.equal(nearestMetroWithinBoundary(nearFlorence, METROS).slug, 'florence')
  const r = resolveHomeMetro({ persistedSlug: 'florence', metros: METROS, location: nearFlorence, locationState: 'ready', explicitLinkMetro: getExplicitMetro() })
  assert.equal(r.metro.slug, 'amalfi-coast')
})

test('cross metro: in Phoenix, tapping a Munich list -> Munich', async () => {
  const list = await resolveListLink(DB(), LIST)
  setExplicitMetro(list.metro, 'list_link')
  const r = resolveHomeMetro({ persistedSlug: 'phoenix', metros: METROS, location: { latitude: 33.45, longitude: -112.07 }, locationState: 'ready', explicitLinkMetro: getExplicitMetro() })
  assert.equal(r.metro.slug, 'munich')
})

test('location refresh while an explicit link is resolving never replaces it', () => {
  setExplicitMetro(PHX, 'item_link')
  // the foreground effect sees a location that moved to a different nearest metro
  const adopt = shouldAdoptNearestMetro({ explicitLinkMetro: getExplicitMetro(), nearest: FLR, selectedMetro: PHX, nearestChanged: true })
  assert.equal(adopt, false)
  // after a manual Switch City (which clears the intent) the pre existing behavior resumes unchanged
  clearExplicitMetro('manual')
  assert.equal(shouldAdoptNearestMetro({ explicitLinkMetro: getExplicitMetro(), nearest: FLR, selectedMetro: PHX, nearestChanged: true }), true)
  assert.equal(shouldAdoptNearestMetro({ explicitLinkMetro: null, nearest: PHX, selectedMetro: PHX, nearestChanged: true }), false)
  assert.equal(shouldAdoptNearestMetro({ explicitLinkMetro: null, nearest: FLR, selectedMetro: PHX, nearestChanged: false }), false)
})

test('cold launch, warm launch and auth hydration: the same intent resolves identically, repeated handling is idempotent', async () => {
  const item = await resolveItemLink(DB(), ITEM)
  const calls = []
  subscribeExplicitMetro((i) => calls.push(i.slug))
  setExplicitMetro(item.metro, 'item_link'); setExplicitMetro(item.metro, 'item_link') // link handled twice
  const once = resolveHomeMetro({ persistedSlug: null, metros: METROS, location: null, locationState: 'pending', explicitLinkMetro: getExplicitMetro() })
  const hydrated = resolveHomeMetro({ persistedSlug: 'florence', metros: METROS, location: null, locationState: 'unavailable', explicitLinkMetro: getExplicitMetro() })
  assert.equal(once.metro.slug, 'phoenix'); assert.equal(hydrated.metro.slug, 'phoenix')
  assert.equal(once.reason, 'explicit_link')
  assert.ok(calls.length >= 1 && calls.every((s) => s === 'phoenix'))
})

test('an unknown or inactive intent falls through to the normal precedence (never selects an invented metro)', () => {
  const r = resolveHomeMetro({ persistedSlug: 'florence', metros: METROS, location: null, locationState: 'unavailable', explicitLinkMetro: { id: 'x', slug: 'old-town' } })
  assert.deepEqual([r.metro.slug, r.reason], ['florence', 'explicit'])
})

test('Naples is outside every metro boundary, so Florence could only come from a persisted choice, not from nearest', () => {
  const naples = { latitude: 40.8518, longitude: 14.2681 }
  assert.equal(nearestMetroWithinBoundary(naples, METROS), null) // Amalfi Coast claims only 12 km
  const r = resolveHomeMetro({ persistedSlug: 'florence', metros: METROS, location: naples, locationState: 'ready' })
  assert.deepEqual([r.metro.slug, r.reason], ['florence', 'explicit'])
})
