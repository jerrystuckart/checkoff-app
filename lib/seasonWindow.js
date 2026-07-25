import { supabase } from './supabase'

// A check_ins row counts for a window only if checked_at falls inside it.
// Each bound is checked independently — a window with only one side set is
// bounded on that side and open on the other; a window with neither set
// (undated list, or no seasons row covering today) is all-time. Mirrors the
// same independent-bound handling already used by the DB trigger
// prevent_expired_list_checkins() and by checkInFanOut.js's list filtering.
export function isWithinWindow(checkedAt, startsAt, endsAt) {
  if (!checkedAt) return false
  if (startsAt && checkedAt < startsAt) return false
  if (endsAt && checkedAt > endsAt) return false
  return true
}

// seasons has no metro/city column — it's one global calendar, same as
// HomeScreen's existing theming lookup at loadForMetro(). Returns a null
// window (all-time) when no season row covers today, same fallback as an
// undated list.
export async function getCurrentSeasonWindow() {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('seasons')
    .select('starts_at, ends_at')
    .lte('starts_at', today)
    .gte('ends_at', today)
    .maybeSingle()
  return { starts_at: data?.starts_at ?? null, ends_at: data?.ends_at ?? null }
}
