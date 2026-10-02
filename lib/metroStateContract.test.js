// REGRESSION / NEW COVERAGE — metro state contract (2026-10-02, revision 2: provenance + nearest metro).
//
// Field evidence 1 (OTA 01a0f8c7): after an Amalfi email link and a flight, Home kept "Amalfi Coast" while the
// unsupported card said "We haven't unlocked this city yet". Root cause: the in-memory link intent lived as
// long as the JS process and HomeScreen's location effect returned early outside every launched metro.
// Field evidence 2 (OTA 01a0fe7d, NYC): the first fix expired the intent but re-resolved from a legacy
// persisted Amalfi slug (it could not tell a link or auto choice from a deliberate pick), so Amalfi stayed.
// Revision 2 tracks provenance (link | manual | nearest | physical), normalizes untagged legacy state once, and
// defaults to the nearest launched metro when the phone is outside every one.
//
// These tests drive the SAME pure functions HomeScreen uses with a deterministic clock and fixed coordinates.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  setExplicitMetro, getExplicitMetro, getActiveExplicitMetro, stampExplicitMetroOrigin, clearExplicitMetro,
  evaluateExplicitMetroIntent, shouldClearExactLinkIntent,
  EXPLICIT_METRO_INTENT_MAX_AGE_MS, EXPLICIT_METRO_INTENT_MAX_TRAVEL_M, __resetExplicitMetroForTests,
} from './explicitMetroIntent.js'
import {
  deriveHomeMetroContext, reconcileHomeMetroState, resolveMetroChoice, normalizePersistedMetro,
  HOME_METRO_KIND, BROWSING_BADGE_TEXT, NEAREST_BADGE_TEXT, METRO_PROVENANCE as P,
} from './homeMetroContext.js'
import { nearestMetroByCoords } from './metroSelection.js'
import {
  shouldPreserveSession, describeSessionPreservationDecision, BACKGROUND_PRESERVE_MS_DEFAULT, SHORT_INTERRUPTION_MAX_MOVE_M,
} from './whatsGoodSessionCache.js'
import { createLocationStore } from './locationFreshness.js'
import { deriveUnsupportedLocationCardState, UNSUPPORTED_LOCATION_TITLE, UNSUPPORTED_LOCATION_BROWSING_TITLE } from './unsupportedLocationCard.js'
import { COVERAGE_MODE, deriveCoverageMode } from './whatsGoodCoverageMode.js'
import { haversineMeters } from './distance.js'

// Production active metros as queried 2026-10-02 (centers; Amalfi has a 12 km boundary radius).
const M = (id, slug, name, lat, lng, r = null) => ({ id, slug, name, center_lat: lat, center_lng: lng, boundary_radius_km: r })
const AMALFI = M('amalfi-id', 'amalfi-coast', 'Amalfi Coast', 40.634, 14.602, 12)
const PHOENIX = M('phoenix-id', 'phoenix', 'Phoenix Metro', 33.4484, -112.074)
const MILWAUKEE = M('milwaukee-id', 'milwaukee', 'Milwaukee Metro', 43.0389, -87.9065)
const GREEN_BAY = M('green-bay-id', 'green-bay', 'Green Bay Metro', 44.5192, -88.0198)
const DENVER = M('denver-id', 'denver', 'Denver Metro', 39.7392, -104.9903)
const MUNICH = M('munich-id', 'munich', 'Munich Metro', 48.1351, 11.582)
const METROS = [AMALFI, DENVER, GREEN_BAY, MILWAUKEE, MUNICH, PHOENIX]

const IN_ITALY = { latitude: 40.628, longitude: 14.485 }
const HEATHROW = { latitude: 51.4724, longitude: -0.4814 }
const NYC = { latitude: 40.7647, longitude: -73.9776 }
const IN_PHOENIX = { latitude: 33.45, longitude: -112.07 }

const T0 = Date.UTC(2026, 9, 2, 8, 0, 0)
const MIN = 60 * 1000
const HOUR = 60 * MIN

// Deterministic Home: the same state HomeScreen keeps (selected metro, provenance, last physical id, persisted
// record) and the same pure reconcile / resolve it calls.
function makeHome({ persisted = null, selectedMetro = null, provenance = null } = {}) {
  const h = { persisted, selectedMetro, provenance, lastPhysicalMetroId: undefined, needsMetroSelection: false, previousFocusAt: 0, lastBlurAt: 0 }
  // Cold launch (init()): normalize legacy state, then resolve once.
  h.coldLaunch = ({ location, locationState = location ? 'ready' : 'unavailable', rawStored = null, now = T0 }) => {
    if (rawStored) {
      const { record } = normalizePersistedMetro(rawStored)
      h.persisted = record
    }
    const r = resolveMetroChoice({ metros: METROS, location, locationState, activeIntent: getActiveExplicitMetro({ location, resumed: true, now }), persisted: h.persisted })
    h.selectedMetro = r.metro; h.provenance = r.provenance; h.needsMetroSelection = r.reason === 'needs_selection'
    if (r.provenance === P.PHYSICAL || r.provenance === P.NEAREST) h.persisted = { slug: r.metro.slug, source: r.provenance }
    h.lastPhysicalMetroId = undefined
    return r
  }
  h.reconcile = ({ location, now, resumed = false }) => {
    if (location) stampExplicitMetroOrigin(location)
    const intent = getActiveExplicitMetro({ location, resumed, now })
    const next = reconcileHomeMetroState({
      metros: METROS, selectedMetro: h.selectedMetro, provenance: h.provenance,
      lastPhysicalMetroId: h.lastPhysicalMetroId, activeIntent: intent, location, persisted: h.persisted,
    })
    h.lastPhysicalMetroId = next.lastPhysicalMetroId
    if (next.action !== 'keep') {
      h.selectedMetro = next.selectedMetro; h.provenance = next.provenance; h.needsMetroSelection = next.needsMetroSelection
      if (next.persist) h.persisted = next.persist
    }
    return next
  }
  h.openLink = (metro, source, now) => { setExplicitMetro(metro, source, now); h.selectedMetro = metro; h.provenance = P.LINK; h.needsMetroSelection = false }
  h.switchCity = (metro) => { clearExplicitMetro('manual'); h.provenance = P.MANUAL; h.selectedMetro = metro; h.persisted = { slug: metro.slug, source: P.MANUAL } }
  // Home regains focus (navigation 'focus').
  h.focus = ({ location, now }) => {
    if (shouldClearExactLinkIntent(getExplicitMetro(), { previousFocusAt: h.previousFocusAt, lastBlurAt: h.lastBlurAt })) clearExplicitMetro('flow-closed')
    h.previousFocusAt = now
    return h.reconcile({ location, now })
  }
  h.blur = (now) => { h.lastBlurAt = now }
  h.context = (location) => deriveHomeMetroContext({
    selectedMetro: h.selectedMetro,
    physicalMetro: location ? resolveMetroChoice({ metros: METROS, location, locationState: 'ready', activeIntent: null, persisted: null }).metro && resolveMetroChoice({ metros: METROS, location, locationState: 'ready', activeIntent: null, persisted: null }).provenance === P.PHYSICAL ? resolveMetroChoice({ metros: METROS, location, locationState: 'ready', activeIntent: null, persisted: null }).metro : null : null,
    hasLiveLocation: Boolean(location), provenance: h.provenance,
  })
  return h
}
const reset = () => __resetExplicitMetroForTests()

// ── Nearest active metro ─────────────────────────────────────────────────────
test('NYC resolves to the nearest active metro, calculated from the metro list (Milwaukee, about 1179 km), not hard-coded', () => {
  const nearest = nearestMetroByCoords(NYC, METROS)
  assert.equal(nearest.slug, 'milwaukee')
  const km = haversineMeters(NYC.latitude, NYC.longitude, MILWAUKEE.center_lat, MILWAUKEE.center_lng) / 1000
  assert.ok(km > 1170 && km < 1190, `distance ${km}`)
  // Calculated, not hard-coded: remove Milwaukee and the answer changes; add a closer fake metro and it wins.
  assert.equal(nearestMetroByCoords(NYC, METROS.filter(m => m.slug !== 'milwaukee')).slug, 'green-bay')
  const boston = M('boston-id', 'boston', 'Boston Metro', 42.36, -71.06)
  assert.equal(nearestMetroByCoords(NYC, [...METROS, boston]).slug, 'boston')
})

test('cold launch in NYC with no saved choice selects the nearest metro (provenance nearest), still unsupported for coverage', () => {
  reset()
  const home = makeHome()
  const r = home.coldLaunch({ location: NYC })
  assert.equal(r.metro.slug, 'milwaukee')
  assert.equal(home.provenance, P.NEAREST)
  const ctx = home.context(NYC)
  assert.equal(ctx.kind, HOME_METRO_KIND.NEAREST_CITY_UNSUPPORTED_LOCATION)
  assert.equal(ctx.badge, NEAREST_BADGE_TEXT)
  assert.equal(ctx.headerLabel, 'Milwaukee')
  assert.equal(ctx.showUnsupportedNotice, true)
})

test('unsupported NYC coverage stays unsupported while nearest-metro content is displayed', () => {
  // Coverage is a function of the live location's local inventory (0 near NYC), never of the selected metro.
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 0, targetCount: 3, hasExplicitSelection: true }), COVERAGE_MODE.UNSUPPORTED)
  const ctx = deriveHomeMetroContext({ selectedMetro: MILWAUKEE, physicalMetro: null, hasLiveLocation: true, provenance: P.NEAREST })
  assert.equal(ctx.showUnsupportedNotice, true)
  const card = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED, items: [{ id: 'u', is_universal: true }], browsingName: 'Milwaukee', browsingIsNearest: true })
  assert.equal(card.title, UNSUPPORTED_LOCATION_BROWSING_TITLE)
  assert.match(card.body, /Showing Milwaukee, the nearest CheckOff city/)
  assert.equal(card.showTryAnywhereAction, true)
})

// ── Expired link intent ──────────────────────────────────────────────────────
test('expired Amalfi link intent immediately resolves to the nearest active metro (the NYC field failure)', () => {
  reset()
  // Legacy-style state: a persisted AUTO slug 'amalfi-coast' tagged nearest must not pin Amalfi either.
  const home = makeHome({ persisted: null })
  home.reconcile({ location: IN_ITALY, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + MIN })
  assert.equal(home.selectedMetro.id, AMALFI.id)

  const next = home.reconcile({ location: NYC, now: T0 + 20 * HOUR, resumed: true })
  assert.equal(getExplicitMetro(), null)
  assert.equal(next.action, 'switch')
  assert.equal(home.selectedMetro.slug, 'milwaukee')
  assert.equal(home.provenance, P.NEAREST)
  assert.deepEqual(home.persisted, { slug: 'milwaukee', source: 'nearest' })
})

test('travel alone (a fix 50+ km away) expires the intent and re-resolves on the next tick, no resume needed', () => {
  reset()
  const home = makeHome()
  home.reconcile({ location: IN_ITALY, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + MIN })
  home.reconcile({ location: NYC, now: T0 + 2 * MIN })
  assert.equal(home.selectedMetro.slug, 'milwaukee')
})

test('intent expiry thresholds: just inside stays, just outside goes; age only counts on resume', () => {
  reset()
  setExplicitMetro(AMALFI, 'metro_link', T0)
  stampExplicitMetroOrigin(IN_ITALY)
  const i = getExplicitMetro()
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0 + 3 * HOUR, location: IN_ITALY, resumed: false }).active, true)
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0 + EXPLICIT_METRO_INTENT_MAX_AGE_MS - 1, resumed: true }).active, true)
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0 + EXPLICIT_METRO_INTENT_MAX_AGE_MS, resumed: true }).reason, 'expired-age')
  const near = { latitude: IN_ITALY.latitude + 0.3, longitude: IN_ITALY.longitude }
  const far = { latitude: IN_ITALY.latitude + 0.6, longitude: IN_ITALY.longitude }
  assert.ok(haversineMeters(IN_ITALY.latitude, IN_ITALY.longitude, near.latitude, near.longitude) < EXPLICIT_METRO_INTENT_MAX_TRAVEL_M)
  assert.ok(haversineMeters(IN_ITALY.latitude, IN_ITALY.longitude, far.latitude, far.longitude) > EXPLICIT_METRO_INTENT_MAX_TRAVEL_M)
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0, location: near }).active, true)
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0, location: far }).reason, 'expired-travel')
})

test('the link intent is not persisted and does not become the permanent Home metro', () => {
  reset()
  const home = makeHome({ persisted: { slug: 'phoenix', source: 'manual' }, selectedMetro: PHOENIX, provenance: P.MANUAL })
  home.reconcile({ location: IN_PHOENIX, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_PHOENIX, now: T0 + MIN })
  assert.deepEqual(home.persisted, { slug: 'phoenix', source: 'manual' })
  home.reconcile({ location: IN_PHOENIX, now: T0 + 26 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.provenance, P.PHYSICAL)
})

// ── Exact Phoenix links while physically elsewhere ───────────────────────────
test('exact Phoenix item opened while physically in NYC: Phoenix wins for the flow, nearest-metro resolution does not override it', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC })
  home.reconcile({ location: NYC, now: T0 })
  home.openLink(PHOENIX, 'item_link', T0 + MIN)
  for (let i = 2; i < 8; i++) home.reconcile({ location: NYC, now: T0 + i * MIN })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.provenance, P.LINK)
})

test('exact Phoenix list opened while physically in NYC behaves the same', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC })
  home.openLink(PHOENIX, 'list_link', T0)
  home.reconcile({ location: NYC, now: T0 + 5 * MIN })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
})

test('exact Phoenix item / list opened while physically in Italy keeps Phoenix; an Amalfi metro link in Italy is local', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: IN_ITALY })
  home.openLink(PHOENIX, 'item_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + MIN })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  reset()
  const h2 = makeHome()
  h2.coldLaunch({ location: IN_ITALY })
  h2.openLink(AMALFI, 'metro_link', T0)
  h2.reconcile({ location: IN_ITALY, now: T0 + MIN })
  assert.equal(h2.context(IN_ITALY).kind, HOME_METRO_KIND.LOCAL)
})

test('closing the exact link flow returns Home to the normal metro state (nearest in NYC); a metro link stays until it expires', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC })
  home.focus({ location: NYC, now: T0 })
  home.openLink(PHOENIX, 'item_link', T0 + MIN)
  home.blur(T0 + MIN + 100) // Home left for the item screen
  home.reconcile({ location: NYC, now: T0 + 2 * MIN })
  assert.equal(home.selectedMetro.id, PHOENIX.id, 'still Phoenix while the item flow is open')
  home.focus({ location: NYC, now: T0 + 3 * MIN }) // back
  assert.equal(getExplicitMetro(), null)
  assert.equal(home.selectedMetro.slug, 'milwaukee')
  assert.equal(home.provenance, P.NEAREST)

  reset()
  const h2 = makeHome()
  h2.coldLaunch({ location: NYC })
  h2.focus({ location: NYC, now: T0 })
  h2.openLink(AMALFI, 'metro_link', T0 + MIN)
  h2.blur(T0 + MIN + 100)
  h2.focus({ location: NYC, now: T0 + 3 * MIN })
  assert.equal(h2.selectedMetro.id, AMALFI.id, 'a metro link is a browsing request and stays')
})

test('shouldClearExactLinkIntent: only item and list links, only after Home was left', () => {
  const mk = (source, at) => ({ source, at })
  assert.equal(shouldClearExactLinkIntent(mk('item_link', 1000), { previousFocusAt: 500, lastBlurAt: 0 }), true)
  assert.equal(shouldClearExactLinkIntent(mk('list_link', 1000), { previousFocusAt: 500, lastBlurAt: 0 }), true)
  assert.equal(shouldClearExactLinkIntent(mk('metro_link', 1000), { previousFocusAt: 500, lastBlurAt: 1100 }), false)
  assert.equal(shouldClearExactLinkIntent(mk('item_link', 1000), { previousFocusAt: 1500, lastBlurAt: 0 }), false)
  assert.equal(shouldClearExactLinkIntent(null, {}), false)
})

// ── Manual choice ────────────────────────────────────────────────────────────
test('a deliberate manual Amalfi choice remains Amalfi with BROWSING while outside the boundary, across resume and cold launch', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC })
  home.switchCity(AMALFI)
  home.reconcile({ location: NYC, now: T0 + 5 * MIN })
  home.reconcile({ location: NYC, now: T0 + 3 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, AMALFI.id)
  let ctx = home.context(NYC)
  assert.deepEqual([ctx.kind, ctx.badge, ctx.headerLabel], [HOME_METRO_KIND.BROWSING_UNSUPPORTED_LOCATION, BROWSING_BADGE_TEXT, 'Amalfi Coast'])
  // cold launch with the persisted manual record
  const cold = makeHome({ persisted: home.persisted })
  cold.coldLaunch({ location: NYC })
  assert.equal(cold.selectedMetro.id, AMALFI.id)
  assert.equal(cold.provenance, P.MANUAL)
})

test('manual choice is dropped only by arriving in a different launched metro (a travel event)', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC })
  home.switchCity(AMALFI)
  home.reconcile({ location: NYC, now: T0 })
  const next = home.reconcile({ location: IN_PHOENIX, now: T0 + 30 * HOUR, resumed: true })
  assert.equal(next.action, 'switch')
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.provenance, P.PHYSICAL)
})

test('a manual Switch City after a link replaces the link (newest explicit action wins)', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC })
  home.openLink(AMALFI, 'metro_link', T0)
  home.switchCity(PHOENIX)
  home.reconcile({ location: NYC, now: T0 + 9 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.provenance, P.MANUAL)
})

// ── Legacy normalization ─────────────────────────────────────────────────────
test('legacy untagged Amalfi state is normalized once: dropped, and NYC then resolves to the nearest metro', () => {
  reset()
  assert.deepEqual(normalizePersistedMetro({ slug: 'amalfi-coast', source: null }), { record: null, legacy: true })
  assert.deepEqual(normalizePersistedMetro({ slug: 'amalfi-coast', source: 'link' }), { record: null, legacy: true }, 'a link tag is never trusted as persisted state')
  const home = makeHome()
  const r = home.coldLaunch({ location: NYC, rawStored: { slug: 'amalfi-coast', source: null } })
  assert.equal(r.metro.slug, 'milwaukee')
  assert.equal(home.provenance, P.NEAREST)
  // Normalized: the retained record is now the tagged automatic one, so a second launch is stable.
  const again = makeHome({ persisted: home.persisted })
  again.coldLaunch({ location: NYC, rawStored: { slug: home.persisted.slug, source: home.persisted.source } })
  assert.equal(again.selectedMetro.slug, 'milwaukee')
})

test('a newly recorded deliberate manual choice is not erased by normalization', () => {
  assert.deepEqual(normalizePersistedMetro({ slug: 'amalfi-coast', source: 'manual' }), { record: { slug: 'amalfi-coast', source: 'manual' }, legacy: false })
  assert.deepEqual(normalizePersistedMetro({ slug: null, source: 'manual' }), { record: null, legacy: false })
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC, rawStored: { slug: 'amalfi-coast', source: 'manual' } })
  assert.equal(home.selectedMetro.id, AMALFI.id)
  assert.equal(home.provenance, P.MANUAL)
})

// ── Returning to Phoenix ─────────────────────────────────────────────────────
test('returning from NYC to Phoenix selects Phoenix automatically (physical), no BROWSING badge, no relaunch/link/storage clearing', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: NYC })
  home.reconcile({ location: NYC, now: T0 })
  const next = home.reconcile({ location: IN_PHOENIX, now: T0 + 3 * 24 * HOUR, resumed: true })
  assert.equal(next.action, 'switch')
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.provenance, P.PHYSICAL)
  const ctx = deriveHomeMetroContext({ selectedMetro: PHOENIX, physicalMetro: PHOENIX, hasLiveLocation: true, provenance: P.PHYSICAL })
  assert.deepEqual([ctx.kind, ctx.badge, ctx.showUnsupportedNotice], [HOME_METRO_KIND.LOCAL, null, false])
})

test('first observation never moves a physical/nearest selection that init already resolved correctly', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: IN_PHOENIX })
  const next = home.reconcile({ location: IN_PHOENIX, now: T0 })
  assert.equal(next.action, 'keep')
})

// ── Cold / warm / unavailable / denied ───────────────────────────────────────
test('cold launch precedence: link > physical > manual > nearest > last known > needs selection', () => {
  reset()
  const manualAmalfi = { slug: 'amalfi-coast', source: 'manual' }
  assert.equal(resolveMetroChoice({ metros: METROS, location: IN_ITALY, locationState: 'ready', activeIntent: { id: PHOENIX.id }, persisted: manualAmalfi }).provenance, P.LINK)
  assert.equal(resolveMetroChoice({ metros: METROS, location: IN_PHOENIX, locationState: 'ready', activeIntent: null, persisted: manualAmalfi }).provenance, P.PHYSICAL)
  assert.equal(resolveMetroChoice({ metros: METROS, location: NYC, locationState: 'ready', activeIntent: null, persisted: manualAmalfi }).provenance, P.MANUAL)
  assert.equal(resolveMetroChoice({ metros: METROS, location: NYC, locationState: 'ready', activeIntent: null, persisted: null }).provenance, P.NEAREST)
  assert.equal(resolveMetroChoice({ metros: METROS, location: null, locationState: 'unavailable', activeIntent: null, persisted: { slug: 'milwaukee', source: 'nearest' } }).reason, 'last-known')
  assert.equal(resolveMetroChoice({ metros: METROS, location: null, locationState: 'unavailable', activeIntent: null, persisted: null }).reason, 'needs_selection')
  assert.equal(resolveMetroChoice({ metros: METROS, location: null, locationState: 'pending', activeIntent: null, persisted: null }).reason, 'pending')
})

test('location denied or unavailable: a manual or last-known choice is kept, nothing is claimed about the phone, no badge or notice', () => {
  reset()
  const home = makeHome({ persisted: { slug: 'phoenix', source: 'physical' } })
  home.coldLaunch({ location: null, locationState: 'unavailable' })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  const next = home.reconcile({ location: null, now: T0 + MIN })
  assert.equal(next.action, 'keep')
  const ctx = home.context(null)
  assert.deepEqual([ctx.kind, ctx.badge, ctx.showUnsupportedNotice], [HOME_METRO_KIND.LOCATION_UNKNOWN, null, false])
  reset()
  const none = makeHome()
  none.coldLaunch({ location: null, locationState: 'unavailable' })
  assert.equal(none.needsMetroSelection, true)
})

test('warm-process resume sequence Italy link -> Heathrow -> NYC -> Phoenix ends coherent at every step', () => {
  reset()
  const home = makeHome()
  home.coldLaunch({ location: IN_ITALY })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + MIN })
  assert.equal(home.context(IN_ITALY).kind, HOME_METRO_KIND.LOCAL)
  home.reconcile({ location: HEATHROW, now: T0 + 9 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.slug, 'munich', 'nearest launched metro to Heathrow')
  home.reconcile({ location: NYC, now: T0 + 20 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.slug, 'milwaukee')
  home.reconcile({ location: IN_PHOENIX, now: T0 + 4 * 24 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.provenance, P.PHYSICAL)
})

test('header, badge and notice can never disagree: exhaustive over (selected, physical, live, provenance)', () => {
  for (const selectedMetro of [null, AMALFI, PHOENIX]) {
    for (const physicalMetro of [null, AMALFI, PHOENIX]) {
      for (const hasLiveLocation of [true, false]) {
        for (const provenance of [null, P.LINK, P.MANUAL, P.NEAREST, P.PHYSICAL]) {
          if (!hasLiveLocation && physicalMetro) continue
          const ctx = deriveHomeMetroContext({ selectedMetro, physicalMetro, hasLiveLocation, provenance })
          if (ctx.kind === HOME_METRO_KIND.LOCAL) assert.equal(ctx.badge, null)
          if (ctx.badge) assert.ok(ctx.headerLabel)
          if (ctx.showUnsupportedNotice) assert.equal(physicalMetro, null)
          if (ctx.headerLabel === null) assert.equal(selectedMetro, null)
        }
      }
    }
  }
})

test('unsupported card with nothing browsed keeps generic copy and never names a city', () => {
  const card = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED, items: [] })
  assert.equal(card.title, UNSUPPORTED_LOCATION_TITLE)
  assert.doesNotMatch(card.body, /Amalfi|Phoenix|Milwaukee/)
})

// ── What's Good cache ────────────────────────────────────────────────────────
const NOW = new Date(T0)
function session(overrides = {}) {
  return {
    schemaVersion: 2, itemIds: ['a', 'b', 'c'], generatedAt: NOW, fingerprint: 'fp-A',
    location: IN_ITALY, resolvedMetroId: AMALFI.id, coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT, ...overrides,
  }
}
const at = (ms) => new Date(T0 + ms)

test('cache: fresh distant location (Heathrow) invalidates an Amalfi cache even inside the 5 minute window', () => {
  const opts = { now: at(MIN), currentFingerprint: 'fp-A', currentLocation: HEATHROW, currentMetroId: AMALFI.id }
  assert.equal(shouldPreserveSession(session(), opts), false)
  assert.equal(describeSessionPreservationDecision(session(), opts).reason, 'location-moved-beyond-radius')
})

test('cache: excessive distance within the nearby radius but past the short interruption limit also recomputes', () => {
  const drove = { latitude: IN_ITALY.latitude + 0.1, longitude: IN_ITALY.longitude } // about 11 km
  assert.ok(haversineMeters(IN_ITALY.latitude, IN_ITALY.longitude, drove.latitude, drove.longitude) > SHORT_INTERRUPTION_MAX_MOVE_M)
  const opts = { now: at(MIN), currentFingerprint: 'fp-DIFFERENT', currentLocation: drove, currentMetroId: AMALFI.id }
  assert.equal(shouldPreserveSession(session(), opts), false)
})

test('cache: a short interruption with a small move still preserves', () => {
  const walked = { latitude: IN_ITALY.latitude + 0.003, longitude: IN_ITALY.longitude } // about 330 m
  const opts = { now: at(4 * MIN), currentFingerprint: 'fp-X', currentLocation: walked, currentMetroId: AMALFI.id }
  assert.equal(shouldPreserveSession(session(), opts), true)
  assert.equal(describeSessionPreservationDecision(session(), opts).reason, 'preserved-short-interruption')
})

test('cache: expired cache without a fingerprint match is not preserved; with a match it is (unchanged rule)', () => {
  const base = { now: at(BACKGROUND_PRESERVE_MS_DEFAULT + MIN), currentLocation: IN_ITALY, currentMetroId: AMALFI.id }
  assert.equal(shouldPreserveSession(session(), { ...base, currentFingerprint: 'fp-other' }), false)
  assert.equal(shouldPreserveSession(session(), { ...base, currentFingerprint: 'fp-A' }), true)
})

test('cache: boundary of the age window is inclusive at exactly 5 minutes', () => {
  const opts = { now: at(BACKGROUND_PRESERVE_MS_DEFAULT), currentFingerprint: 'x', currentLocation: IN_ITALY, currentMetroId: AMALFI.id }
  assert.equal(shouldPreserveSession(session(), opts), true)
  assert.equal(shouldPreserveSession(session(), { ...opts, now: at(BACKGROUND_PRESERVE_MS_DEFAULT + 1) }), false)
})

test('cache: location unavailable (no currentLocation supplied) keeps the age-only rule', () => {
  const opts = { now: at(2 * MIN), currentFingerprint: 'x', currentLocation: null }
  assert.equal(shouldPreserveSession(session(), opts), true)
})

test('cache: a session recomputed at Heathrow under the stale Amalfi id is what showed preserved-short-interruption in the field; with the metro cleared the id mismatch recomputes', () => {
  // How the field state arose: recompute at Heathrow was saved with the (stale) Amalfi metro id, so later
  // reads inside 5 minutes were "preserved" and UNSUPPORTED. The cache was consistent with the location; the
  // wrong input was the metro Home passed in.
  const atHeathrow = session({ location: HEATHROW, resolvedMetroId: AMALFI.id, coverageMode: COVERAGE_MODE.UNSUPPORTED })
  const stale = { now: at(2 * MIN), currentFingerprint: 'x', currentLocation: HEATHROW, currentMetroId: AMALFI.id }
  assert.equal(describeSessionPreservationDecision(atHeathrow, stale).reason, 'preserved-short-interruption')
  // After this fix Home no longer passes Amalfi once the link expired: a different (or null) metro id.
  assert.equal(shouldPreserveSession(atHeathrow, { ...stale, currentMetroId: PHOENIX.id }), false)
})

test('cache: returning to Phoenix invalidates the NYC unsupported cache (distance and metro identity)', () => {
  const nyc = session({ location: NYC, resolvedMetroId: null, coverageMode: COVERAGE_MODE.UNSUPPORTED })
  assert.equal(shouldPreserveSession(nyc, { now: at(MIN), currentFingerprint: 'fp-A', currentLocation: IN_PHOENIX, currentMetroId: PHOENIX.id }), false)
})

// ── Warm resume through the real location store (deterministic fetch) ───────
test('warm resume: a stale fix triggers a device fetch and the new coordinates replace the old ones; a fresh fix does not fetch', async () => {
  let fetches = 0
  let next = HEATHROW
  const deviceFetch = async () => { fetches++; return next }
  const store = createLocationStore({ initialState: { coords: IN_ITALY, lastFetchedAt: 1_000 } })
  // Resume 9 hours later.
  const snap = await store.requestFreshLocation({ force: false, deviceFetch, now: 1_000 + 9 * HOUR })
  assert.equal(fetches, 1)
  assert.deepEqual(snap.coords, HEATHROW)
  // Immediate second resume: fresh enough, no fetch.
  await store.requestFreshLocation({ force: false, deviceFetch, now: Date.now() })
  assert.equal(fetches, 1)
})

test('location unavailable on resume: the last good fix is kept (never erased) and reconcile still behaves', async () => {
  const store = createLocationStore({ initialState: { coords: IN_ITALY, lastFetchedAt: 1_000 } })
  const snap = await store.requestFreshLocation({ force: false, deviceFetch: async () => null, now: 1_000 + 9 * HOUR })
  assert.deepEqual(snap.coords, IN_ITALY)
})
