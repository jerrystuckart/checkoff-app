// What's Good V1 — data adapter. Assembles the exact input shape
// lib/whatsGoodSelection.js's selectWhatsGood() needs, from live app data.
// This is the ONLY layer in the What's Good pipeline that talks to
// Supabase — see lib/whatsGoodMomentum.js and lib/whatsGoodSelection.js's
// own module docs for why momentum math and ranking stay pure and never
// touch a data source directly.
//
// NOT pure (by necessity — it's the data-access boundary), but every
// downstream layer it calls into (proximitySort, computeMomentumScore) is.
// `client` is dependency-injected (defaulting to the real app Supabase
// client, loaded lazily — see the JSDoc below) specifically so tests can
// stub Supabase responses — see whatsGoodDataAdapter.test.js.
//
// QUERY SHAPE (up to 6 per call — see below — never per-candidate, no N+1):
//   1. items (candidate source) — must resolve first; its distance-sorted
//      output determines the candidate ID list.
//   1a/1b. bonus-drop item IDs, then this user's checked-off subset of
//      them — ONLY runs if any bonus-drop items exist in the raw pool at
//      all (typically none/few) — see maskBonusDrops() below.
//   2/3/4. lifetime checkoff existence, exposure state, and momentum
//      contributions — all depend only on the final candidate ID list, run
//      via Promise.all.
//
// ELIGIBILITY MUST MATCH HOME RAIL'S OWN POOL (bug fix, see the "First
// On-Device Test" diagnosis): a candidate this adapter selects but that
// Home Rail's own loadNearbyRail() would have excluded (out of season, or
// a not-yet-unlocked masked Bonus Drop) is unhydratable UI-side — its ID
// exists in the selection but not in the item map the screen already has,
// so it silently vanishes from the rendered rail. The root fix is here,
// not at the hydration layer: this adapter's candidate pool now applies
// the SAME isItemInSeason + bonus-drop-mask rules loadNearbyRail() and
// useNearby.js already apply, so a selected candidate is always something
// that can actually be found and rendered. lib/bonusDrops.js's existing
// filterMaskedBonusDrops() is NOT reused directly — it hardcodes the real
// production Supabase client with no injection point, which would defeat
// this module's own testability; maskBonusDrops() below is a dependency-
// injected reimplementation of the exact same rule.
//
// Universal fallback is deliberately NOT handled here — see decision
// `whats_good_v1_candidate_pool_and_fallback` — that's the caller's
// responsibility (lib/whatsGoodOrchestrator.js's coverage-mode composition,
// see lib/whatsGoodCoverageMode.js), reusing the raw Universal item rows
// the caller already has (HomeScreen.jsx's loadNearbyRail() already fetches
// every active Universal item unconditionally, with no metro/location
// filter — this adapter never queries for Universal items itself).

import { proximitySort } from './proximity.js'
import { computeMomentumScore } from './whatsGoodMomentum.js'
import { isItemInSeason } from './seasonFilter.js'
import { hasUsableCoordinates, MAX_NEARBY_RADIUS_M } from './nearbyRanking.js'
import { haversineMeters } from './distance.js'
import { COVERAGE_MODE, WHATS_GOOD_TARGET_COUNT } from './whatsGoodCoverageMode.js'
import { fetchAllRows } from './supabasePagination.js'

const CANDIDATE_POOL_SIZE = 15

/**
 * Dependency-injected reimplementation of lib/bonusDrops.js's
 * filterMaskedBonusDrops() masking rule: a Bonus Drop item (list_items.is_bonus_drop)
 * stays hidden from general proximity/browse surfaces until the viewing
 * user has already checked it off. Same rule, same two-query shape — the
 * only difference is `client` is injected rather than hardcoded, so this
 * adapter stays fully testable with a stub. Fails open (returns items
 * unfiltered) on any query error, matching the original's documented
 * behavior.
 */
async function maskBonusDrops(items, userId, client) {
  if (!items?.length) return items ?? []
  try {
    const { data: dropRows, error: dropError } = await client.from('list_items').select('item_id').eq('is_bonus_drop', true)
    if (dropError) throw dropError
    const dropIds = new Set((dropRows ?? []).map((r) => r.item_id).filter(Boolean))
    if (dropIds.size === 0) return items

    let checkedDropIds = new Set()
    if (userId) {
      const { data: checkedRows, error: checkedError } = await client
        .from('check_ins')
        .select('item_id')
        .eq('user_id', userId)
        .in('item_id', [...dropIds])
      if (checkedError) throw checkedError
      checkedDropIds = new Set((checkedRows ?? []).map((r) => r.item_id))
    }

    return items.filter((item) => !dropIds.has(item.id) || checkedDropIds.has(item.id))
  } catch {
    return items
  }
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {{latitude: number, longitude: number}} params.userLocation
 * @param {string[]} params.homeRailItemIds  The 5 currently-shown Home Rail
 *   IDs — received from the caller, never recomputed here (the caller
 *   already knows what's actually on screen; re-deriving it here would
 *   risk drifting from that and would duplicate loadNearbyRail's own
 *   checkoff/season-window logic).
 * @param {Date} params.now
 * @param {object} [params.client]  Injected Supabase client; tests always
 *   pass a stub. When omitted, the real app client (lib/supabase.js) is
 *   loaded lazily via dynamic import — NOT a static top-level import —
 *   specifically so that importing this module (or running its test file)
 *   never pulls in React Native/AsyncStorage machinery that only works
 *   inside the app runtime, not under plain `node --test`.
 * @param {string|null} [params.currentMetroId]  Accepted for forward-
 *   compatibility with the caller's own resolved-metro plumbing, but
 *   currently UNUSED by this function — see the "METRO IDENTITY" note
 *   below for why. Reserved so a future fix can wire it up without another
 *   signature change at every call site.
 * @returns {Promise<{candidates: Array<{
 *   itemId: string,
 *   isHomeRail: boolean,
 *   everCheckedOff: boolean,
 *   lastShownAt: Date|null,
 *   momentumScore: number,
 * }>, eligibleLocalCount: number, diagnostics: {
 *   rawItemCount: number,
 *   outOfSeasonOrNoCoordsCount: number,
 *   inSeasonAndCoordEligibleCount: number,
 *   bonusDropMaskedCount: number,
 *   coordinateEligibleLocalCount: number,
 *   eligibleLocalCount: number,
 *   homeRailExcludedCount: number,
 *   candidatePoolSize: number,
 * }}>}  ADMIN DIAGNOSTICS PANEL (Phase 1, 2026-09-23) — `diagnostics` is a
 *   purely additive, read-only field for the admin-only runtime diagnostics
 *   panel (see components/home/UnsupportedLocationCard.jsx). It is derived
 *   entirely from values already computed above for `candidates`/
 *   `eligibleLocalCount` — no new queries, no change to what those two
 *   fields compute. `candidates` is exactly the shape
 *   selectWhatsGood() expects, unchanged by this fix — still Home-Rail-
 *   excluded and capped at CANDIDATE_POOL_SIZE, for actual item SELECTION.
 *   `eligibleLocalCount` is a SEPARATE, authoritative count (2026-09-23 fix
 *   — see the "COVERAGE-MODE COUNT" note below): the full size of the
 *   eligible local inventory within radius (same is_active/is_approved/
 *   is_universal=false/usable-coordinates/in-season/bonus-drop-masked
 *   criteria as `candidates`), computed BEFORE the Home Rail exclusion
 *   loop — this is what coverage-mode derivation
 *   (lib/whatsGoodCoverageMode.js) must use, NOT
 *   `candidates.length`/`ranked.length`, which measure a narrower
 *   "eligible AND not already shown on Home Rail" personalization pool and
 *   can hit zero in a fully supported metro whose nearest local items
 *   happen to already be on the Home Rail (see whatsGoodOrchestrator.js's
 *   module doc for the full incident writeup).
 */
// METRO IDENTITY — FLAGGED FOLLOW-UP, NOT IMPLEMENTED HERE: `eligibleLocalCount`
// below is radius-only (MAX_NEARBY_RADIUS_M via proximitySort), matching this
// function's pre-existing candidate-pool geography exactly. A stricter
// per-metro check (so two metros within 100mi of each other, e.g. Denver/
// Colorado Springs, can't cross-contaminate each other's coverage count) was
// evaluated and deliberately NOT added here: it would require joining this
// query to each item's owning neighborhood's resolved-metro column and
// referencing that column's name inside this file, which directly violates
// an existing, deliberate regression guard in
// lib/homeMetroResolutionMunichFix.test.js (see that file's "REGRESSION:
// lib/whatsGoodDataAdapter.js has no metro/city filter in its own querying
// either" test) — put in place after an EARLIER Munich field bug where a
// metro-scoped query on this exact table caused stale-city content.
// Reintroducing that column reference here risks reopening that exact class
// of bug. See this function's final report for the full reasoning.

// COVERAGE-MODE COUNT (2026-09-23 field bug fix — Munich showed a resolved
// metro + real Near-You items AND "we haven't unlocked this city yet"
// simultaneously): `candidates`/`ranked.length` was being used as the input
// to deriveCoverageMode(), but it deliberately EXCLUDES any item already on
// the Home Rail (see the loop below) — a personalization/dedup concern, not
// a "does this metro have local inventory" concern. In Munich, the nearest
// real local items were already on the Home Rail, so the candidate pool hit
// zero even though real local inventory obviously existed (Near You was
// showing it). `eligibleLocalCount` below is computed from `sortedItems` —
// the full within-radius, fully-eligibility-filtered pool, BEFORE Home Rail
// exclusion — so it can never go to zero just because personalization
// already showed those same items elsewhere.
export async function assembleWhatsGoodCandidates({ userId, userLocation, homeRailItemIds, now, client, currentMetroId = null }) {
  const activeClient = client ?? (await import('./supabase.js')).supabase
  const homeRailSet = new Set(homeRailItemIds)
  void currentMetroId // reserved, not yet used — see the METRO IDENTITY note above

  // 1. Items — same non-universal/located/active/approved shape Home
  // Rail's own loadNearbyRail() already fetches, no metro/city filter
  // (matches its existing behavior). Reuses proximitySort() unmodified for
  // the actual distance sort/tiering — no proximity logic duplicated here.
  //
  // PAGINATED (2026-09-23 field bug fix — the REAL root cause of the
  // "Munich resolved + Near You correct + What's Good still shows
  // unsupported" incident, which survived two earlier fixes to this
  // pipeline's coverage-mode DERIVATION and CACHE logic because neither of
  // those layers was the actual defect): this was a plain, unbounded
  // `.select()` with no `.order()`/`.range()` — PostgREST silently caps
  // that at 1000 rows. lib/supabasePagination.js's own header documents
  // this EXACT bug class already happening and being fixed elsewhere in
  // this codebase (the "Vienna MORGEN bug, 2026-09-13" — global eligible-
  // items count confirmed at 1465 rows for this identical filter shape,
  // in lib/useNearby.js's "All" fetch and this screen's own Near-You rail
  // fetch) — this function was added as part of the newer What's Good
  // pipeline and never adopted fetchAllRows(), so it kept silently losing
  // any item past row ~1000 in whatever order Postgres happened to return
  // them, BEFORE proximitySort/eligibleLocalCount ever saw it. No test in
  // this file's suite could ever catch this — every fixture uses a
  // handful of items, structurally unable to exceed the 1000-row cap; see
  // this file's own test file for a fixture large enough to actually
  // exercise it.
  const { data: items, error: itemsError } = await fetchAllRows(() => activeClient
    .from('items')
    .select('id, maps_lat, maps_lng, season_tag')
    .eq('is_active', true)
    .eq('is_approved', true)
    .eq('is_universal', false)
    .not('maps_lat', 'is', null)
    .not('maps_lng', 'is', null)
    .order('id'))
  if (itemsError) throw itemsError

  // Eligibility must match Home Rail's own pool — see the module doc
  // above. isItemInSeason() is pure (no data dependency); maskBonusDrops()
  // needs its own (bounded, not-per-candidate) queries. hasUsableCoordinates
  // (lib/nearbyRanking.js, read-only reference — same gate Nearby already
  // applies) additionally rejects the (0,0)/non-finite "fake location"
  // footgun the raw not-null query above doesn't catch.
  const inSeasonItems = (items ?? []).filter(item => isItemInSeason(item) && hasUsableCoordinates(item.maps_lat, item.maps_lng))
  const eligibleItems = await maskBonusDrops(inSeasonItems, userId, activeClient)

  // includeUniversal:false, interleave:false — LOCAL candidates only,
  // nearest-first. maxDistance:MAX_NEARBY_RADIUS_M (2026-09-21 field fix —
  // was previously unbounded): "geographic expansion" by taking further
  // entries from this same sorted list is still how a sparse metro gets
  // more candidates, but it must stop at the same hard "no longer a nearby
  // place at all" cutoff Nearby already enforces — without this, a metro
  // with fewer than CANDIDATE_POOL_SIZE local items below could reach all
  // the way into another metro (e.g. Munich falling through to Vienna
  // items) rather than legitimately running short.
  const { items: sortedItems } = proximitySort(eligibleItems, userLocation, { includeUniversal: false, interleave: false, maxDistance: MAX_NEARBY_RADIUS_M })

  // Authoritative eligible-local-inventory count — see this function's
  // JSDoc and the COVERAGE-MODE COUNT note above. Computed from
  // `sortedItems` (full radius + eligibility pool, same MAX_NEARBY_RADIUS_M
  // cutoff as `candidates`), BEFORE the Home Rail exclusion loop below, so
  // it can never be depressed by personalization/dedup. Radius-only — see
  // the METRO IDENTITY note above for why per-metro narrowing is not
  // applied here.
  const eligibleLocalCount = sortedItems.length

  // ADMIN DIAGNOSTICS PANEL (Phase 1, additive-only — see the panel's own
  // module doc in components/home/UnsupportedLocationCard.jsx): a precise
  // count of how many items within `sortedItems` were skipped from the
  // candidate pool specifically FOR BEING on the Home Rail already, as
  // distinct from `eligibleLocalCount - candidateIds.length`, which would
  // conflate that reason with simply exceeding CANDIDATE_POOL_SIZE. Counted
  // over the FULL sortedItems list (not just up to the point the pool loop
  // below stops at CANDIDATE_POOL_SIZE), so it's the true total regardless
  // of where the cap lands.
  const homeRailExcludedCount = sortedItems.filter((item) => homeRailSet.has(item.id)).length

  const candidateIds = []
  for (const item of sortedItems) {
    if (homeRailSet.has(item.id)) continue
    candidateIds.push(item.id)
    if (candidateIds.length >= CANDIDATE_POOL_SIZE) break
  }

  // ADMIN DIAGNOSTICS PANEL — read-only counts, additive only. Never
  // consumed by any selection/filtering logic above; purely informational
  // for the admin-only runtime diagnostics panel. `rawItemCount`/
  // `inSeasonAndCoordEligibleCount`/`coordinateEligibleLocalCount` mirror
  // `items`/`inSeasonItems`/`eligibleItems` exactly as already computed
  // above — no new queries, no new filtering.
  const diagnostics = {
    rawItemCount: items.length,
    // Out-of-season and missing/unusable-coordinates rejections are a
    // single combined filter step above (isItemInSeason && hasUsableCoordinates)
    // — this count cannot be split into "out of season" vs "no coords"
    // without changing that filter, so it is reported combined and labeled
    // honestly by the panel, never fabricated as two separate numbers.
    outOfSeasonOrNoCoordsCount: items.length - inSeasonItems.length,
    inSeasonAndCoordEligibleCount: inSeasonItems.length,
    bonusDropMaskedCount: inSeasonItems.length - eligibleItems.length,
    coordinateEligibleLocalCount: eligibleItems.length,
    eligibleLocalCount,
    homeRailExcludedCount,
    candidatePoolSize: candidateIds.length,
  }

  if (candidateIds.length === 0) {
    return { candidates: [], eligibleLocalCount, diagnostics }
  }

  // 2/3/4 in parallel — all scoped to exactly this candidate ID list.
  // Anonymous (no userId): none of these three are anon-reachable —
  // check_ins/whats_good_exposures RLS are self-row-only (auth.uid()-scoped,
  // meaningless with no session), and get_whats_good_momentum_contributions
  // is a SECURITY DEFINER RPC that explicitly RAISEs on an unauthenticated
  // call and has EXECUTE revoked from anon (see
  // supabase/migrations/20260902_whats_good_momentum_rpc.sql). So for anon
  // we skip all three network calls and treat every candidate as
  // never-checked-off / never-shown / momentum-neutral — the same shape a
  // brand-new signed-in user with no history would already produce.
  const [checkoffResult, exposureResult, momentumResult] = userId
    ? await Promise.all([
        activeClient.from('check_ins').select('item_id').eq('user_id', userId).in('item_id', candidateIds),
        activeClient.from('whats_good_exposures').select('item_id, last_shown_at').eq('user_id', userId).in('item_id', candidateIds),
        activeClient.rpc('get_whats_good_momentum_contributions', { candidate_item_ids: candidateIds }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]

  if (checkoffResult.error) throw checkoffResult.error
  if (exposureResult.error) throw exposureResult.error
  if (momentumResult.error) throw momentumResult.error

  const everCheckedOffSet = new Set((checkoffResult.data ?? []).map((r) => r.item_id))
  const lastShownMap = new Map((exposureResult.data ?? []).map((r) => [r.item_id, new Date(r.last_shown_at)]))

  // Group the flat RPC rows per item, validating that
  // previous_window_contributor_total (which the RPC repeats on every row
  // for a given item) actually agrees across all of that item's rows
  // before trusting it — the RPC's own SQL guarantees this, but this
  // boundary re-checks rather than assuming.
  const momentumInputByItem = new Map()
  for (const row of momentumResult.data ?? []) {
    let entry = momentumInputByItem.get(row.item_id)
    if (!entry) {
      entry = { currentBuckets: [], previousContributorTotal: row.previous_window_contributor_total }
      momentumInputByItem.set(row.item_id, entry)
    } else if (entry.previousContributorTotal !== row.previous_window_contributor_total) {
      throw new Error(
        `whatsGoodDataAdapter: inconsistent previous_window_contributor_total for item ${row.item_id} (${entry.previousContributorTotal} vs ${row.previous_window_contributor_total})`
      )
    }
    entry.currentBuckets.push({
      contributionDate: new Date(row.contribution_date),
      verificationMethod: row.verification_method,
      contributorCount: row.contributor_count,
    })
  }

  const candidates = candidateIds.map((itemId) => {
    const momentumInput = momentumInputByItem.get(itemId) ?? { currentBuckets: [], previousContributorTotal: 0 }
    return {
      itemId,
      isHomeRail: false,
      everCheckedOff: everCheckedOffSet.has(itemId),
      lastShownAt: lastShownMap.get(itemId) ?? null,
      momentumScore: computeMomentumScore(momentumInput, now),
    }
  })

  return { candidates, eligibleLocalCount, diagnostics }
}

/**
 * FINAL, MODE-AWARE geographic/eligibility render gate (2026-09-21
 * follow-up field bug fix; tightened 2026-09-21 second follow-up —
 * `whats_good_v1_never_universal`; made context-aware 2026-09-22 —
 * lib/whatsGoodCoverageMode.js). Applied by the caller (lib/useWhatsGood.js)
 * to the fully hydrated item objects for the selection ABOUT TO BE
 * RENDERED — regardless of whether those item ids came from a fresh
 * candidate query, the session cache, or a fallback-tier top-up
 * (lib/whatsGoodOrchestrator.js). Nothing upstream of this point (cache
 * preservation, ranking, momentum/personalization score, tag relevance, any
 * fallback branch) is trusted to have already enforced geography/
 * eligibility correctly; this function re-verifies it independently, one
 * more time, right before render.
 *
 * 2026-09-22 CORRECTION: the previous version of this function rejected
 * EVERY Universal item unconditionally, under every fallback tier. That was
 * itself a bug in the other direction — see lib/whatsGoodCoverageMode.js's
 * module doc — Universal items are legitimate coverage OUTSIDE CheckOff's
 * supported geography (no metro within range at all) and a legitimate
 * SUPPLEMENT (never a replacement) in a supported-but-sparse area with too
 * few local items. This function is now MODE-AWARE (see `coverageMode` in
 * `options`) rather than absolute, but the invariant that made the original
 * fix necessary — no OTHER-METRO local item can ever pass, in ANY mode —
 * still holds unconditionally: the local-place contract
 * (isEligibleForWhatsGood) below is unchanged and is still applied to every
 * local item in every mode that admits local items at all.
 *
 * Per-mode behavior (see lib/whatsGoodCoverageMode.js's COVERAGE_MODE):
 *   - SUPPORTED_SUFFICIENT: reject ALL Universal items — identical to the
 *     prior absolute rule, now scoped to this one mode. Local items must
 *     pass the full local-place contract.
 *   - SUPPORTED_SPARSE: local items must pass the full local-place
 *     contract (never relaxed); Universal items fill ONLY the slots that
 *     remain after every eligible local item has been counted, up to
 *     `targetCount` total — any Universal item beyond that is rejected,
 *     and a local item is NEVER displaced by a Universal one. Local items
 *     are always ordered ahead of Universal items in the returned array,
 *     regardless of the input order.
 *   - UNSUPPORTED: reject ALL place-based/local items outright, even one
 *     with valid-looking coordinates (this mode means "no eligible local
 *     inventory" — nothing place-based belongs on screen; this is the
 *     specific guard against a distant-metro item re-entering through a
 *     different fallback tier). Allow only Universal items, up to
 *     `targetCount`.
 *   - PENDING_LOCATION / LOCATION_UNAVAILABLE: reject everything — an
 *     empty result. The caller shows a loading state (PENDING_LOCATION) or
 *     an honest no-fabricated-content state (LOCATION_UNAVAILABLE) instead
 *     of ever rendering stale or fabricated cards.
 *
 * A Universal item is only ever accepted once per call (no duplicate
 * within one computed session — Step 7), and only when it satisfies
 * isEligibleUniversalExperience below.
 *
 * @param {Array} items  Full item objects (whatever shape rawNearbyItems
 *   already is — flat snake_case, matches getLat/getLng conventions used
 *   throughout lib/proximity.js).
 * @param {{latitude:number, longitude:number}|null} userLocation
 * @param {{maxDistance?: number, coverageMode?: string, targetCount?: number}} [options]
 *   `coverageMode` defaults to SUPPORTED_SUFFICIENT (preserves the original
 *   absolute-rejection behavior for any caller/test that doesn't pass it).
 * @returns {Array}  The subset (local first, then any admitted Universal)
 *   that passes the gate for the given mode.
 */
export function verifyNearbyForRender(items, userLocation, options = {}) {
  const {
    maxDistance = MAX_NEARBY_RADIUS_M,
    coverageMode = COVERAGE_MODE.SUPPORTED_SUFFICIENT,
    targetCount = WHATS_GOOD_TARGET_COUNT,
  } = options
  const list = items ?? []
  const localOptions = { maxDistance }

  switch (coverageMode) {
    case COVERAGE_MODE.PENDING_LOCATION:
    case COVERAGE_MODE.LOCATION_UNAVAILABLE:
      // No fabricated content in either state — see module doc above.
      return []

    case COVERAGE_MODE.UNSUPPORTED:
      return admitUniversalOnly(list, targetCount)

    case COVERAGE_MODE.SUPPORTED_SPARSE:
      return admitLocalThenUniversal(list, userLocation, localOptions, targetCount)

    case COVERAGE_MODE.SUPPORTED_SUFFICIENT:
    default:
      // Unchanged from the pre-2026-09-22 absolute rule: only real local
      // places, never Universal.
      return list.filter((item) => isEligibleForWhatsGood(item, userLocation, localOptions))
  }
}

/**
 * SUPPORTED_SPARSE composition: every eligible local item first (full local
 * contract, never relaxed, never displaced), then Universal items filling
 * only the genuinely remaining slots up to `targetCount` — see
 * verifyNearbyForRender's module doc. Always returns local items ahead of
 * Universal ones in the returned array, regardless of the input item order,
 * so this function is itself the authoritative enforcement of "local
 * before Universal" (Step 7), not merely a passthrough of upstream order.
 */
function admitLocalThenUniversal(items, userLocation, localOptions, targetCount) {
  const locals = []
  const universalCandidates = []
  for (const item of items) {
    if (isUniversalItem(item)) {
      universalCandidates.push(item)
    } else if (isEligibleForWhatsGood(item, userLocation, localOptions)) {
      locals.push(item)
    }
    // A local item that fails the place contract is dropped, exactly as
    // in every other mode — sparse coverage never relaxes that contract.
  }

  const remainingSlots = Math.max(0, targetCount - locals.length)
  const admittedUniversal = []
  const seenUniversalIds = new Set()
  for (const item of universalCandidates) {
    if (admittedUniversal.length >= remainingSlots) break
    if (!isEligibleUniversalExperience(item)) continue
    const id = item?.id
    if (id != null) {
      if (seenUniversalIds.has(id)) continue // never the same Universal item twice in one computation (Step 7)
      seenUniversalIds.add(id)
    }
    admittedUniversal.push(item)
  }

  return [...locals, ...admittedUniversal]
}

/** UNSUPPORTED composition: Universal items only, up to targetCount, deduped, never a local/place item (see verifyNearbyForRender's module doc — this is the guard against a distant metro re-entering here). */
function admitUniversalOnly(items, targetCount) {
  const out = []
  const seenIds = new Set()
  for (const item of items) {
    if (out.length >= targetCount) break
    if (!isUniversalItem(item) || !isEligibleUniversalExperience(item)) continue
    const id = item?.id
    if (id != null) {
      if (seenIds.has(id)) continue
      seenIds.add(id)
    }
    out.push(item)
  }
  return out
}

function isUniversalItem(item) {
  return Boolean(item?.is_universal ?? item?.isUniversal ?? false)
}

/**
 * Single-item version of the LOCAL PLACE contract verifyNearbyForRender
 * applies to every local item in every mode that admits local items — pure
 * predicate, no I/O. UNCHANGED from the pre-2026-09-22 version (Step 5:
 * "local place contract... preserve exactly") — a local item must be
 * non-Universal, have usable coordinates, and be within `maxDistance` of a
 * usable `userLocation`. Exists as its own export (rather than only
 * inlined inside a filter) specifically so:
 *   (a) verifyNearbyForRender and the dev-time assertion below
 *       (findWhatsGoodContractViolations) share exactly one rule
 *       implementation — never two copies that could drift, and
 *   (b) it is directly unit-testable per-item, independent of list
 *       filtering behavior.
 *
 * @param {object} item
 * @param {{latitude:number, longitude:number}|null} userLocation
 * @param {{maxDistance?: number}} [options]
 * @returns {boolean}
 */
export function isEligibleForWhatsGood(item, userLocation, { maxDistance = MAX_NEARBY_RADIUS_M } = {}) {
  if (isUniversalItem(item)) return false // the LOCAL place contract — a Universal item is never a local place, see isEligibleUniversalExperience for its own contract

  const userHasUsableLocation =
    userLocation != null &&
    typeof userLocation.latitude === 'number' && typeof userLocation.longitude === 'number'
  if (!userHasUsableLocation) return false

  const lat = item?.maps_lat ?? item?.mapsLat
  const lng = item?.maps_lng ?? item?.mapsLng
  if (!hasUsableCoordinates(lat, lng)) return false

  const distM = haversineMeters(userLocation.latitude, userLocation.longitude, lat, lng)
  return distM <= maxDistance
}

/**
 * The UNIVERSAL experience contract (new 2026-09-22, more nuanced than the
 * prior blanket rejection — Step 6): explicitly `is_universal`/`isUniversal`
 * true, and carries a real id (a valid navigation/detail destination — the
 * same `id` ItemDetail navigation already keys off, see
 * components/home/WhatsGoodDiscovery.jsx's onPress). Deliberately does NOT
 * require coordinates (Universal items never have them) and callers must
 * NOT display distance/map/navigation affordances for one — that
 * card-type distinction already exists and is reused as-is, not
 * reinvented: components/home/EditorialCard.jsx's `formatDistanceLabel`
 * already returns null for `item.is_universal` (see its "distance only,
 * when it's actually useful" comment), which is exactly the existing
 * place/Universal card-type split this contract relies on.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isEligibleUniversalExperience(item) {
  if (!isUniversalItem(item)) return false
  return item?.id != null
}

/**
 * Dev/test-time assertion helper (see lib/useWhatsGood.js's __DEV__-gated
 * use right before setSelectedItems) — a pure function usable identically
 * at runtime and directly in a test, per this repo's established
 * pure-logic-extraction convention. Returns the ids of any item in `items`
 * that does NOT satisfy the What's Good contract FOR THE GIVEN
 * `coverageMode` (mode-aware, mirroring verifyNearbyForRender exactly — see
 * its doc for per-mode rules). An empty array means the contract holds for
 * every item under that mode.
 *
 * @param {Array} items
 * @param {{latitude:number, longitude:number}|null} userLocation
 * @param {{maxDistance?: number, coverageMode?: string, targetCount?: number}} [options]
 * @returns {string[]}
 */
export function findWhatsGoodContractViolations(items, userLocation, options = {}) {
  const {
    maxDistance = MAX_NEARBY_RADIUS_M,
    coverageMode = COVERAGE_MODE.SUPPORTED_SUFFICIENT,
    targetCount = WHATS_GOOD_TARGET_COUNT,
  } = options
  const list = items ?? []
  const localOptions = { maxDistance }

  if (coverageMode === COVERAGE_MODE.PENDING_LOCATION || coverageMode === COVERAGE_MODE.LOCATION_UNAVAILABLE) {
    // Nothing should ever render in these modes — every item is a violation.
    return list.map((item) => item?.id)
  }

  if (coverageMode === COVERAGE_MODE.UNSUPPORTED) {
    return list.filter((item) => !isUniversalItem(item) || !isEligibleUniversalExperience(item)).map((item) => item?.id)
  }

  if (coverageMode === COVERAGE_MODE.SUPPORTED_SPARSE) {
    const localCount = list.filter((item) => !isUniversalItem(item)).length
    const remainingSlots = Math.max(0, targetCount - localCount)
    const violations = []
    let universalSeen = 0
    for (const item of list) {
      if (isUniversalItem(item)) {
        universalSeen += 1
        if (universalSeen > remainingSlots || !isEligibleUniversalExperience(item)) violations.push(item?.id)
      } else if (!isEligibleForWhatsGood(item, userLocation, localOptions)) {
        violations.push(item?.id)
      }
    }
    return violations
  }

  // SUPPORTED_SUFFICIENT (default): the original absolute rule — a
  // Universal item, or any local item failing the place contract, is a
  // violation.
  return list
    .filter((item) => isUniversalItem(item) || !isEligibleForWhatsGood(item, userLocation, localOptions))
    .map((item) => item?.id)
}
