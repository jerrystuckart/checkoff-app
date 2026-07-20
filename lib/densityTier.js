import { supabase } from './supabase'
import { haversineMeters } from './distance'
import { computeDensityTier } from './proximity'

// Computed once per app session, the first time any screen needs it, then
// reused for the rest of the session (module-level cache — resets on the
// next cold start, same idiom as proximity.js's SESSION_START). The tier
// reflects "how busy is it around the user," which a single short list
// can't answer on its own — querying the full candidate set on every list
// open would mean an extra DB round trip per ListScreen mount just to
// classify that, so it's deliberately not re-fetched on GPS movement.
let cachedPromise = null

async function fetchCandidateItems() {
  const { data, error } = await supabase
    .from('items')
    .select('maps_lat, maps_lng')
    .eq('is_active', true)
    .eq('is_approved', true)
    .eq('is_universal', false)
    .not('maps_lat', 'is', null)
    .not('maps_lng', 'is', null)

  if (error) throw error
  return data ?? []
}

/**
 * getSessionDensityTier({ latitude, longitude })
 *
 * Returns { tier, inMetro } computed against ALL located items app-wide
 * (not scoped to any one list) — see proximity.js's computeDensityTier.
 * Cached after the first successful resolution for the rest of the
 * session; returns null if userLocation isn't available yet.
 */
export function getSessionDensityTier(userLocation) {
  if (!userLocation) return Promise.resolve(null)
  if (cachedPromise) return cachedPromise

  cachedPromise = fetchCandidateItems()
    .then(rows => {
      const distances = rows.map(r =>
        haversineMeters(userLocation.latitude, userLocation.longitude, r.maps_lat, r.maps_lng)
      )
      return computeDensityTier(distances)
    })
    .catch(e => {
      console.warn('getSessionDensityTier error:', e.message)
      cachedPromise = null // allow a retry on the next call
      return null
    })

  return cachedPromise
}
