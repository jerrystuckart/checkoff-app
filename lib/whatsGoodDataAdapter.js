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
// responsibility, reusing the same proximitySort/interleave mechanics Home
// Rail already has, at wiring time (not yet implemented).

import { proximitySort } from './proximity.js'
import { computeMomentumScore } from './whatsGoodMomentum.js'
import { isItemInSeason } from './seasonFilter.js'
import { hasUsableCoordinates, MAX_NEARBY_RADIUS_M } from './nearbyRanking.js'
import { haversineMeters } from './distance.js'

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
 * @returns {Promise<{candidates: Array<{
 *   itemId: string,
 *   isHomeRail: boolean,
 *   everCheckedOff: boolean,
 *   lastShownAt: Date|null,
 *   momentumScore: number,
 * }>}>}  Exactly the shape selectWhatsGood() expects. May contain fewer
 *   than CANDIDATE_POOL_SIZE candidates if fewer real local candidates
 *   exist — Universal fallback top-up is the caller's job, not this
 *   function's.
 */
export async function assembleWhatsGoodCandidates({ userId, userLocation, homeRailItemIds, now, client }) {
  const activeClient = client ?? (await import('./supabase.js')).supabase
  const homeRailSet = new Set(homeRailItemIds)

  // 1. Items — same non-universal/located/active/approved shape Home
  // Rail's own loadNearbyRail() already fetches, no metro/city filter
  // (matches its existing behavior). Reuses proximitySort() unmodified for
  // the actual distance sort/tiering — no proximity logic duplicated here.
  const { data: items, error: itemsError } = await activeClient
    .from('items')
    .select('id, maps_lat, maps_lng, season_tag')
    .eq('is_active', true)
    .eq('is_approved', true)
    .eq('is_universal', false)
    .not('maps_lat', 'is', null)
    .not('maps_lng', 'is', null)
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

  const candidateIds = []
  for (const item of sortedItems) {
    if (homeRailSet.has(item.id)) continue
    candidateIds.push(item.id)
    if (candidateIds.length >= CANDIDATE_POOL_SIZE) break
  }

  if (candidateIds.length === 0) {
    return { candidates: [] }
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

  return { candidates }
}

/**
 * FINAL, UNCONDITIONAL geographic render gate (2026-09-21 follow-up field
 * bug fix). Applied by the caller (lib/useWhatsGood.js) to the fully
 * hydrated item objects for the selection ABOUT TO BE RENDERED — regardless
 * of whether those item ids came from a fresh candidate query, the session
 * cache, or the Universal fallback top-up. Nothing upstream of this point
 * (cache preservation, ranking, momentum/personalization score, tag
 * relevance) is trusted to have already enforced geography correctly; this
 * function re-verifies it independently, one more time, right before
 * render, so a bug anywhere upstream can never put an out-of-radius card on
 * screen.
 *
 * Rules:
 *   - A Universal item (no single "home" location by design — see
 *     lib/proximity.js) is exempt: it is not a location-based card, so
 *     there is nothing to verify. It always passes.
 *   - Every OTHER item MUST have usable coordinates (lib/nearbyRanking.js's
 *     hasUsableCoordinates — read-only reference) and MUST be within
 *     `maxDistance` (default MAX_NEARBY_RADIUS_M, the same 100mi cutoff
 *     Nearby enforces) of the CURRENT `userLocation`. Anything that fails
 *     either check is dropped — never rendered, never backfilled from
 *     another city to hit a target count (that's the caller's job to
 *     accept: fewer cards, or an honest empty state).
 *   - If `userLocation` itself isn't usable, every non-Universal item is
 *     rejected (there is nothing to verify distance against).
 *
 * @param {Array} items  Full item objects (whatever shape rawNearbyItems
 *   already is — flat snake_case, matches getLat/getLng conventions used
 *   throughout lib/proximity.js).
 * @param {{latitude:number, longitude:number}|null} userLocation
 * @param {{maxDistance?: number}} [options]
 * @returns {Array}  The subset of `items` that pass the gate, in the same
 *   relative order as given.
 */
export function verifyNearbyForRender(items, userLocation, { maxDistance = MAX_NEARBY_RADIUS_M } = {}) {
  const userHasUsableLocation =
    userLocation != null &&
    typeof userLocation.latitude === 'number' && typeof userLocation.longitude === 'number'

  return (items ?? []).filter((item) => {
    const isUniversal = item?.is_universal ?? item?.isUniversal ?? false
    if (isUniversal) return true // not a location-based card — exempt by design

    if (!userHasUsableLocation) return false

    const lat = item?.maps_lat ?? item?.mapsLat
    const lng = item?.maps_lng ?? item?.mapsLng
    if (!hasUsableCoordinates(lat, lng)) return false

    const distM = haversineMeters(userLocation.latitude, userLocation.longitude, lat, lng)
    return distM <= maxDistance
  })
}
