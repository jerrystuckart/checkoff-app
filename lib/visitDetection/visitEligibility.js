// Pure per-item geofence-monitoring eligibility rule, extracted from
// candidateVisitTracker.js so it can be unit-tested without a live
// Supabase/Expo/React Native environment — mirrors the existing pattern in
// notifyEligibility.js (pure decision logic lives here; I/O lives in the
// tracker). No behavior change from the inline version this replaced.

// iOS caps monitored regions at 20 per app; the tracker registers 19 (see
// candidateVisitTracker.js for why) — kept in sync with that constant.
export const MAX_MONITORED_REGIONS = 19

/**
 * classifyVisitEligibility(item, profiles, monitoredCountSoFar)
 *
 * `monitoredCountSoFar` is the number of items already accepted into the
 * monitored set this pass (items are evaluated closest-first, so the
 * region cap always drops the farthest ones, never the closest).
 *
 * @returns {{eligible: true} | {eligible: false, reason: string}}
 */
export function classifyVisitEligibility(item, profiles, monitoredCountSoFar) {
  if (item.is_universal) return { eligible: false, reason: 'universal_item' }
  if (!item.is_active) return { eligible: false, reason: 'inactive' }
  const profile = item.visit_profile_key ? profiles[item.visit_profile_key] : null
  if (!profile) return { eligible: false, reason: 'no_visit_profile_assigned' }
  if (profile.manual_only) return { eligible: false, reason: 'manual_only_profile' }
  if (monitoredCountSoFar >= MAX_MONITORED_REGIONS) return { eligible: false, reason: 'exceeds_region_cap' }
  return { eligible: true }
}
