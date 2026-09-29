// Device-side cache of the catalog rows needed to choose the next venue set, so a background refresh needs no network
// when the user has not left the cached area. The cache is fetched for a wide circle (CACHE_FETCH_RADIUS_M); it can
// serve a selection at position p (which needs everything within NEARBY_RADIUS_M of p) only while p is within
// CACHE_FETCH_RADIUS_M - NEARBY_RADIUS_M of the cache center. Beyond that the cache would silently omit nearby
// venues, so it must not be used to choose a set.
import { haversineMeters } from '../distance.js'
import { NEARBY_RADIUS_M } from './coveragePlanner.js'

export const CACHE_FETCH_RADIUS_M = 60000
export const CACHE_STALE_MS = 3 * 24 * 60 * 60 * 1000   // older than this: refetch when online; still usable offline, flagged stale
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // older than this is not trusted at all (catalog edits, deactivations)
export const CACHE_SAFE_TRAVEL_M = CACHE_FETCH_RADIUS_M - NEARBY_RADIUS_M

/**
 * @returns {'fresh'|'stale'|'expired'|'outside_area'|'empty'}
 */
export function cacheStatus(cache, position, nowMs) {
  if (!cache || !Array.isArray(cache.items) || cache.center == null || typeof cache.fetchedAt !== 'number') return 'empty'
  if (haversineMeters(position.lat, position.lng, cache.center.lat, cache.center.lng) > CACHE_SAFE_TRAVEL_M) return 'outside_area'
  const age = nowMs - cache.fetchedAt
  if (age > CACHE_MAX_AGE_MS) return 'expired'
  return age > CACHE_STALE_MS ? 'stale' : 'fresh'
}

/**
 * What to do to obtain rows for a selection:
 *  use_cache    fresh cache covers the position
 *  fetch        online and the cache is missing/stale/expired/out of area
 *  use_stale    offline, cache covers the position but is old: usable, reported as stale
 *  keep_previous offline and the cache cannot honestly serve this position: leave the registered set as it is
 */
export function decideCacheSource({ status, online }) {
  if (status === 'fresh') return 'use_cache'
  if (online) return 'fetch'
  return status === 'stale' ? 'use_stale' : 'keep_previous'
}

/** Rows to store: only what selection needs (never user data). */
export function buildCache(items, center, nowMs) {
  return {
    center: { lat: center.lat, lng: center.lng },
    fetchedAt: nowMs,
    items: items.map((i) => ({
      id: i.id, maps_lat: i.maps_lat, maps_lng: i.maps_lng, geo_radius_m: i.geo_radius_m ?? null,
      visit_profile_key: i.visit_profile_key ?? null, is_universal: !!i.is_universal, is_active: i.is_active !== false,
    })),
  }
}

/** Latitude/longitude window covering CACHE_FETCH_RADIUS_M around a center (used for the server-side bounding-box filter). */
export function fetchWindow(center) {
  const dLat = CACHE_FETCH_RADIUS_M / 111320
  const dLng = CACHE_FETCH_RADIUS_M / (111320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)))
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLng: center.lng - dLng, maxLng: center.lng + dLng }
}
