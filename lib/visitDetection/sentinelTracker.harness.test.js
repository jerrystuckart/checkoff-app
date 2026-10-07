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
    flags: { candidate_visit_sentinel_refresh: true, candidate_visit_detection: true, candidate_visit_movement_refresh: true }, optedIn: true,
    rpcResponder: null, flagsUnreadable: false, catalog: FX.items, profiles: FX.profiles, fetchCount: 0, startDelayMs: 0,
  })
}
resetWorld()

const fakes = {
  'react': `export const useEffect = () => {}; export const useRef = (v) => ({ current: v }); export default { useEffect, useRef }`,
  'react-native': `export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) }; export const Platform = { OS: 'ios' }`,
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
  'expo-updates': `export const updateId = '01a0ef6f-test'; export const runtimeVersion = '81dbd1f1'; export const channel = 'production'; export const isEmbeddedLaunch = false`,
  'expo-location': `const w = globalThis.__world
export const GeofencingEventType = { Enter: 1, Exit: 2 }
export const Accuracy = { Balanced: 3, Low: 2 }
export async function startGeofencingAsync(task, regions) { if (w.startDelayMs) await new Promise((r) => setTimeout(r, w.startDelayMs)); w.geofenceCalls.push({ task, regions, at: Date.now() }) }
export async function stopGeofencingAsync() { w.stopCalls += 1 }
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
  for (const m of ['select', 'not', 'order', 'eq', 'in']) q[m] = () => q
  for (const m of ['gte', 'lte']) q[m] = (col, v) => { q._f.push([m, col, v]); return q }
  q.maybeSingle = async () => ({ data: null, error: null })
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

test('harness sanity: the real tracker registered its task with the OS layer', () => {
  assert.equal(typeof world.tasks[TASK], 'function')
})

test('sentinel exit with a fresh fix: re-chooses 18 venues + a re-centered sentinel, logs cause, touches no presence RPC', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { ...FAR_EAST }
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 1)
  const call = world.geofenceCalls[0]
  assert.equal(call.regions.length, 19)
  const s = sentinelRegion(call)
  assert.ok(s && Math.abs(s.latitude - FAR_EAST.latitude) < 1e-9, 'sentinel re-centered on the fresh fix')
  assert.equal(world.inserts.at(-1).refresh_cause, 'sentinel_exit')
  assert.equal(world.inserts.at(-1).registration_state, 'ok_monitored')
  assert.equal(world.inserts.at(-1).monitored_items.length, 18)
  assert.ok(world.inserts.at(-1).coverage.sentinelRadiusM >= 150)
  assert.deepEqual(world.rpcCalls.filter((c) => /presence|candidate/.test(c.name)), [], 'a sentinel event never reports presence')
  assert.deepEqual(world.debugEvents.map((e) => e.event_type).filter((t) => ['enter', 'exit', 'presence_enter_result'].includes(t)), [])
})

test('sentinel exit while the fresh fix is still inside the circle is ignored (no re-registration)', async () => {
  setSentinel({ radiusM: 900 }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { ...POSITANO }
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 0)
  assert.ok(world.debugEvents.some((e) => e.event_type === 'sentinel_ignored'))
})

test('sentinel enter (registration state determination) does nothing', async () => {
  setSentinel(); await fire('enter', SENTINEL)
  assert.equal(world.geofenceCalls.length, 0); assert.equal(world.rpcCalls.length, 0)
})

test('concurrent callbacks: five simultaneous sentinel exits produce at most one refresh plus one coalesced follow-up, never overlapping', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { ...FAR_EAST }; world.startDelayMs = 25
  await Promise.all([1, 2, 3, 4, 5].map(() => fire('exit', SENTINEL)))
  assert.ok(world.geofenceCalls.length >= 1 && world.geofenceCalls.length <= 2, `registrations: ${world.geofenceCalls.length}`)
  // the 60 s minimum gap means the coalesced follow-up is gated, not a second re-registration
  assert.equal(world.geofenceCalls.length, 1)
  assert.ok(world.inserts.some((r) => r.error_message === 'gated_min_gap') || world.inserts.length === 1)
})

test('offline: the device cache serves the refresh (no network fetch needed when the cache covers the position)', async () => {
  // build a cache at Positano while online
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3); world.fix = { ...FAR_EAST }
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.fetchCount >= 1, true); const fetchesOnline = world.fetchCount
  // now offline, minutes later, further along
  clockOffset += 5 * 60 * 1000; world.fixTimestamp = Date.now()
  world.online = false; world.fix = { ...POSITANO }
  setRegisteredAt(Date.now() - 10 * 60e3)
  world.storage.set('visitCoverageRefreshTimes', JSON.stringify([Date.now() - 5 * 60e3]))
  setSentinel({ lat: FAR_EAST.latitude, lng: FAR_EAST.longitude, radiusM: 700 })
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 2, 'refreshed from cache while offline')
  assert.equal(world.fetchCount, fetchesOnline, 'no network fetch was needed')
})

test('offline with no usable cache: keeps the previous set, flags needsRefresh, does not register a guess', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3); world.online = false; world.fix = { ...FAR_EAST }
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 0)
  const state = JSON.parse(world.storage.get('visitCoverageSentinel'))
  assert.equal(state.needsRefresh, true)
  assert.equal(world.inserts.length, 0, 'offline the diagnostics row is queued locally, not lost')
  assert.equal(JSON.parse(world.storage.get('visitCoverageLogQueue')).at(-1).registration_state, 'kept_previous_set')
  // connectivity returns: the next geofence event retries the unresolved refresh and uploads the queued diagnostics
  world.online = true
  await fire('exit', 'some-venue-not-open')
  assert.equal(world.geofenceCalls.length, 1)
  assert.ok(world.inserts.some((r) => r.registration_state === 'kept_previous_set') && world.inserts.some((r) => r.registration_state === 'ok_monitored'))
})

test('no recent fix: nothing is re-registered around a stale position', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3); world.fix = null
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 0)
  assert.equal(JSON.parse(world.storage.get('visitCoverageSentinel')).needsRefresh, true)
})

test('a stale last-known position is never used to centre a new set', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { ...FAR_EAST }; world.fixTimestamp = Date.now() - 20 * 60e3 // the OS only has a 20-minute-old fix
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 0)
  assert.equal(JSON.parse(world.storage.get('visitCoverageSentinel')).needsRefresh, true)
})

test('opt-out / gate off: with the sentinel state cleared a late sentinel callback re-registers nothing', async () => {
  setSentinel(); world.storage.delete('visitCoverageSentinel')
  world.fix = { ...FAR_EAST }
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 0)
  assert.ok(world.debugEvents.some((e) => e.event_type === 'sentinel_ignored'))
})

test('born outside: an exit right after our own registration re-centers a bounded number of times', async () => {
  setSentinel({ bornOutsideRetries: 0 }); setRegisteredAt(Date.now() - 3000); world.fix = { ...FAR_EAST }
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(JSON.parse(world.storage.get('visitCoverageSentinel')).bornOutsideRetries, 1)
})

test('presence preserved: an open venue outside the nearest 18 stays registered; the open map is untouched by a refresh', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3); world.fix = { ...FAR_EAST }
  // an eligible venue within 30 km of the phone that is NOT among the nearest 18 (Florence rows in the fixture are ~500 km away and irrelevant)
  const R = 6371000, rad = (d) => (d * Math.PI) / 180
  const dist = (i) => { const x = Math.sin(rad(i.maps_lat - FAR_EAST.latitude) / 2) ** 2 + Math.cos(rad(FAR_EAST.latitude)) * Math.cos(rad(i.maps_lat)) * Math.sin(rad(i.maps_lng - FAR_EAST.longitude) / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) }
  const eligibleNear = FX.items.filter((i) => FX.profiles[i.visit_profile_key] && !FX.profiles[i.visit_profile_key].manual_only && i.is_active && dist(i) < 30000).sort((a, b) => dist(a) - dist(b))
  const farVenue = eligibleNear[eligibleNear.length - 1]
  assert.ok(eligibleNear.indexOf(farVenue) >= 18, 'fixture has an eligible venue outside the nearest 18')
  const open = { [farVenue.id]: Date.now() - 30 * 60e3 }
  world.storage.set('visitPresenceOpen', JSON.stringify(open))
  await fire('exit', SENTINEL)
  assert.ok(world.geofenceCalls[0].regions.some((r) => r.identifier === farVenue.id), 'venue with an open session is kept')
  assert.deepEqual(JSON.parse(world.storage.get('visitPresenceOpen')), open, 'refresh never closes or alters open sessions')
})

test('venue events still take the presence path: a real enter is reported, a duplicate is not, a non-open exit is skipped', async () => {
  const venue = FX.items.find((i) => FX.profiles[i.visit_profile_key] && !FX.profiles[i.visit_profile_key].manual_only && i.is_active)
  setSentinel({ lat: venue.maps_lat, lng: venue.maps_lng }); setRegisteredAt(Date.now() - 10 * 60e3); world.fix = { latitude: venue.maps_lat, longitude: venue.maps_lng, accuracy: 10 }
  await fire('enter', venue.id)
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_enter').length, 1)
  await fire('enter', venue.id)  // re-delivered soon after: duplicate
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_enter').length, 1)
  await fire('exit', 'another-venue-we-never-entered')
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_exit').length, 0)
  assert.equal(world.geofenceCalls.length, 0, 'venue events do not re-register regions')
})

test('an exit right after our own registration is reconciled without a departure time (region replacement is not a departure)', async () => {
  const venue = FX.items.find((i) => FX.profiles[i.visit_profile_key] && !FX.profiles[i.visit_profile_key].manual_only && i.is_active)
  world.storage.set('visitPresenceOpen', JSON.stringify({ [venue.id]: Date.now() - 40 * 60e3 }))
  setRegisteredAt(Date.now() - 2000)
  world.fix = { latitude: venue.maps_lat + 0.02, longitude: venue.maps_lng, accuracy: 10 }
  await fire('exit', venue.id)
  const names = world.rpcCalls.map((c) => c.name)
  assert.deepEqual(names, ['visit_presence_reconcile'])
  assert.ok(!('p_client_departed_at' in world.rpcCalls[0].args))
})

test('the classic path is what runs without the flag (public users): no sentinel is registered', async () => {
  world.flags.candidate_visit_sentinel_refresh = false
  await tracker.forceRefreshGeofences('user-1')
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.geofenceCalls[0].regions.some((r) => r.identifier === SENTINEL), false)
  assert.ok(world.geofenceCalls[0].regions.length <= 19)
  assert.equal(world.inserts.at(-1).refresh_cause ?? null, null, 'classic rows carry no refresh_cause')
})

test('the flag on: a manual refresh registers 18 venues + sentinel and records the cause', async () => {
  await tracker.forceRefreshGeofences('user-1')
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.geofenceCalls[0].regions.length, 19)
  assert.equal(world.inserts.at(-1).refresh_cause, 'manual')
  assert.equal(JSON.parse(world.storage.get('visitCoverageSentinel')).radiusM, sentinelRegion(world.geofenceCalls[0]).radius)
})

test('rollback switch: a sentinel wake with the flag explicitly OFF drops the sentinel and registers the classic set', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3); world.fix = { ...FAR_EAST }
  world.flags.candidate_visit_sentinel_refresh = false
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.geofenceCalls[0].regions.some((r) => r.identifier === SENTINEL), false, 'no sentinel in the classic registration')
  assert.ok(world.geofenceCalls[0].regions.length <= 19)
  assert.equal(world.storage.has('visitCoverageSentinel'), false, 'sentinel state cleared')
  assert.ok(world.inserts.some((r) => r.error_message === 'flag_off_fallback_classic'))
})

test('an unreadable flag (offline) is NOT a rollback: the sentinel keeps working from the cache', async () => {
  setSentinel(); setRegisteredAt(Date.now() - 10 * 60e3); world.fix = { ...FAR_EAST }
  await fire('exit', SENTINEL)                  // online: builds the cache
  clockOffset += 5 * 60 * 1000; world.fixTimestamp = Date.now()
  world.online = false; world.flagsUnreadable = true; world.flags.candidate_visit_sentinel_refresh = false
  world.fix = { ...POSITANO }
  setRegisteredAt(Date.now() - 10 * 60e3); setSentinel({ lat: FAR_EAST.latitude, lng: FAR_EAST.longitude, radiusM: 700 })
  world.storage.set('visitCoverageRefreshTimes', JSON.stringify([Date.now() - 5 * 60e3]))
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 2)
  assert.equal(world.geofenceCalls[1].regions.some((r) => r.identifier === SENTINEL), true)
})

test('"born outside" exits that a fresh fix contradicts are ignored (field log: one followed every background re-registration)', async () => {
  setSentinel({ bornOutsideRetries: 0 }); setRegisteredAt(Date.now() - 2000)
  world.fix = { latitude: 40.628, longitude: 14.488, accuracy: 10 } // at the sentinel's centre
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 0)
  assert.ok(world.debugEvents.some((e) => e.event_type === 'sentinel_ignored' && e.detail.reason === 'born_outside_fix_inside'))
  assert.equal(JSON.parse(world.storage.get('visitCoverageSentinel')).needsRefresh, false, 'no pointless retry is queued')
})

// ---------------------------------------------------------------- evidence quality on the phone
const someVenue = () => FX.items.find((i) => FX.profiles[i.visit_profile_key] && !FX.profiles[i.visit_profile_key].manual_only && i.is_active)

test('enter reports the fix AGE to the server and never falls back to an old last-known position', async () => {
  const v = someVenue()
  setSentinel({ lat: v.maps_lat, lng: v.maps_lng }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { latitude: v.maps_lat, longitude: v.maps_lng, accuracy: 9 }; world.fixTimestamp = Date.now() - 4000
  await fire('enter', v.id)
  const call = world.rpcCalls.find((c) => c.name === 'visit_presence_enter')
  assert.ok(call, 'an enter was reported')
  assert.ok(call.args.p_fix_age_s >= 3.5 && call.args.p_fix_age_s < 10, `age sent: ${call.args.p_fix_age_s}`)
})

test('a stale OS position is not used to report presence: the enter is queued for a fresh fix instead', async () => {
  const v = someVenue()
  setSentinel({ lat: v.maps_lat, lng: v.maps_lng }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { latitude: v.maps_lat, longitude: v.maps_lng, accuracy: 9 }; world.fixTimestamp = Date.now() - 30 * 60e3   // 30 minutes old
  await fire('enter', v.id)
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_enter').length, 0)
  const pending = JSON.parse(world.storage.get('visitPresencePending'))
  assert.equal(pending.length, 1); assert.equal(pending[0].itemId, v.id); assert.equal(pending[0].lat, null)
})

test('a rejected-as-uncertain enter is retried with a fresh fix later; a genuine arrival is then accepted (no blanket exclusion)', async () => {
  const v = someVenue()
  setSentinel({ lat: v.maps_lat, lng: v.maps_lng }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.fix = { latitude: v.maps_lat + 0.0019, longitude: v.maps_lng, accuracy: 10 }   // ~210 m away: e.g. the lodging next door
  world.rpcResponder = (name) => (name === 'visit_presence_enter' ? { status: 'rejected', reason: 'fix_outside_venue' } : undefined)
  await fire('enter', v.id)
  assert.equal(JSON.parse(world.storage.get('visitPresencePending')).length, 1, 'kept for a later fresh fix')
  assert.equal(JSON.parse(world.storage.get('visitPresenceOpen') ?? '{}')[v.id], undefined, 'no session considered open')
  // later: the user walks to the venue; the next callback flushes the retry with a NEW fix
  clockOffset += 10 * 60 * 1000; world.fixTimestamp = Date.now()
  world.fix = { latitude: v.maps_lat, longitude: v.maps_lng, accuracy: 7 }
  world.rpcResponder = (name) => (name === 'visit_presence_enter' ? { status: 'opened' } : undefined)
  await fire('exit', 'some-other-venue')    // any callback flushes pending reports
  const enters = world.rpcCalls.filter((c) => c.name === 'visit_presence_enter')
  assert.equal(enters.length, 2)
  assert.ok(Math.abs(enters[1].args.p_lat - v.maps_lat) < 1e-9, 'the retry used the new fix, not the old one')
  assert.equal(JSON.parse(world.storage.get('visitPresencePending') ?? '[]').length, 0)
  assert.ok(JSON.parse(world.storage.get('visitPresenceOpen'))[v.id], 'session opened from the retry; time starts now, never backdated')
})

test('rejected enters are retried only for a bounded time (90 min), then dropped', async () => {
  const v = someVenue()
  setSentinel({ lat: v.maps_lat, lng: v.maps_lng }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.storage.set('visitPresencePending', JSON.stringify([{ type: 'enter', itemId: v.id, lat: null, lng: null, accuracy: null, queuedAt: Date.now() - 100 * 60e3 }]))
  world.fix = { latitude: v.maps_lat, longitude: v.maps_lng, accuracy: 7 }
  await fire('exit', 'some-other-venue')
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_enter').length, 0)
  assert.equal(JSON.parse(world.storage.get('visitPresencePending') ?? '[]').length, 0)
})

test('opportunistic drift refresh: a venue callback whose fresh fix is already outside the sentinel triggers a (gated) refresh', async () => {
  const v = someVenue()
  setSentinel({ lat: v.maps_lat + 0.05, lng: v.maps_lng, radiusM: 700 }); setRegisteredAt(Date.now() - 10 * 60e3)   // the OS exit was never delivered
  world.fix = { latitude: v.maps_lat, longitude: v.maps_lng, accuracy: 8 }
  await fire('enter', v.id)
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.inserts.at(-1).refresh_cause, 'sentinel_drift')
  assert.equal(world.inserts.at(-1).registration_state, 'ok_monitored')
})

test('reconcile carries the fix age and never claims a departure time', async () => {
  const v = someVenue()
  world.storage.set('visitPresenceOpen', JSON.stringify({ [v.id]: Date.now() - 40 * 60e3 }))
  setRegisteredAt(Date.now() - 2000)
  world.fix = { latitude: v.maps_lat + 0.02, longitude: v.maps_lng, accuracy: 10 }; world.fixTimestamp = Date.now() - 2000
  await fire('exit', v.id)
  const rec = world.rpcCalls.find((c) => c.name === 'visit_presence_reconcile')
  assert.ok(rec && rec.args.p_fix_age_s >= 1 && rec.args.p_fix_age_s < 8)
  assert.ok(!('p_client_departed_at' in rec.args))
})

test('retries have no timer: a queued rejected enter is retried by the next real wake-up, including a sentinel refresh, and never by waiting', async () => {
  const v = someVenue()
  setSentinel({ lat: 40.628, lng: 14.488, radiusM: 700 }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.storage.set('visitPresencePending', JSON.stringify([{ type: 'enter', itemId: v.id, lat: null, lng: null, accuracy: null, queuedAt: Date.now() - 5 * 60e3 }]))
  // time passes with no wake-up: nothing happens (there is no timer)
  clockOffset += 20 * 60e3; world.fixTimestamp = Date.now()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(world.rpcCalls.filter((c) => c.name === 'visit_presence_enter').length, 0)
  // a sentinel exit (a real OS wake-up) re-centres coverage AND retries the queued enter with the fresh fix
  world.fix = { latitude: v.maps_lat, longitude: v.maps_lng, accuracy: 7 }; world.fixTimestamp = Date.now()
  setRegisteredAt(Date.now() - 10 * 60e3)
  world.storage.set('visitCoverageSentinel', JSON.stringify({ lat: v.maps_lat + 0.05, lng: v.maps_lng, radiusM: 700, registeredAt: Date.now() - 10 * 60e3, signature: 'x', needsRefresh: false, bornOutsideRetries: 0 }))
  await fire('exit', SENTINEL)
  assert.equal(world.geofenceCalls.length, 1)
  const enters = world.rpcCalls.filter((c) => c.name === 'visit_presence_enter')
  assert.equal(enters.length, 1); assert.equal(enters[0].args.p_item_id, v.id)
})

// ================================================================ native movement refresh (branch native/movement-refresh)
const hint = (over = {}) => ({ latitude: 40.634, longitude: 14.603, accuracy: 800, timestampMs: Date.now() - 20e3, receivedAtMs: Date.now(), appState: 2, ...over })
const emitMovement = async () => { for (const cb of world.native.listeners) await cb({}) }

test('movement: a hint that puts the phone out of coverage refreshes it (cause movement_update) with diagnostics, and touches no presence RPC', async () => {
  setSentinel({ lat: 40.624, lng: 14.507, radiusM: 1500 }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.storage.set('visitMovementEnabled', '1'); world.fix = { latitude: 40.634, longitude: 14.603, accuracy: 15 }
  world.nativeHints = [hint()]
  await emitMovement()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.inserts.at(-1).refresh_cause, 'movement_update')
  assert.equal(world.inserts.at(-1).coverage.movement.source, 'fix')
  assert.ok(world.inserts.at(-1).coverage.movement.driftM > 5000)
  assert.deepEqual(world.rpcCalls.filter((c) => /presence|candidate|check/.test(c.name)), [])
  assert.ok(world.debugEvents.some((e) => e.event_type === 'movement_update'))
})

test('movement: a hint inside the current coverage is ignored and logged (no re-registration, no network)', async () => {
  setSentinel({ lat: 40.634, lng: 14.603, radiusM: 1500 }); world.storage.set('visitMovementEnabled', '1')
  world.fix = { latitude: 40.6345, longitude: 14.6035, accuracy: 15 }; world.nativeHints = [hint()]
  await emitMovement(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 0)
  assert.ok(world.debugEvents.some((e) => e.event_type === 'movement_ignored' && e.detail.reason === 'within_coverage'))
})

test('movement + sentinel dedupe: a sentinel exit and a movement hint arriving together produce ONE registration', async () => {
  setSentinel({ lat: 40.624, lng: 14.507, radiusM: 700 }); setRegisteredAt(Date.now() - 10 * 60e3)
  world.storage.set('visitMovementEnabled', '1'); world.fix = { latitude: 40.634, longitude: 14.603, accuracy: 12 }; world.startDelayMs = 25
  world.nativeHints = [hint()]
  await Promise.all([fire('exit', SENTINEL), emitMovement()])
  await new Promise((r) => setTimeout(r, 120))
  assert.equal(world.geofenceCalls.length, 1, `registrations: ${world.geofenceCalls.length}`)
})

test('movement: opted-out / cleared state ignores a late native wake-up and stops the native service', async () => {
  setSentinel(); world.nativeHints = [hint()]          // visitMovementEnabled was cleared by opt-out
  await emitMovement(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 0); assert.equal(world.nativeStopCalls, 1)
})

test('movement: remote rollback (flag explicitly OFF) stops the native service; an unreadable flag does not', async () => {
  setSentinel({ lat: 40.624, lng: 14.507, radiusM: 1500 }); world.storage.set('visitMovementEnabled', '1'); world.fix = { latitude: 40.634, longitude: 14.603, accuracy: 15 }
  world.flags.candidate_visit_movement_refresh = false; world.nativeHints = [hint()]
  await emitMovement(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 0); assert.equal(world.nativeStopCalls, 1); assert.equal(world.storage.get('visitMovementEnabled') ?? null, null)
  // unreadable
  world.storage.set('visitMovementEnabled', '1'); world.flagsUnreadable = true; world.flags.candidate_visit_movement_refresh = false; world.nativeHints = [hint()]
  clockOffset += 5 * 60e3; world.fixTimestamp = Date.now()
  await emitMovement(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 1, 'kept running')
})

test('movement: offline with a covering cache refreshes from the cache; with none it keeps the previous set', async () => {
  setSentinel({ lat: 40.624, lng: 14.507, radiusM: 700 }); setRegisteredAt(Date.now() - 10 * 60e3); world.storage.set('visitMovementEnabled', '1')
  world.fix = { latitude: 40.634, longitude: 14.603, accuracy: 12 }; world.nativeHints = [hint()]
  world.online = false
  await emitMovement(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 0, 'no cache yet and offline: nothing is guessed')
  assert.ok(JSON.parse(world.storage.get('visitCoverageLogQueue')).some((r) => r.refresh_cause === 'movement_update' && r.registration_state === 'kept_previous_set'))
})

test('movement: in-progress presence sessions survive a movement refresh', async () => {
  setSentinel({ lat: 40.624, lng: 14.507, radiusM: 700 }); setRegisteredAt(Date.now() - 10 * 60e3); world.storage.set('visitMovementEnabled', '1')
  world.fix = { latitude: 40.634, longitude: 14.603, accuracy: 12 }; world.nativeHints = [hint()]
  const open = { 'some-open-venue': Date.now() - 30 * 60e3 }
  world.storage.set('visitPresenceOpen', JSON.stringify(open))
  await emitMovement(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 1)
  assert.deepEqual(JSON.parse(world.storage.get('visitPresenceOpen')), open)
})

test('movement: a stale/coarse hint with no fresh fix is only a wake-up: ignored, never used as a position', async () => {
  setSentinel({ lat: 40.624, lng: 14.507, radiusM: 700 }); world.storage.set('visitMovementEnabled', '1'); world.fix = null
  world.nativeHints = [hint({ timestampMs: Date.now() - 30 * 60e3 })]
  await emitMovement(); await new Promise((r) => setTimeout(r, 20))
  assert.equal(world.geofenceCalls.length, 0)
  assert.ok(world.debugEvents.some((e) => e.event_type === 'movement_ignored' && /stale_or_coarse/.test(e.detail.reason)))
})

test('movement: with the coverage (sentinel) flag off the classic 19-venue refresh is used', async () => {
  world.flags.candidate_visit_sentinel_refresh = false; world.storage.set('visitMovementEnabled', '1')
  world.fix = { latitude: 40.634, longitude: 14.603, accuracy: 12 }; world.nativeHints = [hint()]
  await emitMovement(); await new Promise((r) => setTimeout(r, 40))
  assert.equal(world.geofenceCalls.length, 1)
  assert.equal(world.geofenceCalls[0].regions.some((r) => r.identifier === SENTINEL), false)
})

test('movement start/stop follows flag, opt-in and Always permission', async () => {
  assert.equal(await tracker.syncMovementMonitoring('u', true), 'started')
  assert.equal(world.storage.get('visitMovementEnabled'), '1'); assert.equal(world.nativeStartCalls, 1)
  world.bgPermission = false
  assert.equal(await tracker.syncMovementMonitoring('u', true), 'no_always_permission')
  assert.equal(world.storage.get('visitMovementEnabled') ?? null, null)
  world.bgPermission = true; world.flags.candidate_visit_movement_refresh = false
  assert.equal(await tracker.syncMovementMonitoring('u', true), 'stopped')
  world.flags.candidate_visit_movement_refresh = true; world.nativeStartResult = 'no_always_permission'
  assert.equal(await tracker.syncMovementMonitoring('u', true), 'no_always_permission')
  world.nativeStartResult = null
  assert.equal(await tracker.syncMovementMonitoring('u', false), 'stopped')   // opted out / feature off
  assert.equal(world.nativeRunning, false)
})
