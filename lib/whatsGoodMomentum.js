// What's Good V1 — pure momentum-score computation. Locked product rules
// (decision `whats_good_v1_momentum_ranking`, see
// docs/whats-good-widget/product-discovery.md, Decision Area 8):
//   - rolling 30-day active window
//   - momentum only begins once >= 3 distinct users have contributed in
//     that window
//   - newer activity weighted more heavily than older activity within the
//     window
//   - light verification-method weighting
//   - a small capped "rising" bonus vs. the preceding comparable window
//   - momentum is bounded and capped, never a raw popularity leaderboard
//
// PRIVACY BOUNDARY: this function's input contains NO user identity and NO
// exact per-contributor timestamp — see the "What's Good V1 — Data Adapter
// Preflight" design conversation. Raw check_ins rows are read only inside
// the `get_whats_good_momentum_contributions` SECURITY DEFINER Postgres
// function (supabase/migrations/20260902_whats_good_momentum_rpc.sql),
// which internally deduplicates by (item, window, user) — most recent
// qualifying checkoff wins — enforces the 3-distinct-user floor, and
// returns only anonymous, day-granularity, aggregated buckets plus a
// single previous-window total. This function receives exactly that
// aggregated shape; it cannot see a userId or an exact checkoff instant
// even if it wanted to. Pipeline: check_ins -> RPC (dedup + floor +
// aggregate, identity stripped) -> this module (pure scoring) ->
// lib/whatsGoodSelection.js (pure ranking).
//
// PURE: no Supabase, no network, no filesystem, no AsyncStorage, no
// Expo/location APIs, no hidden current time (`now` is always an explicit
// parameter), no mutation of caller inputs.

// ---------------------------------------------------------------------------
// Locked product rules — NOT tunable. Changing these is a product decision,
// not an implementation tweak. See decision `whats_good_v1_momentum_ranking`.
// The 30-day window and 3-user floor are enforced primarily by the RPC now
// (see module doc above) — exported here for documentation/single-reference
// purposes and because this module still applies the floor itself as
// defense-in-depth (never trusting the RPC's own guarantee as this
// function's sole evidence).
// ---------------------------------------------------------------------------
export const MOMENTUM_WINDOW_DAYS = 30
export const MOMENTUM_MIN_DISTINCT_USERS = 3

// ---------------------------------------------------------------------------
// Tunable implementation defaults — approved as provisional, not product
// decisions. Safe to retune without changing what the product rules above
// actually require.
// ---------------------------------------------------------------------------

/** "Newer activity weighted more heavily" — exponential half-life decay within the window. */
export const MOMENTUM_RECENCY_HALF_LIFE_DAYS = 10

/** "Light verification-method weighting" — higher-confidence checkoffs contribute more. */
export const MOMENTUM_VERIFICATION_WEIGHTS = {
  live_location: 1.0,
  qr_scan: 1.0,
  historical_visit_confirmed: 1.0,
  photo: 0.8,
  admin: 0.5,
  legacy: 0.3,
}

/** Any verification_method not in the map above (including null/undefined) is treated as low-confidence, not full weight. */
export const DEFAULT_VERIFICATION_WEIGHT = 0.3

/** "Small capped rising bonus" — max fraction of the base score the rising effect may add. */
export const MOMENTUM_RISING_BONUS_CAP = 0.25

/** Overall bound so momentum stays well-behaved and non-gameable, independent of raw volume. */
export const MOMENTUM_SCORE_CAP = 10

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysBetween(earlier, later) {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY
}

function verificationWeight(method) {
  return Object.prototype.hasOwnProperty.call(MOMENTUM_VERIFICATION_WEIGHTS, method)
    ? MOMENTUM_VERIFICATION_WEIGHTS[method]
    : DEFAULT_VERIFICATION_WEIGHT
}

/** Exponential decay: weight 1.0 at age 0, halving every MOMENTUM_RECENCY_HALF_LIFE_DAYS. Future-dated buckets (clock skew) are never weighted above 1.0. */
function recencyWeight(contributionDate, now) {
  const ageDays = daysBetween(contributionDate, now)
  if (ageDays <= 0) return 1
  return Math.pow(0.5, ageDays / MOMENTUM_RECENCY_HALF_LIFE_DAYS)
}

/**
 * @typedef {Object} CurrentContributionBucket
 * @property {Date} contributionDate     Day-granularity (from the RPC's UTC date bucket).
 * @property {string} verificationMethod
 * @property {number} contributorCount   >= 1, distinct contributors represented by this bucket.
 */

/**
 * @param {{currentBuckets: CurrentContributionBucket[], previousContributorTotal: number}} input
 *   ONE item's worth, already deduplicated, floor-checked, and aggregated
 *   by the SECURITY DEFINER RPC. No userId, no exact per-contributor
 *   timestamp, no previous-window dates or verification methods — only a
 *   single previous-window total count. Never mutated.
 * @param {Date} now
 * @returns {number} A bounded, non-negative momentum score. Exactly 0 if
 *   the current buckets' total contributor count is below
 *   MOMENTUM_MIN_DISTINCT_USERS (defense-in-depth — the RPC already
 *   enforces this and should never send an under-floor item at all, but
 *   this function never trusts that as its own evidence).
 */
export function computeMomentumScore({ currentBuckets, previousContributorTotal }, now) {
  const currentTotal = currentBuckets.reduce((sum, b) => sum + b.contributorCount, 0)

  if (currentTotal < MOMENTUM_MIN_DISTINCT_USERS) return 0

  let score = 0
  for (const b of currentBuckets) {
    score += recencyWeight(b.contributionDate, now) * verificationWeight(b.verificationMethod) * b.contributorCount
  }

  // Rising bonus: only when there IS a defined prior baseline to rise
  // against (previousContributorTotal > 0) and current activity genuinely
  // exceeds it.
  if (previousContributorTotal > 0 && currentTotal > previousContributorTotal) {
    const risingFraction = Math.min(MOMENTUM_RISING_BONUS_CAP, (currentTotal - previousContributorTotal) / previousContributorTotal)
    score += score * risingFraction
  }

  return Math.min(MOMENTUM_SCORE_CAP, score)
}
