// Check-In Memory Viewer (2026-09-23) — shared data layer for surfacing a
// user's already-saved photo check-in ("memory") on Item Detail, Home, and
// Nearby. There is no separate "memory" table: a memory IS a `check_ins`
// row (photo_url/personal_place/personal_note columns already exist on it,
// confirmed via screens/PhotoCheckInScreen.jsx:203-212 and
// screens/ListScreen.jsx:1120's select). This module generalizes the exact
// query + "most recent / list-context wins" tie-break that already lives,
// UI-bound, inside screens/ListScreen.jsx's openDetailModal (~line 1104) —
// it is not a second memory system, just the same lookup made reusable
// and batchable. screens/ListScreen.jsx itself is untouched.
//
// Privacy: every function here requires an explicit userId and scopes its
// query with .eq('user_id', userId). Callers MUST skip calling these
// entirely when there is no signed-in user — same anon-skip convention as
// lib/whatsGoodDataAdapter.js's assembleWhatsGoodCandidates (userId-gated
// query branches, see that file's maskBonusDrops/momentum section).
//
// No module-level `import { supabase } from './supabase'` here, by design
// — same reason lib/whatsGoodDataAdapter.js / lib/whatsGoodOrchestrator.js
// never import it either (see lib/seasonWindowPure.js's header comment):
// lib/supabase.js cannot be loaded under plain node:test, only under the
// React Native runtime. Callers (screens) pass their own already-imported
// `supabase` singleton in as `client`. Pulls isWithinWindow from
// lib/seasonWindowPure.js for the same reason (zero-import pure module).

import { isWithinWindow } from './seasonWindowPure.js'

/**
 * Batch existence check: which of the given item ids have at least one
 * check-in WITH a photo for this user. One query, not N+1 — intended for
 * card rails (Home / Nearby) where many items render at once.
 *
 * Returns a Map<itemId, { photoUrl, checkedAt }> using the most recent
 * photo check-in per item_id (same "most recent wins" rule as the
 * single-item lookup below, minus the list-context preference, which only
 * makes sense once you know which specific list-item is being viewed).
 *
 * @param {string|null} userId
 * @param {string[]} itemIds
 * @param {{ client: object }} opts - the caller's own supabase client (required — see module header)
 * @returns {Promise<Map<string, {photoUrl: string, checkedAt: string}>>}
 */
export async function getMemoryFlagsForItems(userId, itemIds, { client } = {}) {
  const ids = Array.from(new Set((itemIds ?? []).filter(Boolean)))
  if (!userId || ids.length === 0 || !client) return new Map()

  try {
    const { data, error } = await client
      .from('check_ins')
      .select('item_id, photo_url, checked_at')
      .eq('user_id', userId)
      .in('item_id', ids)
      .not('photo_url', 'is', null)

    if (error) {
      console.warn('getMemoryFlagsForItems: query failed:', error.message)
      return new Map()
    }

    return reduceToLatestPerItem(data ?? [])
  } catch (e) {
    // Fail closed on the affordance only — never throw into card rendering.
    console.warn('getMemoryFlagsForItems error:', e?.message ?? e)
    return new Map()
  }
}

/** Client-side "most recent wins" reduction, keyed by item_id. */
function reduceToLatestPerItem(rows) {
  const map = new Map()
  for (const row of rows) {
    if (!row?.item_id || !row?.photo_url) continue
    const existing = map.get(row.item_id)
    if (!existing || new Date(row.checked_at) > new Date(existing.checkedAt)) {
      map.set(row.item_id, { photoUrl: row.photo_url, checkedAt: row.checked_at })
    }
  }
  return map
}

/**
 * Full single-item memory detail, for when the viewer actually opens.
 * Generalized from screens/ListScreen.jsx's openDetailModal (~line 1104):
 * same select columns, same season-window filter, same
 * "prefer the row for this specific list-item, else most recent" pick.
 *
 * @param {string|null} userId
 * @param {string|null} itemId
 * @param {object} [opts]
 * @param {string|null} [opts.seasonStart] - starts_at bound; omit for all-time
 * @param {string|null} [opts.seasonEnd] - ends_at bound; omit for all-time
 * @param {string|null} [opts.preferListItemId] - list_item_id to prefer if present among the matching rows
 * @param {object} opts.client - the caller's own supabase client (required — see module header)
 * @returns {Promise<{id, list_item_id, checked_at, photo_url, personal_place, personal_note}|null>}
 */
export async function getMemoryDetailForItem(userId, itemId, {
  seasonStart = null,
  seasonEnd = null,
  preferListItemId = null,
  client,
} = {}) {
  if (!userId || !itemId || !client) return null

  try {
    const { data, error } = await client
      .from('check_ins')
      .select('id, list_item_id, checked_at, photo_url, personal_place, personal_note')
      .eq('item_id', itemId)
      .eq('user_id', userId)
      .order('checked_at', { ascending: false })

    if (error) {
      console.warn('getMemoryDetailForItem: query failed:', error.message)
      return null
    }

    const rows = (data ?? []).filter(r =>
      (seasonStart == null && seasonEnd == null) || isWithinWindow(r.checked_at, seasonStart, seasonEnd)
    )

    return rows.find(r => r.list_item_id === preferListItemId) ?? rows[0] ?? null
  } catch (e) {
    console.warn('getMemoryDetailForItem error:', e?.message ?? e)
    return null
  }
}

/** True if a detail row represents a real memory (photo and/or note), not just a bare check-in. */
export function hasMemoryContent(detail) {
  return !!(detail && (detail.photo_url || detail.personal_place || detail.personal_note))
}
