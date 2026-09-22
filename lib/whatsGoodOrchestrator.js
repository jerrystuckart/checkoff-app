// What's Good V1 — app-side orchestration. Connects the layers without
// merging them:
//   location/context (caller-supplied fingerprint)
//     -> whatsGoodDataAdapter (Supabase access)
//     -> selectWhatsGood (pure ranking; computeMomentumScore already runs
//        INSIDE the adapter, per its own module doc)
//     -> local-pool fallback (2026-09-21 second follow-up fix — broadens
//        WITHIN the same geographically-eligible local candidate pool the
//        adapter already assembled, never backfills from Universal items;
//        see decision `whats_good_v1_never_universal`, which SUPERSEDES the
//        earlier `whats_good_v1_candidate_pool_and_fallback` Universal
//        top-up design)
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

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {{latitude: number, longitude: number}} params.userLocation
 * @param {string|null} [params.currentMetroId]  The CURRENT authoritative
 *   resolved metro id/slug (e.g. from lib/metroSelection.js's
 *   nearestMetroWithinBoundary()/resolveHomeMetro(), read-only references —
 *   this module reuses, never reimplements, metro resolution). Passed
 *   through to shouldPreserveSession's cache-compatibility check (2026-09-21
 *   follow-up field fix — resolved metro identity, not merely raw distance)
 *   and stored alongside a freshly-generated session so a LATER call can
 *   compare against it. Optional — omitting it simply skips the metro-
 *   identity check (see whatsGoodSessionCache.js's module doc).
 * @param {string[]} params.homeRailItemIds
 * @param {Array} [params.allLocatedItems]  The same raw item rows HomeScreen
 *   already fetched (both universal and non-universal). No longer consumed
 *   by this module (2026-09-21 second follow-up fix removed the Universal
 *   top-up step that used to read it — see the module doc above) — kept as
 *   an accepted-but-unused parameter so existing call sites in
 *   lib/useWhatsGood.js don't need to change their call shape.
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
// Monotonic request-generation counter — race-condition guard (2026-09-21
// field bug fix). getWhatsGoodSelection does real async I/O (multiple
// Supabase round-trips inside assembleWhatsGoodCandidates); two calls can be
// in flight at once (e.g. one started for a stale Vienna location right
// before a newer call starts for a just-resolved Munich location), and
// nothing guaranteed they'd settle in start order. Without this guard, an
// older call finishing AFTER a newer one could still overwrite the exposure
// table and the session cache with its now-outdated selection — silently
// reverting a user who has already moved on to Munich back to a Vienna
// result. Every call claims the next generation number at entry; a call
// only persists its result (exposure write + session-cache write) if no
// newer call has claimed a later number by the time it's ready to persist.
// The newer call always wins, regardless of which one's queries happen to
// resolve first.
let latestRequestGeneration = 0

/** Test-only: resets the generation counter between independent test cases. */
export function __resetWhatsGoodRequestGenerationForTests() {
  latestRequestGeneration = 0
}

export async function getWhatsGoodSelection({
  userId,
  userLocation,
  currentMetroId = null,
  homeRailItemIds,
  allLocatedItems,
  currentFingerprint,
  now,
  client,
  storage,
  forceRefresh = false,
  backgroundPreserveMs,
}) {
  const myGeneration = ++latestRequestGeneration

  if (!forceRefresh) {
    const cached = await loadWhatsGoodSession(storage)
    if (shouldPreserveSession(cached, { now, currentFingerprint, currentLocation: userLocation, currentMetroId, backgroundPreserveMs })) {
      return {
        itemIds: cached.itemIds,
        fromCache: true,
        backupItemIds: [],
        stale: myGeneration !== latestRequestGeneration,
        debug: { fromCache: true, cachedFingerprint: cached.fingerprint, cachedGeneratedAt: cached.generatedAt, candidatePool: [], localFallbackUsed: false },
      }
    }
  }

  const { candidates } = await assembleWhatsGoodCandidates({ userId, userLocation, homeRailItemIds, now, client })
  const { selectedItemIds, ranked } = selectWhatsGood(candidates, now)

  // Local-pool fallback (2026-09-21 second follow-up field fix): when the
  // personalized top-3 selection is short, broaden WITHIN the same
  // geographically-eligible, non-Universal local candidate pool `ranked`
  // already contains (assembleWhatsGoodCandidates' own eligibility query —
  // active, approved, in-season, unmasked, coordinate-bearing, within
  // MAX_NEARBY_RADIUS_M) by taking its next-best entries beyond the top 3,
  // rather than the REMOVED Universal top-up (fillWithUniversal, deleted
  // here — see whatsGoodDataAdapter.js's verifyNearbyForRender doc for why
  // that path was the actual leak). Because `ranked` already IS the full
  // eligible local pool (selectedItemIds is just its top 3), this single
  // step covers fallback tiers 1 (same local pool) and 3 (relaxed
  // personalization) at once — there is nothing further to broaden into
  // beyond what `ranked` already holds. Tier 2 (avoid duplicating Home
  // Rail's current set) needs no separate step either: Home Rail's ids are
  // already excluded from `candidates` at the adapter level (`isHomeRail`
  // filtering / homeRailItemIds exclusion in assembleWhatsGoodCandidates),
  // so nothing in `ranked` can duplicate what Home Rail is currently
  // showing. If `ranked` itself has fewer than 3 eligible items, this is a
  // genuine local-inventory shortage — `finalItemIds` simply stays short.
  // NEVER backfilled from Universal (tier 5, absolute) and never from
  // another metro (tier 6, absolute; already enforced by the adapter's own
  // maxDistance cap) — fewer cards is the correct, honest outcome (tier 7).
  let finalItemIds = selectedItemIds
  const localFallbackUsed = finalItemIds.length < 3
  if (localFallbackUsed) {
    finalItemIds = fillFromLocalPool(finalItemIds, ranked)
  }

  // Defensive safety net (not the primary fix — see whatsGoodDataAdapter.js's
  // module doc for the actual root-cause fix): the next few ranked
  // candidates beyond the top 3, for the UI hydration layer to
  // deterministically refill a slot from IF a selected ID somehow still
  // can't be rendered (e.g. deleted between selection and render). Ranked,
  // not random — same ordering selectWhatsGood() already produced.
  const backupItemIds = ranked.map((r) => r.itemId).filter((id) => !finalItemIds.includes(id)).slice(0, 3)

  // A newer call already started (and may have already persisted its own,
  // fresher result) since this one began — see the module-level comment
  // above. Skip the writes so this stale result can never clobber it.
  const isStale = myGeneration !== latestRequestGeneration
  if (finalItemIds.length > 0 && !isStale) {
    await recordWhatsGoodExposure({ userId, itemIds: finalItemIds, now, client })
    await saveWhatsGoodSession({ itemIds: finalItemIds, generatedAt: now, fingerprint: currentFingerprint, location: userLocation, resolvedMetroId: currentMetroId }, storage)
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
    stale: isStale,
    debug: {
      fromCache: false,
      candidatePool,
      localFallbackUsed,
    },
  }
}

/**
 * Fills remaining slots (up to 3 total) by taking further entries from the
 * already-ranked LOCAL candidate pool (`ranked`, from selectWhatsGood — see
 * the call site's comment above for why this alone covers fallback tiers
 * 1-3) — never Universal, never another metro. Never displaces an
 * already-selected candidate, only fills an actual shortage. If `ranked`
 * doesn't have enough entries to fill every slot, the returned list simply
 * stays shorter than 3 — that is the correct, honest outcome (tier 7:
 * fewer cards rather than backfilling from elsewhere).
 */
function fillFromLocalPool(selectedItemIds, ranked) {
  const usedIds = new Set(selectedItemIds)
  const needed = 3 - selectedItemIds.length
  const extra = (ranked ?? [])
    .map((r) => r.itemId)
    .filter((id) => !usedIds.has(id))
    .slice(0, needed)
  return [...selectedItemIds, ...extra]
}
