// Nearby Redesign (2026-09-19) — pure derivation step for Nearby's bulk
// completion lookup, split out of lib/nearbyCompletedItems.js so it can
// be unit-tested directly under node:test. Its only import is
// lib/seasonWindowPure.js's isWithinWindow — a zero-import pure module —
// so this file never drags in lib/supabase.js (which cannot load outside
// a React Native runtime, matching every other Supabase-touching module
// in this codebase). lib/nearbyCompletedItems.js (the impure half, which
// does the actual DB fetch) imports this function rather than
// re-implementing it, so there is exactly one definition either way.

import { isWithinWindow } from './seasonWindowPure.js'

/**
 * buildCompletedIdsFromCheckIns(checkInRows, windowDates)
 *
 * Given check_ins rows (each carrying item_id + checked_at) and a season
 * window, returns the Set of item ids with at least one check-in inside
 * that window — the exact same isWithinWindow() rule
 * ItemDetailScreen.jsx's loadCheckedState() already uses, just applied to
 * many rows/ids at once instead of one.
 *
 * @param {Array<{item_id: string, checked_at: string}>} checkInRows
 * @param {{starts_at: string|null, ends_at: string|null}} windowDates
 * @returns {Set<string>}
 */
export function buildCompletedIdsFromCheckIns(checkInRows, windowDates) {
  const ids = new Set()
  for (const row of checkInRows ?? []) {
    if (!row?.item_id) continue
    if (isWithinWindow(row.checked_at, windowDates?.starts_at ?? null, windowDates?.ends_at ?? null)) {
      ids.add(row.item_id)
    }
  }
  return ids
}
