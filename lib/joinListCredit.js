import { supabase } from './supabase'

// After a user INTENTIONALLY joins a list (list_members insert), give
// retroactive credit for any item on that list they've already completed —
// as a standalone check-in or via a different list. This is the converse of
// lib/checkInFanOut.js's fanOutCheckIn: that mirrors a fresh check-off into
// lists already joined; this mirrors an old check-off into a list just
// joined. Neither one ever creates or changes a list_members row itself.
//
// Every side effect that would normally follow a real check-off (points,
// streak, badges, crew notification, dare completion) is triggered by
// explicit application code at the check-off call sites — never by a
// database trigger on check_ins — so a plain insert/upsert here is safe:
// it cannot re-award points, restart a streak, or send a duplicate
// notification. See lib/checkInFanOut.js's fan-out rows for the existing
// precedent (points_awarded: 0 on every mirrored row).
//
// Idempotent via upsert + ignoreDuplicates on (user_id, list_item_id) —
// safe to call every time a join succeeds, including re-joins or races.
export async function backfillListCreditOnJoin(userId, listId) {
  if (!userId || !listId) return
  try {
    const { data: listItems } = await supabase
      .from('list_items')
      .select('id, item_id')
      .eq('list_id', listId)

    if (!listItems?.length) return

    const itemIds = listItems.map(li => li.item_id).filter(Boolean)
    if (!itemIds.length) return

    const { data: existingCheckIns } = await supabase
      .from('check_ins')
      .select('item_id, checked_at, checkin_method, photo_url, photo_width, photo_height, personal_place, personal_note, points_awarded')
      .eq('user_id', userId)
      .in('item_id', itemIds)

    if (!existingCheckIns?.length) return

    // One source row per item. Prefer the row carrying real evidence
    // (points_awarded > 0 — the original primary check-in) over a
    // zero-point fan-out mirror, so the backfilled row can't silently
    // downgrade a photo/GPS check-in to a plain tap copy. Ties keep the
    // earliest — the original completion, not a later mirror.
    const byItem = new Map()
    for (const ci of existingCheckIns) {
      const cur = byItem.get(ci.item_id)
      if (!cur || (ci.points_awarded ?? 0) > (cur.points_awarded ?? 0)) {
        byItem.set(ci.item_id, ci)
      }
    }

    // checked_at is copied verbatim — this is what keeps the backfilled
    // row out of "new this week/month" counts everywhere downstream sums
    // points or counts distinct items within a date range: it lands back
    // in the original period, not today.
    const rows = listItems
      .filter(li => byItem.has(li.item_id))
      .map(li => {
        const src = byItem.get(li.item_id)
        return {
          user_id:        userId,
          list_item_id:   li.id,
          item_id:        li.item_id,
          checkin_method: src.checkin_method ?? 'tap',
          photo_url:      src.photo_url ?? null,
          photo_width:    src.photo_width ?? null,
          photo_height:   src.photo_height ?? null,
          personal_place: src.personal_place ?? null,
          personal_note:  src.personal_note ?? null,
          checked_at:     src.checked_at,
          points_awarded: 0, // credit only — the source row already carries the points
        }
      })

    if (!rows.length) return

    await supabase.from('check_ins').upsert(rows, { onConflict: 'user_id,list_item_id', ignoreDuplicates: true })
  } catch (e) {
    console.warn('backfillListCreditOnJoin error:', e.message)
  }
}

// Single canonical "join a list" entry point — every UI surface that lets a
// user intentionally join a list (JoinListScreen's invite-code flow,
// PostCheckoffSheet's "Track your progress?" prompt, ListScreen's persistent
// join banner) must call this, not insert into list_members directly, so
// retroactive credit can never be missed from a new join surface again.
// Idempotent: safe to call even if the user is already a member (no-ops the
// list_members insert, still safe to re-run the backfill — it's idempotent
// itself via upsert+ignoreDuplicates).
//
// Returns { joined: boolean, error: string|null }. joined is true whether
// this call did the join or the user was already a member — callers that
// just need "is this user in the list now" can use it without branching.
export async function joinListAndBackfill(userId, listId, inviteSource = 'app') {
  if (!userId || !listId) return { joined: false, error: 'Missing user or list' }

  try {
    const { data: existing } = await supabase
      .from('list_members')
      .select('id')
      .eq('list_id', listId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!existing) {
      const { error: joinErr } = await supabase
        .from('list_members')
        .insert({ list_id: listId, user_id: userId, invite_source: inviteSource })

      // 23505 = joined between the check above and this insert (race,
      // e.g. another device) — not a real failure, the row exists either way.
      if (joinErr && joinErr.code !== '23505') {
        return { joined: false, error: joinErr.message }
      }
    }

    await backfillListCreditOnJoin(userId, listId)
    return { joined: true, error: null }
  } catch (e) {
    return { joined: false, error: e.message }
  }
}
