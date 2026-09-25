// Field bug fix (2026-09-25) — pure derivation of a human-readable geofence
// registration outcome from a geofence_registration_log row. Extracted so
// the "0 eligible places nearby" vs "query failed" vs "OS registration
// failed" distinction (the debug panel previously rendered the first two
// identically as a single ✕, which is what made a genuine, un-actionable
// "nothing nearby" reading look like a broken feature) has real test
// coverage, matching this codebase's pure-logic-extraction convention.
//
// Prefers the explicit registration_state column (added by
// supabase/migrations/20260925_geofence_registration_state.sql) when
// present, and falls back to the old heuristic for log rows written before
// that column existed (registration_state IS NULL) — those rows can't
// distinguish "no eligible places" from "OS registration failure" any more
// precisely than they always could.

/**
 * @param {object|null} log  a geofence_registration_log row (or null if none exists yet)
 * @returns {{ label: string, tone: 'ok'|'neutral'|'error'|'unknown' }}
 */
export function describeRegistrationState(log) {
  if (!log) {
    return { label: 'No registration log yet — grant permission and refresh.', tone: 'unknown' }
  }

  const monitoredCount = log.monitored_items?.length ?? 0

  if (log.registration_state) {
    switch (log.registration_state) {
      case 'ok_monitored':
        return { label: `${monitoredCount} place${monitoredCount === 1 ? '' : 's'} monitored`, tone: 'ok' }
      case 'ok_none_eligible':
        return { label: 'No eligible places nearby (not a failure)', tone: 'neutral' }
      case 'query_error':
        return { label: `Query failed: ${log.error_message ?? 'unknown error'}`, tone: 'error' }
      case 'os_registration_error':
        return { label: `OS geofence registration failed: ${log.error_message ?? 'unknown error'}`, tone: 'error' }
      default:
        return { label: `Unrecognized state: ${log.registration_state}`, tone: 'unknown' }
    }
  }

  // Legacy row (before registration_state existed) — old, ambiguous
  // heuristic: geofencing_started alone can't tell "nothing eligible" apart
  // from "OS call failed" when it's false, so name that ambiguity rather
  // than silently pick one.
  if (log.geofencing_started) {
    return { label: `${monitoredCount} place${monitoredCount === 1 ? '' : 's'} monitored`, tone: 'ok' }
  }
  if (monitoredCount === 0 && !log.error_message) {
    return { label: 'No eligible places nearby, or registration failed (legacy log row, can\'t distinguish)', tone: 'unknown' }
  }
  return { label: `Registration failed${log.error_message ? `: ${log.error_message}` : ''}`, tone: 'error' }
}
