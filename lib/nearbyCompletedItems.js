// Nearby Redesign (2026-09-19) — bulk "has this user completed this item"
// lookup for the Nearby result list, reusing the EXACT same completion
// semantics as screens/ItemDetailScreen.jsx's loadCheckedState() rather
// than inventing a second definition of "completed":
//   - keyed by item_id (not list_item_id) — a check-off made from a
//     different list containing the same item still counts.
//   - scoped to a window: Nearby has no listId (it's not a list context),
//     so — mirroring loadCheckedState's own isNearbyMode-equivalent
//     branch — this always uses getCurrentSeasonWindow(), the same
//     window the Nearby rail/detail-from-rail path already uses, via
//     lib/seasonWindow.js's isWithinWindow().
//
// The one thing this module changes vs. loadCheckedState is SHAPE, not
// RULE: loadCheckedState queries one item_id at a time (right, for a
// single-item detail screen); this queries ALL currently-visible item ids
// in ONE check_ins request, then derives a Set client-side — the same
// bulk-fetch-then-Set pattern lib/savedItemsState.js already establishes
// for Saved Items, kept for consistency.
//
// Split per this repo's convention (see lib/SavedItemsContext.js +
// lib/savedItemsState.js): the DB call lives HERE (needs Supabase + the
// season lookup, so this file can't be imported directly under
// node:test), while the actual "which ids are completed" derivation is
// lib/nearbyCompletedIdsBuilder.js — a zero-Supabase-import pure module —
// so that decision logic has real, direct unit coverage.

import { supabase } from './supabase'
import { getCurrentSeasonWindow } from './seasonWindow'
import { buildCompletedIdsFromCheckIns } from './nearbyCompletedIdsBuilder.js'

export { buildCompletedIdsFromCheckIns }

/**
 * fetchCompletedItemIds(userId, itemIds)
 *
 * ONE bulk check_ins query for every currently-visible item id, plus the
 * current season window — never a per-row query. Returns an empty Set
 * (not an error) for a missing user or an empty id list, since Nearby's
 * rows should render un-completed rather than throw when signed out.
 *
 * @param {string|null} userId
 * @param {Array<string>} itemIds
 * @returns {Promise<Set<string>>}
 */
export async function fetchCompletedItemIds(userId, itemIds) {
  const ids = (itemIds ?? []).filter(Boolean)
  if (!userId || ids.length === 0) return new Set()

  try {
    const [{ data, error }, windowDates] = await Promise.all([
      supabase
        .from('check_ins')
        .select('item_id, checked_at')
        .eq('user_id', userId)
        .in('item_id', ids),
      getCurrentSeasonWindow(),
    ])
    if (error) throw error
    return buildCompletedIdsFromCheckIns(data, windowDates)
  } catch (e) {
    console.warn('fetchCompletedItemIds:', e?.message ?? e)
    return new Set()
  }
}
