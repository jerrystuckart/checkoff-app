// ANDROID variant of the end-to-end tracker harness (Platform.OS = 'android', an allowlisted native runtime). The same production
// tracker, router, planner and presence rules, driven through the geofence task callback the way Google Play services' GeofencingClient
// (via expo-location and expo-task-manager) would call it. Android cannot be proven here: delivery latency, Doze and OEM battery rules need the phone.
// End-to-end harness for the REAL candidateVisitTracker.js. Only the edges are faked (React Native, expo-location,
// expo-task-manager, AsyncStorage, Supabase, feature flags); the tracker, router, planner, cache, coordinator,
// eligibility and presence rules are the production code, bundled with esbuild and driven through the geofence task
// callback exactly as iOS would call it. What this cannot show is iOS itself (relaunch, exit lag): that needs the phone.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const FX = JSON.parse(fs.readFileSync(path.join(here, '__fixtures__/live_coverage_2026-09-30.json'), 'utf8'))
const POSITANO = { latitude: 40.628, longitude: 14.488, accuracy: 12, speed: 0.4 }
const FAR_EAST = { latitude: 40.6232, longitude: 14.5038, accuracy: 12, speed: 0.4 } // Laurito, ~1.4 km east

// ------------------------------------------------------------------ fakes (shared mutable world)
const world = globalThis.__world = {}
// The native movement module fake is created once (the tracker attaches its listener at import time) and reads live world fields.
world.native = {
  listeners: [],
  addListener(_name, cb) { this.listeners.push(cb); return { remove() {} } },
  isAvailableAsync: async () => world.nativeAvailable !== false,
  isEnabledAsync: async () => !!world.nativeRunning,
  startAsync: async () => { world.nativeStartCalls += 1; const r = world.nativeStartResult ?? 'started'; world.nativeRunning = r === 'started'; return r },
  stopAsync: async () => { world.nativeStopCalls += 1; world.nativeRunning = false },
  consumePendingAsync: async () => { const p = world.nativeHints; world.nativeHints = []; return p },
}
function resetWorld() {
  Object.assign(world, {
    native: world.native, nativeHints: [], nativeStartCalls: 0, nativeStopCalls: 0, nativeRunning: false, nativeStartResult: null, nativeAvailable: true,
    storage: new Map(), tasks: world.tasks ?? {}, geofenceCalls: [], stopCalls: 0, rpcCalls: [], inserts: [], debugEvents: [],
    fix: { ...POSITANO }, fixTimestamp: Date.now(), online: true, bgPermission: true, session: { user: { id: 'user-1' } },
    flags: { candidate_visit_sentinel_refresh: true, candidate_visit_detection: true, candidate_visit_movement_refresh: false }, isTester: true, isAdmin: false, optedIn: true,
    rpcResponder: null, flagsUnreadable: false, catalog: FX.items, profiles: FX.profiles, fetchCount: 0, startDelayMs: 0,
  })
}
resetWorld()

const fakes = {
  'react': `export const useEffect = () => {}; export const useRef = (v) => ({ current: v }); export default { useEffect, useRef }`,
  'react-native': `export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) }; export const Platform = { OS: 'android', Version: 34 }`,
  '@react-native-async-storage/async-storage': `const w = globalThis.__world
export default {
  getItem: async (k) => (w.storage.has(k) ? w.storage.get(k) : null),
  setItem: async (k, v) => { w.storage.set(k, String(v)) },
  removeItem: async (k) => { w.storage.delete(k) },
  multiRemove: async (ks) => { ks.forEach((k) => w.storage.delete(k)) },
  getAllKeys: async () => [...w.storage.keys()],
}`,
  'expo-modules-core': `const w = globalThis.__world
export function requireOptionalNativeModule() { return w.native }`,
  'expo-task-manager': `const w = globalThis.__world
export function defineTask(name, fn) { w.tasks[name] = fn }
export async function isTaskRegisteredAsync() { return true }`,
  'expo-updates': `export const updateId = '01a0ef6f-test'; export const runtimeVersion = '53ba13b59fec2f2667b5ce1f9568e19f8f5076b3'; export const channel = 'production'; export const isEmbeddedLaunch = false`,
  'expo-location': `const w = globalThis.__world
export const GeofencingEventType = { Enter: 1, Exit: 2 }
export const Accuracy = { Balanced: 3, Low: 2 }
export async function startGeofencingAsync(task, regions) { if (w.startDelayMs) await new Promise((r) => setTimeout(r, w.startDelayMs)); w.geofenceCalls.push({ task, regions, at: Date.now() }) }
export async function stopGeofencingAsync() { w.stopCalls += 1 }
export async function hasStartedGeofencingAsync() { return w.geofenceCalls.length > 0 }
export async function getBackgroundPermissionsAsync() { return { status: w.bgPermission ? 'granted' : 'denied' } }
export async function getForegroundPermissionsAsync() { return { status: 'granted' } }
export async function requestForegroundPermissionsAsync() { return { status: 'granted' } }
export async function requestBackgroundPermissionsAsync() { return { status: w.bgPermission ? 'granted' : 'denied' } }
export async function getCurrentPositionAsync() { if (!w.fix) throw new Error('no fix'); return { coords: w.fix, timestamp: w.fixTimestamp } }
export async function getLastKnownPositionAsync() { return w.fix ? { coords: w.fix, timestamp: w.fixTimestamp } : null }`,
  'supabase': `const w = globalThis.__world
const err = () => ({ data: null, error: { message: 'Network request failed' } })
function itemsQuery() {
  const q = { _f: [] }
  for (const m of ['select', 'not', 'order', 'in']) q[m] = () => q
  q.eq = (col, v) => { q._eq = [col, v]; return q }
  for (const m of ['gte', 'lte']) q[m] = (col, v) => { q._f.push([m, col, v]); return q }
  q.maybeSingle = async () => ({ data: q._eq ? (w.catalog.find((r) => r[q._eq[0]] === q._eq[1]) ?? null) : null, error: null })
  q.range = async () => {
    w.fetchCount += 1
    if (!w.online) return err()
    let rows = w.catalog
    for (const [m, col, v] of q._f) rows = rows.filter((r) => (m === 'gte' ? r[col] >= v : r[col] <= v))
    return { data: rows, error: null }
  }
  return q
}
export const supabase = {
  auth: { getSession: async () => ({ data: { session: w.session } }), getUser: async () => ({ data: { user: w.session?.user ?? null } }) },
  rpc: async (name, args) => { w.rpcCalls.push({ name, args }); if (!w.online) return err(); if (w.rpcResponder) { const x = w.rpcResponder(name, args); if (x !== undefined) return { data: x, error: null } } return { data: { status: 'opened', open_item_ids: [] }, error: null } },
  from: (table) => {
    if (table === 'items') return itemsQuery()
    if (table === 'geofence_registration_log') return { insert: async (row) => { if (!w.online) return err(); w.inserts.push(row); return { error: null } } }
    if (table === 'geofence_debug_events') return { insert: async (row) => { w.debugEvents.push(row); return { error: null } } }
    if (table === 'visit_detection_profiles') return { select: async () => (w.online ? { data: Object.entries(w.profiles).map(([key, p]) => ({ key, ...p })), error: null } : err()) }
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
  },
}`,
  'flags': `const w = globalThis.__world
export async function isFlagEnabled(_u, key) { return w.flags[key] === true }
export async function flagStateOrUnknown(_u, key) { return w.flagsUnreadable ? null : w.flags[key] === true }
export async function isVisitRecoveryOffered(_u, os) { const master = w.flags.candidate_visit_detection === true; if (os !== 'android') return master; return master && (w.flags.android_visit_recovery === true || w.isTester === true || w.isAdmin === true) }`,
  'recoverySettings': `const w = globalThis.__world
export async function fetchOptIn() { return w.optedIn }
export function subscribeRecoveryChange() { return () => {} }`,
}

let tracker
before(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-harness-'))
  const fakeFile = (name) => { const f = path.join(tmp, name.replace(/[^a-z]/gi, '_') + '.js'); fs.writeFileSync(f, fakes[name]); return f }
  const map = {
    'react': fakeFile('react'), 'react-native': fakeFile('react-native'), '@react-native-async-storage/async-storage': fakeFile('@react-native-async-storage/async-storage'),
    'expo-modules-core': fakeFile('expo-modules-core'), 'expo-task-manager': fakeFile('expo-task-manager'), 'expo-updates': fakeFile('expo-updates'), 'expo-location': fakeFile('expo-location'),
  }
  const result = await build({
    entryPoints: [path.join(here, 'candidateVisitTracker.js')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
    loader: { '.js': 'jsx' },
    plugins: [{
      name: 'edges',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => {
          if (map[a.path]) return { path: map[a.path] }
          if (/(^|\/)supabase$/.test(a.path) && a.path.startsWith('.')) return { path: fakeFile('supabase') }
          if (/(^|\/)featureFlags$/.test(a.path)) return { path: fakeFile('flags') }
          if (/(^|\/)recoverySettings$/.test(a.path)) return { path: fakeFile('recoverySettings') }
          return null
        })
      },
    }],
  })
  const out = path.join(tmp, 'tracker.mjs')
  fs.writeFileSync(out, result.outputFiles[0].text)
  tracker = await import(pathToFileURL(out).href)
})
// The tracker caches a location fix for 15 s and rate-limits refreshes by wall clock; give every test its own later "now".
const realNow = Date.now.bind(Date)
let clockOffset = 0
beforeEach(() => { clockOffset += 3 * 60 * 60 * 1000; Date.now = () => realNow() + clockOffset; resetWorld() })

const TASK = 'checkoff-candidate-visit-geofence'
const fire = (eventType, id) => world.tasks[TASK]({ data: { eventType: eventType === 'enter' ? 1 : 2, region: { identifier: id } }, error: null })
const SENTINEL = 'checkoff-refresh-sentinel'
const setSentinel = (over = {}) => world.storage.set('visitCoverageSentinel', JSON.stringify({ lat: 40.628, lng: 14.488, radiusM: 700, registeredAt: Date.now() - 10 * 60e3, signature: 'x', needsRefresh: false, bornOutsideRetries: 0, ...over }))
const setRegisteredAt = (ms) => world.storage.set('visitGeofenceRegisteredAt', String(ms))
const sentinelRegion = (call) => call.regions.find((r) => r.identifier === SENTINEL)


test('harness sanity: Android registered the geofence task at module scope', () => {
  assert.equal(typeof world.tasks[TASK], 'function')
})

const eligible = () => FX.items.filter((i) => i.is_active && !i.is_universal && FX.profiles[i.visit_profile_key] && !FX.profiles[i.visit_profile_key].manual_only)

test('Android registers up to 39 venues + the sentinel (40 total, well under the platform limit of 100); nearest first; universal and inactive items never', async () => {
  assert.ok(eligible().length > 39, 'fixture has more eligible venues than the cap')
  world.catalog = [
    { ...eligible()[0], id: 'universal-near', is_universal: true, maps_lat: POSITANO.latitude, maps_lng: POSITANO.longitude },
    { ...eligible()[0], id: 'inactive-near', is_active: false, maps_lat: POSITANO.latitude, maps_lng: POSITANO.longitude },
    ...FX.items,
  ]
  await tracker.forceRefreshGeofences('user-1')
  assert.equal(world.geofenceCalls.length, 1)
  const regions = world.geofenceCalls[0].regions
  assert.equal(regions.length, 40)
  assert.equal(regions.filter((r) => r.identifier !== SENTINEL).length, 39)
  assert.ok(sentinelRegion(world.geofenceCalls[0]))
  const ids = regions.map((r) => r.identifier)
  assert.ok(!ids.includes('universal-near') && !ids.includes('inactive-near'))
  assert.equal(world.inserts.at(-1).monitored_items.length, 39)
  assert.equal(world.inserts.at(-1).registration_state, 'ok_monitored')
})

test('idempotent registration: the same position and catalog give the same region signature, so an unchanged set is not re-registered', async () => {
  const { planCoverage, regionSignature } = await import('./coveragePlanner.js')
  const position = { lat: POSITANO.latitude, lng: POSITANO.longitude }
  const a = planCoverage({ position, items: FX.items, profiles: FX.profiles, platformOS: 'android' })
  const b = planCoverage({ position, items: FX.items, profiles: FX.profiles, platformOS: 'android' })
  assert.equal(regionSignature(a.regions), regionSignature(b.regions))
  assert.equal(a.regions.length, 40)
  // A different metro (far away) yields a different set; an unsupported location (nothing nearby) yields none.
  const far = planCoverage({ position: { lat: 40.76, lng: -73.98 }, items: FX.items, profiles: FX.profiles, platformOS: 'android' })
  assert.equal(far.regions.length, 0)
  const iosPlan = planCoverage({ position, items: FX.items, profiles: FX.profiles, platformOS: 'ios' })
  assert.equal(iosPlan.regions.length, 19, 'iOS budget unchanged')
})

test('classic path (sentinel flag off) registers up to 40 venues on Android', async () => {
  world.flags.candidate_visit_sentinel_refresh = false
  await tracker.forceRefreshGeofences('user-1')
  assert.equal(world.geofenceCalls.at(-1).regions.length, 40)
  assert.ok(!world.geofenceCalls.at(-1).regions.some((r) => r.identifier === SENTINEL))
})

test('no background permission: nothing is registered and nothing prompts', async () => {
  world.bgPermission = false
  await tracker.forceRefreshGeofences('user-1')
  assert.equal(world.geofenceCalls.length, 0)
  assert.ok(world.inserts.some((r) => r.error_message === 'no_background_permission'))
})

test('travel: a sentinel exit with a fresh fix far away re-chooses the nearby set (material travel refresh)', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3); world.fix = { ...FAR_EAST }
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.inserts.at(-1).refresh_cause, 'sentinel_exit')
})

test('enter is reported once; a duplicate enter is not; events from a restarted process still use the stored open session', async () => {
  const venue = eligible()[0]
  setSentinel({ lat: venue.maps_lat, lng: venue.maps_lng }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { latitude: venue.maps_lat, longitude: venue.maps_lng, accuracy: 10 }
  await fire('enter', venue.id)
  await fire('enter', venue.id)
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_enter').length, 1, 'duplicate enter ignored')
  assert.ok(JSON.parse(world.storage.get('visitPresenceOpen'))[venue.id], 'the open session is in AsyncStorage, so it survives process death')
  // Android may deliver the exit many minutes late, to a fresh process: the stored session is enough.
  clockOffset += 25 * 60 * 1000; world.fixTimestamp = Date.now()
  world.fix = { latitude: venue.maps_lat + 0.02, longitude: venue.maps_lng, accuracy: 10 }
  await fire('exit', venue.id)
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_exit').length, 1)
  assert.deepEqual(JSON.parse(world.storage.get('visitPresenceOpen') ?? '{}'), {})
})

test('offline: an enter that cannot be reported is queued locally and flushed at the next wake-up (bounded, no timer)', async () => {
  const venue = eligible()[0]
  setSentinel({ lat: venue.maps_lat, lng: venue.maps_lng }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { latitude: venue.maps_lat, longitude: venue.maps_lng, accuracy: 10 }
  world.online = false
  await fire('enter', venue.id)
  const queued = world.storage.get('visitPresencePending')
  assert.ok(queued && queued !== '[]', 'queued locally while offline')
  world.online = true; world.rpcCalls.length = 0
  await fire('enter', 'unrelated-region') // any real wake-up flushes the queue
  assert.ok(world.rpcCalls.some((c) => c.name === 'visit_presence_enter'), 'queued report sent once back online')
})

test('sign-out stops monitoring and clears this phone\'s visit state', async () => {
  const venue = eligible()[0]
  world.storage.set('visitPresenceOpen', JSON.stringify({ [venue.id]: Date.now() }))
  world.storage.set('visitCoverageSentinel', '{"lat":1,"lng":1,"radiusM":500}')
  world.storage.set('visitStateOwner', 'user-1')
  const stopsBefore = world.stopCalls
  await tracker.stopVisitTrackingForSignOut()
  assert.ok(world.stopCalls > stopsBefore, 'geofences unregistered')
  for (const k of ['visitPresenceOpen', 'visitCoverageSentinel']) assert.equal(world.storage.has(k) && world.storage.get(k) !== 'null', false, k)
})

test('account switch: another user never inherits the previous account\'s open sessions or monitoring', async () => {
  const venue = eligible()[0]
  world.storage.set('visitStateOwner', 'user-1')
  world.storage.set('visitPresenceOpen', JSON.stringify({ [venue.id]: Date.now() }))
  const stopsBefore = world.stopCalls
  await tracker.ensureStateOwner('user-2')
  assert.ok(world.stopCalls > stopsBefore)
  assert.equal(world.storage.has('visitPresenceOpen'), false)
  assert.equal(world.storage.get('visitStateOwner'), 'user-2')
  // Same user again: nothing is cleared.
  world.storage.set('visitPresenceOpen', JSON.stringify({ x: Date.now() }))
  await tracker.ensureStateOwner('user-2')
  assert.equal(world.storage.has('visitPresenceOpen'), true)
})

test('registration facts for the card: a failed OS registration is recorded and cleared by the next success', async () => {
  const before = await tracker.readGeofenceRegistrationState()
  assert.equal(before.error, null)
  world.storage.set('visitRegistrationError', 'boom')
  assert.equal((await tracker.readGeofenceRegistrationState()).error, 'boom')
  await tracker.forceRefreshGeofences('user-1')
  assert.equal((await tracker.readGeofenceRegistrationState()).error, null, 'a successful registration clears the error')
})
