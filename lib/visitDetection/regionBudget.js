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
