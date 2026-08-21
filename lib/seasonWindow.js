import { supabase } from './supabase'

// checkedAt is a full UTC timestamptz string; startsAt/endsAt are bare
// metro-local `date` strings (YYYY-MM-DD). Comparing them directly as
// strings is wrong on the boundary days — a same-day timestamp always
// lexicographically sorts after the bare date, so it always evaluated as
// "past ends_at" even hours before local midnight. Converting checkedAt
// to its metro-local calendar date first mirrors the DB trigger
// prevent_expired_list_checkins(), which (as of the platform timezone
// fix — supabase/migrations/20260821_metro_timezone_platform_fix.sql)
// evaluates (now() AT TIME ZONE <list's own metro timezone>)::date
// against these same columns, resolved via metro_areas.timezone instead
// of a hardcoded zone.
//
// JUDGMENT CALL, FLAGGED FOR REVIEW: isWithinWindow's existing callers
// (HomeScreen.jsx's seasonal "N of M" count, PostCheckoffSheet's
// per-list progress) do not currently have a metro_id in scope at every
// call site — some only have the list row (which DOES have metro_id)
// while others may only have the item. To keep this patch's blast
// radius limited to seasonWindow.js itself rather than also touching
// every caller, isWithinWindow's signature grows an OPTIONAL trailing
// metroTimezone parameter that defaults to 'America/Phoenix' (matching
// today's behavior exactly when omitted). Callers that already have a
// list/metro's timezone in scope should pass it explicitly; callers that
// don't are UNCHANGED and keep evaluating on America/Phoenix until they
// are updated separately. This means the client-side fix is NOT
// automatically complete just from this diff — see the follow-up note
// at the bottom of this file for exactly which call sites still need a
// second, separate patch once each one's available metro context is
// confirmed.
function toMetroDateString(isoTimestamp, metroTimezone = 'America/Phoenix') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: metroTimezone }).format(new Date(isoTimestamp))
}

// A check_ins row counts for a window only if checked_at falls inside it.
// Each bound is checked independently — a window with only one side set is
// bounded on that side and open on the other; a window with neither set
// (undated list, or no seasons row covering today) is all-time. Mirrors the
// same independent-bound handling already used by the DB trigger
// prevent_expired_list_checkins() and by checkInFanOut.js's list filtering.
export function isWithinWindow(checkedAt, startsAt, endsAt, metroTimezone = 'America/Phoenix') {
  if (!checkedAt) return false
  const checkedDate = toMetroDateString(checkedAt, metroTimezone)
  if (startsAt && checkedDate < startsAt) return false
  if (endsAt && checkedDate > endsAt) return false
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
