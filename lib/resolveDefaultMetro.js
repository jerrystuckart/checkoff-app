import * as Location from 'expo-location'
import { supabase } from './supabase'

// Extracted from screens/HomeScreen.jsx's init() GPS-nearest-metro logic
// (docs/metro-launch-audit/02_app_metro_dependencies.md, finding: city
// selector default-metro fallback) so BrowseListsScreen and any other
// screen reached without an explicit citySlug/metroName param can pick a
// real nearest-metro default instead of a hardcoded 'phoenix' string.
// Mirrors HomeScreen's own algorithm exactly — same GPS timeout, same
// euclidean-nearest-by-center_lat/lng, same low-accuracy request — so the
// two code paths can't silently drift from each other over time.
//
// JUDGMENT CALL (flagged for review, not a straight bug fix): this
// duplicates rather than imports HomeScreen's inline logic, since that
// logic isn't currently exported as a standalone function. A cleaner
// long-term shape would have HomeScreen call this same helper instead of
// keeping its own copy — not done here to keep this patch's blast radius
// limited to the actual bug (BrowseListsScreen's hardcoded fallback), but
// flagged as follow-up cleanup worth doing in a later pass.
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

    if (locationResult !== null) {
      const { latitude: uLat, longitude: uLng } = locationResult
      const metrosWithCoords = metros.filter(m => m.center_lat != null && m.center_lng != null)
      if (metrosWithCoords.length > 0) {
        return metrosWithCoords.reduce((closest, m) => {
          const dLat = uLat - m.center_lat, dLng = uLng - m.center_lng
          const distSq = dLat * dLat + dLng * dLng
          const cLat = uLat - closest.center_lat, cLng = uLng - closest.center_lng
          const closestSq = cLat * cLat + cLng * cLng
          return distSq < closestSq ? m : closest
        })
      }
    }
  } catch (e) {
    /* GPS optional, same as HomeScreen's init() */
  }

  // No GPS / no coords on any metro — alphabetically-first active metro.
  // JUDGMENT CALL: HomeScreen's own no-GPS fallback specifically searches
  // for 'Phoenix' by name; deliberately NOT replicated here — that
  // fallback is itself flagged as latent debt in the audit
  // (doc 02_app_metro_dependencies.md), and propagating it into a second
  // call site would work against the point of this fix. Falling back to
  // "first active metro alphabetically" is metro-blind rather than
  // Phoenix-specific; flagged for reviewer reaction, not a verified-safe
  // audit finding like the rest of this fix.
  return metros[0]
}
