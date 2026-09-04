// What's Good V1 — the ONE foreground "at place" calculation for the
// "You're Here / What's the Thing?" state. Decision
// `whats_the_thing_foreground_presence_radius`:
//   foreground presence radius = min(item.geo_radius_m, 150m)
//   NULL/oversized geo_radius_m is also capped at 150m
//   background visit detection keeps using the item's FULL geo_radius_m
//   and is a separate concept (lib/geoFence.js's checkGeoFence /
//   lib/visitDetection/ — neither is touched or reused here on purpose;
//   this is deliberately its own, smaller, foreground-only calculation).
//
// Pure: only imports haversineMeters (also pure) — no Expo Location, no
// react-native, so this loads and tests fine under plain Node, unlike
// lib/geoFence.js which is necessarily impure (permission prompts, live
// GPS reads) and must stay that way for actual check-in verification.

import { haversineMeters } from './distance.js'

/** Same background-detection default as lib/geoFence.js's DEFAULT_GEOFENCE_RADIUS_M — duplicated as a literal, not imported, specifically so this module has zero dependency on geoFence.js's (impure) module. */
const DEFAULT_GEOFENCE_RADIUS_M = 500

/** IMPLEMENTATION-LOCKED by decision `whats_the_thing_foreground_presence_radius` — this is a product decision, not a tunable default. */
export const FOREGROUND_PRESENCE_CAP_M = 150

/**
 * @param {{geo_radius_m?: number|null, geoRadiusM?: number|null}} item
 * @returns {number}  min(item's own radius, 150m) — never above the cap,
 *   regardless of how large or missing the item's own geo_radius_m is.
 */
export function getForegroundPresenceRadiusM(item) {
  const ownRadius = item?.geo_radius_m ?? item?.geoRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M
  return Math.min(ownRadius, FOREGROUND_PRESENCE_CAP_M)
}

/**
 * @param {{maps_lat?: number, maps_lng?: number, mapsLat?: number, mapsLng?: number, geo_radius_m?: number|null, geoRadiusM?: number|null}} item
 * @param {{latitude: number, longitude: number}|null} userLocation
 * @returns {boolean}
 */
export function isAtPlace(item, userLocation) {
  if (!userLocation) return false
  const itemLat = item?.maps_lat ?? item?.mapsLat ?? null
  const itemLng = item?.maps_lng ?? item?.mapsLng ?? null
  if (itemLat == null || itemLng == null) return false

  const distanceM = haversineMeters(userLocation.latitude, userLocation.longitude, itemLat, itemLng)
  return distanceM <= getForegroundPresenceRadiusM(item)
}
