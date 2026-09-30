// Coverage-sentinel refresh: the pure decision logic the tracker runs, exercised with the REAL eligibility rule, planner,
// router, presence rules and live production rows (Positano/Amalfi and Florence old town, __fixtures__/live_coverage_*).
// The I/O around it (AsyncStorage, expo-location, Supabase) lives in candidateVisitTracker.js and needs a device.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { haversineMeters } from '../distance.js'
import { classifyVisitEligibility, MAX_MONITORED_REGIONS } from './visitEligibility.js'
import { IOS_REGION_LIMIT, MAX_TOTAL_REGISTERED, MAX_VENUE_REGIONS_WITH_SENTINEL, SPARE_REGION_SLOTS } from './regionBudget.js'
import {
  SENTINEL_ID, SENTINEL_MIN_RADIUS_M, SENTINEL_MAX_RADIUS_M, sentinelRadius, judgeSentinelExit, sentinelRefreshGate,
  SENTINEL_MIN_REFRESH_GAP_MS, SENTINEL_MAX_REFRESHES_PER_HOUR, MAX_BORN_OUTSIDE_RETRIES, REGISTRATION_WINDOW_MS,
} from './sentinel.js'
import { planCoverage, regionSignature, NEARBY_RADIUS_M } from './coveragePlanner.js'
import { cacheStatus, decideCacheSource, buildCache, fetchWindow, CACHE_FETCH_RADIUS_M, CACHE_STALE_MS, CACHE_MAX_AGE_MS, CACHE_SAFE_TRAVEL_M } from './coverageCache.js'
import { routeGeofenceEvent } from './eventRouter.js'
import { createRefreshCoordinator } from './refreshCoordinator.js'
import { isVisitStateKey, SENTINEL_STATE_KEY, COVERAGE_CACHE_KEY, OPEN_KEY, PENDING_KEY, ARRIVAL_KEY_PREFIX, PROFILES_CACHE_KEY, REFRESH_TIMES_KEY, REFRESH_LOG_QUEUE_KEY, REGISTERED_AT_KEY } from './trackerKeys.js'
import { pruneOpen, markOpen } from './presenceClient.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FX = JSON.parse(fs.readFileSync(path.join(here, '__fixtures__/live_coverage_2026-09-30.json'), 'utf8'))
const POSITANO = { lat: 40.628, lng: 14.488 }      // Spiaggia Grande
const LAURITO = { lat: 40.6232, lng: 14.5038 }      // Chiesa di San Pietro, east of Positano
const FLORENCE_DUOMO = { lat: 43.7731, lng: 11.2560 }
const NOW = Date.UTC(2026, 8, 30, 9, 0, 0)

// ---------------------------------------------------------------- region budget
test('region budget: 19 total, 18 venues + 1 sentinel, one spare slot, and no other feature registers regions', () => {
  assert.equal(IOS_REGION_LIMIT, 20)
  assert.equal(SPARE_REGION_SLOTS, 1)
  assert.equal(MAX_TOTAL_REGISTERED, 19)
  assert.equal(MAX_TOTAL_REGISTERED, MAX_MONITORED_REGIONS, 'the classic path already registered 19; the sentinel path must not exceed it')
  assert.equal(MAX_VENUE_REGIONS_WITH_SENTINEL, 18)

  // Only the tracker may register regions. If another feature ever does, OTHER_FEATURE_REGIONS must be raised and this fails first.
  const root = path.join(here, '../..')
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'ios', 'android', '.git', '.claude', 'agent-service', 'docs', 'supabase'].includes(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(js|jsx|ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.js')) {
        const src = fs.readFileSync(p, 'utf8')
        if (/startGeofencingAsync\(|startMonitoringForRegion|CLCircularRegion/.test(src)) hits.push(path.relative(root, p))
      }
    }
  }
  walk(root)
  assert.deepEqual(hits, ['lib/visitDetection/candidateVisitTracker.js'])
})

// ---------------------------------------------------------------- sentinel size comes from real coverage
test('sentinelRadius: derived from the nearest unmonitored venue, clamped, and reports when coverage is tight', () => {
  // next unmonitored venue 900 m away with a 100 m circle -> 900 - 100 - 60 = 740 m
  assert.deepEqual(sentinelRadius({ nextOutDistanceM: 900, nextOutVenueRadiusM: 100 }), { radiusM: 740, tight: false, boundM: 740 })
  // very dense: bound below what iOS can honor -> minimum radius, flagged tight
  const dense = sentinelRadius({ nextOutDistanceM: 250, nextOutVenueRadiusM: 120 })
  assert.equal(dense.radiusM, SENTINEL_MIN_RADIUS_M); assert.equal(dense.tight, true)
  // sparse: capped
  assert.equal(sentinelRadius({ nextOutDistanceM: 20000, nextOutVenueRadiusM: 120 }).radiusM, SENTINEL_MAX_RADIUS_M)
  // nothing left unmonitored in the cached area -> maximum, not tight
  assert.deepEqual(sentinelRadius({ nextOutDistanceM: null }), { radiusM: SENTINEL_MAX_RADIUS_M, tight: false, boundM: null })
})

test('planCoverage on live Positano: 18 nearest eligible venues + a sentinel = 19 regions, radius not one constant', () => {
  const plan = planCoverage({ position: POSITANO, items: FX.items, profiles: FX.profiles, openItemIds: [] })
  assert.equal(plan.monitored.length, 18)
  assert.equal(plan.regions.length, 19)
  assert.equal(plan.regions.filter((r) => r.identifier === SENTINEL_ID).length, 1)
  const sentinel = plan.regions.find((r) => r.identifier === SENTINEL_ID)
  assert.equal(sentinel.notifyOnEnter, false); assert.equal(sentinel.notifyOnExit, true)
  assert.ok(sentinel.radius >= SENTINEL_MIN_RADIUS_M && sentinel.radius <= SENTINEL_MAX_RADIUS_M)
  // every registered venue passes the REAL eligibility rule
  for (const v of plan.monitored) assert.deepEqual(classifyVisitEligibility(v, FX.profiles, 0), { eligible: true })
  // and nothing manual_only / inactive / over the distance made it in
  for (const v of plan.monitored) { assert.notEqual(FX.profiles[v.visit_profile_key].manual_only, true); assert.ok(v.distanceM <= NEARBY_RADIUS_M) }
  assert.ok(plan.coverage.nextUnmonitoredM >= plan.coverage.farthestVenueM)

  const other = planCoverage({ position: LAURITO, items: FX.items, profiles: FX.profiles })
  assert.notEqual(regionSignature(other.regions), regionSignature(plan.regions), 'moving east changes the venue set')
})

test('planCoverage classic-equivalence: without the sentinel it selects exactly what the classic tracker selects', () => {
  const classic = () => { // classifyNearbyItems' loop, verbatim semantics
    const nearby = FX.items.map((i) => ({ ...i, distanceM: haversineMeters(POSITANO.lat, POSITANO.lng, i.maps_lat, i.maps_lng) }))
      .filter((i) => i.distanceM <= 30000).sort((a, b) => a.distanceM - b.distanceM)
    const monitored = []
    for (const it of nearby) if (classifyVisitEligibility(it, FX.profiles, monitored.length).eligible) monitored.push(it)
    return monitored.map((m) => m.id)
  }
  const plan = planCoverage({ position: POSITANO, items: FX.items, profiles: FX.profiles, sentinelEnabled: false })
  assert.equal(plan.regions.length, 19)
  assert.deepEqual(plan.monitored.map((m) => m.id), classic())
  assert.equal(plan.sentinel, null)
})

test('density drives the size: Florence old town gets a much smaller sentinel than Positano, and a synthetic packed block is reported tight', () => {
  const florence = planCoverage({ position: FLORENCE_DUOMO, items: FX.items, profiles: FX.profiles })
  const positano = planCoverage({ position: POSITANO, items: FX.items, profiles: FX.profiles })
  assert.equal(florence.monitored.length, 18)
  assert.ok(florence.coverage.sentinelRadiusM >= SENTINEL_MIN_RADIUS_M)
  assert.ok(florence.coverage.sentinelRadiusM < positano.coverage.sentinelRadiusM, `${florence.coverage.sentinelRadiusM} < ${positano.coverage.sentinelRadiusM}`)
  assert.equal(florence.coverage.sentinelBoundM, florence.coverage.nextUnmonitoredM - 120 - 60, 'bound = next unmonitored venue - its circle - buffer')
  // 30 venues within ~100 m of each other: nothing can be guaranteed between refreshes -> minimum radius, tight = true
  const block = Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, maps_lat: 45 + (i % 6) * 0.0002, maps_lng: 9 + Math.floor(i / 6) * 0.0002, geo_radius_m: 100, visit_profile_key: 'restaurant', is_universal: false, is_active: true }))
  const dense = planCoverage({ position: { lat: 45.0005, lng: 9.0005 }, items: block, profiles: FX.profiles })
  assert.equal(dense.coverage.sentinelRadiusM, SENTINEL_MIN_RADIUS_M)
  assert.equal(dense.coverage.tight, true)
})

test('planCoverage preserves a venue with an open presence session even when it is no longer among the nearest', () => {
  const all = planCoverage({ position: POSITANO, items: FX.items, profiles: FX.profiles })
  const far = FX.items.filter((i) => classifyVisitEligibility(i, FX.profiles, 0).eligible)
    .map((i) => ({ ...i, d: haversineMeters(POSITANO.lat, POSITANO.lng, i.maps_lat, i.maps_lng) }))
    .filter((i) => i.d < 30000 && !all.monitored.some((m) => m.id === i.id)).sort((a, b) => b.d - a.d)[0]
  assert.ok(far, 'fixture must contain an eligible venue outside the nearest 18')
  const plan = planCoverage({ position: POSITANO, items: FX.items, profiles: FX.profiles, openItemIds: [far.id] })
  assert.ok(plan.monitored.some((m) => m.id === far.id), 'open venue stays registered so its exit is still delivered')
  assert.equal(plan.monitored.length, 18); assert.equal(plan.coverage.openPreserved, 1)
  // an "open" venue that is no longer eligible (manual_only) is NOT kept
  const manual = FX.items.find((i) => i.visit_profile_key === 'manual_only')
  const plan2 = planCoverage({ position: POSITANO, items: FX.items, profiles: FX.profiles, openItemIds: [manual.id] })
  assert.ok(!plan2.monitored.some((m) => m.id === manual.id))
})

// ---------------------------------------------------------------- event routing
const registration = { registeredAt: NOW - 5 * 60 * 1000, bornOutsideRetries: 0 }
const route = (over) => routeGeofenceEvent({ eventType: 'exit', regionId: SENTINEL_ID, sentinel: registration, openMap: {}, registeredAtMs: NOW - 5 * 60 * 1000, nowMs: NOW, maxBornOutsideRetries: MAX_BORN_OUTSIDE_RETRIES, ...over })

test('sentinel events never produce a venue action (so never a visit, check-off or points)', () => {
  const open = { 'venue-a': NOW - 3600e3 }
  for (const eventType of ['enter', 'exit'])
    for (const sentinel of [null, registration, { ...registration, bornOutsideRetries: 5 }])
      for (const registeredAtMs of [null, NOW - 1000, NOW - 5 * 60 * 1000]) {
        const r = routeGeofenceEvent({ eventType, regionId: SENTINEL_ID, sentinel, openMap: open, registeredAtMs, nowMs: NOW, maxBornOutsideRetries: MAX_BORN_OUTSIDE_RETRIES })
        assert.ok(r.kind.startsWith('sentinel_'), `${eventType}/${JSON.stringify(sentinel)}/${registeredAtMs} -> ${r.kind}`)
      }
})

test('sentinel: enter is a registration determination; a real exit is verified; born-outside re-centers a bounded number of times', () => {
  assert.deepEqual(route({ eventType: 'enter' }), { kind: 'sentinel_ignored', reason: 'enter' })
  assert.deepEqual(route({}), { kind: 'sentinel_exit_verify' })
  const bornOutside = route({ registeredAtMs: NOW - (REGISTRATION_WINDOW_MS - 1000) })
  assert.deepEqual(bornOutside, { kind: 'sentinel_born_outside', retry: true })
  assert.deepEqual(route({ registeredAtMs: NOW - 1000, sentinel: { ...registration, bornOutsideRetries: MAX_BORN_OUTSIDE_RETRIES } }), { kind: 'sentinel_ignored', reason: 'born_outside_retries_exhausted' })
})

test('opt-out / gate off: with no active sentinel state a late sentinel callback is ignored', () => {
  assert.deepEqual(route({ sentinel: null }), { kind: 'sentinel_ignored', reason: 'no_active_sentinel' })
})

test('venue events keep their existing meaning: duplicates, non-open exits, registration-time exits and live exits', () => {
  const v = (over) => routeGeofenceEvent({ eventType: 'enter', regionId: 'venue-a', sentinel: registration, openMap: {}, registeredAtMs: NOW - 5 * 60e3, nowMs: NOW, maxBornOutsideRetries: 2, ...over })
  assert.equal(v({}).kind, 'venue_enter')
  assert.equal(v({ openMap: { 'venue-a': NOW - 60e3 } }).kind, 'venue_enter_duplicate')
  assert.equal(v({ openMap: { 'venue-a': NOW - 11 * 60e3 } }).kind, 'venue_enter', 'an older open session is re-reported; the server keeps its original stamp')
  assert.equal(v({ eventType: 'exit' }).kind, 'venue_exit_skip', 'OS reporting "outside" for a region we never entered')
  assert.equal(v({ eventType: 'exit', openMap: { 'venue-a': NOW - 3600e3 } }).kind, 'venue_exit_report')
  // an exit that arrives right after our own (re-)registration - including a sentinel-driven replacement - is a state
  // determination: reconcile without credit, never a claimed departure time.
  assert.equal(v({ eventType: 'exit', openMap: { 'venue-a': NOW - 3600e3 }, registeredAtMs: NOW - 2000 }).kind, 'venue_exit_reconcile')
})

test('region replacement keeps in-progress sessions: open map survives, an inside venue re-enters as a duplicate', () => {
  const open = pruneOpen(markOpen({}, 'venue-a', NOW - 40 * 60e3), NOW)
  assert.ok(open['venue-a'], 'refresh code never clears the open map')
  // after re-registration iOS re-delivers ENTER for the venue we are inside: re-sent only if the last report is old, and the server keeps the original entered_at
  const again = routeGeofenceEvent({ eventType: 'enter', regionId: 'venue-a', sentinel: registration, openMap: open, registeredAtMs: NOW - 1000, nowMs: NOW, maxBornOutsideRetries: 2 })
  assert.equal(again.kind, 'venue_enter')   // 40 min > 10 min refresh interval: harmless re-report (server: already_open)
  // and the administrative removal of a region is not a departure: exits in the registration window never report a departure
  const exit = routeGeofenceEvent({ eventType: 'exit', regionId: 'venue-a', sentinel: registration, openMap: open, registeredAtMs: NOW - 1500, nowMs: NOW, maxBornOutsideRetries: 2 })
  assert.equal(exit.kind, 'venue_exit_reconcile')
})

// ---------------------------------------------------------------- verifying and rate-limiting exits
test('judgeSentinelExit: believes the OS only when a fresh fix agrees; noisy accuracy does not fake a departure', () => {
  const sentinel = { lat: POSITANO.lat, lng: POSITANO.lng, radiusM: 500 }
  const at = (dNorthM, accuracy) => ({ latitude: POSITANO.lat + dNorthM / 111320, longitude: POSITANO.lng, accuracy })
  assert.equal(judgeSentinelExit({ fix: at(600, 10), sentinel, distanceFn: haversineMeters }), 'refresh')
  assert.equal(judgeSentinelExit({ fix: at(100, 10), sentinel, distanceFn: haversineMeters }), 'ignore_still_inside')
  assert.equal(judgeSentinelExit({ fix: at(340, 200), sentinel, distanceFn: haversineMeters }), 'refresh', 'slack is capped at 50 m: 340 + 50 >= 350')
  assert.equal(judgeSentinelExit({ fix: null, sentinel, distanceFn: haversineMeters }), 'refresh_no_fix')
  assert.equal(judgeSentinelExit({ fix: at(600, 10), sentinel: null, distanceFn: haversineMeters }), 'no_active_sentinel')
})

test('sentinelRefreshGate: prevents flapping and caps refreshes per hour', () => {
  assert.equal(sentinelRefreshGate({ nowMs: NOW, lastRefreshAtMs: null, recent: [] }).run, true)
  const soon = sentinelRefreshGate({ nowMs: NOW, lastRefreshAtMs: NOW - 20e3, recent: [NOW - 20e3] })
  assert.equal(soon.run, false); assert.equal(soon.reason, 'min_gap'); assert.equal(soon.retryAfterMs, SENTINEL_MIN_REFRESH_GAP_MS - 20e3)
  assert.equal(sentinelRefreshGate({ nowMs: NOW, lastRefreshAtMs: NOW - 61e3, recent: [NOW - 61e3] }).run, true)
  const many = Array.from({ length: SENTINEL_MAX_REFRESHES_PER_HOUR }, (_, i) => NOW - 61e3 - i * 60e3)
  assert.equal(sentinelRefreshGate({ nowMs: NOW, lastRefreshAtMs: NOW - 61e3, recent: many }).reason, 'hourly_cap')
  assert.equal(sentinelRefreshGate({ nowMs: NOW, lastRefreshAtMs: NOW - 61e3, recent: many.map((t) => t - 3600e3) }).run, true, 'old refreshes age out')
})

// ---------------------------------------------------------------- cache, offline, travel beyond the cached area
test('cache: fresh / stale / expired / outside the cached area / empty', () => {
  const cache = buildCache(FX.items, POSITANO, NOW)
  assert.equal(cacheStatus(cache, POSITANO, NOW), 'fresh')
  assert.equal(cacheStatus(cache, LAURITO, NOW + 60e3), 'fresh')
  assert.equal(cacheStatus(cache, POSITANO, NOW + CACHE_STALE_MS + 1), 'stale')
  assert.equal(cacheStatus(cache, POSITANO, NOW + CACHE_MAX_AGE_MS + 1), 'expired')
  assert.equal(cacheStatus(cache, FLORENCE_DUOMO, NOW), 'outside_area')
  assert.equal(cacheStatus(null, POSITANO, NOW), 'empty')
  const edge = { lat: POSITANO.lat + (CACHE_SAFE_TRAVEL_M + 2000) / 111320, lng: POSITANO.lng }
  assert.equal(cacheStatus(cache, edge, NOW), 'outside_area', 'beyond fetch radius - nearby radius the cache would silently omit venues')
  assert.equal(CACHE_SAFE_TRAVEL_M, CACHE_FETCH_RADIUS_M - NEARBY_RADIUS_M)
})

test('offline refresh: uses the cache while it honestly covers the position, otherwise keeps the previous set', () => {
  assert.equal(decideCacheSource({ status: 'fresh', online: false }), 'use_cache')
  assert.equal(decideCacheSource({ status: 'stale', online: false }), 'use_stale')
  assert.equal(decideCacheSource({ status: 'expired', online: false }), 'keep_previous')
  assert.equal(decideCacheSource({ status: 'outside_area', online: false }), 'keep_previous')
  assert.equal(decideCacheSource({ status: 'empty', online: false }), 'keep_previous')
  for (const s of ['stale', 'expired', 'outside_area', 'empty']) assert.equal(decideCacheSource({ status: s, online: true }), 'fetch')

  // end to end with real planner: walking ~1.5 km east offline is served from the cache built at Positano
  const cache = buildCache(FX.items, POSITANO, NOW)
  assert.equal(cacheStatus(cache, LAURITO, NOW), 'fresh')
  const plan = planCoverage({ position: LAURITO, items: cache.items, profiles: FX.profiles })
  assert.equal(plan.monitored.length, 18)
  // the cache must contain every row selection needs from its own center (nothing dropped by buildCache)
  const direct = planCoverage({ position: POSITANO, items: FX.items, profiles: FX.profiles })
  const fromCache = planCoverage({ position: POSITANO, items: cache.items, profiles: FX.profiles })
  assert.deepEqual(fromCache.monitored.map((m) => m.id), direct.monitored.map((m) => m.id))
})

test('fetchWindow covers the whole cache circle', () => {
  const w = fetchWindow(POSITANO)
  const northEdge = { lat: POSITANO.lat + CACHE_FETCH_RADIUS_M / 111320 - 1e-4, lng: POSITANO.lng }
  const eastEdge = { lat: POSITANO.lat, lng: POSITANO.lng + CACHE_FETCH_RADIUS_M / (111320 * Math.cos((POSITANO.lat * Math.PI) / 180)) - 1e-4 }
  for (const p of [northEdge, eastEdge]) assert.ok(p.lat >= w.minLat && p.lat <= w.maxLat && p.lng >= w.minLng && p.lng <= w.maxLng)
})

// ---------------------------------------------------------------- concurrency
test('refresh coordinator: concurrent triggers never overlap and coalesce into one follow-up', async () => {
  let active = 0, maxActive = 0
  const calls = []
  const coordinator = createRefreshCoordinator(async (arg) => {
    active += 1; maxActive = Math.max(maxActive, active); calls.push(arg)
    await new Promise((r) => setTimeout(r, 15))
    active -= 1
    return `done:${arg}`
  })
  const results = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((c) => coordinator.request(c)))
  assert.equal(maxActive, 1, 'never two refreshes at once')
  assert.deepEqual(calls, ['a', 'b'], 'five simultaneous requests => the running one plus a single coalesced follow-up (first queued wins)')
  assert.ok(results.every((r) => r.startsWith('done:')))
  assert.equal(coordinator.isRunning(), false)
  await coordinator.request('f'); assert.deepEqual(calls, ['a', 'b', 'f'])
})

test('refresh coordinator: a failing refresh does not wedge later requests', async () => {
  let n = 0
  const coordinator = createRefreshCoordinator(async () => { n += 1; if (n === 1) throw new Error('boom'); return 'ok' })
  await assert.rejects(coordinator.request('x'), /boom/)
  assert.equal(coordinator.isRunning(), false)
  assert.equal(await coordinator.request('y'), 'ok')
})

// ---------------------------------------------------------------- opt-out
test('opt-out clears every piece of device state the sentinel path adds', () => {
  for (const k of [SENTINEL_STATE_KEY, COVERAGE_CACHE_KEY, PROFILES_CACHE_KEY, REFRESH_TIMES_KEY, REFRESH_LOG_QUEUE_KEY, OPEN_KEY, PENDING_KEY, REGISTERED_AT_KEY, `${ARRIVAL_KEY_PREFIX}abc`])
    assert.equal(isVisitStateKey(k), true, k)
  assert.equal(isVisitStateKey('someOtherAppKey'), false)
  const tracker = fs.readFileSync(path.join(here, 'candidateVisitTracker.js'), 'utf8')
  assert.match(tracker, /filter\(isVisitStateKey\)/, 'the tracker clears keys through the shared list')
  assert.match(tracker, /optOutEpoch \+= 1/, 'in-flight refreshes are cancelled by opt-out')
  assert.match(tracker, /await clearSentinelState\(\)\n\s+await stopTracking\(\)/, 'turning the feature off also removes sentinel state')
})

// ---------------------------------------------------------------- the public path is untouched
test('the sentinel path is behind its own flag (global + overrides, not tester-gated); users without it keep the classic refresh', () => {
  const flags = fs.readFileSync(path.join(here, '../featureFlags.js'), 'utf8')
  const gated = flags.slice(flags.indexOf('const TESTER_GATED_FLAGS'), flags.indexOf(']', flags.indexOf('const TESTER_GATED_FLAGS')))
  assert.doesNotMatch(gated, /candidate_visit_sentinel_refresh/, 'rolled out beyond testers 2026-09-30')
  assert.doesNotMatch(gated, /'candidate_visit_detection'/)
  const tracker = fs.readFileSync(path.join(here, 'candidateVisitTracker.js'), 'utf8')
  assert.match(tracker, /const sentinelOn = await isFlagEnabled\(userId, 'candidate_visit_sentinel_refresh'\)\n\s+if \(sentinelOn\) await requestCoverageRefresh\(cause, userId\)\n\s+else \{ await clearSentinelState\(\); await refreshGeofences\(userId\) \}/)
  // the venue-path presence RPCs are still the only writers of presence; the sentinel code never calls them
  const sentinelBlock = tracker.slice(tracker.indexOf('COVERAGE SENTINEL REFRESH'), tracker.indexOf('async function refreshGeofences'))
  for (const forbidden of ['visit_presence_enter', 'visit_presence_exit', 'candidate_visits', 'check_ins', 'sendEnter', 'sendExit', 'reportEnter', 'reportDeparture'])
    assert.ok(!sentinelBlock.includes(forbidden), `sentinel refresh code must not touch ${forbidden}`)
})
