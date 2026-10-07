import { supabase } from './supabase'
import { ANDROID_RECOVERY_FLAG, isOfferedToUser } from './visitDetection/offering.js'

// Simple in-memory cache — flags don't need to be realtime-fresh, and this
// avoids a round trip on every check. Cleared on sign-out via resetFlagsCache().
let cache = null
let cacheUserId = null
let inflight = null

async function loadFlags(userId) {
  const [{ data: flags, error: flagsError }, { data: overrides }, { data: userRow }] = await Promise.all([
    supabase.from('feature_flags').select('key, enabled_globally'),
    userId
      ? supabase.from('feature_flag_overrides').select('flag_key, enabled').eq('user_id', userId)
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from('users').select('visit_detection_tester, is_admin').eq('id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const byKey = {}
  for (const f of flags ?? []) byKey[f.key] = f.enabled_globally
  for (const o of overrides ?? []) byKey[o.flag_key] = o.enabled

  return {
    flags: byKey,
    isTester: userRow?.visit_detection_tester ?? false,
    isAdmin: userRow?.is_admin ?? false,
    // false when the flag table could not be read (offline / error): callers that must not act on "unknown" as "off"
    // (the sentinel kill-switch check) use flagStateOrUnknown() below. isFlagEnabled() keeps its original behavior.
    loadedOk: !flagsError && flags != null,
  }
}

// isFlagEnabled(userId, 'candidate_visit_detection')
//
// Resolution order: per-user override > global flag > false. The
// candidate_visit_* flags are additionally gated on visit_detection_tester
// during the internal/test-user rollout phase — callers don't need to know
// that; it's applied here so every call site gets the same gate for free.
// 'candidate_visit_detection' is deliberately NOT here any more (2026-09-28): it is
// the master switch for offering seven-day visit recovery to everyone. It stays
// off globally until the real-device field test passes; users must additionally
// opt in (visit_recovery_settings) and grant Always location. The reminder-side
// flags below remain tester-only.
const TESTER_GATED_FLAGS = new Set([
  'candidate_visit_silent_mode',
  'historical_checkoff_recovery',
  'realtime_nearby_checkoff_notifications',
  'at_place_checkoff_reminders',
])

export async function isFlagEnabled(userId, flagKey) {
  if (!userId) return false

  if (cacheUserId !== userId) {
    cache = null
    cacheUserId = userId
  }
  if (!cache) {
    inflight = inflight ?? loadFlags(userId).finally(() => { inflight = null })
    cache = await inflight
  }

  const enabled = cache.flags[flagKey] ?? false
  if (!enabled) return false

  if (TESTER_GATED_FLAGS.has(flagKey) && !cache.isTester) return false

  return true
}

/**
 * Is visit recovery offered to this user on this platform (lib/visitDetection/offering.js)? iOS: the master flag, unchanged.
 * Android: master flag AND (dedicated android_visit_recovery flag OR visit-detection tester OR admin).
 */
export async function isVisitRecoveryOffered(userId, platformOS) {
  if (!userId) return false
  const master = await isFlagEnabled(userId, 'candidate_visit_detection')
  if (platformOS !== 'android') return master
  const androidFlag = await isFlagEnabled(userId, ANDROID_RECOVERY_FLAG)
  return isOfferedToUser({ platformOS, masterFlag: master, androidFlag, isTester: cache?.isTester === true, isAdmin: cache?.isAdmin === true })
}

/**
 * true / false, or null when the flags could not be read. The sentinel refresh consults this from a background wake
 * (a fresh process, possibly offline): a failed read must leave things as they are, only an explicit "off" is a rollback.
 * candidate_visit_sentinel_refresh is NOT tester-gated (2026-09-30): it follows the global flag and per-user overrides,
 * and only ever runs inside visit recovery (which itself needs candidate_visit_detection, opt-in and Always location).
 */
export async function flagStateOrUnknown(userId, flagKey) {
  if (!userId) return null
  if (cacheUserId !== userId) { cache = null; cacheUserId = userId }
  if (!cache) {
    inflight = inflight ?? loadFlags(userId).finally(() => { inflight = null })
    cache = await inflight
  }
  if (!cache.loadedOk) { cache = null; return null } // do not pin a failed read for the rest of the process
  const enabled = cache.flags[flagKey] ?? false
  if (enabled && TESTER_GATED_FLAGS.has(flagKey) && !cache.isTester) return false
  return enabled
}

export function resetFlagsCache() {
  cache = null
  cacheUserId = null
  inflight = null
}
