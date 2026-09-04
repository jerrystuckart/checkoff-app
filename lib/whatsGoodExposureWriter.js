// What's Good V1 — exposure write. The ONLY place that writes to
// public.whats_good_exposures. Data access only — no ranking/session
// logic here (see lib/whatsGoodSelection.js / lib/whatsGoodSessionCache.js
// for those). Records exposure ONLY for the items actually displayed
// (typically 3), never the full ~15 candidate pool.

/**
 * Upserts last_shown_at = now for exactly the given item IDs, for the
 * given user, in ONE batched upsert call (never one write per item).
 * @param {object} params
 * @param {string} params.userId
 * @param {string[]} params.itemIds  The items actually displayed — not the candidate pool.
 * @param {Date} params.now
 * @param {object} [params.client]  Injected Supabase client; defaults to
 *   the real app client, loaded lazily (same reasoning as
 *   whatsGoodDataAdapter.js — avoids pulling in React Native/AsyncStorage
 *   machinery just by importing this module).
 * @returns {Promise<void>}
 */
export async function recordWhatsGoodExposure({ userId, itemIds, now, client }) {
  if (!itemIds || itemIds.length === 0) return

  const activeClient = client ?? (await import('./supabase.js')).supabase
  const rows = itemIds.map((itemId) => ({
    user_id: userId,
    item_id: itemId,
    last_shown_at: now.toISOString(),
  }))

  const { error } = await activeClient.from('whats_good_exposures').upsert(rows, { onConflict: 'user_id,item_id' })
  if (error) throw error
}
