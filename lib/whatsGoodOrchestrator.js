// What's Good V1 — app-side orchestration. Connects the layers without
// merging them:
//   location/context (caller-supplied fingerprint)
//     -> whatsGoodDataAdapter (Supabase access)
//     -> selectWhatsGood (pure ranking; computeMomentumScore already runs
//        INSIDE the adapter, per its own module doc)
//     -> Universal fallback (reuses proximitySort's existing interleave —
//        no new Universal concept)
//     -> session persistence (skip everything above if the cached session
//        should be preserved)
//     -> exposure upsert (only for the items actually returned)
//
// This module owns none of the ranking math, none of the momentum math,
// and none of the Supabase query shapes — it only sequences the existing
// pure/data modules in the right order and decides when to skip
// recomputation via the session cache.

import { assembleWhatsGoodCandidates } from './whatsGoodDataAdapter.js'
import { selectWhatsGood } from './whatsGoodSelection.js'
import { recordWhatsGoodExposure } from './whatsGoodExposureWriter.js'
import { loadWhatsGoodSession, saveWhatsGoodSession, shouldPreserveSession } from './whatsGoodSessionCache.js'
import { proximitySort } from './proximity.js'

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {{latitude: number, longitude: number}} params.userLocation
 * @param {string[]} params.homeRailItemIds
 * @param {Array} params.allLocatedItems  The same raw item rows HomeScreen
 *   already fetched (both universal and non-universal) — used ONLY for the
 *   Universal fallback top-up step, via the existing proximitySort
 *   interleave logic. Not re-fetched here.
 * @param {string|null} params.currentFingerprint  Computed upstream (see
 *   lib/whatsGoodContextFingerprint.js) by the location/context layer —
 *   this module never computes it itself, keeping the layers separated.
 * @param {Date} params.now
 * @param {object} [params.client]  Injected Supabase client — see whatsGoodDataAdapter.js.
 * @param {object} [params.storage]  Injected AsyncStorage-shaped store — see whatsGoodSessionCache.js.
 * @param {boolean} [params.forceRefresh]  Bypass the session cache (e.g. explicit pull-to-refresh).
 * @param {number} [params.backgroundPreserveMs]  Override for testing — see whatsGoodSessionCache.js's documented default.
 * @returns {Promise<{itemIds: string[], fromCache: boolean, debug: object}>}
 *   `debug` is built entirely from data already computed for the real
 *   selection (no extra queries) — see the tester instrumentation section
 *   of the "Morning Tester Enable" work for what consumes it. It never
 *   contains another user's identity or raw checkoff data: `momentumScore`
 *   is already the anonymized aggregate lib/whatsGoodMomentum.js produces.
 */
export async function getWhatsGoodSelection({
  userId,
  userLocation,
  homeRailItemIds,
  allLocatedItems,
  currentFingerprint,
  now,
  client,
  storage,
  forceRefresh = false,
  backgroundPreserveMs,
}) {
  if (!forceRefresh) {
    const cached = await loadWhatsGoodSession(storage)
    if (shouldPreserveSession(cached, { now, currentFingerprint, backgroundPreserveMs })) {
      return {
        itemIds: cached.itemIds,
        fromCache: true,
        backupItemIds: [],
        debug: { fromCache: true, cachedFingerprint: cached.fingerprint, cachedGeneratedAt: cached.generatedAt, candidatePool: [], universalFallbackUsed: false },
      }
    }
  }

  const { candidates } = await assembleWhatsGoodCandidates({ userId, userLocation, homeRailItemIds, now, client })
  const { selectedItemIds, ranked } = selectWhatsGood(candidates, now)

  let finalItemIds = selectedItemIds
  const universalFallbackUsed = finalItemIds.length < 3
  if (universalFallbackUsed) {
    finalItemIds = fillWithUniversal(finalItemIds, { homeRailItemIds, allLocatedItems, userLocation })
  }

  // Defensive safety net (not the primary fix — see whatsGoodDataAdapter.js's
  // module doc for the actual root-cause fix): the next few ranked
  // candidates beyond the top 3, for the UI hydration layer to
  // deterministically refill a slot from IF a selected ID somehow still
  // can't be rendered (e.g. deleted between selection and render). Ranked,
  // not random — same ordering selectWhatsGood() already produced.
  const backupItemIds = ranked.map((r) => r.itemId).filter((id) => !finalItemIds.includes(id)).slice(0, 3)

  if (finalItemIds.length > 0) {
    await recordWhatsGoodExposure({ userId, itemIds: finalItemIds, now, client })
    await saveWhatsGoodSession({ itemIds: finalItemIds, generatedAt: now, fingerprint: currentFingerprint, location: userLocation }, storage)
  }

  const freshnessClassByItemId = new Map(ranked.map((r) => [r.itemId, r.freshnessClass]))
  const candidatePool = candidates.map((c) => ({
    itemId: c.itemId,
    everCheckedOff: c.everCheckedOff,
    lastShownAt: c.lastShownAt,
    momentumScore: c.momentumScore,
    freshnessClass: freshnessClassByItemId.get(c.itemId) ?? null,
  }))

  return {
    itemIds: finalItemIds,
    fromCache: false,
    backupItemIds,
    debug: {
      fromCache: false,
      candidatePool,
      universalFallbackUsed,
    },
  }
}

/**
 * Fills remaining slots (up to 3 total) from Universal items only — never
 * displaces an already-selected local candidate, only fills an actual
 * shortage. Reuses proximitySort's own Universal interleave/shuffle
 * (lib/proximity.js) rather than inventing new Universal-selection logic.
 */
function fillWithUniversal(selectedItemIds, { homeRailItemIds, allLocatedItems, userLocation }) {
  const usedIds = new Set([...selectedItemIds, ...(homeRailItemIds ?? [])])
  const { items: sorted } = proximitySort(allLocatedItems ?? [], userLocation, { includeUniversal: true, interleave: true })
  const universalOnly = sorted.filter((item) => (item.is_universal ?? item.isUniversal) === true && !usedIds.has(item.id))
  const needed = 3 - selectedItemIds.length
  return [...selectedItemIds, ...universalOnly.slice(0, needed).map((item) => item.id)]
}
