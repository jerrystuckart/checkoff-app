// The single place that decides what a geofence callback means. The background task calls this first and only then
// performs I/O, so sentinel events can never fall into the venue path (and so create a visit) - the router returns a
// sentinel_* action for the sentinel id and never a venue_* action.
import { isSentinelId, REGISTRATION_WINDOW_MS } from './sentinel.js'
import { shouldSendEnter, decideExit } from './presenceClient.js'

/**
 * @param {{ eventType: 'enter'|'exit', regionId: string, sentinel: null | {registeredAt:number, bornOutsideRetries?:number},
 *           openMap: Record<string,number>, registeredAtMs: number|null, nowMs: number, maxBornOutsideRetries: number }} e
 * @returns {{ kind: string, [k: string]: any }}
 */
export function routeGeofenceEvent({ eventType, regionId, sentinel, openMap, registeredAtMs, nowMs, maxBornOutsideRetries }) {
  if (!regionId) return { kind: 'ignore', reason: 'no_region' }

  if (isSentinelId(regionId)) {
    if (!sentinel) return { kind: 'sentinel_ignored', reason: 'no_active_sentinel' } // opted out / gate off / stale callback
    if (eventType === 'enter') return { kind: 'sentinel_ignored', reason: 'enter' }    // state determination at registration
    const sinceRegistration = registeredAtMs != null ? nowMs - registeredAtMs : Infinity
    if (sinceRegistration >= 0 && sinceRegistration <= REGISTRATION_WINDOW_MS) {
      // The OS decided we are already outside the circle we just centered on ourselves (bad first fix). Re-center a
      // bounded number of times; never loop.
      return (sentinel.bornOutsideRetries ?? 0) < maxBornOutsideRetries
        ? { kind: 'sentinel_born_outside', retry: true }
        : { kind: 'sentinel_ignored', reason: 'born_outside_retries_exhausted' }
    }
    return { kind: 'sentinel_exit_verify' }
  }

  if (eventType === 'enter') return shouldSendEnter(openMap, regionId, nowMs) ? { kind: 'venue_enter', itemId: regionId } : { kind: 'venue_enter_duplicate', itemId: regionId }
  const decision = decideExit({ openMap, itemId: regionId, registeredAtMs, nowMs })
  return { kind: `venue_exit_${decision}`, itemId: regionId }
}
