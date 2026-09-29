import { useEffect, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import * as Updates from 'expo-updates'
import { describeClientBundle } from './clientBundle'
import { supabase } from '../supabase'
import { fetchAllRows } from '../supabasePagination'
import { isFlagEnabled } from '../featureFlags'
import { shouldRunVisitDetection } from './recoveryPolicy'
import { fetchOptIn, subscribeRecoveryChange } from './recoverySettings'
import { pruneOpen, shouldSendEnter, decideExit, markOpen, markClosed, replaceOpen, isFixFresh } from './presenceClient'
import { getVisitProfiles } from './profiles'
import { visitGeofenceRadiusM, isFixInsideVenue } from './visitPipeline'
import { hasBackgroundLocationPermission } from './permissions'
import { classifyVisitEligibility, MAX_MONITORED_REGIONS } from './visitEligibility'
import { routeGeofenceEvent } from './eventRouter'
import { planCoverage, regionSignature } from './coveragePlanner'
import { cacheStatus, decideCacheSource, buildCache, fetchWindow } from './coverageCache'
import { createRefreshCoordinator } from './refreshCoordinator'
import { judgeSentinelExit, sentinelRefreshGate, MAX_BORN_OUTSIDE_RETRIES, SENTINEL_INSIDE_FRACTION } from './sentinel'
import {
  ARRIVAL_KEY_PREFIX, PENDING_KEY, OPEN_KEY, REGISTERED_AT_KEY, SENTINEL_STATE_KEY, COVERAGE_CACHE_KEY, PROFILES_CACHE_KEY,
  REFRESH_TIMES_KEY, REFRESH_LOG_QUEUE_KEY, isVisitStateKey,
} from './trackerKeys'

// =============================================================================
// PHASE 1 SCOPE — read before changing thresholds or behavior here.
//
// This module validates HISTORICAL candidate-visit detection only: a
// candidate_visits row is created on geofence EXIT, once arrival→departure
// gives us a real dwell duration. It does NOT validate, and must not be
// extended to attempt, real-time dwell notification timing — there is no
// mechanism here that can act *while the user is still at the venue*, since
// dwell is only known in hindsight, after the exit event fires. A future
// "What's the thing?" real-time prompt needs a different mechanism (e.g. a
// timer armed on ENTER that re-checks presence at the profile's candidate
// threshold) layered on top of this — not built here, and no notification-
// sending code exists anywhere in this file on purpose.
//
// TERMINATION BEHAVIOR (verify during the pilot, don't assume):
//   iOS     — region monitoring can relaunch the app in the background to
//             deliver an event ONLY if the OS terminated the app (e.g. under
//             memory pressure). If the user force-quits via the app
//             switcher, iOS will NOT relaunch the app for geofence events
//             until the user manually reopens it — any visit that starts and
//             ends while force-quit is silently missed, with no error to log.
//   Android — a terminated app is generally NOT guaranteed to receive
//             background location/geofence broadcasts; behavior varies by
//             OS version and OEM battery-management policy (some vendors
//             kill background work aggressively regardless of the
//             permissions granted). Do not represent Android detection as
//             reliable after force termination — test foreground,
//             backgrounded, and swiped-away explicitly and expect gaps in
//             the last case.
// =============================================================================

const GEOFENCE_TASK_NAME = 'checkoff-candidate-visit-geofence'

// iOS caps monitored regions at 20 per app. We register 19, not 20 — the
// spare slot is intentional headroom for the moment between stopping the
// previous region set and starting the new one during a refresh (not
// atomic), and for any other feature that might someday also monitor a
// region: it avoids ever hitting the hard cap and having startGeofencingAsync
// silently drop or fail to register the last region.
// (MAX_MONITORED_REGIONS itself lives in ./visitEligibility, imported above)
const NEARBY_RADIUS_M = 30000 // only consider items within ~30km of the last known device position
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // AppState can fire in rapid succession; don't re-query/re-register faster than this

let lastRefreshAt = 0

// Registered once at module load, per expo-task-manager's requirement that
// defineTask run outside any component lifecycle.
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    await logDebugEventForCurrentUser('task_error', null, { message: error.message ?? String(error) })
    return
  }
  const { eventType, region } = data ?? {}
  if (!region?.identifier) return

  try {
    const isEnter = eventType === Location.GeofencingEventType.Enter
    const kind = isEnter ? 'enter' : 'exit'
    const registeredAtMs = Number((await AsyncStorage.getItem(REGISTERED_AT_KEY)) ?? 0) || null

    // Sentinel events are decided BEFORE any venue logic and can never reach it (eventRouter.js).
    const sentinel = await readSentinelState()
    const first = routeGeofenceEvent({ eventType: kind, regionId: region.identifier, sentinel, openMap: {}, registeredAtMs, nowMs: Date.now(), maxBornOutsideRetries: MAX_BORN_OUTSIDE_RETRIES })
    if (first.kind.startsWith('sentinel_')) { await handleSentinelRoute(first, sentinel); return }

    // Venue path (unchanged behavior): flush queued reports first, then decide from the up-to-date open sessions.
    await flushPendingPresence()
    const route = routeGeofenceEvent({ eventType: kind, regionId: region.identifier, sentinel, openMap: await readOpen(), registeredAtMs, nowMs: Date.now(), maxBornOutsideRetries: MAX_BORN_OUTSIDE_RETRIES })
    // The SERVER starts the visit clock (visit_presence_enter stamps entered_at with its own time and keeps the original
    // stamp when iOS re-delivers "enter" on every geofence re-registration). The phone only reports that it entered,
    // with a location fix. A venue the user is already inside when it is (re-)registered therefore starts its clock at
    // the moment evidence begins, never earlier.
    if (route.kind === 'venue_enter') {
      await logDebugEventForCurrentUser('enter', route.itemId, {})
      await reportEnter(route.itemId)
    } else if (route.kind === 'venue_exit_reconcile') {
      await reconcileNow()
    } else if (route.kind === 'venue_exit_report') {
      await reportDeparture(route.itemId)
    }
    // venue_enter_duplicate / venue_exit_skip: nothing to do (re-delivered state determinations).
    await retryUnresolvedRefresh()
  } catch (e) {
    await logDebugEventForCurrentUser('task_error', region.identifier, { message: e?.message ?? String(e) })
  }
})

async function currentUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

async function logDebugEventForCurrentUser(eventType, itemId, detail) {
  try {
    const userId = await currentUserId()
    if (!userId) return
    await supabase.from('geofence_debug_events').insert({
      user_id: userId,
      item_id: itemId,
      event_type: eventType,
      detail,
    })
  } catch (e) {
    console.warn('geofence debug event log failed:', e?.message ?? e)
  }
}

// Live field testing (2026-08-29/30) showed exit callbacks firing while the
// user was still physically inside a venue — almost certainly GPS noise
// indoors, or a state re-check triggered by re-registering the full
// geofence list on every refresh. Verifying with a fresh location fix
// before trusting an exit as a real departure fixes the failure mode where
// a single spurious exit permanently kills dwell tracking for the rest of
// a real, hours-long visit (the arrival record was being deleted on the
// FIRST exit signal, with no way to recover once the real exit came later
// and found nothing to compute a dwell from).
//
// Returns { stillInside, coords } — stillInside is true (ignore this exit),
// false (confirmed departure), or null (couldn't get a fix — caller falls
// back to trusting the OS signal). coords is the fix used for the decision
// (or null), reused by the caller for the accuracy / stopped-vs-driving
// confidence signals without a second location request. Uses the SAME
// visit radius the geofence was registered with (visitGeofenceRadiusM), plus
// the fix's own reported accuracy as GPS-noise slack (see isFixInsideVenue).
async function isStillInsideRadius(item) {
  if (item.maps_lat == null || item.maps_lng == null) return { stillInside: false, coords: null }
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]).catch(() => Location.getLastKnownPositionAsync({}))
    if (!pos?.coords) return { stillInside: null, coords: null }

    return { stillInside: isFixInsideVenue(pos.coords, item), coords: pos.coords }
  } catch {
    return { stillInside: null, coords: null }
  }
}

// ---------------------------------------------------------------------------
// Presence reporting. The phone reports; the SERVER decides (see
// supabase/migrations/20260929_visit_presence_sessions.sql): it times the stay
// with its own clock, validates the fix, scores the visit, checks ambiguity,
// and is the only writer of candidate_visits. Reports that fail (offline) are
// queued and retried; a late "enter" only ever SHORTENS the recorded stay, and
// a late "exit" carries the real departure time, which the server clamps to
// [entered_at, now].
// ---------------------------------------------------------------------------
const MAX_PENDING = 20

async function readPending() {
  try { return JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? '[]') } catch { return [] }
}
async function writePending(list) {
  try { await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING))) } catch {}
}
async function queuePending(entry) {
  const list = await readPending()
  await writePending([...list.filter(e => !(e.type === entry.type && e.itemId === entry.itemId)), entry])
}

async function readOpen() {
  try { return pruneOpen(JSON.parse((await AsyncStorage.getItem(OPEN_KEY)) ?? '{}'), Date.now()) } catch { return {} }
}
async function writeOpen(map) { try { await AsyncStorage.setItem(OPEN_KEY, JSON.stringify(map)) } catch {} }

let lastFix = null // { coords, at } — simultaneous callbacks (dense areas) share one fix

async function getFix() {
  if (lastFix && isFixFresh(lastFix.at, Date.now())) return lastFix.coords
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]).catch(() => Location.getLastKnownPositionAsync({}))
    if (pos?.coords) lastFix = { coords: pos.coords, at: Date.now() }
    return pos?.coords ?? null
  } catch { return null }
}

// A fix for choosing the next venue set: fresh, or at most FIX_MAX_AGE_MS old. An arbitrarily old "last known" position
// would centre the new set (and the sentinel) somewhere the phone no longer is.
const FIX_MAX_AGE_MS = 2 * 60 * 1000
async function getRecentFix() {
  if (lastFix && isFixFresh(lastFix.at, Date.now())) return lastFix.coords
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]).catch(() => Location.getLastKnownPositionAsync({ maxAge: FIX_MAX_AGE_MS }))
    if (pos?.coords && (pos.timestamp == null || Date.now() - pos.timestamp <= FIX_MAX_AGE_MS)) {
      lastFix = { coords: pos.coords, at: Date.now() }
      return pos.coords
    }
    return null
  } catch { return null }
}

async function sendEnter({ itemId, lat, lng, accuracy }) {
  const { data, error } = await supabase.rpc('visit_presence_enter', { p_item_id: itemId, p_lat: lat, p_lng: lng, p_accuracy: accuracy ?? null })
  if (error) throw error
  await logDebugEventForCurrentUser('presence_enter_result', itemId, { status: data?.status, reason: data?.reason })
  const open = await readOpen()
  await writeOpen(data?.status === 'opened' || data?.status === 'already_open' ? markOpen(open, itemId, Date.now()) : markClosed(open, itemId))
  return data
}

async function sendExit({ itemId, lat, lng, accuracy, speed, departedAt }) {
  const { data, error } = await supabase.rpc('visit_presence_exit', {
    p_item_id: itemId, p_lat: lat ?? null, p_lng: lng ?? null, p_accuracy: accuracy ?? null,
    p_speed: speed != null && speed >= 0 ? speed : null, p_client_departed_at: departedAt,
  })
  if (error) throw error
  await logDebugEventForCurrentUser('presence_exit_result', itemId, { outcome: data?.outcome, reason: data?.reason, score: data?.score, dwell: data?.dwell_minutes })
  await writeOpen(markClosed(await readOpen(), itemId))
  return data
}

async function reportEnter(itemId) {
  const fix = await getFix()
  if (!fix) {
    await queuePending({ type: 'enter', itemId, lat: null, lng: null, accuracy: null }) // retried with a fresh fix at the next opportunity
    await logDebugEventForCurrentUser('presence_rpc_failed', itemId, { stage: 'enter', message: 'no location fix' })
    return
  }
  const entry = { type: 'enter', itemId, lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy }
  try { await sendEnter(entry) } catch (e) {
    await queuePending(entry)
    await logDebugEventForCurrentUser('presence_rpc_failed', itemId, { stage: 'enter', message: e?.message ?? String(e) })
  }
}

async function flushPendingPresence() {
  const list = await readPending()
  if (!list.length) return
  const remaining = []
  for (const e of list) {
    try {
      if (e.type === 'enter') {
        const fix = e.lat == null ? await getFix() : null
        if (e.lat == null && !fix) { remaining.push(e); continue }
        await sendEnter(fix ? { ...e, lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy } : e)
      } else await sendExit(e)
    } catch { remaining.push(e) }
  }
  await writePending(remaining)
}

async function reconcileNow() {
  const fix = await getFix()
  if (!fix) return
  const { data, error } = await supabase.rpc('visit_presence_reconcile', { p_lat: fix.latitude, p_lng: fix.longitude, p_accuracy: fix.accuracy ?? null })
  if (error) { await logDebugEventForCurrentUser('presence_rpc_failed', null, { stage: 'reconcile', message: error.message }); return }
  await writeOpen(replaceOpen(data?.open_item_ids, Date.now()))
  if (data?.closed > 0) await logDebugEventForCurrentUser('presence_exit_result', null, { reconcile: true, closed: data.closed })
}

// A live exit (the router already decided this is not a registration-time state determination and that a session is open).
async function reportDeparture(itemId) {
  await logDebugEventForCurrentUser('exit', itemId, {})
  const { data: item } = await supabase
    .from('items')
    .select('id, maps_lat, maps_lng, geo_radius_m')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return

  const { stillInside, coords } = await isStillInsideRadius(item)
  if (stillInside === true) {
    await logDebugEventForCurrentUser('exit_ignored_still_inside', itemId, {})
    return // spurious exit — the server session stays open for the real departure later
  }

  const entry = {
    type: 'exit', itemId, lat: coords?.latitude ?? null, lng: coords?.longitude ?? null,
    accuracy: coords?.accuracy ?? null, speed: coords?.speed ?? null, departedAt: new Date().toISOString(),
  }
  try { await sendExit(entry) } catch (e) {
    await queuePending(entry)
    await logDebugEventForCurrentUser('presence_rpc_failed', itemId, { stage: 'exit', message: e?.message ?? String(e) })
  }
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Classifies every nearby item (not just eligible ones) so a tester can tell
// "monitored, saw nothing" apart from "never monitored" — see
// geofence_registration_log / current_monitored_geofences view.
async function classifyNearbyItems(userLat, userLng) {
  // PAGINATED (2026-09-25 field bug fix — confirmed via production REST
  // query this session: an unbounded .select() here silently caps at
  // PostgREST's default 1000-row limit; the catalog has 1536+ geocoded
  // items, and only 2 of Florence's 96 landed inside that cap, so almost
  // every real nearby venue was silently absent before distance was ever
  // computed — the exact same bug class already fixed in
  // lib/whatsGoodDataAdapter.js (see 8121018's commit message) and
  // documented in lib/supabasePagination.js's own header. This is a
  // global, un-scoped-by-metro query (matches its pre-existing behavior;
  // classifyNearbyItems' own 30km NEARBY_RADIUS_M filter still narrows it
  // down after fetch), so fetchAllRows() rather than a bounding-box filter
  // is the least-behavior-changing fix.
  const { data, error } = await fetchAllRows(() => supabase
    .from('items')
    .select('id, maps_lat, maps_lng, geo_radius_m, visit_profile_key, is_universal, is_active')
    .not('maps_lat', 'is', null)
    .not('maps_lng', 'is', null)
    .order('id'))
  // queryError is surfaced (not swallowed) so refreshGeofences() can log a
  // real query failure distinctly from "the query succeeded and found
  // nothing nearby" — previously both looked identical (monitored: [],
  // excluded: []) both to callers and in the debug panel.
  if (error || !data) return { monitored: [], excluded: [], queryError: error?.message ?? 'items query returned no data' }

  const profiles = await getVisitProfiles()

  const nearby = data
    .map(item => ({ ...item, distanceM: haversine(userLat, userLng, item.maps_lat, item.maps_lng) }))
    .filter(item => item.distanceM <= NEARBY_RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM)

  const monitored = []
  const excluded = []

  for (const item of nearby) {
    const decision = classifyVisitEligibility(item, profiles, monitored.length)
    if (!decision.eligible) {
      excluded.push({ item_id: item.id, distance_m: Math.round(item.distanceM), reason: decision.reason })
      continue
    }
    monitored.push(item)
  }

  return { monitored, excluded, queryError: null }
}

// =============================================================================
// COVERAGE SENTINEL REFRESH (tester-gated: feature flag candidate_visit_sentinel_refresh, see featureFlags.js)
//
// iOS can watch 19 regions; the classic path registers the 19 nearest venues at app launch/foreground and never
// updates them while the app is backgrounded. This path registers the 18 nearest venues plus one large "sentinel"
// circle around where they were chosen. Leaving the circle wakes the app (iOS relaunches a terminated app for region
// events; NOT after the user force-quits it) and the set is re-chosen around the new position from a device cache.
// No continuous GPS. A sentinel event never reaches the venue/presence code: see eventRouter.js.
// The classic path (refreshGeofences below) is untouched and still serves every user without the flag.
// =============================================================================

async function backgroundUserId() {
  // getSession reads local storage (getUser is a network call that can fail in the background / offline).
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user?.id ?? null
}

async function readJson(key, fallback) {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}
async function writeJson(key, value) { try { await AsyncStorage.setItem(key, JSON.stringify(value)) } catch {} }

async function readSentinelState() { return readJson(SENTINEL_STATE_KEY, null) }
async function writeSentinelState(state) {
  if (state == null) { try { await AsyncStorage.removeItem(SENTINEL_STATE_KEY) } catch {} } else await writeJson(SENTINEL_STATE_KEY, state)
}
async function clearSentinelState() { await writeSentinelState(null) }

// Diagnostics for a real walk. Written to geofence_registration_log (one row per attempt, including "kept previous set"
// and failures); rows that cannot be sent offline are queued locally and flushed with the next refresh.
async function logRefreshAttempt(row) {
  const queue = await readJson(REFRESH_LOG_QUEUE_KEY, [])
  queue.push({ ...row, refreshed_at: new Date().toISOString() })
  const remaining = []
  for (const r of queue.slice(-50)) {
    const { error } = await supabase.from('geofence_registration_log').insert(r)
    if (error) remaining.push(r)
  }
  await writeJson(REFRESH_LOG_QUEUE_KEY, remaining)
}

function roundedCoord(v) { return Math.round(v * 1000) / 1000 }

async function loadProfilesForRefresh() {
  const live = await getVisitProfiles()
  if (live && Object.keys(live).length > 0) { await writeJson(PROFILES_CACHE_KEY, live); return { profiles: live, source: 'live' } }
  const cached = await readJson(PROFILES_CACHE_KEY, null)
  return cached && Object.keys(cached).length > 0 ? { profiles: cached, source: 'cache' } : { profiles: null, source: 'none' }
}

async function loadCoverageRows(position) {
  const now = Date.now()
  const cache = await readJson(COVERAGE_CACHE_KEY, null)
  const status = cacheStatus(cache, position, now)
  if (status === 'fresh') return { items: cache.items, status, source: 'cache', ageMs: now - cache.fetchedAt }
  const w = fetchWindow(position)
  const { data, error } = await fetchAllRows(() => supabase
    .from('items')
    .select('id, maps_lat, maps_lng, geo_radius_m, visit_profile_key, is_universal, is_active')
    .gte('maps_lat', w.minLat).lte('maps_lat', w.maxLat).gte('maps_lng', w.minLng).lte('maps_lng', w.maxLng)
    .order('id'))
  if (!error && data) {
    const fresh = buildCache(data, position, now)
    await writeJson(COVERAGE_CACHE_KEY, fresh)
    return { items: fresh.items, status, source: 'fetched', ageMs: 0 }
  }
  const fallback = decideCacheSource({ status, online: false })
  if (fallback === 'use_stale') return { items: cache.items, status, source: 'stale_cache', ageMs: now - cache.fetchedAt }
  return { items: null, status, source: 'unavailable', error: error?.message ?? 'offline' }
}

// One coverage refresh. Never throws; always logs one row. On any failure the previously registered set is left alone
// (it is still valid, just not re-centered) and the sentinel is flagged needsRefresh so the next opportunity retries.
async function refreshCoverage(userId, cause) {
  const startedAt = Date.now()
  const epochAtStart = optOutEpoch
  const base = { user_id: userId, refresh_cause: cause }
  const sentinelBefore = await readSentinelState()
  try {
    // A sentinel-driven refresh only makes sense while a sentinel is active. After opt-out / flag-off / stopTracking the
    // state is gone and a late callback must not re-register anything.
    if (cause.startsWith('sentinel') && !sentinelBefore) return { outcome: 'not_active' }
    if (cause === 'foreground' && !sentinelBefore?.needsRefresh) {
      const recent = await readJson(REFRESH_TIMES_KEY, [])
      if (recent.length && startedAt - recent[recent.length - 1] < MIN_REFRESH_INTERVAL_MS) return { outcome: 'foreground_cooldown' }
    }
    if (!(await hasBackgroundLocationPermission())) {
      await logRefreshAttempt({ ...base, selection_lat: 0, selection_lng: 0, monitored_items: [], excluded_items: [], geofencing_started: false, registration_state: 'kept_previous_set', error_message: 'no_background_permission', coverage: { reason: 'no_background_permission' }, client_build: describeClientBundle(Updates).logString })
      return { outcome: 'no_permission' }
    }

    const isSentinelCause = cause.startsWith('sentinel')
    const times = await readJson(REFRESH_TIMES_KEY, [])
    if (isSentinelCause) {
      const gate = sentinelRefreshGate({ nowMs: startedAt, lastRefreshAtMs: times.length ? times[times.length - 1] : null, recent: times })
      if (!gate.run) {
        if (sentinelBefore) await writeSentinelState({ ...sentinelBefore, needsRefresh: true })
        await logRefreshAttempt({ ...base, selection_lat: 0, selection_lng: 0, monitored_items: [], excluded_items: [], geofencing_started: false, registration_state: 'kept_previous_set', error_message: `gated_${gate.reason}`, coverage: { reason: `gated_${gate.reason}`, retryAfterMs: gate.retryAfterMs }, client_build: describeClientBundle(Updates).logString })
        return { outcome: 'gated', reason: gate.reason }
      }
    }

    const fix = await getRecentFix()
    if (!fix) {
      if (sentinelBefore) await writeSentinelState({ ...sentinelBefore, needsRefresh: true })
      await logRefreshAttempt({ ...base, selection_lat: 0, selection_lng: 0, monitored_items: [], excluded_items: [], geofencing_started: false, registration_state: 'kept_previous_set', error_message: 'no_location_fix', coverage: { reason: 'no_location_fix' }, client_build: describeClientBundle(Updates).logString })
      return { outcome: 'no_fix' }
    }
    const position = { lat: fix.latitude, lng: fix.longitude }

    const rows = await loadCoverageRows(position)
    const { profiles, source: profileSource } = await loadProfilesForRefresh()
    if (!rows.items || !profiles) {
      // Offline (or failing) AND the cache cannot honestly serve this position: do not replace a working set with a guess.
      if (sentinelBefore) await writeSentinelState({ ...sentinelBefore, needsRefresh: true })
      await logRefreshAttempt({ ...base, selection_lat: roundedCoord(position.lat), selection_lng: roundedCoord(position.lng), monitored_items: [], excluded_items: [], geofencing_started: false, registration_state: 'kept_previous_set', error_message: rows.items ? 'no_profiles' : `cache_${rows.status}_offline`, coverage: { reason: rows.items ? 'no_profiles' : `cache_${rows.status}_offline`, cacheStatus: rows.status, profileSource }, client_build: describeClientBundle(Updates).logString })
      return { outcome: 'kept_previous_set' }
    }

    const openIds = Object.keys(await readOpen())
    const plan = planCoverage({ position, items: rows.items, profiles, openItemIds: openIds, sentinelEnabled: true })
    const signature = regionSignature(plan.regions)

    // Foreground/manual refresh with nothing to change: do not re-register (that re-determines every region).
    if ((cause === 'foreground' || cause === 'app_start') && sentinelBefore && sentinelBefore.signature === signature && !sentinelBefore.needsRefresh) {
      const drift = haversine(position.lat, position.lng, sentinelBefore.lat, sentinelBefore.lng)
      if (drift < sentinelBefore.radiusM * 0.5) {
        await logRefreshAttempt({ ...base, selection_lat: roundedCoord(position.lat), selection_lng: roundedCoord(position.lng), monitored_items: plan.monitored.map(i => ({ item_id: i.id, distance_m: Math.round(i.distanceM) })), excluded_items: plan.excluded, geofencing_started: true, registration_state: 'kept_previous_set', error_message: null, coverage: { ...plan.coverage, reason: 'unchanged', cacheStatus: rows.status, cacheSource: rows.source }, client_build: describeClientBundle(Updates).logString })
        return { outcome: 'unchanged' }
      }
    }

    if (epochAtStart !== optOutEpoch) return { outcome: 'opted_out_during_refresh' }
    let registrationState = 'ok_monitored'
    let geofencingStarted = false
    let errorMessage = null
    if (plan.monitored.length === 0) {
      registrationState = 'ok_none_eligible'
      await stopTracking()
      await clearSentinelState()
    } else {
      try {
        // Sentinel state first: the OS starts delivering state determinations as soon as registration begins.
        await writeSentinelState({
          lat: position.lat, lng: position.lng, radiusM: plan.sentinel.radiusM, registeredAt: Date.now(), signature, needsRefresh: false,
          bornOutsideRetries: cause === 'sentinel_born_outside' ? (sentinelBefore?.bornOutsideRetries ?? 0) + 1 : 0,
        })
        await AsyncStorage.setItem(REGISTERED_AT_KEY, String(Date.now())) // callbacks right after this are OS state determinations
        await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, plan.regions)
        geofencingStarted = true
      } catch (e) {
        errorMessage = e?.message ?? String(e)
        registrationState = 'os_registration_error'
        await writeSentinelState(sentinelBefore ? { ...sentinelBefore, needsRefresh: true } : null)
      }
    }
    await writeJson(REFRESH_TIMES_KEY, [...times.filter(t => startedAt - t < 60 * 60 * 1000), startedAt])
    await logRefreshAttempt({
      ...base, selection_lat: roundedCoord(position.lat), selection_lng: roundedCoord(position.lng),
      monitored_items: plan.monitored.map(i => ({ item_id: i.id, distance_m: Math.round(i.distanceM) })),
      excluded_items: plan.excluded, geofencing_started: geofencingStarted, error_message: errorMessage, registration_state: registrationState,
      coverage: { ...plan.coverage, cacheStatus: rows.status, cacheSource: rows.source, cacheAgeMs: rows.ageMs ?? null, profileSource, fixAccuracyM: fix.accuracy ?? null, durationMs: Date.now() - startedAt },
      client_build: describeClientBundle(Updates).logString,
    })
    return { outcome: registrationState }
  } catch (e) {
    try {
      if (sentinelBefore) await writeSentinelState({ ...sentinelBefore, needsRefresh: true })
      await logRefreshAttempt({ ...base, selection_lat: 0, selection_lng: 0, monitored_items: [], excluded_items: [], geofencing_started: false, registration_state: 'kept_previous_set', error_message: `exception: ${e?.message ?? e}`, coverage: { reason: 'exception' }, client_build: describeClientBundle(Updates).logString })
    } catch {}
    return { outcome: 'error' }
  }
}

// Single-flight: bursts of callbacks / foreground / manual triggers become at most one refresh plus one coalesced follow-up.
// Bumped when the user turns visit recovery off, so a refresh already in flight cannot re-register regions afterwards.
let optOutEpoch = 0

const coverageCoordinator = createRefreshCoordinator(async ({ userId, cause }) => refreshCoverage(userId ?? (await backgroundUserId()), cause))

async function requestCoverageRefresh(cause, userId = null) {
  const uid = userId ?? (await backgroundUserId())
  if (!uid) return { outcome: 'no_user' }
  return coverageCoordinator.request({ userId: uid, cause })
}

async function handleSentinelRoute(route, sentinel) {
  if (route.kind === 'sentinel_ignored') {
    if (route.reason !== 'enter') await logDebugEventForCurrentUser('sentinel_ignored', null, { reason: route.reason })
    return
  }
  if (route.kind === 'sentinel_born_outside') {
    await logDebugEventForCurrentUser('sentinel_born_outside', null, { retries: sentinel?.bornOutsideRetries ?? 0 })
    await requestCoverageRefresh('sentinel_born_outside')
    return
  }
  // sentinel_exit_verify: believe the OS only if a fresh fix agrees.
  await logDebugEventForCurrentUser('sentinel_exit', null, { radiusM: sentinel?.radiusM ?? null })
  const fix = await getRecentFix()
  const verdict = judgeSentinelExit({ fix, sentinel, distanceFn: haversine })
  if (verdict === 'ignore_still_inside') {
    await logDebugEventForCurrentUser('sentinel_ignored', null, { reason: 'fix_still_inside', factor: SENTINEL_INSIDE_FRACTION })
    return
  }
  await requestCoverageRefresh('sentinel_exit')
}

// A refresh that could not complete (no fix / gated / offline) leaves needsRefresh set; the next callback or foreground retries.
async function retryUnresolvedRefresh() {
  const sentinel = await readSentinelState()
  if (sentinel?.needsRefresh) await requestCoverageRefresh('sentinel_retry')
}

async function refreshGeofences(userId) {
  const now = Date.now()
  if (now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return
  lastRefreshAt = now

  const hasPermission = await hasBackgroundLocationPermission()
  if (!hasPermission) return // never silently prompt — a settings screen must call requestBackgroundLocationPermission() explicitly first

  const pos = await Location.getLastKnownPositionAsync({}).catch(() => null)
    ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => null)
  if (!pos) return

  const { monitored, excluded, queryError } = await classifyNearbyItems(pos.coords.latitude, pos.coords.longitude)

  let geofencingStarted = false
  let errorMessage = null
  // registration_state gives the debug panel (and anything else reading
  // this log) an explicit, unambiguous outcome instead of re-deriving it
  // from (monitored_items.length, geofencing_started, error_message) —
  // the exact ambiguity that made "0 eligible places nearby" render
  // identically to "the OS geofence call failed" in production. See
  // 2026-09-25 field bug report.
  let registrationState = 'ok_none_eligible'

  if (queryError) {
    registrationState = 'query_error'
    errorMessage = queryError
  } else if (monitored.length === 0) {
    registrationState = 'ok_none_eligible'
    await stopTracking()
  } else {
    try {
      await AsyncStorage.setItem(REGISTERED_AT_KEY, String(Date.now())) // callbacks right after this are OS state determinations
      await Location.startGeofencingAsync(
        GEOFENCE_TASK_NAME,
        monitored.map(item => ({
          identifier: item.id,
          latitude: item.maps_lat,
          longitude: item.maps_lng,
          radius: visitGeofenceRadiusM(item),
          notifyOnEnter: true,
          notifyOnExit: true,
        }))
      )
      geofencingStarted = true
      registrationState = 'ok_monitored'
    } catch (e) {
      errorMessage = e?.message ?? String(e)
      registrationState = 'os_registration_error'
    }
  }

  // Approximate to ~111m (3 decimal places) — enough to sanity-check which
  // venues should have been nearby, not a precise movement trail.
  const roundedLat = Math.round(pos.coords.latitude * 1000) / 1000
  const roundedLng = Math.round(pos.coords.longitude * 1000) / 1000

  await supabase.from('geofence_registration_log').insert({
    user_id: userId,
    selection_lat: roundedLat,
    selection_lng: roundedLng,
    monitored_items: monitored.map(item => ({ item_id: item.id, distance_m: Math.round(item.distanceM) })),
    excluded_items: excluded,
    geofencing_started: geofencingStarted,
    error_message: errorMessage,
    registration_state: registrationState,
    client_build: describeClientBundle(Updates).logString,
  })
}

// Removes any in-progress arrival timestamps (device-local only) — part of "turn off and delete".
async function clearArrivalRecords() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(isVisitStateKey)
    if (keys.length) await AsyncStorage.multiRemove(keys)
  } catch {}
}

async function stopTracking() {
  const started = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK_NAME).catch(() => false)
  if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {})
}

// Bypasses the refresh cooldown — for the tester-only debug panel's manual
// "refresh now" button. Never call this from anywhere else; the cooldown
// exists specifically to keep foreground-triggered refresh lightweight.
export async function forceRefreshGeofences(userId) {
  if (await isFlagEnabled(userId, 'candidate_visit_sentinel_refresh')) {
    await requestCoverageRefresh('manual', userId)
    return
  }
  lastRefreshAt = 0
  await refreshGeofences(userId)
}

// Call from App.jsx alongside useNotifications(userId). Internal/test-user
// and flag gating happens inside isFlagEnabled(); this hook is a no-op for
// everyone else, and never requests background permission on its own.
//
// REFRESH STRATEGY: the monitored set is recomputed on mount and on every
// app-foreground transition (via AppState), not continuously. Expo doesn't
// expose iOS's significant-location-change service or Android's passive/
// low-power location provider without a custom native module, so
// foreground-triggered refresh (with a 5-minute cooldown to avoid
// thrashing on rapid app-switcher use) is the lightest mechanism available
// without adding continuous GPS polling or new native code. Documented
// limitation: if a user travels far enough to leave the monitored set
// while the app stays backgrounded for a long stretch without a foreground
// event, the set won't update until the next foreground — acceptable for
// this pilot, revisit if it causes missed visits during testing.
export function useCandidateVisitTracking(userId) {
  const appStateRef = useRef(AppState.currentState)

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const runRefresh = async (cause = 'foreground') => {
      const flagEnabled = await isFlagEnabled(userId, 'candidate_visit_detection')
      if (cancelled) return
      // Only look up consent for users the feature is actually offered to.
      const optedIn = flagEnabled ? await fetchOptIn(userId) : false
      if (cancelled) return
      if (shouldRunVisitDetection({ flagEnabled, platformOS: Platform.OS, optedIn })) {
        // Tester-gated coverage sentinel; everyone else keeps the classic path below, unchanged.
        const sentinelOn = await isFlagEnabled(userId, 'candidate_visit_sentinel_refresh')
        if (sentinelOn) await requestCoverageRefresh(cause, userId)
        else { await clearSentinelState(); await refreshGeofences(userId) }
        await flushPendingPresence()
        if (Object.keys(await readOpen()).length) await reconcileNow()
      } else {
        await clearSentinelState()
        await stopTracking()
      }
    }

    // Turning the feature on/off in Profile takes effect immediately, not at the next foreground.
    const unsubscribe = subscribeRecoveryChange(async (event) => {
      lastRefreshAt = 0
      if (event?.type === 'turned_off') { optOutEpoch += 1; await clearArrivalRecords() }
      runRefresh('opt_in_change')
    })

    runRefresh('app_start')

    const subscription = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        runRefresh('foreground')
      }
      appStateRef.current = nextState
    })

    return () => {
      cancelled = true
      unsubscribe()
      subscription.remove()
    }
  }, [userId])
}
