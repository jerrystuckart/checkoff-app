// Pure decisions for the native significant-location-change ("movement") coverage refresh.
//
// What a movement callback is: the OS telling us the phone moved >= ~500 m (cell-tower based, at most about every 5 minutes; it
// relaunches a terminated app). It is a WAKE-UP and a rough position. It never establishes dwell, never creates a visit, check-off
// or points: the only thing it may do is ask the coverage planner to re-choose the nearest venues (the same single-flight,
// rate-gated refresh the sentinel uses). Presence is still established only by venue region events with fresh, accurate fixes.
import { haversineMeters } from '../distance.js'

export const MOVEMENT_FLAG = 'candidate_visit_movement_refresh'
export const MOVEMENT_HINT_MAX_AGE_MS = 10 * 60 * 1000   // a hint older than this is not a position, only a wake-up
export const MOVEMENT_HINT_MAX_ACCURACY_M = 5000          // coarser than this cannot rank venues usefully
export const MOVEMENT_DRIFT_FRACTION = 0.5                // refresh once the phone is this far (x radius) from the sentinel centre
export const MOVEMENT_FALLBACK_DRIFT_M = 750              // with no sentinel to compare to: refresh on any move of this size since the last centre

/** Newest usable hint from the native queue, plus how many were drained. */
export function newestHint(hints) {
  const list = (hints ?? []).filter((h) => h && Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
  if (!list.length) return null
  return list.reduce((a, b) => ((b.timestampMs ?? 0) >= (a.timestampMs ?? 0) ? b : a))
}

/**
 * @param {{ fix: null | {latitude:number, longitude:number, accuracy?:number}, hint: null | object, sentinel: null | {lat:number,lng:number,radiusM:number,needsRefresh?:boolean}, nowMs: number }} p
 * @returns {{ action: 'refresh'|'ignore', reason: string, source: 'fix'|'hint'|null, driftM: number|null, hintAgeS: number|null }}
 */
export function decideMovementRefresh({ fix, hint, sentinel, nowMs }) {
  const hintAgeS = hint?.timestampMs != null ? Math.max(0, (nowMs - hint.timestampMs) / 1000) : null
  const hintUsable = !!hint && hintAgeS != null && hintAgeS * 1000 <= MOVEMENT_HINT_MAX_AGE_MS && (hint.accuracy ?? 0) <= MOVEMENT_HINT_MAX_ACCURACY_M
  const pos = fix ? { lat: fix.latitude, lng: fix.longitude, source: 'fix' } : hintUsable ? { lat: hint.latitude, lng: hint.longitude, source: 'hint' } : null
  if (!pos) return { action: 'ignore', reason: hint ? 'hint_stale_or_coarse_and_no_fix' : 'no_position', source: null, driftM: null, hintAgeS }
  if (!sentinel) return { action: 'refresh', reason: 'no_active_coverage', source: pos.source, driftM: null, hintAgeS }
  if (sentinel.needsRefresh) return { action: 'refresh', reason: 'coverage_needs_refresh', source: pos.source, driftM: null, hintAgeS }
  const driftM = haversineMeters(pos.lat, pos.lng, sentinel.lat, sentinel.lng)
  const threshold = Math.max(200, sentinel.radiusM * MOVEMENT_DRIFT_FRACTION)
  return driftM >= threshold
    ? { action: 'refresh', reason: 'moved_out_of_coverage', source: pos.source, driftM: Math.round(driftM), hintAgeS }
    : { action: 'ignore', reason: 'within_coverage', source: pos.source, driftM: Math.round(driftM), hintAgeS }
}
