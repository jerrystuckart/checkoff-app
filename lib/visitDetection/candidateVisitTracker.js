import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { supabase } from '../supabase'
import { isFlagEnabled } from '../featureFlags'
import { getVisitProfiles } from './profiles'
import { computeConfidenceScore, bandForScore } from './confidenceScore'
import { hasBackgroundLocationPermission } from './permissions'
import { DEFAULT_GEOFENCE_RADIUS_M } from '../geoFence'
import { classifyVisitEligibility, MAX_MONITORED_REGIONS } from './visitEligibility'

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
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000
const ARRIVAL_KEY_PREFIX = 'candidateVisitArrival:'
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
    if (eventType === Location.GeofencingEventType.Enter) {
      await AsyncStorage.setItem(ARRIVAL_KEY_PREFIX + region.identifier, String(Date.now()))
      await logDebugEventForCurrentUser('enter', region.identifier, {})
      return
    }
    if (eventType === Location.GeofencingEventType.Exit) {
      await logDebugEventForCurrentUser('exit', region.identifier, {})
      await handleDeparture(region.identifier)
    }
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
// ACCURACY_GOOD_M / ACCURACY_POOR_M mirror the intent behind
// visit_confidence_weights' good_location_accuracy / poor_location_accuracy
// rows (10 / -20) — a real threshold, not a guess: expo-location's
// Accuracy.Balanced setting typically yields low-double-digit-meter fixes
// outdoors and 50m+ indoors/urban-canyon, so 20m/65m separates "clearly
// good" from "clearly bad" with a deliberate gap where neither signal fires.
const ACCURACY_GOOD_M = 20
const ACCURACY_POOR_M = 65
// A relaxed walking-pace ceiling (~5.4 km/h) — anything faster at the exact
// moment of departure suggests still-moving/vehicle rather than a stop.
const STOPPED_SPEED_MPS = 1.5

// Returns { stillInside, coords } — stillInside is true (ignore this exit),
// false (confirmed departure), or null (couldn't get a fix — caller falls
// back to trusting the OS signal). coords is the fix used for the decision
// (or null), reused by the caller to restore the good/poor-accuracy and
// stopped-not-driving confidence signals without a second location request.
async function isStillInsideRadius(item) {
  if (item.maps_lat == null || item.maps_lng == null) return { stillInside: false, coords: null }
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]).catch(() => Location.getLastKnownPositionAsync({}))
    if (!pos?.coords) return { stillInside: null, coords: null }

    const distanceM = haversine(pos.coords.latitude, pos.coords.longitude, item.maps_lat, item.maps_lng)
    const radiusM = item.geo_radius_m ?? DEFAULT_GEOFENCE_RADIUS_M
    return { stillInside: distanceM <= radiusM, coords: pos.coords }
  } catch {
    return { stillInside: null, coords: null }
  }
}

async function handleDeparture(itemId) {
  const arrivalKey = ARRIVAL_KEY_PREFIX + itemId
  const arrivalRaw = await AsyncStorage.getItem(arrivalKey)
  if (!arrivalRaw) {
    await logDebugEventForCurrentUser('discarded_no_arrival_record', itemId, {})
    return // app was killed mid-visit or region churn without a real enter — discard, no raw history to recover from
  }

  const { data: item } = await supabase
    .from('items')
    .select('id, visit_profile_key, maps_lat, maps_lng, geo_radius_m')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return

  const { stillInside, coords: exitCoords } = await isStillInsideRadius(item)
  if (stillInside === true) {
    await logDebugEventForCurrentUser('exit_ignored_still_inside', itemId, {})
    return // spurious exit — keep the arrival record intact for the real departure later
  }

  await AsyncStorage.removeItem(arrivalKey)

  const arrivalAt = new Date(Number(arrivalRaw))
  const departureAt = new Date()
  const dwellMinutes = (departureAt - arrivalAt) / 60000

  const userId = await currentUserId()
  if (!userId) return

  const profiles = await getVisitProfiles()
  const profile = item.visit_profile_key ? profiles[item.visit_profile_key] : null
  if (!profile || profile.manual_only) {
    await logDebugEventForCurrentUser('discarded_manual_only_or_no_profile', itemId, {})
    return
  }

  if (dwellMinutes < profile.candidate_dwell_minutes) {
    await logDebugEventForCurrentUser('discarded_below_candidate_dwell', itemId, { dwellMinutes: Math.round(dwellMinutes * 10) / 10 })
    return
  }

  // good/poorLocationAccuracy and stoppedNotDriving come from the exact
  // fix isStillInsideRadius() already took to confirm this was a real
  // departure (not a second location request) — accuracy/speed are
  // standard expo-location coords fields, previously discarded here.
  // Remaining signals (no_competing_venue_nearby, likely_drive_by,
  // overlapping_venues) still need data this detector doesn't compute
  // (nearby-venue density, a movement trail) and stay unset.
  const accuracyM = exitCoords?.accuracy ?? null
  const speedMps = exitCoords?.speed ?? null
  const score = await computeConfidenceScore({
    insideVenueRadius: true, // geofence firing at all means the fix was inside the monitored radius
    exceedsCandidateDwell: true,
    exceedsStrongDwell: dwellMinutes >= profile.strong_dwell_minutes,
    goodLocationAccuracy: accuracyM != null && accuracyM <= ACCURACY_GOOD_M,
    poorLocationAccuracy: accuracyM != null && accuracyM > ACCURACY_POOR_M,
    stoppedNotDriving: speedMps != null && speedMps >= 0 && speedMps < STOPPED_SPEED_MPS,
  })
  const band = await bandForScore(score)
  if (band === 'ignore') return

  const status = band === 'notify_eligible' ? 'high_confidence' : band

  await supabase.from('candidate_visits').insert({
    user_id: userId,
    item_id: itemId,
    visit_profile_key: item.visit_profile_key,
    arrival_at: arrivalAt.toISOString(),
    departure_at: departureAt.toISOString(),
    dwell_minutes: Math.round(dwellMinutes * 10) / 10,
    detection_method: 'geofence_dwell',
    confidence_score: score,
    status,
    expires_at: new Date(departureAt.getTime() + GRACE_PERIOD_MS).toISOString(),
    metadata: { profileKey: item.visit_profile_key },
  })

  await logDebugEventForCurrentUser('candidate_created', itemId, { dwellMinutes: Math.round(dwellMinutes * 10) / 10, confidenceScore: score, status })
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
  const { data, error } = await supabase
    .from('items')
    .select('id, maps_lat, maps_lng, geo_radius_m, visit_profile_key, is_universal, is_active')
    .not('maps_lat', 'is', null)
    .not('maps_lng', 'is', null)
  if (error || !data) return { monitored: [], excluded: [] }

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

  return { monitored, excluded }
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

  const { monitored, excluded } = await classifyNearbyItems(pos.coords.latitude, pos.coords.longitude)

  let geofencingStarted = false
  let errorMessage = null

  if (monitored.length === 0) {
    await stopTracking()
  } else {
    try {
      await Location.startGeofencingAsync(
        GEOFENCE_TASK_NAME,
        monitored.map(item => ({
          identifier: item.id,
          latitude: item.maps_lat,
          longitude: item.maps_lng,
          radius: item.geo_radius_m ?? DEFAULT_GEOFENCE_RADIUS_M,
          notifyOnEnter: true,
          notifyOnExit: true,
        }))
      )
      geofencingStarted = true
    } catch (e) {
      errorMessage = e?.message ?? String(e)
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
  })
}

async function stopTracking() {
  const started = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK_NAME).catch(() => false)
  if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => {})
}

// Bypasses the refresh cooldown — for the tester-only debug panel's manual
// "refresh now" button. Never call this from anywhere else; the cooldown
// exists specifically to keep foreground-triggered refresh lightweight.
export async function forceRefreshGeofences(userId) {
  lastRefreshAt = 0
  await refreshGeofences(userId)
}

// Marks candidate visits past their 24h grace period as expired, so the
// (future) recovery screen only ever queries status IN ('candidate',
// 'medium_confidence', 'high_confidence') and never has to re-check dates.
export async function expireStaleCandidateVisits(userId) {
  if (!userId) return
  await supabase
    .from('candidate_visits')
    .update({ status: 'expired' })
    .eq('user_id', userId)
    .lt('expires_at', new Date().toISOString())
    .in('status', ['candidate', 'medium_confidence', 'high_confidence'])
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

    const runRefresh = async () => {
      const enabled = await isFlagEnabled(userId, 'candidate_visit_detection')
      if (cancelled) return
      if (enabled) {
        await refreshGeofences(userId)
        await expireStaleCandidateVisits(userId)
      } else {
        await stopTracking()
      }
    }

    runRefresh()

    const subscription = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        runRefresh()
      }
      appStateRef.current = nextState
    })

    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [userId])
}
