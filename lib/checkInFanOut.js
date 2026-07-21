import { supabase } from './supabase'

// A check-off is a fact about the user and the item, not the list they
// were viewing — this is what makes that true across every list containing
// the item. Extracted from the secret-item-only fan-out that used to live
// in PhotoCheckInScreen.jsx and generalized to all items.

// Active list_items (list currently started and not ended) for a given
// item, partitioned by this user's list_members status — member lists are
// fan-out targets; non-member OFFICIAL lists are minimal-join-gate targets
// (see fanOutCheckIn). One shared query serves both purposes.
async function getListItemsForItemWithMembership(itemId, userId) {
  const today = new Date().toISOString().split('T')[0]

  const { data: allListItems } = await supabase
    .from('list_items')
    .select('id, list_id, lists!inner(id, starts_at, ends_at, is_official)')
    .eq('item_id', itemId)

  const activeListItems = (allListItems ?? []).filter(li => {
    const l = li.lists
    if (!l) return false
    if (l.starts_at && l.starts_at > today) return false
    if (l.ends_at   && l.ends_at   < today) return false
    return true
  })

  if (!activeListItems.length) return { memberListItems: [], nonMemberOfficialListItems: [] }

  const listIds = activeListItems.map(li => li.list_id)
  const { data: memberships } = await supabase
    .from('list_members')
    .select('list_id')
    .eq('user_id', userId)
    .in('list_id', listIds)

  const memberListIds = new Set((memberships ?? []).map(m => m.list_id))

  const memberListItems = activeListItems.filter(li => memberListIds.has(li.list_id))
  const nonMemberOfficialListItems = activeListItems.filter(
    li => !memberListIds.has(li.list_id) && li.lists?.is_official
  )

  return { memberListItems, nonMemberOfficialListItems }
}

/**
 * fanOutCheckIn — after a primary check-in insert succeeds, mirrors it
 * into every OTHER active list containing the same item that the user
 * belongs to. points_awarded is omitted on every fanned-out row so a
 * single real action is never double-counted in lifetime points. Uses
 * upsert + ignoreDuplicates so it's safe to call even when some target
 * lists already have a row for this item. Non-critical — never throws.
 *
 * Also closes the browse-without-joining gap: minimal join gate, no
 * prompt, no dialog. If the item belongs to an official/seasonal list this
 * user isn't a member of (this includes the list they're currently
 * viewing, if that's the one they browsed into without joining — it's
 * just another entry in the same active-list-items set), the check-off
 * itself is treated as the join signal and a list_members row is inserted
 * for it. This runs BEFORE the check_ins fan-out below and the newly-
 * joined lists are merged into its targets — otherwise the user's first
 * check-off wouldn't appear in the very list they were just auto-joined
 * to (fan-out would still see it as "not a member" from the membership
 * snapshot taken before the join). Full B2 join-gate UI (a general
 * first-check-off prompt) is separate, larger scope — this only covers
 * what this function already had the data for.
 */
export async function fanOutCheckIn({ userId, itemId, excludeListItemId = null, checkinMethod = 'tap', photoUrl = null }) {
  if (!itemId || !userId) return
  try {
    const { memberListItems, nonMemberOfficialListItems } = await getListItemsForItemWithMembership(itemId, userId)

    if (nonMemberOfficialListItems.length) {
      const uniqueListIds = [...new Set(nonMemberOfficialListItems.map(li => li.list_id))]
      const joinRows = uniqueListIds.map(listId => ({
        list_id: listId,
        user_id: userId,
        invite_source: 'checkoff',
      }))
      // Plain insert, not upsert — list_members' RLS doesn't support the
      // upsert-on-conflict UPDATE path (see JoinListScreen.jsx:137). The
      // membership query above already confirmed these aren't existing
      // rows, so a 23505 here only means a genuine race (e.g. joined from
      // another device in the same instant) — safe to ignore either way,
      // the check_ins fan-out below still needs to include these lists.
      const { error: joinErr } = await supabase.from('list_members').insert(joinRows)
      if (joinErr && joinErr.code !== '23505') {
        console.warn('fanOutCheckIn join-gate error:', joinErr.message)
      }
    }

    const targets = [...memberListItems, ...nonMemberOfficialListItems]
      .filter(li => li.id !== excludeListItemId)
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
