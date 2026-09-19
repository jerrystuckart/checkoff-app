import { supabase } from './supabase'
// Nearby Redesign (2026-09-19) — isWithinWindow/toMetroDateString now live
// in lib/seasonWindowPure.js (a zero-import pure module, split out so
// they can be unit-tested/reused without dragging in this file's own
// supabase import) and are re-exported below unchanged. See that file's
// header for why.
import { isWithinWindow, toMetroDateString } from './seasonWindowPure.js'
export { isWithinWindow, toMetroDateString }

// isWithinWindow/toMetroDateString's full history/rationale comment
// (boundary-day metro-local date comparison, the JUDGMENT CALL note about
// which callers still need an explicit metroTimezone) now lives in
// lib/seasonWindowPure.js, where the actual implementations moved to.

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
