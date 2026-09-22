// What's Good V1 — app-side orchestration. Connects the layers without
// merging them:
//   location/context (caller-supplied fingerprint + locationState)
//     -> coverage-mode derivation (lib/whatsGoodCoverageMode.js — pure)
//     -> whatsGoodDataAdapter (Supabase access, LOCAL candidates only)
//     -> selectWhatsGood (pure ranking; computeMomentumScore already runs
//        INSIDE the adapter, per its own module doc)
//     -> mode-aware composition:
//          SUPPORTED_SUFFICIENT -> local-pool fallback only (2026-09-21
//            second follow-up fix's broadening, unchanged)
//          SUPPORTED_SPARSE     -> every eligible local item + a Universal
//            top-up filling only the remaining slots (2026-09-22 policy
//            correction)
//          UNSUPPORTED          -> Universal items only (2026-09-22 policy
//            correction — no resolved supported metro AND no local
//            inventory at all, e.g. San Francisco)
//          PENDING_LOCATION / LOCATION_UNAVAILABLE -> nothing (honest
//            loading/no-fabricated-content state, caller renders it)
//     -> session persistence (skip everything above if the cached session
//        should be preserved for the CURRENT coverage mode too)
//     -> exposure upsert (only for the items actually returned)
//
// 2026-09-22 CORRECTION: commit 1567427 made Universal-item exclusion
// UNCONDITIONAL (decision `whats_good_v1_never_universal`) — correct for a
// supported metro with sufficient local inventory (Munich), but too
// absolute for a user entirely outside CheckOff's supported geography
// (confirmed via read-only query: no metro_areas row within
// MAX_NEARBY_RADIUS_M of San Francisco) or a supported-but-sparse area.
// See lib/whatsGoodCoverageMode.js for the full policy this module now
// implements — Universal items are once again eligible, but ONLY as a
// context-aware supplement (SUPPORTED_SPARSE) or sole content
// (UNSUPPORTED), never as a blanket fallback and never displacing a valid
// local item.
//
// This module owns none of the ranking math, none of the momentum math,
// and none of the Supabase query shapes — it only sequences the existing
// pure/data modules in the right order and decides when to skip
// recomputation via the session cache.

import { assembleWhatsGoodCandidates } from './whatsGoodDataAdapter.js'
import { selectWhatsGood } from './whatsGoodSelection.js'
import { recordWhatsGoodExposure } from './whatsGoodExposureWriter.js'
import { loadWhatsGoodSession, saveWhatsGoodSession, shouldPreserveSession } from './whatsGoodSessionCache.js'
import { COVERAGE_MODE, deriveCoverageMode, WHATS_GOOD_TARGET_COUNT } from './whatsGoodCoverageMode.js'

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {{latitude: number, longitude: number}} params.userLocation  The
 *   coordinates to evaluate coverage against — real GPS for locationState
 *   'ready', or the explicitly-selected city's own coordinates when the
 *   caller is substituting for an 'unavailable' GPS fix (LOCATION_UNAVAILABLE
 *   mode 5's "explicit selection" branch — see lib/whatsGoodCoverageMode.js).
 *   The caller (lib/useWhatsGood.js), not this module, decides which
 *   coordinates these are.
 * @param {'pending'|'ready'|'unavailable'} [params.locationState]  Feeds
 *   lib/whatsGoodCoverageMode.js's deriveCoverageMode() directly. Defaults
 *   to 'ready' so existing callers/tests that don't pass it keep the exact
 *   prior behavior (always attempt a real selection).
 * @param {boolean} [params.hasExplicitSelection]  Only changes behavior
 *   when locationState is 'unavailable' — true means `userLocation` is a
 *   deliberately-selected city's coordinates and should be evaluated like a
 *   resolved location; false/omitted means there's truly nothing to show.
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
 *   already fetched (both Universal and non-universal — HomeScreen's
 *   loadNearbyRail() fetches every active Universal item unconditionally,
 *   with no metro/location filter). 2026-09-22 policy correction: this
 *   module now DOES consume this again, filtered to Universal items only,
 *   as the source pool for the SUPPORTED_SPARSE/UNSUPPORTED Universal
 *   top-up (fillUniversalTopUp below) — this is the exact plumbing the
 *   2026-09-21 second follow-up fix left in place but unused when it
 *   removed the (then-buggy, unconditional) Universal top-up; no new
 *   Supabase query is added anywhere for this.
 * @param {string|null} params.currentFingerprint  Computed upstream (see
 *   lib/whatsGoodContextFingerprint.js) by the location/context layer —
 *   this module never computes it itself, keeping the layers separated.
 * @param {Date} params.now
 * @param {object} [params.client]  Injected Supabase client — see whatsGoodDataAdapter.js.
 * @param {object} [params.storage]  Injected AsyncStorage-shaped store — see whatsGoodSessionCache.js.
 * @param {boolean} [params.forceRefresh]  Bypass the session cache (e.g. explicit pull-to-refresh).
 * @param {number} [params.backgroundPreserveMs]  Override for testing — see whatsGoodSessionCache.js's documented default.
 * @returns {Promise<{itemIds: string[], fromCache: boolean, coverageMode: string, debug: object}>}
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
  locationState = 'ready',
  hasExplicitSelection = false,
}) {
  const myGeneration = ++latestRequestGeneration

  // PENDING_LOCATION — never compute, never trust a cache, never show
  // stale local or Universal content. The caller (lib/useWhatsGood.js)
  // renders a loading/skeleton state instead.
  if (locationState === 'pending') {
    return emptyResult({ myGeneration, coverageMode: COVERAGE_MODE.PENDING_LOCATION })
  }

  if (!forceRefresh) {
    const cached = await loadWhatsGoodSession(storage)
    const cachePreserved = shouldPreserveSession(cached, { now, currentFingerprint, currentLocation: userLocation, currentMetroId, backgroundPreserveMs })

    if (cachePreserved && cached.coverageMode === COVERAGE_MODE.SUPPORTED_SPARSE) {
      // Coverage-mode drift check (2026-09-22, Step 8's "sparse-area cache
      // after sufficient local inventory becomes available -> recompute"):
      // SUPPORTED_SPARSE is the one cached mode whose correctness can go
      // stale WITHOUT any location/metro change at all — more local
      // inventory can simply become available at the SAME spot. Every
      // other cached mode (SUPPORTED_SUFFICIENT/UNSUPPORTED) is only ever
      // invalidated by parts 0-3's location/metro checks, which are cheap
      // (no query). This is the only branch that pays for a fresh
      // candidate query on an otherwise-valid cache hit, specifically to
      // close that one gap.
      const { candidates: freshCandidates } = await assembleWhatsGoodCandidates({ userId, userLocation, homeRailItemIds, now, client })
      const { ranked: freshRanked } = selectWhatsGood(freshCandidates, now)
      const freshMode = deriveCoverageMode({ locationState, eligibleLocalCount: freshRanked.length, targetCount: WHATS_GOOD_TARGET_COUNT, hasExplicitSelection })
      if (freshMode === cached.coverageMode) {
        return cachedResult({ cached, myGeneration })
      }
      // Drift detected — fall through to full composition below, reusing
      // freshCandidates/freshRanked so this doesn't cost a THIRD query.
      const { selectedItemIds: freshSelectedItemIds } = selectWhatsGood(freshCandidates, now)
      return composeAndPersist({
        userId, userLocation, currentMetroId, homeRailItemIds, allLocatedItems, currentFingerprint, now, client, storage,
        locationState, hasExplicitSelection, myGeneration,
        candidates: freshCandidates, ranked: freshRanked, selectedItemIds: freshSelectedItemIds,
      })
    }

    if (cachePreserved) {
      return cachedResult({ cached, myGeneration })
    }
  }

  // LOCATION_UNAVAILABLE (no explicit selection to substitute) — same
  // honest-empty-state contract as PENDING_LOCATION, but distinguished in
  // the returned coverageMode so the caller/UI can tell the two apart.
  if (locationState === 'unavailable' && !hasExplicitSelection) {
    return emptyResult({ myGeneration, coverageMode: COVERAGE_MODE.LOCATION_UNAVAILABLE })
  }

  const { candidates } = await assembleWhatsGoodCandidates({ userId, userLocation, homeRailItemIds, now, client })
  const { selectedItemIds, ranked } = selectWhatsGood(candidates, now)
  return composeAndPersist({
    userId, userLocation, currentMetroId, homeRailItemIds, allLocatedItems, currentFingerprint, now, client, storage,
    locationState, hasExplicitSelection, myGeneration, candidates, ranked, selectedItemIds,
  })
}

function emptyResult({ myGeneration, coverageMode }) {
  return {
    itemIds: [],
    fromCache: false,
    backupItemIds: [],
    stale: myGeneration !== latestRequestGeneration,
    coverageMode,
    debug: { fromCache: false, candidatePool: [], localFallbackUsed: false, coverageMode },
  }
}

function cachedResult({ cached, myGeneration }) {
  return {
    itemIds: cached.itemIds,
    fromCache: true,
    backupItemIds: [],
    stale: myGeneration !== latestRequestGeneration,
    coverageMode: cached.coverageMode,
    debug: { fromCache: true, cachedFingerprint: cached.fingerprint, cachedGeneratedAt: cached.generatedAt, candidatePool: [], localFallbackUsed: false, coverageMode: cached.coverageMode },
  }
}

/**
 * Mode-aware composition (2026-09-22 policy correction — see this module's
 * doc and lib/whatsGoodCoverageMode.js) + persistence, shared by both the
 * fresh-computation path and the SUPPORTED_SPARSE cache-drift path above
 * (so neither one duplicates this logic or pays for an extra query).
 */
async function composeAndPersist({
  userId, userLocation, currentMetroId, homeRailItemIds, allLocatedItems, currentFingerprint, now, client, storage,
  locationState, hasExplicitSelection, myGeneration, candidates, ranked, selectedItemIds,
}) {
  const eligibleLocalCount = ranked.length
  const coverageMode = deriveCoverageMode({ locationState, eligibleLocalCount, targetCount: WHATS_GOOD_TARGET_COUNT, hasExplicitSelection })

  let finalItemIds = selectedItemIds
  let localFallbackUsed = false

  if (coverageMode === COVERAGE_MODE.SUPPORTED_SUFFICIENT) {
    // Local-pool fallback (2026-09-21 second follow-up field fix,
    // unchanged): when the personalized top pick is short, broaden WITHIN
    // the same geographically-eligible, non-Universal local candidate pool
    // `ranked` already contains — never Universal (this mode has enough
    // real local inventory by definition), never another metro.
    localFallbackUsed = finalItemIds.length < WHATS_GOOD_TARGET_COUNT
    if (localFallbackUsed) {
      finalItemIds = fillFromLocalPool(finalItemIds, ranked, WHATS_GOOD_TARGET_COUNT)
    }
  } else if (coverageMode === COVERAGE_MODE.SUPPORTED_SPARSE) {
    // Every eligible local item first (there are fewer than target by
    // definition of this mode, so fillFromLocalPool takes the entire
    // ranked pool), THEN a Universal top-up filling only the genuinely
    // remaining slots. Local items are NEVER displaced.
    finalItemIds = fillFromLocalPool(finalItemIds, ranked, WHATS_GOOD_TARGET_COUNT)
    localFallbackUsed = true
    const remainingSlots = WHATS_GOOD_TARGET_COUNT - finalItemIds.length
    finalItemIds = [...finalItemIds, ...fillUniversalTopUp(finalItemIds, allLocatedItems, remainingSlots)]
  } else if (coverageMode === COVERAGE_MODE.UNSUPPORTED) {
    // No eligible local inventory at all (e.g. San Francisco — confirmed
    // via read-only query: no metro_areas row within MAX_NEARBY_RADIUS_M).
    // Universal items only, never a distant-metro local item.
    finalItemIds = fillUniversalTopUp([], allLocatedItems, WHATS_GOOD_TARGET_COUNT)
  }
  // LOCATION_UNAVAILABLE/PENDING_LOCATION never reach this function (see
  // getWhatsGoodSelection's early returns above) — no branch needed here.

  // Defensive safety net (not the primary fix — see whatsGoodDataAdapter.js's
  // module doc for the actual root-cause fix): the next few ranked LOCAL
  // candidates beyond what was selected, for the UI hydration layer to
  // deterministically refill a slot from IF a selected ID somehow still
  // can't be rendered (e.g. deleted between selection and render). Ranked,
  // not random — same ordering selectWhatsGood() already produced. Local
  // only, by design — a Universal backup would need its own eligibility
  // re-check the hydration layer isn't set up to do.
  const backupItemIds = ranked.map((r) => r.itemId).filter((id) => !finalItemIds.includes(id)).slice(0, 3)

  // A newer call already started (and may have already persisted its own,
  // fresher result) since this one began — see the module-level comment
  // above. Skip the writes so this stale result can never clobber it.
  const isStale = myGeneration !== latestRequestGeneration
  if (finalItemIds.length > 0 && !isStale) {
    await recordWhatsGoodExposure({ userId, itemIds: finalItemIds, now, client })
    await saveWhatsGoodSession(
      { itemIds: finalItemIds, generatedAt: now, fingerprint: currentFingerprint, location: userLocation, resolvedMetroId: currentMetroId, coverageMode },
      storage
    )
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
    coverageMode,
    debug: {
      fromCache: false,
      candidatePool,
      localFallbackUsed,
      coverageMode,
    },
  }
}

/**
 * Fills remaining slots (up to `targetCount` total) by taking further
 * entries from the already-ranked LOCAL candidate pool (`ranked`, from
 * selectWhatsGood) — never Universal, never another metro. Never displaces
 * an already-selected candidate, only fills an actual shortage. If `ranked`
 * doesn't have enough entries to fill every slot, the returned list simply
 * stays shorter than `targetCount` — that is the correct, honest outcome
 * for SUPPORTED_SUFFICIENT (fewer cards rather than backfilling from
 * elsewhere); for SUPPORTED_SPARSE, composeAndPersist tops the remainder up
 * with Universal items instead of leaving it short.
 */
function fillFromLocalPool(selectedItemIds, ranked, targetCount = WHATS_GOOD_TARGET_COUNT) {
  const usedIds = new Set(selectedItemIds)
  const needed = targetCount - selectedItemIds.length
  const extra = (ranked ?? [])
    .map((r) => r.itemId)
    .filter((id) => !usedIds.has(id))
    .slice(0, needed)
  return [...selectedItemIds, ...extra]
}

/**
 * Universal top-up (2026-09-22 policy correction — SUPPORTED_SPARSE and
 * UNSUPPORTED only; never called for SUPPORTED_SUFFICIENT). Picks up to
 * `neededCount` DISTINCT Universal item ids from `allLocatedItems` — the
 * same raw item pool HomeScreen's loadNearbyRail() already fetched
 * (unconditionally including every active Universal item, no metro/
 * location filter — see this function's caller's param doc). No Supabase
 * query here: this module still doesn't talk to Supabase directly (see
 * whatsGoodDataAdapter.js's module doc) — it only filters data the caller
 * already has.
 *
 * Sorted by id for determinism (this repo's existing testability
 * convention — see e.g. lib/whatsGoodOrchestrator.test.js's fixtures) —
 * real session-to-session variety comes from a fresh location/context
 * eventually landing on a different set, and from this always excluding
 * whatever was already picked (`existingIds`); this function only needs to
 * guarantee no REPEAT within one computation (Step 7), not cross-session
 * history tracking, which was explicitly not required.
 */
function fillUniversalTopUp(existingIds, allLocatedItems, neededCount) {
  if (neededCount <= 0) return []
  const usedIds = new Set(existingIds)
  const universalIds = (allLocatedItems ?? [])
    .filter((item) => (item?.is_universal ?? item?.isUniversal ?? false) && item?.id != null && !usedIds.has(item.id))
    .map((item) => item.id)
    .sort()
  return universalIds.slice(0, neededCount)
}
