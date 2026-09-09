// Single shared "current device location" source of truth.
//
// Before this module, useNearby.js, HomeScreen.jsx's Near-You-rail effect,
// and useWhatsGood.js each independently called expo-location and kept
// their own coords in their own state — three competing GPS
// implementations that could (and did) disagree, and none of them
// refreshed on returning from the background. A user who opened the app
// at Location A, backgrounded it, drove to Location B, and reopened it
// kept seeing Location A everywhere until they force-quit and relaunched.
//
// This module is now the only place that calls expo-location for "what is
// the user's current position." Every consumer goes through
// useCurrentLocation()/requestFreshLocation() instead of its own
// permission+getCurrentPositionAsync call. The state machine (staleness
// check, force flag, concurrent-call dedupe, fail-safe-on-error) is pure
// and lives in lib/locationFreshness.js so it's unit-testable without a
// device; this file only adds the real device fetch and the React/
// AppState glue around it.
//
// Policy:
//   - Manual refresh (Home/Discover pull-to-refresh): force=true, always
//     hits GPS.
//   - Foreground transition (background/inactive -> active): force=false,
//     only hits GPS if the last successful fix is
//     LOCATION_STALE_AFTER_MS (5 min) old or older. A quick app-switch
//     (answering a text, 30 seconds) does nothing; a real trip (drive to a
//     new place, reopen 10+ minutes later) triggers a fresh fix
//     automatically, no relaunch required.
//   - A failed/denied fetch never erases the last known-good location —
//     Nearby/Home/What's Good keep using the last good fix rather than
//     going blank.
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import * as Location from 'expo-location'
import { createLocationStore } from './locationFreshness'

export { LOCATION_STALE_AFTER_MS, isLocationStale } from './locationFreshness'

async function deviceFetch() {
  const { status } = await Location.requestForegroundPermissionsAsync()
  if (status !== 'granted') return null
  const pos = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('location fetch timeout')), 8000)),
  ]).catch(() => Location.getLastKnownPositionAsync({}))
  return pos?.coords ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : null
}

const store = createLocationStore()

/**
 * requestFreshLocation({ force }) — see this module's docstring for the
 * force/staleness policy. Safe to call from anywhere (not just React
 * components) — e.g. the AppState listener below calls it directly.
 */
export function requestFreshLocation({ force = false } = {}) {
  return store.requestFreshLocation({ force, deviceFetch })
}

/**
 * useCurrentLocation() — subscribes to the shared location. Every screen
 * using this hook re-renders when ANY caller (this screen's own pull-to-
 * refresh, another screen's, or the automatic foreground check) updates
 * the shared fix — no per-screen refresh wiring needed beyond calling
 * refreshLocation(true) for a manual override.
 */
export function useCurrentLocation() {
  const [snapshot, setSnapshot] = useState(store.getSnapshot())
  useEffect(() => store.subscribe(setSnapshot), [])
  return {
    location: snapshot.coords,
    lastFetchedAt: snapshot.lastFetchedAt,
    refreshLocation: (force = false) => requestFreshLocation({ force }),
  }
}

// Centralized foreground-stale trigger — ONE AppState listener for the
// whole app (registered once at module load, same idiom as
// lib/supabase.js's own AppState listener for auth-token refresh), so no
// individual screen needs its own AppState subscription for this.
let appStatePrev = AppState.currentState
AppState.addEventListener('change', nextState => {
  if (appStatePrev.match(/inactive|background/) && nextState === 'active') {
    requestFreshLocation({ force: false })
  }
  appStatePrev = nextState
})
