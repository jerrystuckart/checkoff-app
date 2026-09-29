// Chooses the region set to register: the nearest eligible venues plus (optionally) the coverage sentinel.
// Uses the SAME eligibility rule as the classic path (visitEligibility.classifyVisitEligibility), the same venue radius
// (visitPipeline.visitGeofenceRadiusM) and the same 30 km / closest-first ordering as candidateVisitTracker's
// classifyNearbyItems - this module only adds: an explicit venue cap, preservation of venues with an open presence
// session, and the coverage numbers used to size the sentinel.
import { haversineMeters } from '../distance.js'
import { classifyVisitEligibility, MAX_MONITORED_REGIONS } from './visitEligibility.js'
import { visitGeofenceRadiusM } from './visitPipeline.js'
import { MAX_VENUE_REGIONS_WITH_SENTINEL } from './regionBudget.js'
import { SENTINEL_ID, sentinelRadius } from './sentinel.js'

export const NEARBY_RADIUS_M = 30000

export function venueRegion(item) {
  return { identifier: item.id, latitude: item.maps_lat, longitude: item.maps_lng, radius: visitGeofenceRadiusM(item), notifyOnEnter: true, notifyOnExit: true }
}

/**
 * @param {{ position: {lat:number,lng:number}, items: any[], profiles: Record<string,any>, openItemIds?: string[], sentinelEnabled?: boolean }} args
 * items: rows with id, maps_lat, maps_lng, geo_radius_m, visit_profile_key, is_universal, is_active
 */
export function planCoverage({ position, items, profiles, openItemIds = [], sentinelEnabled = true }) {
  const cap = sentinelEnabled ? MAX_VENUE_REGIONS_WITH_SENTINEL : MAX_MONITORED_REGIONS
  const open = new Set(openItemIds)
  const nearby = (items ?? [])
    .filter((i) => i.maps_lat != null && i.maps_lng != null)
    .map((i) => ({ ...i, distanceM: haversineMeters(position.lat, position.lng, i.maps_lat, i.maps_lng) }))
    .filter((i) => i.distanceM <= NEARBY_RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM)

  // A venue with an open presence session stays registered even if it is no longer among the nearest, so its exit is
  // still delivered. Eligibility is still enforced (an item that became manual_only/inactive is genuinely dropped).
  const ordered = [...nearby.filter((i) => open.has(i.id)), ...nearby.filter((i) => !open.has(i.id))]
  const monitored = []
  const excluded = []
  for (const item of ordered) {
    const decision = classifyVisitEligibility(item, profiles, monitored.length, cap)
    if (!decision.eligible) { excluded.push({ item_id: item.id, distance_m: Math.round(item.distanceM), reason: decision.reason }); continue }
    monitored.push(item)
  }
  monitored.sort((a, b) => a.distanceM - b.distanceM)

  const overCap = nearby.filter((i) => excluded.some((e) => e.item_id === i.id && e.reason === 'exceeds_region_cap'))
  const nextOut = overCap[0] ?? null // nearby is distance-sorted, so this is the nearest eligible venue that did not fit
  const farthestM = monitored.length ? Math.round(monitored[monitored.length - 1].distanceM) : null
  const sizing = sentinelRadius({
    nextOutDistanceM: nextOut ? nextOut.distanceM : null,
    nextOutVenueRadiusM: nextOut ? visitGeofenceRadiusM(nextOut) : 0,
  })

  const sentinel = sentinelEnabled && monitored.length > 0
    ? { lat: position.lat, lng: position.lng, radiusM: sizing.radiusM }
    : null
  const regions = monitored.map(venueRegion)
  if (sentinel) regions.push({ identifier: SENTINEL_ID, latitude: sentinel.lat, longitude: sentinel.lng, radius: sentinel.radiusM, notifyOnEnter: false, notifyOnExit: true })

  return {
    monitored,
    excluded,
    regions,
    sentinel,
    coverage: {
      venues: monitored.length,
      eligibleNearby: monitored.length + overCap.length,
      farthestVenueM: farthestM,
      nextUnmonitoredM: nextOut ? Math.round(nextOut.distanceM) : null,
      sentinelRadiusM: sentinel ? sizing.radiusM : null,
      sentinelBoundM: sizing.boundM,
      tight: sentinel ? sizing.tight : false,
      openPreserved: monitored.filter((i) => open.has(i.id)).length,
    },
  }
}

/** Stable identity of a registration, so an unchanged set is not re-registered (re-registration re-determines every region). */
export function regionSignature(regions) {
  return regions.filter((r) => r.identifier !== SENTINEL_ID).map((r) => r.identifier).sort().join(',')
}
