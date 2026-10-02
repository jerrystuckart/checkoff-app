// REGRESSION / NEW COVERAGE — metro state contract (2026-10-02).
//
// Field evidence (TestFlight 1.1.10 build 155, Jerry's iPhone): after an Amalfi email link and a flight, Home
// kept the header "Amalfi Coast" while the unsupported card said "We haven't unlocked this city yet", at
// London Heathrow and again in New York. Root cause: the in-memory link intent (lib/explicitMetroIntent.js)
// lived as long as the JS process, and HomeScreen's location effect returned early whenever the phone was
// outside every launched metro, so nothing ever revisited the link-derived selection.
//
// These tests drive the SAME pure functions HomeScreen uses (reconcileHomeMetroState, the intent expiry rule,
// deriveHomeMetroContext, the session cache) with a deterministic clock and fixed coordinates. No device
// location, no wall clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  setExplicitMetro, getExplicitMetro, getActiveExplicitMetro, stampExplicitMetroOrigin, clearExplicitMetro,
  evaluateExplicitMetroIntent, EXPLICIT_METRO_INTENT_MAX_AGE_MS, EXPLICIT_METRO_INTENT_MAX_TRAVEL_M, __resetExplicitMetroForTests,
} from './explicitMetroIntent.js'
import { deriveHomeMetroContext, reconcileHomeMetroState, HOME_METRO_KIND, BROWSING_BADGE_TEXT } from './homeMetroContext.js'
import { resolveHomeMetro } from './metroSelection.js'
import {
  shouldPreserveSession, describeSessionPreservationDecision, BACKGROUND_PRESERVE_MS_DEFAULT, SHORT_INTERRUPTION_MAX_MOVE_M,
} from './whatsGoodSessionCache.js'
import { createLocationStore } from './locationFreshness.js'
import { deriveUnsupportedLocationCardState, UNSUPPORTED_LOCATION_TITLE, UNSUPPORTED_LOCATION_BROWSING_TITLE } from './unsupportedLocationCard.js'
import { COVERAGE_MODE } from './whatsGoodCoverageMode.js'
import { haversineMeters } from './distance.js'

const AMALFI = { id: 'amalfi-id', slug: 'amalfi-coast', name: 'Amalfi Coast', center_lat: 40.634, center_lng: 14.602, boundary_radius_km: 40 }
const PHOENIX = { id: 'phoenix-id', slug: 'phoenix', name: 'Phoenix Metro', center_lat: 33.4484, center_lng: -112.074 }
const MUNICH = { id: 'munich-id', slug: 'munich', name: 'Munich Metro', center_lat: 48.1351, center_lng: 11.582 }
const METROS = [AMALFI, PHOENIX, MUNICH]

const IN_ITALY = { latitude: 40.628, longitude: 14.485 } // Positano
const HEATHROW = { latitude: 51.4724, longitude: -0.4814 }
const NYC = { latitude: 40.7128, longitude: -74.006 }
const IN_PHOENIX = { latitude: 33.45, longitude: -112.07 }

const T0 = Date.UTC(2026, 9, 2, 8, 0, 0)
const MIN = 60 * 1000
const HOUR = 60 * MIN

// A small deterministic Home: same state the screen keeps in refs/state, same pure reconcile it calls.
function makeHome({ persistedSlug = null, selectedMetro = null, selectedFromLink = false } = {}) {
  const h = { persistedSlug, selectedMetro, selectedFromLink, lastPhysicalMetroId: undefined, needsMetroSelection: false, persisted: persistedSlug }
  h.reconcile = ({ location, now, resumed = false }) => {
    if (location) stampExplicitMetroOrigin(location)
    const intent = getActiveExplicitMetro({ location, resumed, now })
    const next = reconcileHomeMetroState({
      metros: METROS, selectedMetro: h.selectedMetro, selectedFromLink: h.selectedFromLink,
      lastPhysicalMetroId: h.lastPhysicalMetroId, activeIntent: intent, location, persistedSlug: h.persisted,
    })
    h.lastPhysicalMetroId = next.lastPhysicalMetroId
    h.selectedFromLink = next.selectedFromLink
    if (next.action !== 'keep') {
      h.selectedMetro = next.selectedMetro
      h.needsMetroSelection = next.needsMetroSelection
      if (next.persistSlug) h.persisted = next.persistSlug
    }
    return next
  }
  // What applyIntent does when a link names a metro.
  h.openLink = (metro, source, now) => {
    setExplicitMetro(metro, source, now)
    h.selectedMetro = metro
    h.selectedFromLink = true
    h.needsMetroSelection = false
  }
  // What switchMetro does.
  h.switchCity = (metro) => {
    clearExplicitMetro('manual')
    h.selectedFromLink = false
    h.selectedMetro = metro
    h.persisted = metro.slug
  }
  h.context = (location) => deriveHomeMetroContext({
    selectedMetro: h.selectedMetro,
    physicalMetro: location ? resolveHomeMetro({ persistedSlug: null, metros: METROS, location, locationState: 'ready' }).metro : null,
    hasLiveLocation: Boolean(location),
  })
  return h
}
const reset = () => __resetExplicitMetroForTests()

// ── Link intent semantics ────────────────────────────────────────────────────
test('Amalfi metro link opened while physically in Italy: Home shows Amalfi as LOCAL (no badge), intent active', () => {
  reset()
  const home = makeHome()
  home.reconcile({ location: IN_ITALY, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + MIN })
  assert.equal(home.selectedMetro.id, AMALFI.id)
  assert.equal(home.context(IN_ITALY).kind, HOME_METRO_KIND.LOCAL)
  assert.equal(home.context(IN_ITALY).badge, null)
})

test('exact Phoenix item link opened while physically in Italy: Phoenix is the browsing metro and location does not override it', () => {
  reset()
  const home = makeHome({ selectedMetro: AMALFI })
  home.reconcile({ location: IN_ITALY, now: T0 })
  home.openLink(PHOENIX, 'item_link', T0 + MIN)
  // Several location ticks in Italy while the item is open.
  for (let i = 2; i < 8; i++) home.reconcile({ location: IN_ITALY, now: T0 + i * MIN })
  assert.equal(home.selectedMetro.id, PHOENIX.id, 'a nearer physical metro (Amalfi) must not replace the linked destination')
  const ctx = home.context(IN_ITALY)
  assert.equal(ctx.kind, HOME_METRO_KIND.BROWSING_ELSEWHERE)
  assert.equal(ctx.badge, BROWSING_BADGE_TEXT)
})

test('exact Phoenix list link opened while physically in Italy behaves the same (list_link)', () => {
  reset()
  const home = makeHome({ selectedMetro: AMALFI })
  home.reconcile({ location: IN_ITALY, now: T0 })
  home.openLink(PHOENIX, 'list_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + 5 * MIN })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.context(IN_ITALY).badge, BROWSING_BADGE_TEXT)
})

test('the link intent is in memory only: nothing is persisted when a link names a metro', () => {
  reset()
  const home = makeHome({ persistedSlug: 'phoenix', selectedMetro: PHOENIX })
  home.reconcile({ location: IN_PHOENIX, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_PHOENIX, now: T0 + MIN })
  assert.equal(home.persisted, 'phoenix', 'the persisted choice is untouched by a link')
})

// ── The field failure: warm process, Italy -> Heathrow -> NYC ────────────────
test('warm-process resume at Heathrow: the Amalfi link intent is dropped (travel), Home no longer claims Amalfi as its metro', () => {
  reset()
  const home = makeHome({ persistedSlug: null })
  home.reconcile({ location: IN_ITALY, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + MIN })
  assert.ok(getExplicitMetro(), 'intent active while in Italy')

  // 9 hours later the same JS process resumes at Heathrow with a fresh fix.
  const next = home.reconcile({ location: HEATHROW, now: T0 + 9 * HOUR, resumed: true })
  assert.equal(getExplicitMetro(), null, 'intent must be gone')
  assert.equal(next.action, 're-resolve')
  assert.equal(home.selectedMetro, null, 'no persisted choice and no physical metro: nothing is browsed, so nothing names Amalfi')
  assert.equal(home.needsMetroSelection, true)
  assert.equal(home.context(HEATHROW).kind, HOME_METRO_KIND.UNSUPPORTED_LOCATION)
  assert.equal(home.context(HEATHROW).headerLabel, null)
  assert.equal(home.context(HEATHROW).showUnsupportedNotice, true)
})

test('warm-process resume in NYC after Heathrow stays coherent (still unsupported, still not Amalfi)', () => {
  reset()
  const home = makeHome()
  home.reconcile({ location: IN_ITALY, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_ITALY, now: T0 + MIN })
  home.reconcile({ location: HEATHROW, now: T0 + 9 * HOUR, resumed: true })
  home.reconcile({ location: NYC, now: T0 + 20 * HOUR, resumed: true })
  assert.equal(home.selectedMetro, null)
  assert.equal(home.context(NYC).kind, HOME_METRO_KIND.UNSUPPORTED_LOCATION)
})

test('travel alone expires the intent on a location tick (no resume needed), age alone does not', () => {
  reset()
  setExplicitMetro(AMALFI, 'metro_link', T0)
  stampExplicitMetroOrigin(IN_ITALY)
  // Foreground, 3 hours later, still in Italy: not expired by a location tick.
  assert.equal(evaluateExplicitMetroIntent(getExplicitMetro(), { now: T0 + 3 * HOUR, location: IN_ITALY, resumed: false }).active, true)
  // Same time but resumed from background: age expires it.
  assert.equal(evaluateExplicitMetroIntent(getExplicitMetro(), { now: T0 + 3 * HOUR, location: IN_ITALY, resumed: true }).reason, 'expired-age')
  // A fix far away expires it even in the foreground.
  assert.equal(evaluateExplicitMetroIntent(getExplicitMetro(), { now: T0 + MIN, location: HEATHROW, resumed: false }).reason, 'expired-travel')
})

test('intent expiry thresholds: just inside stays, just outside goes', () => {
  reset()
  setExplicitMetro(AMALFI, 'metro_link', T0)
  stampExplicitMetroOrigin(IN_ITALY)
  const i = getExplicitMetro()
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0 + EXPLICIT_METRO_INTENT_MAX_AGE_MS - 1, resumed: true }).active, true)
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0 + EXPLICIT_METRO_INTENT_MAX_AGE_MS, resumed: true }).active, false)
  const near = { latitude: IN_ITALY.latitude + 0.3, longitude: IN_ITALY.longitude } // about 33 km
  const far = { latitude: IN_ITALY.latitude + 0.6, longitude: IN_ITALY.longitude } // about 67 km
  assert.ok(haversineMeters(IN_ITALY.latitude, IN_ITALY.longitude, near.latitude, near.longitude) < EXPLICIT_METRO_INTENT_MAX_TRAVEL_M)
  assert.ok(haversineMeters(IN_ITALY.latitude, IN_ITALY.longitude, far.latitude, far.longitude) > EXPLICIT_METRO_INTENT_MAX_TRAVEL_M)
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0, location: near }).active, true)
  assert.equal(evaluateExplicitMetroIntent(i, { now: T0, location: far }).active, false)
})

test('temporary email intent does not become the permanent Home metro: after it expires, the persisted manual choice returns', () => {
  reset()
  const home = makeHome({ persistedSlug: 'phoenix', selectedMetro: PHOENIX })
  home.reconcile({ location: IN_PHOENIX, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.reconcile({ location: IN_PHOENIX, now: T0 + MIN })
  assert.equal(home.selectedMetro.id, AMALFI.id)
  // Next day the process resumes, still in Phoenix.
  home.reconcile({ location: IN_PHOENIX, now: T0 + 26 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.persisted, 'phoenix')
})

test('manual Switch City while unsupported stays browseable, is labeled BROWSING (not local), and persists', () => {
  reset()
  const home = makeHome()
  home.reconcile({ location: NYC, now: T0 })
  home.switchCity(AMALFI)
  home.reconcile({ location: NYC, now: T0 + 5 * MIN })
  home.reconcile({ location: NYC, now: T0 + 3 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, AMALFI.id, 'a manual pick is not silently dropped')
  const ctx = home.context(NYC)
  assert.equal(ctx.kind, HOME_METRO_KIND.BROWSING_UNSUPPORTED_LOCATION)
  assert.equal(ctx.badge, BROWSING_BADGE_TEXT)
  assert.equal(ctx.headerLabel, 'Amalfi Coast')
  assert.equal(ctx.showUnsupportedNotice, true)
  assert.equal(home.persisted, 'amalfi-coast')
})

test('a manual Switch City after a link replaces the link (newest explicit action wins)', () => {
  reset()
  const home = makeHome()
  home.reconcile({ location: NYC, now: T0 })
  home.openLink(AMALFI, 'metro_link', T0)
  home.switchCity(PHOENIX)
  home.reconcile({ location: NYC, now: T0 + 9 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(getExplicitMetro(), null)
})

// ── Returning to Phoenix ─────────────────────────────────────────────────────
test('returning to Phoenix after NYC while browsing Amalfi recognises Phoenix as local with no relaunch, logout or link', () => {
  reset()
  const home = makeHome({ persistedSlug: 'amalfi-coast', selectedMetro: AMALFI })
  home.reconcile({ location: NYC, now: T0 }) // baseline (unsupported)
  home.reconcile({ location: NYC, now: T0 + HOUR })
  const next = home.reconcile({ location: IN_PHOENIX, now: T0 + 30 * HOUR, resumed: true })
  assert.equal(next.action, 'adopt-physical')
  assert.equal(home.selectedMetro.id, PHOENIX.id)
  assert.equal(home.persisted, 'phoenix')
  assert.equal(home.context(IN_PHOENIX).kind, HOME_METRO_KIND.LOCAL)
  assert.equal(home.context(IN_PHOENIX).badge, null)
})

test('returning to Phoenix with nothing selected (needs_selection) adopts Phoenix too', () => {
  reset()
  const home = makeHome()
  home.reconcile({ location: NYC, now: T0 })
  home.needsMetroSelection = true
  home.reconcile({ location: IN_PHOENIX, now: T0 + 30 * HOUR, resumed: true })
  assert.equal(home.selectedMetro.id, PHOENIX.id)
})

test('an active link intent is never overridden by arriving in a launched metro (J)', () => {
  reset()
  const home = makeHome({ selectedMetro: AMALFI })
  home.reconcile({ location: NYC, now: T0 })
  home.openLink(AMALFI, 'item_link', T0 + MIN)
  // GPS jumps to Phoenix (e.g. late fix) while the exact item is being opened.
  home.reconcile({ location: IN_PHOENIX, now: T0 + 2 * MIN })
  assert.equal(home.selectedMetro.id, AMALFI.id)
})

test('first observation never adopts (init() owns the first resolution)', () => {
  reset()
  const home = makeHome({ persistedSlug: 'amalfi-coast', selectedMetro: AMALFI })
  const next = home.reconcile({ location: IN_PHOENIX, now: T0 })
  assert.equal(next.action, 'keep')
})

// ── Cold launch precedence is unchanged ──────────────────────────────────────
test('cold launch: ready location in a launched metro wins over a stale persisted metro; unsupported location keeps the persisted browsing choice', () => {
  assert.equal(resolveHomeMetro({ persistedSlug: 'amalfi-coast', metros: METROS, location: IN_PHOENIX, locationState: 'ready' }).metro.id, PHOENIX.id)
  const unsupported = resolveHomeMetro({ persistedSlug: 'amalfi-coast', metros: METROS, location: NYC, locationState: 'ready' })
  assert.equal(unsupported.metro.id, AMALFI.id)
  assert.equal(unsupported.reason, 'explicit')
  const none = resolveHomeMetro({ persistedSlug: null, metros: METROS, location: NYC, locationState: 'ready' })
  assert.equal(none.metro, null)
})

test('cold launch from a link: explicit link beats location, even for a different metro', () => {
  const r = resolveHomeMetro({ persistedSlug: 'phoenix', metros: METROS, location: IN_ITALY, locationState: 'ready', explicitLinkMetro: { id: PHOENIX.id, slug: 'phoenix' } })
  assert.equal(r.metro.id, PHOENIX.id)
  assert.equal(r.reason, 'explicit_link')
})

// ── Location unavailable / denied ────────────────────────────────────────────
test('location denied or unavailable: no claim about where the phone is, no badge, no unsupported notice', () => {
  const ctx = deriveHomeMetroContext({ selectedMetro: AMALFI, physicalMetro: null, hasLiveLocation: false })
  assert.equal(ctx.kind, HOME_METRO_KIND.LOCATION_UNKNOWN)
  assert.equal(ctx.badge, null)
  assert.equal(ctx.showUnsupportedNotice, false)
  assert.equal(ctx.headerLabel, 'Amalfi Coast')
})

test('location denied: an intent is not dropped by travel (nothing to measure) and no reconcile adoption happens', () => {
  reset()
  const home = makeHome()
  home.openLink(AMALFI, 'metro_link', T0)
  const next = home.reconcile({ location: null, now: T0 + 5 * MIN })
  assert.equal(next.action, 'keep')
  assert.equal(home.selectedMetro.id, AMALFI.id)
})

// ── UI coherence ─────────────────────────────────────────────────────────────
test('unsupported physical location while browsing Amalfi: header Amalfi, BROWSING badge, notice says CheckOff has not launched near you', () => {
  const ctx = deriveHomeMetroContext({ selectedMetro: AMALFI, physicalMetro: null, hasLiveLocation: true })
  assert.deepEqual([ctx.headerLabel, ctx.badge, ctx.showUnsupportedNotice], ['Amalfi Coast', 'BROWSING', true])
  const card = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED, items: [{ id: 'u1', is_universal: true }], browsingName: ctx.browsingName })
  assert.equal(card.title, UNSUPPORTED_LOCATION_BROWSING_TITLE)
  assert.match(card.body, /browsing Amalfi Coast/)
  assert.notEqual(card.title, UNSUPPORTED_LOCATION_TITLE)
  assert.equal(card.showTryAnywhereAction, true)
})

test('unsupported physical location with nothing browsed: the card keeps the generic unsupported copy and never names a city', () => {
  const card = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED, items: [] })
  assert.equal(card.title, UNSUPPORTED_LOCATION_TITLE)
  assert.doesNotMatch(card.body, /Amalfi|Phoenix/)
})

test('browsing a launched metro the phone is not in (but another launched metro is) shows BROWSING without the unsupported notice', () => {
  const ctx = deriveHomeMetroContext({ selectedMetro: AMALFI, physicalMetro: PHOENIX, hasLiveLocation: true })
  assert.deepEqual([ctx.kind, ctx.badge, ctx.showUnsupportedNotice], [HOME_METRO_KIND.BROWSING_ELSEWHERE, 'BROWSING', false])
})

test('header, badge and notice can never disagree: exhaustive over (selected, physical, live)', () => {
  for (const selectedMetro of [null, AMALFI, PHOENIX]) {
    for (const physicalMetro of [null, AMALFI, PHOENIX]) {
      for (const hasLiveLocation of [true, false]) {
        if (!hasLiveLocation && physicalMetro) continue
        const ctx = deriveHomeMetroContext({ selectedMetro, physicalMetro, hasLiveLocation })
        if (ctx.kind === HOME_METRO_KIND.LOCAL) assert.equal(ctx.badge, null)
        if (ctx.badge) assert.ok(ctx.headerLabel, 'a BROWSING badge always sits next to a named metro')
        if (ctx.showUnsupportedNotice) assert.equal(physicalMetro, null)
        if (ctx.headerLabel === null) assert.equal(selectedMetro, null)
        assert.ok(!(ctx.badge && ctx.kind === HOME_METRO_KIND.LOCAL))
      }
    }
  }
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
