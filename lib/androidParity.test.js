// Android parity for the iOS 1.1.10 metro contract and App Links (release/android-1.1.10-parity).
// Everything here is deterministic: fixed coordinates, fixed clock, fake Supabase. Run with:
//   node --test lib/androidParity.test.js
//
// Android lifecycle mapping used below:
//   process restart       = the JS runtime is new: every module level variable (the link intent) is gone and only
//                           AsyncStorage survives                -> __resetExplicitMetroForTests() + persisted record
//   Activity recreation   = rotation / theme / locale: the JS runtime and the module state survive
//   warm resume           = background -> foreground in the same process
//   cold link             = the VIEW intent launches a killed app: the resolver is the only route (plan type 'reset')
//   warm link             = the VIEW intent arrives while the app runs: the resolver replaces itself (plan type 'replace')
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import {
  setExplicitMetro, getExplicitMetro, getActiveExplicitMetro, stampExplicitMetroOrigin, clearExplicitMetro, shouldClearExactLinkIntent, __resetExplicitMetroForTests,
} from './explicitMetroIntent.js'
import { resolveMetroChoice, reconcileHomeMetroState, normalizePersistedMetro, deriveHomeMetroContext, METRO_PROVENANCE as P, HOME_METRO_KIND } from './homeMetroContext.js'
import { nearestMetroByCoords, nearestMetroWithinBoundary } from './metroSelection.js'
import { shouldPreserveSession, describeSessionPreservationDecision, BACKGROUND_PRESERVE_MS_DEFAULT, SHORT_INTERRUPTION_MAX_MOVE_M } from './whatsGoodSessionCache.js'
import { createLocationStore } from './locationFreshness.js'
import { seasonTimeLeftLabel } from './seasonCountdown.js'
import { COVERAGE_MODE, deriveCoverageMode } from './whatsGoodCoverageMode.js'
import { parseEmailLink, normalizeLinkPath, itemUrl, listUrl, metroUrl, homeUrl, appSchemeUrl } from './emailLinkContract.js'
import { LINK_PREFIXES, LINKING_CONFIG } from './linkingConfig.js'
import { resolveItemLink, resolveListLink, resolveMetroLink, planItemNavigation, planListNavigation, planHomeNavigation } from './linkResolution.js'
import { isVisitRecoveryPlatformSupported, recoveryCardState } from './visitDetection/recoveryPolicy.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo
const require = createRequire(import.meta.url)
const { getStateFromPath } = require('@react-navigation/core')

const M = (id, slug, name, lat, lng, r = null) => ({ id, slug, name, center_lat: lat, center_lng: lng, boundary_radius_km: r, is_active: true })
const AMALFI = M('amalfi-id', 'amalfi-coast', 'Amalfi Coast', 40.634, 14.602, 12)
const PHOENIX = M('phoenix-id', 'phoenix', 'Phoenix Metro', 33.4484, -112.074)
const MILWAUKEE = M('milwaukee-id', 'milwaukee', 'Milwaukee Metro', 43.0389, -87.9065)
const GREEN_BAY = M('green-bay-id', 'green-bay', 'Green Bay Metro', 44.5192, -88.0198)
const MUNICH = M('munich-id', 'munich', 'Munich Metro', 48.1351, 11.582)
const METROS = [AMALFI, GREEN_BAY, MILWAUKEE, MUNICH, PHOENIX]
const NYC = { latitude: 40.7647, longitude: -73.9776 }
const IN_PHOENIX = { latitude: 33.45, longitude: -112.07 }
const T0 = Date.UTC(2026, 9, 2, 8, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN

const ITEM = '2f6c0f6e-8a4b-4c8e-9a53-0b4a1d9e7c11'
const LIST = '7d1b2c3a-1111-4222-8333-444455556666'

function fakeSb(tables) {
  return {
    from(table) {
      const filters = []
      const q = {
        select() { return q },
        eq(c, v) { filters.push([c, v]); return q },
        maybeSingle() { const r = (tables[table] ?? []).filter((x) => filters.every(([c, v]) => x[c] === v)); return Promise.resolve({ data: r[0] ?? null, error: null }) },
      }
      return q
    },
  }
}

// ── 1. The shared implementation has no iOS-only or native-only dependency ──────────────────────────────────────
test('shared metro / cache / link modules import nothing from react-native, expo or an iOS API', () => {
  for (const f of ['homeMetroContext', 'explicitMetroIntent', 'metroSelection', 'whatsGoodSessionCache', 'seasonCountdown', 'locationFreshness', 'unsupportedLocationCard', 'emailLinkContract', 'linkResolution', 'linkingConfig']) {
    const src = readFileSync(join(here, `${f}.js`), 'utf8')
    const imports = [...src.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    for (const i of imports) assert.ok(i.startsWith('.'), `${f}.js imports ${i}`)
    assert.ok(!/Platform\.OS|NativeModules|UIKit|CLLocationManager/.test(src), `${f}.js has a platform check`)
  }
})

test('Home persists the metro choice through AsyncStorage only (cross-platform), with no iOS-only storage', () => {
  const src = readFileSync(join(here, '../screens/HomeScreen.jsx'), 'utf8')
  assert.ok(src.includes("from '@react-native-async-storage/async-storage'"))
  assert.ok(!/NSUserDefaults|Keychain|SecureStore/.test(src))
})

// ── 2. Metro contract on Android lifecycles ────────────────────────────────────────────────────────────────────
function resolveCold({ location, locationState = location ? 'ready' : 'unavailable', persisted = null, now = T0 }) {
  return resolveMetroChoice({ metros: METROS, location, locationState, activeIntent: getActiveExplicitMetro({ location, resumed: true, now }), persisted })
}

test('NYC selects Milwaukee as NEAREST from the metro coordinates, on process restart', () => {
  __resetExplicitMetroForTests()
  const r = resolveCold({ location: NYC })
  assert.equal(r.metro.slug, 'milwaukee')
  assert.equal(r.provenance, P.NEAREST)
  assert.equal(nearestMetroByCoords(NYC, METROS.filter((m) => m.slug !== 'milwaukee')).slug, 'green-bay', 'calculated, not hard-coded')
})

test('NYC with a manual Amalfi choice stays Amalfi with BROWSING; unsupported coverage stays unsupported', () => {
  __resetExplicitMetroForTests()
  const r = resolveCold({ location: NYC, persisted: { slug: 'amalfi-coast', source: 'manual' } })
  assert.equal(r.metro.id, AMALFI.id)
  assert.equal(r.provenance, P.MANUAL)
  const ctx = deriveHomeMetroContext({ selectedMetro: AMALFI, physicalMetro: null, hasLiveLocation: true, provenance: r.provenance })
  assert.deepEqual([ctx.kind, ctx.badge, ctx.showUnsupportedNotice], [HOME_METRO_KIND.BROWSING_UNSUPPORTED_LOCATION, 'BROWSING', true])
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 0, targetCount: 3, hasExplicitSelection: true }), COVERAGE_MODE.UNSUPPORTED)
})

test('process restart drops the in-memory link intent and keeps only the tagged persisted record; link tags are never persisted', () => {
  setExplicitMetro(PHOENIX, 'item_link', T0)
  assert.ok(getExplicitMetro())
  __resetExplicitMetroForTests() // the process died
  assert.equal(getExplicitMetro(), null)
  assert.equal(resolveCold({ location: NYC }).provenance, P.NEAREST)
  assert.deepEqual(normalizePersistedMetro({ slug: 'phoenix', source: 'link' }), { record: null, legacy: true })
})

test('Activity recreation (same process) keeps an active exact link intent; the next resume past an hour drops it', () => {
  __resetExplicitMetroForTests()
  setExplicitMetro(PHOENIX, 'metro_link', T0)
  stampExplicitMetroOrigin(NYC)
  // Activity recreated 2 minutes later: module state intact, still Phoenix.
  assert.equal(resolveCold({ location: NYC, now: T0 + 2 * MIN }).provenance, P.LINK)
  // Resume after 90 minutes: expired, resolves to the nearest metro.
  const after = resolveCold({ location: NYC, now: T0 + 90 * MIN })
  assert.equal(after.metro.slug, 'milwaukee')
  assert.equal(getExplicitMetro(), null)
})

test('exact Phoenix item and list opened in NYC keep Phoenix for the flow, then Home re-resolves to the nearest metro on return', () => {
  for (const source of ['item_link', 'list_link']) {
    __resetExplicitMetroForTests()
    setExplicitMetro(PHOENIX, source, T0)
    const during = reconcileHomeMetroState({ metros: METROS, selectedMetro: PHOENIX, provenance: P.LINK, lastPhysicalMetroId: null, activeIntent: getActiveExplicitMetro({ location: NYC, now: T0 + MIN }), location: NYC, persisted: null })
    assert.equal(during.action, 'keep')
    // Home regains focus after the flow closed.
    assert.equal(shouldClearExactLinkIntent(getExplicitMetro(), { previousFocusAt: T0 - MIN, lastBlurAt: T0 + 100 }), true)
    clearExplicitMetro('flow-closed')
    const back = reconcileHomeMetroState({ metros: METROS, selectedMetro: PHOENIX, provenance: P.LINK, lastPhysicalMetroId: null, activeIntent: null, location: NYC, persisted: null })
    assert.equal(back.selectedMetro.slug, 'milwaukee')
    assert.equal(back.provenance, P.NEAREST)
  }
})

test('a Phoenix metro link stays through a link return and a warm resume under an hour', () => {
  __resetExplicitMetroForTests()
  setExplicitMetro(PHOENIX, 'metro_link', T0)
  assert.equal(shouldClearExactLinkIntent(getExplicitMetro(), { previousFocusAt: T0 - MIN, lastBlurAt: T0 + 100 }), false)
  assert.equal(getActiveExplicitMetro({ resumed: true, now: T0 + 30 * MIN }).slug, 'phoenix')
})

test('physical arrival in Phoenix (warm resume) replaces nearest and manual choices; no BROWSING badge', () => {
  __resetExplicitMetroForTests()
  for (const [selected, provenance] of [[MILWAUKEE, P.NEAREST], [AMALFI, P.MANUAL]]) {
    const r = reconcileHomeMetroState({ metros: METROS, selectedMetro: selected, provenance, lastPhysicalMetroId: null, activeIntent: null, location: IN_PHOENIX, persisted: provenance === P.MANUAL ? { slug: 'amalfi-coast', source: 'manual' } : null })
    assert.equal(r.selectedMetro.id, PHOENIX.id)
    assert.equal(r.provenance, P.PHYSICAL)
    const ctx = deriveHomeMetroContext({ selectedMetro: PHOENIX, physicalMetro: nearestMetroWithinBoundary(IN_PHOENIX, METROS), hasLiveLocation: true, provenance: r.provenance })
    assert.deepEqual([ctx.kind, ctx.badge], [HOME_METRO_KIND.LOCAL, null])
  }
})

test('legacy untagged metro state is normalized once on Android too', () => {
  assert.deepEqual(normalizePersistedMetro({ slug: 'amalfi-coast', source: undefined }), { record: null, legacy: true })
  assert.equal(resolveCold({ location: NYC, persisted: normalizePersistedMetro({ slug: 'amalfi-coast', source: null }).record }).metro.slug, 'milwaukee')
})

// ── 3. Location permission matrix (Android) ────────────────────────────────────────────────────────────────────
test('approximate location (about 2 km of coarse offset) resolves the same metro and the same coverage as precise', () => {
  const coarse = [{ latitude: NYC.latitude + 0.018, longitude: NYC.longitude }, { latitude: NYC.latitude, longitude: NYC.longitude - 0.024 }]
  for (const loc of [NYC, ...coarse]) assert.equal(resolveCold({ location: loc }).metro.slug, 'milwaukee')
  const phxCoarse = { latitude: IN_PHOENIX.latitude + 0.02, longitude: IN_PHOENIX.longitude + 0.02 }
  assert.equal(resolveCold({ location: phxCoarse }).provenance, P.PHYSICAL)
})

test('location denied, services disabled or no fix: last automatic choice is kept; with none, the city picker; a manual choice is honored', () => {
  __resetExplicitMetroForTests()
  assert.equal(resolveCold({ location: null, persisted: { slug: 'milwaukee', source: 'nearest' } }).reason, 'last-known')
  assert.equal(resolveCold({ location: null, persisted: null }).reason, 'needs_selection')
  const manual = resolveCold({ location: null, persisted: { slug: 'amalfi-coast', source: 'manual' } })
  assert.deepEqual([manual.metro.id, manual.provenance], [AMALFI.id, P.MANUAL])
  const ctx = deriveHomeMetroContext({ selectedMetro: AMALFI, physicalMetro: null, hasLiveLocation: false, provenance: P.MANUAL })
  assert.deepEqual([ctx.kind, ctx.badge, ctx.showUnsupportedNotice], [HOME_METRO_KIND.LOCATION_UNKNOWN, null, false])
})

test('permission revoked later: the store keeps the last fix, and reconcile does not move a selection without a location', async () => {
  const store = createLocationStore({ initialState: { coords: NYC, lastFetchedAt: 1000 } })
  const snap = await store.requestFreshLocation({ force: false, deviceFetch: async () => null, now: 1000 + 9 * HOUR })
  assert.deepEqual(snap.coords, NYC)
  const r = reconcileHomeMetroState({ metros: METROS, selectedMetro: MILWAUKEE, provenance: P.NEAREST, lastPhysicalMetroId: null, activeIntent: null, location: null, persisted: null })
  assert.equal(r.action, 'keep')
})

test('stale cached coordinates are replaced on warm resume after travel (staleness policy), and a large move between launches re-resolves', async () => {
  const store = createLocationStore({ initialState: { coords: AMALFI && { latitude: 40.63, longitude: 14.48 }, lastFetchedAt: 1000 } })
  const snap = await store.requestFreshLocation({ force: false, deviceFetch: async () => NYC, now: 1000 + 12 * HOUR })
  assert.deepEqual(snap.coords, NYC)
  assert.equal(resolveCold({ location: snap.coords, persisted: { slug: 'amalfi-coast', source: 'physical' } }).metro.slug, 'milwaukee')
})

// ── 4. Cache protections ───────────────────────────────────────────────────────────────────────────────────────
const NOW = new Date(T0)
const sess = (o = {}) => ({ schemaVersion: 2, itemIds: ['a', 'b', 'c'], generatedAt: NOW, fingerprint: 'fp', location: { latitude: 40.628, longitude: 14.485 }, resolvedMetroId: AMALFI.id, coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT, ...o })

test('cache: 5 minute age and 2 km movement limits hold; expired and distant sessions recompute', () => {
  const at = (ms) => new Date(T0 + ms)
  assert.equal(BACKGROUND_PRESERVE_MS_DEFAULT, 5 * MIN)
  assert.equal(SHORT_INTERRUPTION_MAX_MOVE_M, 2000)
  const here0 = sess().location
  assert.equal(shouldPreserveSession(sess(), { now: at(4 * MIN), currentFingerprint: 'x', currentLocation: here0, currentMetroId: AMALFI.id }), true)
  assert.equal(shouldPreserveSession(sess(), { now: at(6 * MIN), currentFingerprint: 'x', currentLocation: here0, currentMetroId: AMALFI.id }), false)
  assert.equal(describeSessionPreservationDecision(sess(), { now: at(MIN), currentFingerprint: 'fp', currentLocation: NYC, currentMetroId: AMALFI.id }).reason, 'location-moved-beyond-radius')
  const drove = { latitude: here0.latitude + 0.1, longitude: here0.longitude }
  assert.equal(shouldPreserveSession(sess(), { now: at(MIN), currentFingerprint: 'zz', currentLocation: drove, currentMetroId: AMALFI.id }), false)
})

// ── 5. Positano ────────────────────────────────────────────────────────────────────────────────────────────────
test('Positano open-ended lists (and the old 2027-12-31 placeholder) show no countdown', () => {
  const now = new Date(2026, 9, 2, 12)
  assert.equal(seasonTimeLeftLabel(null, now), null)
  assert.equal(seasonTimeLeftLabel('2027-12-31', now), null)
  assert.equal(seasonTimeLeftLabel('2026-11-30', now), '59 days left')
})

// ── 6. Android App Links: generated config, filters and navigation ─────────────────────────────────────────────
const filters = app.android.intentFilters
const httpsData = filters.flatMap((f) => f.data).filter((d) => d.scheme === 'https')

function coveredByFilter(url) {
  const u = new URL(url)
  return httpsData.some((d) => d.host === u.hostname && u.pathname.startsWith(d.pathPrefix))
}

test('every canonical and legacy https link form is covered by a verified filter; no filter is broader than needed', () => {
  const urls = [homeUrl(), itemUrl(ITEM), listUrl(LIST), metroUrl('phoenix'),
    `https://getcheckoff.com/item?id=${ITEM}`, `https://getcheckoff.com/list/${LIST}`, `https://getcheckoff.com/metro/phoenix`, 'https://getcheckoff.com/open?x=1']
  for (const u of urls) assert.ok(coveredByFilter(u), u)
  assert.equal(app.android.package, 'com.getcheckoff.app')
  for (const f of filters) {
    assert.equal(f.autoVerify, true)
    assert.equal(f.action, 'VIEW')
    assert.deepEqual([...f.category].sort(), ['BROWSABLE', 'DEFAULT'])
  }
  for (const d of httpsData) {
    assert.equal(d.host, 'getcheckoff.com')
    assert.notEqual(d.pathPrefix, '/', 'no catch-all path prefix')
    assert.ok(d.pathPrefix.length > 1)
  }
  assert.deepEqual(httpsData.map((d) => d.pathPrefix).sort(), ['/auth/confirm', '/item', '/join', '/list', '/metro', '/open', '/reset-password'])
  assert.equal(app.scheme, 'checkoff', 'checkoff:// custom scheme is registered by Expo for the legacy button')
})

test('www.getcheckoff.com is a React Navigation prefix but NOT an App Link host (no filter, so it opens in the browser)', () => {
  assert.ok(LINK_PREFIXES.includes('https://www.getcheckoff.com'))
  assert.ok(!httpsData.some((d) => d.host === 'www.getcheckoff.com'))
})

test('legacy URL translation: every accepted form normalizes to one route and parses to the same state', () => {
  const forms = {
    item: [itemUrl(ITEM), `https://getcheckoff.com/item?id=${ITEM}`, `checkoff://item/${ITEM}`, appSchemeUrl({ type: 'item', id: ITEM })],
    list: [listUrl(LIST), `https://getcheckoff.com/list/${LIST}`, `checkoff://list?id=${LIST}`],
    metro: [metroUrl('phoenix'), 'https://getcheckoff.com/metro/phoenix', 'checkoff://metro?slug=phoenix'],
  }
  for (const [type, urls] of Object.entries(forms)) {
    for (const u of urls) {
      assert.equal(parseEmailLink(u).type, type, u)
      const state = getStateFromPath(normalizeLinkPath(u.replace(/^(https:\/\/getcheckoff\.com|checkoff:\/\/)\/?/, '')), LINKING_CONFIG)
      assert.ok(state, u)
    }
  }
  assert.equal(parseEmailLink('https://getcheckoff.com/open').type, 'home')
  assert.equal(parseEmailLink('https://evil.example/item/' + ITEM).type, 'invalid')
})

test('cold link (killed app) puts Home under the destination; warm link replaces the resolver; metro and home links land on Home', () => {
  const item = { status: 'ok', item: { id: ITEM }, metro: PHOENIX }
  assert.deepEqual(planItemNavigation(item, { cold: true }).routes.map((r) => r.name), ['Home', 'ItemDetail'])
  assert.equal(planItemNavigation(item, { cold: false }).type, 'replace')
  const list = { status: 'ok', kind: 'list', list: { id: LIST, title: 'Fall 30' }, metro: PHOENIX }
  assert.deepEqual(planListNavigation(list, { cold: true }).routes.map((r) => r.name), ['Home', 'List'])
  assert.equal(planListNavigation(list, { cold: false }).type, 'replace')
  assert.deepEqual(planHomeNavigation().routes.map((r) => r.name), ['Home'])
})

test('invalid or inactive entities give a controlled unavailable state, never a silent Home or Browse Lists', async () => {
  const sb = fakeSb({
    items: [{ id: ITEM, is_active: false, is_approved: true }],
    lists: [{ id: LIST, is_public: false }],
    metro_areas: [{ id: PHOENIX.id, slug: 'phoenix', is_active: false }],
  })
  assert.deepEqual(await resolveItemLink(sb, 'not-a-uuid'), { status: 'invalid' })
  assert.deepEqual(await resolveItemLink(sb, ITEM), { status: 'unavailable' })
  assert.deepEqual(await resolveListLink(sb, LIST), { status: 'unavailable' })
  assert.deepEqual(await resolveListLink(sb, 'nope'), { status: 'invalid' })
  assert.deepEqual(await resolveMetroLink(sb, { slug: 'phoenix' }), { status: 'unavailable' })
  assert.deepEqual(await resolveMetroLink(sb, { slug: 'BAD SLUG!' }), { status: 'invalid' })
})

// ── 7. Android permissions and iOS-only capabilities ──────────────────────────────────────────────────────────
test('Android 1.1.10 (versionCode 19 and later) adds background location for geofenced visit recovery, with no foreground service', () => {
  assert.deepEqual([...app.android.permissions].sort(), ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS'])
  const loc = app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location')[1]
  assert.equal(loc.isAndroidBackgroundLocationEnabled, true, 'adds ACCESS_BACKGROUND_LOCATION (geofencing)')
  assert.equal(loc.isAndroidForegroundServiceEnabled, false, 'no FOREGROUND_SERVICE / FOREGROUND_SERVICE_LOCATION: Play services geofencing needs none')
  assert.ok(!('versionCode' in app.android), 'versionCode is owned by EAS remote versioning')
})

test('visit recovery on Android is granted per native runtime: an old binary (no background permission) never runs or shows it', () => {
  assert.equal(isVisitRecoveryPlatformSupported('android', '56c5f2cd23878dd4083475b052989216e4c3ae11'), false)
  assert.equal(isVisitRecoveryPlatformSupported('android'), false)
  assert.equal(isVisitRecoveryPlatformSupported('ios'), true)
  assert.equal(recoveryCardState({ flagEnabled: true, platformOS: 'android', runtimeVersion: '56c5f2cd23878dd4083475b052989216e4c3ae11', optedIn: false, backgroundGranted: false }), 'hidden')
  assert.equal(recoveryCardState({ flagEnabled: true, platformOS: 'android', runtimeVersion: '56c5f2cd23878dd4083475b052989216e4c3ae11', optedIn: true, backgroundGranted: true }), 'hidden')
  assert.equal(recoveryCardState({ flagEnabled: true, platformOS: 'ios', optedIn: true, backgroundGranted: true }), 'on')
  const home = readFileSync(join(here, '../components/home/VisitRecoveryHeaderIcon.jsx'), 'utf8')
  assert.ok(home.includes('if (!supported || !userId || !loaded || !resolved.visible) return null'))
})

test('the iOS-only native movement module is an Apple platform module and is optional in JS, so Android builds and runs without it', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'modules/checkoff-movement/expo-module.config.json'), 'utf8'))
  assert.deepEqual(cfg.platforms, ['apple'])
  assert.ok(readFileSync(join(here, 'visitDetection/movementNative.js'), 'utf8').includes('requireOptionalNativeModule'))
})
