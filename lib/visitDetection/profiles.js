import { supabase } from '../supabase'

// Mirrors visit_detection_profiles — fetched once and cached in memory.
// The DB is the source of truth (tunable without a build); this module just
// avoids a network round trip on every dwell check.
let cache = null

export async function getVisitProfiles() {
  if (cache) return cache
  const { data, error } = await supabase
    .from('visit_detection_profiles')
    .select('key, candidate_dwell_minutes, strong_dwell_minutes, manual_only, is_active')
  if (error || !data) return {}

  cache = {}
  for (const row of data) cache[row.key] = row
  return cache
}

export function resetVisitProfilesCache() {
  cache = null
}

// An item with no visit_profile_key is treated as manual_only — no
// automatic detection — per the product rule that broad/ambiguous items
// (neighborhoods, districts) must opt in explicitly rather than opt out.
export async function getProfileForItem(item) {
  const key = item?.visit_profile_key ?? item?.visitProfileKey ?? null
  if (!key) return { key: 'manual_only', manual_only: true, is_active: true }

  const profiles = await getVisitProfiles()
  return profiles[key] ?? { key: 'manual_only', manual_only: true, is_active: true }
}
