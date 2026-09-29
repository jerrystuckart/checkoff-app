// Coverage sentinel: one extra, large geofence centered where the monitored set was last chosen. iOS can only watch 19
// regions, so the app watches the 18 nearest eligible venues plus this circle. When the phone LEAVES the circle, iOS
// delivers an exit to the geofence task (relaunching the app in the background if the OS had terminated it), and the
// app re-chooses the nearest venues around the new position and re-registers. It is a refresh trigger only: a sentinel
// event never touches presence, candidates, check-offs or points (see eventRouter.js).
//
// Apple behavior this relies on (Region Monitoring, Core Location): region crossings are detected without continuous
// GPS; a terminated app is relaunched in the background to handle them; the user force-quitting the app from the
// switcher stops that relaunch until CheckOff is opened again. Regions smaller than ~100 m are unreliable, and exits are
// reported with some lag/hysteresis, hence the minimum radius below.

export const SENTINEL_ID = 'checkoff-refresh-sentinel'

export const SENTINEL_MIN_RADIUS_M = 150     // below this iOS exits are too noisy to be useful
export const SENTINEL_MAX_RADIUS_M = 1500    // sparse areas: refresh at least this often as the user travels
export const SENTINEL_BUFFER_M = 60          // margin for iOS exit lag + GPS error between "left the circle" and "reached a venue"
export const SENTINEL_INSIDE_FRACTION = 0.7  // an exit is only believed if a fresh fix is at least this far (x radius) from the center

export const SENTINEL_MIN_REFRESH_GAP_MS = 60 * 1000       // never re-register more often than this because of a sentinel
export const SENTINEL_MAX_REFRESHES_PER_HOUR = 40          // hard ceiling: protects battery even if something misbehaves
export const REGISTRATION_WINDOW_MS = 20 * 1000            // callbacks this soon after our registration are state determinations
export const MAX_BORN_OUTSIDE_RETRIES = 2                  // a sentinel that the OS says is already exited at birth: re-center at most twice

export function isSentinelId(id) { return id === SENTINEL_ID }

/**
 * Radius chosen from real coverage, not a constant.
 *
 * Any venue NOT in the monitored set is at least `nextOutDistanceM` from the center. A user at distance d from the center
 * can be inside that venue's circle only when d >= nextOutDistanceM - nextOutVenueRadiusM. Keeping the sentinel radius
 * below that means: while the user is still inside the sentinel, no unmonitored venue's circle can have been entered.
 * In very dense areas (Florence's old town) that bound is smaller than a radius iOS can honor, so the radius is clamped
 * to SENTINEL_MIN_RADIUS_M and `tight` is reported: coverage there can have short gaps between refreshes.
 *
 * With no unmonitored venue at all, the set is complete for the cached area; the maximum radius is used.
 */
export function sentinelRadius({ nextOutDistanceM = null, nextOutVenueRadiusM = 0 }) {
  if (nextOutDistanceM == null) return { radiusM: SENTINEL_MAX_RADIUS_M, tight: false, boundM: null }
  const boundM = nextOutDistanceM - nextOutVenueRadiusM - SENTINEL_BUFFER_M
  const radiusM = Math.round(Math.min(SENTINEL_MAX_RADIUS_M, Math.max(SENTINEL_MIN_RADIUS_M, boundM)))
  return { radiusM, tight: boundM < SENTINEL_MIN_RADIUS_M, boundM: Math.round(boundM) }
}

/**
 * Is a sentinel exit real? `fix` is a fresh location; `sentinel` the stored { lat, lng, radiusM }.
 * distanceFn is injected so this stays pure (visitPipeline's haversine in production).
 */
export function judgeSentinelExit({ fix, sentinel, distanceFn }) {
  if (!sentinel) return 'no_active_sentinel'
  if (!fix) return 'refresh_no_fix' // the OS said we left; without a fix we cannot re-choose, the caller retries
  const d = distanceFn(fix.latitude, fix.longitude, sentinel.lat, sentinel.lng)
  const slack = Math.min(Math.max(fix.accuracy ?? 0, 0), 50)
  return d + slack >= sentinel.radiusM * SENTINEL_INSIDE_FRACTION ? 'refresh' : 'ignore_still_inside'
}

/**
 * Rate gate for sentinel-driven refreshes. `recent` is the list of start times (ms) of refreshes in the last hour.
 * Returns { run: true } or { run: false, reason, retryAfterMs }.
 */
export function sentinelRefreshGate({ nowMs, lastRefreshAtMs, recent }) {
  const inLastHour = (recent ?? []).filter((t) => nowMs - t < 60 * 60 * 1000)
  if (inLastHour.length >= SENTINEL_MAX_REFRESHES_PER_HOUR) return { run: false, reason: 'hourly_cap', retryAfterMs: 60 * 1000 }
  if (lastRefreshAtMs != null && nowMs - lastRefreshAtMs >= 0 && nowMs - lastRefreshAtMs < SENTINEL_MIN_REFRESH_GAP_MS) {
    return { run: false, reason: 'min_gap', retryAfterMs: SENTINEL_MIN_REFRESH_GAP_MS - (nowMs - lastRefreshAtMs) }
  }
  return { run: true }
}
