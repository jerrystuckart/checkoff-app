// Device-local state keys of the visit tracker. One list, so "turn off and delete" (opt-out) and the tests cannot
// disagree about what is cleared. Everything here is local to the phone; opt-out removes it all.
export const ARRIVAL_KEY_PREFIX = 'candidateVisitArrival:'
export const PENDING_KEY = 'visitPresencePending'
export const OPEN_KEY = 'visitPresenceOpen'
export const REGISTERED_AT_KEY = 'visitGeofenceRegisteredAt'
export const SENTINEL_STATE_KEY = 'visitCoverageSentinel'      // { lat, lng, radiusM, registeredAt, bornOutsideRetries, signature, needsRefresh }
export const COVERAGE_CACHE_KEY = 'visitCoverageCache'         // catalog rows around the user (never user data)
export const PROFILES_CACHE_KEY = 'visitProfilesCache'
export const REFRESH_TIMES_KEY = 'visitCoverageRefreshTimes'   // start times (ms) of recent refreshes, for the rate gate
export const REFRESH_LOG_QUEUE_KEY = 'visitCoverageLogQueue'   // refresh diagnostics waiting for a connection

/** Every AsyncStorage key that belongs to visit tracking (used when the user turns visit recovery off). */
export function isVisitStateKey(k) {
  return k.startsWith(ARRIVAL_KEY_PREFIX) || [
    PENDING_KEY, OPEN_KEY, REGISTERED_AT_KEY, SENTINEL_STATE_KEY, COVERAGE_CACHE_KEY, PROFILES_CACHE_KEY, REFRESH_TIMES_KEY, REFRESH_LOG_QUEUE_KEY,
  ].includes(k)
}
