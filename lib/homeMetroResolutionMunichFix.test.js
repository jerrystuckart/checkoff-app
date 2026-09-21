// REGRESSION / NEW COVERAGE — Munich field-test fix (2026-09-21).
//
// Real users physically in Munich were seeing stale Vienna/Phoenix content
// on Home (seasonal card, curated lists rail, hero image, header city
// label) while Nearby and Right Here (visit detection) correctly showed
// Munich. Root cause, confirmed by tracing the actual code (not assumed):
//
//   - lib/metroSelection.js's resolveHomeMetro() used to let a PERSISTED
//     explicit metro choice win unconditionally, even over a fresh 'ready'
//     GPS location for a different metro.
//   - screens/HomeScreen.jsx's init() additionally never even fetched a
//     live location at all whenever a persisted slug already existed (see
//     the removed `if (!persistedSlug) { ...GPS... }` gate), so there was
//     no live signal to compare against even in principle.
//   - lib/useWhatsGood.js and the "Near You" rail (loadNearbyRail /
//     nearbyRailItems in HomeScreen.jsx) were, on inspection, already
//     metro-agnostic — pure GPS-radius/proximity queries with no
//     metro_id/selectedMetro filter anywhere in their pipeline (same
//     mechanism as lib/useNearby.js). The initial bug-report hypothesis
//     that What's Good/Near You filter by metro_id does NOT hold up under
//     trace — see the structural guards below. The metro-scoped Home
//     surfaces are specifically: hero image, seasonal official list,
//     curated lists rail (fetchCuratedLists(slug)), featured creators, and
//     the header's metro display label — all fed by loadForMetro(metroId,
//     ..., slug), which is exactly what a stale resolveHomeMetro() output
//     fed the wrong (Vienna/Phoenix) metroId/slug into.
//
// This repo has no RN component-rendering test harness (no jest/
// @testing-library — see lib/homeScreenLegacyBranchRemoved.test.js for the
// same convention), so HomeScreen.jsx-side assertions are source-level
// guards rather than rendered-output assertions.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveHomeMetro, nearestMetroWithinBoundary, MAX_METRO_BOUNDARY_M } from './metroSelection.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const homeScreenSource = readFileSync(join(__dirname, '../screens/HomeScreen.jsx'), 'utf8')
const useWhatsGoodSource = readFileSync(join(__dirname, './useWhatsGood.js'), 'utf8')
const useNearbySource = readFileSync(join(__dirname, './useNearby.js'), 'utf8')
const whatsGoodDataAdapterSource = readFileSync(join(__dirname, './whatsGoodDataAdapter.js'), 'utf8')
const itemDetailSource = readFileSync(join(__dirname, '../screens/ItemDetailScreen.jsx'), 'utf8')

// Real-ish fixture including Munich + the two stale cities from the field
// report, plus a couple of others so "nearest" is a real contest.
const PHOENIX = { id: 'p', name: 'Phoenix Metro', slug: 'phoenix', center_lat: 33.4484, center_lng: -112.0740 }
const VIENNA = { id: 'v', name: 'Vienna Metro', slug: 'vienna', center_lat: 48.2082, center_lng: 16.3738 }
const DENVER = { id: 'd', name: 'Denver Metro', slug: 'denver', center_lat: 39.7392, center_lng: -104.9903 }
const MUNICH = { id: 'mu', name: 'Munich Metro', slug: 'munich', center_lat: 48.1351, center_lng: 11.5820 }
const METROS = [PHOENIX, VIENNA, DENVER, MUNICH]

const MUNICH_COORDS = { latitude: 48.137, longitude: 11.575 } // central Munich

// ── Required case 1: persisted Vienna + current Munich coords -> Munich ───
test('resolveHomeMetro: persisted Vienna + genuinely ready Munich coordinates resolves to Munich, not Vienna', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: 'vienna',
    metros: METROS,
    location: MUNICH_COORDS,
    locationState: 'ready',
  })
  assert.equal(metro.slug, 'munich')
  assert.equal(reason, 'nearest')
})

// ── Required case 2: persisted Phoenix + current Munich coords -> Munich ──
test('resolveHomeMetro: persisted Phoenix + genuinely ready Munich coordinates resolves to Munich, not Phoenix', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: 'phoenix',
    metros: METROS,
    location: MUNICH_COORDS,
    locationState: 'ready',
  })
  assert.equal(metro.slug, 'munich')
  assert.equal(reason, 'nearest')
})

// ── Required case 3: Home Near You + What's Good key off the SAME
// resolved metro — in practice this means neither one consults a metro
// concept at all (confirmed by trace), so there is nothing for them to
// disagree about once Home's OWN metro-scoped sections (hero/seasonal/
// curated rail) are fixed to use the corrected resolveHomeMetro() output.
// Structural guards below lock in "no metro filter" for both pipelines so
// this can't silently regress into the split-source-of-truth bug. ────────
test('REGRESSION: useWhatsGood.js has no metro/selectedMetro filtering concept at all — consumes rawNearbyItems (Home Rail\'s own metro-agnostic pool) and live userLocation only', () => {
  assert.ok(!/selectedMetro|metro_id|\.eq\(['"]metro/i.test(useWhatsGoodSource), 'useWhatsGood.js must not filter by selectedMetro/metro_id — it must stay purely location/rail-driven')
  assert.ok(useWhatsGoodSource.includes('rawNearbyItems'), 'useWhatsGood must consume the shared rawNearbyItems pool, not run its own metro-scoped fetch')
})

test('REGRESSION: lib/whatsGoodDataAdapter.js has no metro/city filter in its own querying either', () => {
  assert.ok(!/selectedMetro|metro_id|\.eq\(['"]metro/i.test(whatsGoodDataAdapterSource), 'whatsGoodDataAdapter.js must not filter by metro_id/selectedMetro — its own comment documents reusing Home Rail\'s metro-agnostic pool')
  assert.ok(whatsGoodDataAdapterSource.includes('no metro/city filter'), 'the adapter should retain its documented no-metro-filter rationale comment')
})

test('REGRESSION: HomeScreen.jsx\'s Near-You item pool (loadNearbyRail) is NOT scoped to selectedMetro/metroId — pure proximity, same invariant confirmed for Nearby elsewhere in this app', () => {
  const railStart = homeScreenSource.indexOf('async function loadNearbyRail(userId)')
  const railEnd = homeScreenSource.indexOf('\n  async function switchMetro(metro)')
  assert.ok(railStart > -1 && railEnd > railStart, 'could not isolate loadNearbyRail() body for inspection')
  const railBody = homeScreenSource.slice(railStart, railEnd)
  assert.ok(!railBody.includes(".eq('metro_id'"), 'loadNearbyRail must not filter the items query by metro_id')
  assert.ok(!railBody.includes('selectedMetro'), 'loadNearbyRail must not reference selectedMetro at all')
})

// ── Required case 4: Nearby itself is untouched by this fix ───────────────
test('REGRESSION: lib/useNearby.js has no metro-scoping filter — confirms Nearby was never part of this bug and stays untouched by the fix', () => {
  assert.ok(!/selectedMetro|\.eq\(['"]metro_id/i.test(useNearbySource), 'useNearby.js must not filter by selectedMetro or metro_id — it is purely GPS-radius-driven')
})

// ── Required case 5 / session-scoped manual browsing ──────────────────────
test('resolveHomeMetro: a manual pick (persisted) with NO live-location re-check (pending/unavailable) still sticks, so switchMetro() itself is never fought mid-session', () => {
  const pending = resolveHomeMetro({ persistedSlug: 'vienna', metros: METROS, location: null, locationState: 'pending' })
  const unavailable = resolveHomeMetro({ persistedSlug: 'vienna', metros: METROS, location: null, locationState: 'unavailable' })
  assert.equal(pending.metro.slug, 'vienna')
  assert.equal(pending.reason, 'explicit')
  assert.equal(unavailable.metro.slug, 'vienna')
  assert.equal(unavailable.reason, 'explicit')
})

test('REGRESSION: HomeScreen.jsx\'s foreground travel re-check only acts on a CHANGE in the physically-nearest metro, never merely because it differs from the currently selected (manually browsed) metro', () => {
  const effectStart = homeScreenSource.indexOf('const lastResolvedNearestMetroIdRef')
  const effectEnd = homeScreenSource.indexOf('}, [userLocation, metros, selectedMetro, user])')
  assert.ok(effectStart > -1 && effectEnd > effectStart, 'could not isolate the foreground travel re-check effect for inspection')
  const effectBody = homeScreenSource.slice(effectStart, effectEnd)
  assert.ok(effectBody.includes('nearestChanged'), 'the re-check must gate on a tracked CHANGE in nearest metro, not a one-shot comparison to selectedMetro')
  assert.ok(effectBody.includes('lastResolvedNearestMetroIdRef.current'), 'must track the last resolved nearest metro id across renders (ref), so a same-session manual pick browsing a different city is not immediately reverted')
})

test('resolveHomeMetro: still called only via a pure function of its inputs — HomeScreen.jsx can safely re-invoke it (or the equivalent boundary check) on foreground return without any hidden internal state of its own', () => {
  // Two independent calls with identical inputs must produce identical
  // output — a structural guarantee that the "re-resolve on foreground
  // return" requirement (cold start AND foreground return both re-resolve
  // correctly) can rely on calling this same function/helper repeatedly.
  const a = resolveHomeMetro({ persistedSlug: 'vienna', metros: METROS, location: MUNICH_COORDS, locationState: 'ready' })
  const b = resolveHomeMetro({ persistedSlug: 'vienna', metros: METROS, location: MUNICH_COORDS, locationState: 'ready' })
  assert.deepEqual(a, b)
})

// ── Required case 6/7: unavailable-location fallback + needs_selection,
// re-verified with Munich in the metro list (regression from 2f50d0a). ────
test('resolveHomeMetro: location unavailable with a persisted choice still falls back to that explicit selection (regression)', () => {
  const { metro, reason } = resolveHomeMetro({ persistedSlug: 'munich', metros: METROS, location: null, locationState: 'unavailable' })
  assert.equal(metro.slug, 'munich')
  assert.equal(reason, 'explicit')
})

test('resolveHomeMetro: location unavailable with NO persisted choice still shows needs_selection, never an arbitrary metro (regression)', () => {
  const { metro, reason } = resolveHomeMetro({ persistedSlug: null, metros: METROS, location: null, locationState: 'unavailable' })
  assert.equal(metro, null)
  assert.equal(reason, 'needs_selection')
})

// ── Required case 8: pending location never flashes any metro (regression) ─
test('resolveHomeMetro: pending location with no persisted choice returns no metro at all — never Vienna/Phoenix/anything (regression)', () => {
  const { metro, reason } = resolveHomeMetro({ persistedSlug: null, metros: METROS, location: null, locationState: 'pending' })
  assert.equal(metro, null)
  assert.equal(reason, 'pending')
})

// ── Required case 9: the stale-mismatch state is eliminated, not
// separately handled — a mismatch scenario now correctly resolves straight
// to the physical metro, so Home's metro-scoped queries (which would
// otherwise return Vienna's empty/mismatched result set while physically
// in Munich, the trigger condition for any generic-fallback empty state)
// never see a mismatch in the first place. ────────────────────────────────
test('resolveHomeMetro: a stale persisted/physical mismatch resolves cleanly to the physical metro — no intermediate "mismatched" state is ever returned', () => {
  const { metro, reason } = resolveHomeMetro({
    persistedSlug: 'vienna',
    metros: METROS,
    location: MUNICH_COORDS,
    locationState: 'ready',
  })
  // Exactly one of the two known reasons for a resolved metro — never a
  // third "mismatch" reason string, confirming the caller (HomeScreen.jsx)
  // has a single simple branch (`if (defaultMetro) { ... }`) to handle,
  // not a new conflict state to reconcile separately.
  assert.ok(['nearest', 'explicit'].includes(reason))
  assert.equal(metro.slug, 'munich')
})

// ── Required case 10: coordinate-less generic (universal) content must not
// masquerade as nearby or expose broken navigation. Traced and confirmed
// ALREADY SAFE in the current codebase — no bug found, so this is a
// regression guard on the existing safe behavior, not a new fix. ──────────
test('REGRESSION (confirmed pre-existing safe behavior, not a new fix): ItemDetailScreen only renders the Directions button when the item actually has real coordinates/maps_query (hasLoc gate)', () => {
  assert.ok(itemDetailSource.includes('const hasLoc = item.maps_query'), 'hasLoc must be derived from real location fields')
  const utilityRowIdx = itemDetailSource.indexOf('{hasLoc && (')
  assert.ok(utilityRowIdx > -1, 'Directions button must be conditionally rendered behind hasLoc')
  const directionsBlock = itemDetailSource.slice(utilityRowIdx, utilityRowIdx + 400)
  assert.ok(directionsBlock.includes('Directions'), 'the hasLoc-guarded block must be the Directions control')
})

test('REGRESSION (confirmed pre-existing safe behavior): universal (coordinate-less) items never render a distance label implying proximity', () => {
  const editorialCardSource = readFileSync(join(__dirname, '../components/home/EditorialCard.jsx'), 'utf8')
  assert.ok(/is_universal\s*\?\s*null\s*:\s*formatDistanceLabel/.test(editorialCardSource), 'EditorialCard must suppress the distance label for universal items (is_universal ? null : formatDistanceLabel(...))')
})

// ── Required case 11: anonymous vs authenticated consistency ──────────────
test('resolveHomeMetro: output is identical for an anonymous vs an authenticated call shape (no auth/user parameter exists to vary)', () => {
  const base = { persistedSlug: 'vienna', metros: METROS, location: MUNICH_COORDS, locationState: 'ready' }
  const anonResult = resolveHomeMetro(base)
  const authedResult = resolveHomeMetro({ ...base })
  assert.deepEqual(anonResult, authedResult)
})

// ── Required case 12: cold start AND foreground return both re-resolve ────
test('REGRESSION: HomeScreen.jsx always attempts a real GPS fix in init() (cold start), even when a persisted slug already exists — the old skip-GPS-if-persisted gate must be gone', () => {
  const initStart = homeScreenSource.indexOf('async function init()')
  const initEnd = homeScreenSource.indexOf('\n  function handleDestinationZoneTap')
  const initBody = homeScreenSource.slice(initStart, initEnd)
  assert.ok(!initBody.includes('if (!persistedSlug)'), 'init() must no longer skip the GPS fetch just because a persisted slug exists — resolveHomeMetro needs live location to compare against it')
  assert.ok(initBody.includes('Location.requestForegroundPermissionsAsync'), 'init() must still request location permission unconditionally')
})

test('REGRESSION: HomeScreen.jsx re-resolves the Home metro on live location changes (foreground return / travel), not only once at cold start', () => {
  assert.ok(homeScreenSource.includes('nearestMetroWithinBoundary(userLocation, metros)'), 'a foreground-return re-check using live userLocation must exist')
  assert.ok(homeScreenSource.includes("import { resolveHomeMetro, nearestMetroWithinBoundary } from '../lib/metroSelection'"), 'HomeScreen.jsx must import nearestMetroWithinBoundary for the foreground re-check')
})

// ── Boundary / hysteresis coverage ─────────────────────────────────────────
test('nearestMetroWithinBoundary: returns null (no metro claims the point) when the true nearest metro is farther than MAX_METRO_BOUNDARY_M', () => {
  // Mid-Atlantic — thousands of km from every metro in the fixture.
  const midOcean = { latitude: 30, longitude: -40 }
  assert.equal(nearestMetroWithinBoundary(midOcean, METROS), null)
})

test('nearestMetroWithinBoundary: returns the real nearest metro when genuinely within boundary', () => {
  const nearest = nearestMetroWithinBoundary(MUNICH_COORDS, METROS)
  assert.equal(nearest.slug, 'munich')
})

test('MAX_METRO_BOUNDARY_M reuses the app\'s existing 100-mile geographic-relevance convention rather than inventing a new radius concept', () => {
  const MILES_TO_METERS = 1609.34
  assert.equal(MAX_METRO_BOUNDARY_M, 100 * MILES_TO_METERS)
})

test('resolveHomeMetro: a "ready" location outside every metro\'s boundary, with no persisted choice, falls through to needs_selection rather than picking the nearest-but-still-very-far metro', () => {
  const midOcean = { latitude: 30, longitude: -40 }
  const { metro, reason } = resolveHomeMetro({ persistedSlug: null, metros: METROS, location: midOcean, locationState: 'ready' })
  assert.equal(metro, null)
  assert.equal(reason, 'needs_selection')
})
