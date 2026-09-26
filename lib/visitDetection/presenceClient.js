// Pure client-side decisions for reporting presence to the server, derived from
// how iOS actually delivers geofence callbacks (expo-location's
// EXGeofencingTaskConsumer): every (re-)registration resets each region to
// "unknown" and calls requestStateForRegion, so the OS then delivers ENTER for
// every region the phone is inside and EXIT for every region it is outside —
// on every foreground refresh, not only the first. A callback is therefore not
// necessarily a real crossing. These rules keep that noise from causing
// battery/network churn or — worse — from crediting a departure time the phone
// never observed.

export const OPEN_REFRESH_MS = 10 * 60 * 1000       // don't re-report an already-open session more often than this
export const REGISTRATION_WINDOW_MS = 20 * 1000     // callbacks this soon after OUR registration are state determinations
export const FIX_CACHE_MS = 15 * 1000               // simultaneous callbacks share one location fix
export const OPEN_MAX_AGE_MS = 8 * 60 * 60 * 1000   // matches the server's stale-open cutoff

/** Drops entries the server would already consider stale. */
export function pruneOpen(openMap, nowMs) {
  const out = {}
  for (const [id, at] of Object.entries(openMap ?? {})) if (typeof at === 'number' && nowMs - at < OPEN_MAX_AGE_MS && at <= nowMs + 60000) out[id] = at
  return out
}

/** ENTER: skip the network + GPS when this item's session was reported recently (re-delivered enters). */
export function shouldSendEnter(openMap, itemId, nowMs) {
  const at = openMap?.[itemId]
  return !(typeof at === 'number' && nowMs - at >= 0 && nowMs - at < OPEN_REFRESH_MS)
}

/**
 * EXIT:
 *  'skip'      nothing is open for this item locally (this is the OS reporting "outside" for a region we never entered —
 *              it does that for every monitored region on every registration): no GPS, no request.
 *  'reconcile' the callback arrived right after our own registration, i.e. it is a state determination, not a live
 *              crossing — the phone did not observe when it left, so no departure time may be claimed; ask the server
 *              to close sessions the phone is no longer inside (without credit).
 *  'report'    a live exit: verify with a fix, then report the departure.
 */
export function decideExit({ openMap, itemId, registeredAtMs, nowMs }) {
  if (openMap?.[itemId] == null) return 'skip'
  if (registeredAtMs != null && nowMs - registeredAtMs >= 0 && nowMs - registeredAtMs <= REGISTRATION_WINDOW_MS) return 'reconcile'
  return 'report'
}

export function markOpen(openMap, itemId, nowMs) { return { ...(openMap ?? {}), [itemId]: nowMs } }
export function markClosed(openMap, itemId) { const { [itemId]: _drop, ...rest } = openMap ?? {}; return rest }
export function replaceOpen(itemIds, nowMs) { return Object.fromEntries((itemIds ?? []).map((id) => [id, nowMs])) }

export function isFixFresh(fixAtMs, nowMs) { return typeof fixAtMs === 'number' && nowMs - fixAtMs >= 0 && nowMs - fixAtMs < FIX_CACHE_MS }
