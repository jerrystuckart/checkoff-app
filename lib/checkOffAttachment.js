import { supabase } from './supabase'

// Official/seasonal lists get a brand new `lists` row (and fresh
// list_items rows) every season — HomeScreen picks the latest by
// created_at, older seasons persist as their own, ended rows. That
// makes an official list's list_item_id already season-safe: a Fall
// recheck naturally gets a different list_item_id than the Summer one
// did, so it can never collide with check_ins_user_id_list_item_id_key.
//
// Personal lists are never recreated — same `lists` row, same
// `list_items` row, forever. Reusing that stable list_item_id across a
// season boundary collides with that exact constraint the moment a user
// rechecks an item on their own list next season — the list-attached
// analog of the standalone lifetime-uniqueness bug already fixed (see
// 20260806_drop_standalone_lifetime_unique.sql).
//
// Resolution: a candidate list_item_id belonging to a personal list is
// never attached to the check-in — it's inserted standalone instead,
// which already has its own season-dedup guard and no lifetime
// constraint. This loses nothing: a personal list's own checkmark and
// "N of M" progress are computed by item_id + the list's own window
// (lib/useItems.js), not by list_item_id, and the leaderboard has been
// repointed the same way (lib/useLeaderboard.js) specifically so this
// doesn't lose crew credit either. point_multiplier is still read from
// the original candidate row regardless of the outcome, so a
// list-specific boost (personal lists don't currently set one, but
// nothing stops a future one) is never silently dropped.
//
// Single source of truth for this decision — call this instead of
// resolving/attaching a list_item_id inline at each check-off site, so
// the four call sites can't drift out of sync with each other.
export async function resolveCheckOffAttachment(candidateListItemId) {
  if (!candidateListItemId) {
    return { listItemId: null, pointMultiplier: 1.0 }
  }

  const { data: liRow } = await supabase
    .from('list_items')
    .select('point_multiplier, lists(is_official)')
    .eq('id', candidateListItemId)
    .maybeSingle()

  const pointMultiplier = liRow?.point_multiplier ?? 1.0
  // Defaults to standalone (false) if official-ness can't be determined
  // at all — the safe direction, since that's the side with no lifetime
  // constraint to collide with.
  const isOfficial = liRow?.lists?.is_official ?? false

  return {
    listItemId: isOfficial ? candidateListItemId : null,
    pointMultiplier,
  }
}
