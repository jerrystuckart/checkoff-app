import { supabase } from './supabase'

// A check-off is a fact about the user and the item, not the list they
// were viewing — this is what makes that true across every list containing
// the item. Extracted from the secret-item-only fan-out that used to live
// in PhotoCheckInScreen.jsx and generalized to all items.

// Active list_items (this user is a member of, list currently started and
// not ended) for a given item — the set of "other lists" a check-off or
// uncheck needs to reach.
async function getUserActiveListItemsForItem(itemId, userId) {
  const today = new Date().toISOString().split('T')[0]

  const { data: allListItems } = await supabase
    .from('list_items')
    .select('id, list_id, lists!inner(id, starts_at, ends_at)')
    .eq('item_id', itemId)

  const activeListItems = (allListItems ?? []).filter(li => {
    const l = li.lists
    if (!l) return false
    if (l.starts_at && l.starts_at > today) return false
    if (l.ends_at   && l.ends_at   < today) return false
    return true
  })

  if (!activeListItems.length) return []

  const listIds = activeListItems.map(li => li.list_id)
  const { data: memberships } = await supabase
    .from('list_members')
    .select('list_id')
    .eq('user_id', userId)
    .in('list_id', listIds)

  const memberListIds = new Set((memberships ?? []).map(m => m.list_id))
  return activeListItems.filter(li => memberListIds.has(li.list_id))
}

/**
 * fanOutCheckIn — after a primary check-in insert succeeds, mirrors it
 * into every OTHER active list containing the same item that the user
 * belongs to. points_awarded is omitted on every fanned-out row so a
 * single real action is never double-counted in lifetime points. Uses
 * upsert + ignoreDuplicates so it's safe to call even when some target
 * lists already have a row for this item. Non-critical — never throws.
 */
export async function fanOutCheckIn({ userId, itemId, excludeListItemId = null, checkinMethod = 'tap', photoUrl = null }) {
  if (!itemId || !userId) return
  try {
    const activeListItems = await getUserActiveListItemsForItem(itemId, userId)
    const targets = activeListItems.filter(li => li.id !== excludeListItemId)
    if (!targets.length) return

    const rows = targets.map(li => ({
      user_id: userId,
      list_item_id: li.id,
      item_id: itemId,
      checkin_method: checkinMethod,
      photo_url: photoUrl,
    }))

    await supabase.from('check_ins').upsert(rows, { onConflict: 'user_id,list_item_id', ignoreDuplicates: true })
  } catch (e) {
    console.warn('fanOutCheckIn error:', e.message)
  }
}

// Uncheck has no separate "fan out" helper: deleting by item_id (instead of
// list_item_id) at each call site removes every row for this user+item in
// one shot — primary and any fanned-out secondaries alike — since they all
// share the same item_id. Each call site does this delete inline so it can
// keep its own existing error handling / optimistic-revert behavior.
