import { supabase } from './supabase'

// Simple in-memory cache — flags don't need to be realtime-fresh, and this
// avoids a round trip on every check. Cleared on sign-out via resetFlagsCache().
let cache = null
let cacheUserId = null
let inflight = null

async function loadFlags(userId) {
  const [{ data: flags }, { data: overrides }, { data: userRow }] = await Promise.all([
    supabase.from('feature_flags').select('key, enabled_globally'),
    userId
      ? supabase.from('feature_flag_overrides').select('flag_key, enabled').eq('user_id', userId)
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from('users').select('visit_detection_tester').eq('id', userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const byKey = {}
  for (const f of flags ?? []) byKey[f.key] = f.enabled_globally
  for (const o of overrides ?? []) byKey[o.flag_key] = o.enabled

  return {
    flags: byKey,
    isTester: userRow?.visit_detection_tester ?? false,
  }
}

// isFlagEnabled(userId, 'candidate_visit_detection')
//
// Resolution order: per-user override > global flag > false. The
// candidate_visit_* flags are additionally gated on visit_detection_tester
// during the internal/test-user rollout phase — callers don't need to know
// that; it's applied here so every call site gets the same gate for free.
const TESTER_GATED_FLAGS = new Set([
  'candidate_visit_detection',
  'candidate_visit_silent_mode',
  'historical_checkoff_recovery',
  'realtime_nearby_checkoff_notifications',
  'at_place_checkoff_reminders',
  'community_cover_photos',
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

export function resetFlagsCache() {
  cache = null
  cacheUserId = null
  inflight = null
}
