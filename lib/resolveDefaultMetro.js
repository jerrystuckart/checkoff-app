import * as Location from 'expo-location'
import { supabase } from './supabase'
import { nearestMetroByCoords, fallbackMetro, resolveHomeMetro } from './metroSelection.js'

// Re-exported so existing/new call sites (and tests) can import the pure
// decision logic from this file too — the actual implementation lives in
// lib/metroSelection.js, which stays dependency-free (no expo-location, no
// supabase) specifically so it loads under plain `node --test` with no
// mocking. See that file's docstring for the full precedence rules this
// enforces (explicit persisted choice > real nearest-by-distance > pending
// wait > metro-blind fallback) and for the Vienna-defaulted-to-Phoenix bug
// this replaces.
export { nearestMetroByCoords, fallbackMetro, resolveHomeMetro }

// ── Impure shell — real GPS/Supabase calls, used by BrowseListsScreen and
// CreateListScreen for their own city-selector defaults (no explicit-
// selection precedence here; those screens don't have a persisted city
// choice of their own — see screens/HomeScreen.jsx's init() for the full
// precedence-aware resolution used on the Home tab, which calls
// resolveHomeMetro directly). ───────────────────────────────────────────
export async function resolveDefaultMetro() {
  const { data: metroData } = await supabase
    .from('metro_areas')
    .select('id, name, state, slug, center_lat, center_lng')
    .eq('is_active', true)
    .order('name')

  const metros = metroData ?? []
  if (metros.length === 0) return null

  try {
    const locationResult = await Promise.race([
      (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') return null
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
        return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      })(),
      new Promise(resolve => setTimeout(() => resolve(null), 3000)),
    ])

    const nearest = nearestMetroByCoords(locationResult, metros)
    if (nearest) return nearest
  } catch (e) {
    /* GPS optional, same as HomeScreen's own resolution */
  }

  return fallbackMetro(metros)
}
