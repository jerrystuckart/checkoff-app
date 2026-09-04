// What's Good V1 — pure selection/ranking engine. Accepts an
// already-loaded candidate pool and returns the final 3 picks, per the
// locked product decisions `whats_good_v1_candidate_pool_and_fallback`,
// `whats_good_v1_unchecked_preference`, and `whats_good_v1_exposure_rotation`
// (see docs/whats-good-widget/product-discovery.md, Decision Area 8).
//
// PURE: no Supabase, no network, no filesystem, no AsyncStorage, no
// Expo/location APIs, no hidden current time (`now` is always an explicit
// parameter), no mutation of caller inputs. Universal fallback (when fewer
// than 3 eligible candidates remain) is deliberately NOT handled here —
// that is the caller/pool-builder's responsibility, per
// `whats_good_v1_candidate_pool_and_fallback`.
//
// THE COMBINED FRESHNESS CLASS (this module's central design decision):
// checked-status and exposure-recency are each turned into a small integer
// tier and SUMMED into one ordinal `freshnessClass` (0-3, lower = better),
// rather than compared as two separate sequential sort keys. This is what
// makes checkoff history a strong-but-not-absolute preference: a checked
// item is penalized by exactly CHECKED_PENALTY_WEIGHT exposure-tier-steps,
// so a checked-but-long-unshown item CAN outrank an unchecked-but-just-shown
// item when the exposure gap is large enough — while a checked+recently-shown
// item can never cross a genuine freshnessClass gap into an unchecked+
// meaningfully-less-recently-shown item's territory, no matter how high its
// momentum is (see compareCandidates below — momentum is only ever read
// AFTER freshnessClass has already resolved to a tie). This is a structural
// guarantee, not a tuned outcome.

// ---------------------------------------------------------------------------
// Tunable implementation defaults — approved as provisional, not product
// decisions. Adjusting these changes HOW strongly/quickly each rule bites,
// never WHETHER the underlying product rule (unchecked preference, exposure
// rotation, momentum-never-crosses-class) holds.
// ---------------------------------------------------------------------------

/** How many exposure-tier-steps of penalty a checked-off item carries. Rule: "strongly prefer never-checked... downranked, not excluded." */
export const CHECKED_PENALTY_WEIGHT = 1

/** Shown within this many days = exposure tier 2 (highest penalty). Rule: "strongly penalize recently exposed." */
export const EXPOSURE_TIER_RECENT_DAYS = 3

/** Shown within this many days (but beyond RECENT) = exposure tier 1; beyond this = tier 0, fully recycled. Rule: "older exposures naturally become more eligible again." */
export const EXPOSURE_TIER_MODERATE_DAYS = 14

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysBetween(earlier, later) {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY
}

/**
 * 0 = never shown, or shown long enough ago to be fully recycled.
 * 1 = moderately recent.
 * 2 = recently shown.
 */
export function exposureTier(lastShownAt, now) {
  if (lastShownAt == null) return 0
  const ageDays = daysBetween(lastShownAt, now)
  if (ageDays < EXPOSURE_TIER_RECENT_DAYS) return 2
  if (ageDays < EXPOSURE_TIER_MODERATE_DAYS) return 1
  return 0
}

/** 0 if never checked off, CHECKED_PENALTY_WEIGHT if previously checked off. */
export function checkedPenalty(everCheckedOff) {
  return everCheckedOff ? CHECKED_PENALTY_WEIGHT : 0
}

/** freshnessClass = exposureTier + checkedPenalty. Lower is better/fresher. */
export function freshnessClass(candidate, now) {
  return exposureTier(candidate.lastShownAt, now) + checkedPenalty(candidate.everCheckedOff)
}

/**
 * freshnessClass first (never crossed by momentum), momentumScore second
 * (descending — higher momentum ranks first) ONLY within an identical
 * freshnessClass, itemId last as the final deterministic tie-break (no
 * pure randomness anywhere in this module).
 */
export function compareCandidates(a, b, now) {
  const classA = freshnessClass(a, now)
  const classB = freshnessClass(b, now)
  if (classA !== classB) return classA - classB
  if (a.momentumScore !== b.momentumScore) return b.momentumScore - a.momentumScore
  if (a.itemId < b.itemId) return -1
  if (a.itemId > b.itemId) return 1
  return 0
}

/**
 * @param {Array<{
 *   itemId: string,
 *   isHomeRail: boolean,
 *   everCheckedOff: boolean,
 *   lastShownAt: Date|null,
 *   momentumScore: number,
 * }>} candidates  Roughly 15, may include the current Home Rail 5 (this
 *   function excludes them). Never mutated.
 * @param {Date} now
 * @returns {{
 *   selectedItemIds: string[],
 *   ranked: Array<{itemId: string, freshnessClass: number, momentumScore: number}>,
 * }} selectedItemIds may contain FEWER than 3 ids if fewer than 3 eligible
 *   candidates remain after Home Rail exclusion — Universal fallback top-up
 *   is the caller's responsibility, not this function's.
 */
export function selectWhatsGood(candidates, now) {
  const eligible = candidates.filter((c) => !c.isHomeRail)

  // IMPORTANT: sort the full-shaped candidates (which carry lastShownAt/
  // everCheckedOff) BEFORE mapping to the summary shape below — sorting
  // the already-mapped summary objects would feed compareCandidates()
  // objects with no lastShownAt/everCheckedOff, silently recomputing
  // freshnessClass as 0 for everyone. `[...eligible]` copies so the
  // caller's own array/order is never mutated by .sort().
  const sorted = [...eligible].sort((a, b) => compareCandidates(a, b, now))

  const ranked = sorted.map((c) => ({
    itemId: c.itemId,
    freshnessClass: freshnessClass(c, now),
    momentumScore: c.momentumScore,
  }))

  return {
    selectedItemIds: ranked.slice(0, 3).map((c) => c.itemId),
    ranked,
  }
}
