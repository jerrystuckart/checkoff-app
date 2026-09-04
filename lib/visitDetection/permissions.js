import * as Location from 'expo-location'

// Background ("Always") location is a materially bigger ask than the
// foreground permission the rest of the app already uses — it needs its own
// explanation, and it must never be requested silently. Callers should show
// this copy (or equivalent) in-app before invoking requestBackgroundLocation().
export const BACKGROUND_LOCATION_COPY = {
  title: 'Never miss the thing',
  body: "CheckOff can help recognize when you're spending time at a place in our catalog, so it can show the local pick or help you recover a CheckOff you forgot.",
}

// Returns 'granted' | 'denied' | 'foreground-required'. Never requests
// background permission before foreground is already granted — iOS silently
// fails that ordering, and Android requires the two-step flow directly.
export async function requestBackgroundLocationPermission() {
  const { status: foregroundStatus } = await Location.getForegroundPermissionsAsync()
  if (foregroundStatus !== 'granted') {
    const requested = await Location.requestForegroundPermissionsAsync()
    if (requested.status !== 'granted') return 'foreground-required'
  }

  const { status } = await Location.requestBackgroundPermissionsAsync()
  return status === 'granted' ? 'granted' : 'denied'
}

export async function hasBackgroundLocationPermission() {
  const { status } = await Location.getBackgroundPermissionsAsync()
  return status === 'granted'
}
