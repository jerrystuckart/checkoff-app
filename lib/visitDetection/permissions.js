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

/**
 * Everything the recovery card needs to know about location, read fresh (never cached across a resume).
 * Always Location is NOT inferred from foreground access: on iOS the background status must be granted AND, when
 * the scope is reported, the scope must be 'always' (When In Use is not enough for visit recovery).
 * @returns {Promise<{servicesEnabled: boolean, foreground: 'granted'|'denied'|'undetermined', foregroundCanAskAgain: boolean,
 *   background: 'always'|'whenInUse'|'denied'|'undetermined', backgroundCanAskAgain: boolean}>}
 */
export async function readLocationPermissionSnapshot() {
  const [servicesEnabled, fg, bg] = await Promise.all([
    Location.hasServicesEnabledAsync().catch(() => true),
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
  ])
  const foreground = fg?.status === 'granted' ? 'granted' : fg?.status === 'denied' ? 'denied' : 'undetermined'
  let background = 'undetermined'
  if (bg?.status === 'granted') {
    const scope = bg?.ios?.scope
    background = scope && scope !== 'always' ? 'whenInUse' : 'always'
  } else if (bg?.status === 'denied') {
    background = fg?.ios?.scope === 'whenInUse' || foreground === 'granted' ? 'whenInUse' : 'denied'
  }
  return {
    servicesEnabled,
    foreground,
    foregroundCanAskAgain: fg?.canAskAgain !== false,
    background,
    backgroundCanAskAgain: bg?.canAskAgain !== false,
  }
}
