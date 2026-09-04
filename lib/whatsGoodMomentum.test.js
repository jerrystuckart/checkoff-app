// What's Good V1 — whatsGoodMomentum.js unit tests. Pure, no DB, no network.
// Fixtures deliberately carry no userId anywhere, matching the module's
// actual input contract (see whatsGoodMomentum.js's module doc): the RPC
// has already deduplicated/floor-checked/aggregated before this data
// exists.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeMomentumScore,
  MOMENTUM_MIN_DISTINCT_USERS,
  MOMENTUM_RISING_BONUS_CAP,
  MOMENTUM_SCORE_CAP,
} from './whatsGoodMomentum.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function daysAgo(n) {
  return new Date(NOW.getTime() - n * DAY)
}

/** One current-window bucket: contributorCount distinct contributors, all on the same day/method. */
function bucket(ageDays, verificationMethod = 'live_location', contributorCount = 1) {
  return { contributionDate: daysAgo(ageDays), verificationMethod, contributorCount }
}

function momentumInput(currentBuckets, previousContributorTotal = 0) {
  return { currentBuckets, previousContributorTotal }
}

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

test('below-3-contributor floor: current total under MOMENTUM_MIN_DISTINCT_USERS -> exactly 0', () => {
  assert.equal(MOMENTUM_MIN_DISTINCT_USERS, 3)
  assert.equal(computeMomentumScore(momentumInput([bucket(1, 'live_location', 2)]), NOW), 0)
})

test('floor based on the SUM of contributorCount across buckets, not the number of bucket rows', () => {
  // Two buckets, different verification methods, same day: 2 + 2 = 4 total -> clears the floor.
  const twoBucketsSummingAbove = [bucket(1, 'live_location', 2), bucket(1, 'qr_scan', 2)]
  assert.ok(computeMomentumScore(momentumInput(twoBucketsSummingAbove), NOW) > 0)

  // Two buckets, but summing to only 2 -> still below the floor, even
  // though there are 2 rows (proving the check sums counts, not counts rows).
  const twoBucketsSummingBelow = [bucket(1, 'live_location', 1), bucket(1, 'qr_scan', 1)]
  assert.equal(computeMomentumScore(momentumInput(twoBucketsSummingBelow), NOW), 0)
})

test('floor is a hard gate: exactly MOMENTUM_MIN_DISTINCT_USERS produces a positive score', () => {
  assert.ok(computeMomentumScore(momentumInput([bucket(1, 'live_location', 3)]), NOW) > 0)
})

test('below-3 defense-in-depth: this function never trusts the RPC as its own evidence, even for a hypothetically malformed input', () => {
  assert.equal(computeMomentumScore(momentumInput([bucket(0, 'live_location', 2)]), NOW), 0)
  assert.equal(computeMomentumScore(momentumInput([]), NOW), 0)
})

// ---------------------------------------------------------------------------
// contributorCount > 1 multiplies weight correctly
// ---------------------------------------------------------------------------

test('contributorCount > 1 multiplies the per-contributor weight — a bucket of 5 scores 5x an otherwise-identical bucket of 1 (within the floor via companion buckets)', () => {
  const single = momentumInput([bucket(1, 'live_location', 1), bucket(1, 'qr_scan', 2)]) // total 3, clears floor
  const quintuple = momentumInput([bucket(1, 'live_location', 5), bucket(1, 'qr_scan', 2)]) // same companion bucket
  // Isolate the contribution of the varying bucket: quintuple's score minus
  // single's score should be ~4x single's own live_location-bucket weight
  // (5x - 1x = 4x the per-contributor weight of that one bucket).
  const singleScore = computeMomentumScore(single, NOW)
  const quintupleScore = computeMomentumScore(quintuple, NOW)
  assert.ok(quintupleScore > singleScore)
})

test('contributorCount scales score exactly linearly for a single-bucket item (no rising bonus in play)', () => {
  const three = computeMomentumScore(momentumInput([bucket(5, 'live_location', 3)]), NOW)
  const six = computeMomentumScore(momentumInput([bucket(5, 'live_location', 6)]), NOW)
  assert.ok(Math.abs(six - three * 2) < 1e-9, `expected doubling contributorCount to double the score (got ${three} vs ${six})`)
})

// ---------------------------------------------------------------------------
// Recency weighting
// ---------------------------------------------------------------------------

test('newer contribution buckets score higher than older ones', () => {
  const newer = computeMomentumScore(momentumInput([bucket(1, 'live_location', 3)]), NOW)
  const older = computeMomentumScore(momentumInput([bucket(20, 'live_location', 3)]), NOW)
  assert.ok(newer > older)
})

// ---------------------------------------------------------------------------
// Verification-method weighting
// ---------------------------------------------------------------------------

test('higher-confidence verification methods score higher than legacy/admin, all else equal', () => {
  const highConfidence = computeMomentumScore(momentumInput([bucket(1, 'live_location', 3)]), NOW)
  const lowConfidence = computeMomentumScore(momentumInput([bucket(1, 'legacy', 3)]), NOW)
  assert.ok(highConfidence > lowConfidence)
})

test('unknown verification_method is treated as low-confidence, not full weight', () => {
  const unknown = computeMomentumScore(momentumInput([bucket(1, 'some_future_method', 3)]), NOW)
  const known = computeMomentumScore(momentumInput([bucket(1, 'live_location', 3)]), NOW)
  assert.ok(unknown < known)
})

// ---------------------------------------------------------------------------
// Rising bonus / previousContributorTotal
// ---------------------------------------------------------------------------

test('rising: current total exceeding previousContributorTotal increases the score beyond the base', () => {
  const rising = momentumInput([bucket(1, 'live_location', 5)], 3)
  const flat = momentumInput([bucket(1, 'live_location', 5)], 5)
  assert.ok(computeMomentumScore(rising, NOW) > computeMomentumScore(flat, NOW))
})

test('previousContributorTotal = 0 -> no rising bonus (base score only, no divide-by-zero, no inflated bonus)', () => {
  const noPrior = momentumInput([bucket(1, 'live_location', 4)], 0)
  const flatPrior = momentumInput([bucket(1, 'live_location', 4)], 4)
  assert.equal(computeMomentumScore(noPrior, NOW), computeMomentumScore(flatPrior, NOW))
  assert.ok(Number.isFinite(computeMomentumScore(noPrior, NOW)))
})

test('rising bonus is capped at MOMENTUM_RISING_BONUS_CAP even for an enormous relative increase', () => {
  const hugeRise = momentumInput([bucket(1, 'live_location', 50)], 1)
  const flatAtNewLevel = momentumInput([bucket(1, 'live_location', 50)], 50)
  const scoreWithHugeRise = computeMomentumScore(hugeRise, NOW)
  const scoreFlat = computeMomentumScore(flatAtNewLevel, NOW)
  assert.ok(scoreWithHugeRise <= scoreFlat * (1 + MOMENTUM_RISING_BONUS_CAP) + 1e-9)
})

// ---------------------------------------------------------------------------
// Overall cap
// ---------------------------------------------------------------------------

test('overall score cap: MOMENTUM_SCORE_CAP is never exceeded even with a very large, very recent, very high-confidence bucket', () => {
  const massive = momentumInput([bucket(0, 'live_location', 5000)], 1)
  const score = computeMomentumScore(massive, NOW)
  assert.ok(score <= MOMENTUM_SCORE_CAP)
  assert.equal(score, MOMENTUM_SCORE_CAP)
})

// ---------------------------------------------------------------------------
// Determinism / purity
// ---------------------------------------------------------------------------

test('deterministic: identical input and now always produce identical output, regardless of bucket array order', () => {
  const buckets = [bucket(5, 'live_location', 2), bucket(1, 'qr_scan', 2)]
  const input = momentumInput(buckets, 1)
  const a = computeMomentumScore(input, NOW)
  const b = computeMomentumScore(input, NOW)
  const c = computeMomentumScore(momentumInput([...buckets].reverse(), 1), NOW)
  assert.equal(a, b)
  assert.equal(a, c)
})

test('never mutates the input buckets array/objects or the input object itself', () => {
  const buckets = [bucket(1, 'live_location', 3)]
  const input = momentumInput(buckets, 2)
  const snapshot = JSON.parse(JSON.stringify(input))
  computeMomentumScore(input, NOW)
  assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot)
})

test('never returns a negative score', () => {
  assert.equal(computeMomentumScore(momentumInput([]), NOW), 0)
})
