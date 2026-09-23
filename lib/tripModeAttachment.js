// Trip Mode MVP (2026-09-23) — a Trip-Mode-SPECIFIC point-multiplier
// resolver, deliberately NOT lib/checkOffAttachment.js's
// resolveCheckOffAttachment(). That function intentionally NULLS
// listItemId for any non-official (personal) list — see its own header
// comment: personal lists reuse the same list_items row forever (never
// recreated per season, unlike official lists), so attaching a SEASONAL
// recheck via list_item_id would collide with
// check_ins_user_id_list_item_id_key the moment the same personal-list
// item is rechecked a second season. That concern does not apply to Trip
// Mode: a Trip Mode completion is a ONE-TIME-EVER record of a single
// bounded trip window (there is no "next season" recheck concept for it
// at all), so the exact scenario resolveCheckOffAttachment exists to avoid
// never arises here — reusing list_item_id directly is safe, and in fact
// REQUIRED, since the server trigger
// (docs/trip-mode/20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql)
// mandates a non-null list_item_id for verification_method =
// 'trip_list_retroactive' with no standalone path.
//
// This was the actual root cause of "the target user-created list doesn't
// work": the target list (692cb6bc-cbeb-4740-af6f-5f1833673a0f) is itself
// a personal (is_official=false) list — confirmed via a live read-only
// query this session — so calling the shared resolver for it always
// returned listItemId: null, and the sheet's own defensive guard then
// correctly (but unhelpfully) refused to submit. The trigger itself never
// depended on official-ness at all — it works directly off whatever real
// list_item_id it's given, for ANY list, official or personal. Fixing this
// is a Trip-Mode-only, additive change: lib/checkOffAttachment.js and its
// existing live/photo call sites are completely untouched.
//
// Not pure (does one Supabase read), so — unlike lib/tripMode.js and
// lib/tripModeCheckOffFlow.js — this is not unit-tested under plain
// node:test; its one real decision (never null the id) is covered instead
// by this pass's client-side "attachment resolves the SAME list_item_id it
// was given, never nulled, for a personal list" test, which stubs the
// Supabase client.

/**
 * @param {string} listItemId  REQUIRED, the real list_items.id already
 *   resolved by the caller (e.g. ItemDetailScreen's item.listItemId) —
 *   returned unchanged, never nulled, regardless of the list's
 *   official/personal status. Real authorization (is this list_item_id
 *   actually valid for this user/list/trip-window) happens server-side in
 *   the trigger — this function's only job is resolving the point
 *   multiplier and confirming the row exists at all.
 * @param {object} [opts]
 * @param {object} [opts.client]  injected Supabase client (tests only) —
 *   defaults to the real app client.
 * @returns {Promise<{listItemId: string, pointMultiplier: number, itemId: string|null}|null>}
 *   null if listItemId doesn't resolve to a real list_items row at all
 *   (deleted/invalid id) — callers must treat this as "cannot submit,"
 *   never fall back to a standalone insert (Trip Mode has none).
 */
export async function resolveTripModeAttachment(listItemId, { client } = {}) {
  if (!listItemId) return null
  const activeClient = client ?? (await import('./supabase.js')).supabase

  const { data, error } = await activeClient
    .from('list_items')
    .select('id, item_id, point_multiplier')
    .eq('id', listItemId)
    .maybeSingle()

  if (error || !data) return null

  return {
    listItemId: data.id,
    itemId: data.item_id ?? null,
    pointMultiplier: data.point_multiplier ?? 1.0,
  }
}
