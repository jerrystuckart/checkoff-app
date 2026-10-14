// iOS allows a maximum of 20 monitored regions PER APP (CLLocationManager.monitoredRegions is app-wide, not per feature).
// The visit tracker has always registered 19 and kept one slot spare: the previous set is replaced wholesale on every
// refresh (expo-location's EXGeofencingTaskConsumer stops all monitored regions, then re-registers), and a spare slot
// guarantees the OS never silently drops the last region.
//
// No other CheckOff feature registers regions: the only startGeofencingAsync call site is candidateVisitTracker.js
// (regionBudget.test.js scans the JS sources and fails if another appears). If one is ever added it MUST reduce
// OTHER_FEATURE_REGIONS here so the total stays within budget.

export const IOS_REGION_LIMIT = 20
export const SPARE_REGION_SLOTS = 1
export const OTHER_FEATURE_REGIONS = 0
export const SENTINEL_REGION_SLOTS = 1

/** Total regions this app registers (venues + sentinel), never more than this. */
export const MAX_TOTAL_REGISTERED = IOS_REGION_LIMIT - SPARE_REGION_SLOTS - OTHER_FEATURE_REGIONS // 19

/** Venue regions when the coverage sentinel is registered (18) - the classic path keeps all 19 for venues. */
export const MAX_VENUE_REGIONS_WITH_SENTINEL = MAX_TOTAL_REGISTERED - SENTINEL_REGION_SLOTS

// ANDROID (2026-10): Play services allows 100 geofences per app per device user (GeofencingClient). The tracker registers at
// most ANDROID_MAX_TOTAL_REGISTERED so the budget stays far below the platform limit (headroom for other apps' use of the same
// per-app counter is not needed, but a wholesale replace on every refresh and OEM variance are). 40 venues is also what keeps a
// dense city (Florence has 96 eligible venues) honest: the nearest 39 plus the coverage sentinel, refreshed on travel.
export const ANDROID_GEOFENCE_LIMIT = 100
export const ANDROID_MAX_TOTAL_REGISTERED = 40
export const ANDROID_MAX_VENUE_REGIONS_WITH_SENTINEL = ANDROID_MAX_TOTAL_REGISTERED - SENTINEL_REGION_SLOTS // 39

/** Venue cap for a platform, with or without the coverage sentinel taking one slot. iOS values are unchanged (19 / 18). */
export function maxVenueRegions(platformOS, sentinelEnabled) {
  if (platformOS === 'android') return sentinelEnabled ? ANDROID_MAX_VENUE_REGIONS_WITH_SENTINEL : ANDROID_MAX_TOTAL_REGISTERED
  return sentinelEnabled ? MAX_VENUE_REGIONS_WITH_SENTINEL : MAX_TOTAL_REGISTERED
}
