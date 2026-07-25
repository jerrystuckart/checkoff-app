import { Alert, Linking, Platform } from 'react-native'
import * as Location from 'expo-location'
import { haversineMeters } from './distance'

export const DEFAULT_GEOFENCE_RADIUS_M = 500

// The single check-off location gate — replaces the two near-identical
// enforceGpsCheckin() copies that used to live in ItemDetailScreen.jsx and
// ListScreen.jsx (gps-checkin_type only). This one applies to any item with
// coordinates, regardless of checkin_type, per the physical-presence
// requirement for Fall 2026. Universal items and items with no coordinates
// are never fenced — same "universal is locationless" rule used everywhere
// else in the codebase.
//
// Returns a typed result instead of showing UI itself, so every call site
// renders identical copy via presentGeoFenceFailure() below rather than
// each keeping its own Alert.alert text that can drift.
//   { ok: true }
//   { ok: false, reason: 'permission' }
//   { ok: false, reason: 'unavailable' }
//   { ok: false, reason: 'tooFar', distanceM }
export async function checkGeoFence(item) {
  const isUniversal = item?.is_universal ?? item?.isUniversal ?? false
  if (isUniversal) return { ok: true }

  const itemLat = item?.maps_lat ?? item?.mapsLat ?? null
  const itemLng = item?.maps_lng ?? item?.mapsLng ?? null
  if (!itemLat || !itemLng) return { ok: true }

  let userLat = null
  let userLng = null
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return { ok: false, reason: 'permission' }

    // Try a fresh fix first; fall back to last-known if it times out.
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]).catch(() => Location.getLastKnownPositionAsync({}))
    userLat = pos?.coords?.latitude  ?? null
    userLng = pos?.coords?.longitude ?? null
  } catch {
    // permission denied or device error — falls through to 'unavailable' below
  }

  if (!userLat || !userLng) return { ok: false, reason: 'unavailable' }

  const radiusM   = item?.geo_radius_m ?? item?.geoRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M
  const distanceM = Math.round(haversineMeters(userLat, userLng, itemLat, itemLng))

  if (distanceM > radiusM) return { ok: false, reason: 'tooFar', distanceM }

  return { ok: true }
}

// iOS: Linking.openSettings() is unreliable on some OS versions —
// app-settings: is the version already confirmed working on device
// elsewhere in this app (SecretRevealScreen.jsx's openAppSettings()).
// Reused verbatim rather than risking a second, untested implementation.
async function openAppSettings() {
  try {
    if (Platform.OS === 'ios') {
      await Linking.openURL('app-settings:')
    } else {
      await Linking.openSettings()
    }
  } catch (e) {
    console.warn('openAppSettings failed:', e?.message ?? e)
  }
}

// Renders the right alert for a failed checkGeoFence() result. No bypass
// option is ever offered — a permission failure always carries a one-tap
// Open Settings action so the user has a real path forward instead of a
// dead end. onDismiss (optional) fires from every button so a caller that
// needs to navigate away once the alert is acknowledged (PhotoCheckInScreen)
// can do so regardless of which button was pressed.
export function presentGeoFenceFailure(result, { onDismiss } = {}) {
  const dismiss = () => onDismiss?.()

  if (result.reason === 'permission') {
    Alert.alert(
      'Turn on location to check this off',
      "CheckOff verifies you're actually there before you can check off an item.",
      [
        { text: 'Cancel', style: 'cancel', onPress: dismiss },
        { text: 'Open Settings', onPress: () => { openAppSettings(); dismiss() } },
      ]
    )
    return
  }

  if (result.reason === 'unavailable') {
    Alert.alert(
      "Couldn't get your location",
      'Make sure location services are on, then try again.',
      [{ text: 'OK', onPress: dismiss }]
    )
    return
  }

  const distLabel = result.distanceM >= 1000
    ? `${(result.distanceM / 1000).toFixed(1)}km`
    : `${result.distanceM}m`

  Alert.alert(
    'You need to be here to check this off',
    `You're ${distLabel} away.`,
    [{ text: 'OK', onPress: dismiss }]
  )
}
