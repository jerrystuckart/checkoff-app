// What's Good V1 — whatsGoodSelection.js unit tests. Pure, no DB, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  selectWhatsGood,
  compareCandidates,
  freshnessClass,
  exposureTier,
  checkedPenalty,
  CHECKED_PENALTY_WEIGHT,
  EXPOSURE_TIER_RECENT_DAYS,
  EXPOSURE_TIER_MODERATE_DAYS,
} from './whatsGoodSelection.js'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function daysAgo(n) {
  return new Date(NOW.getTime() - n * DAY)
}

function candidate(overrides = {}) {
  return {
    itemId: 'item-default',
    isHomeRail: false,
    everCheckedOff: false,
    lastShownAt: null,
    momentumScore: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Home Rail exclusion
// ---------------------------------------------------------------------------

test('Home Rail items are excluded entirely, never appear in ranked output', () => {
  const candidates = [
    candidate({ itemId: 'rail-1', isHomeRail: true }),
    candidate({ itemId: 'rail-2', isHomeRail: true }),
    candidate({ itemId: 'good-1', isHomeRail: false }),
  ]
  const result = selectWhatsGood(candidates, NOW)
  assert.deepEqual(result.selectedItemIds, ['good-1'])
  assert.equal(result.ranked.find((r) => r.itemId === 'rail-1'), undefined)
  assert.equal(result.ranked.find((r) => r.itemId === 'rail-2'), undefined)
})

// ---------------------------------------------------------------------------
// Unchecked preference / checked items remain eligible
// ---------------------------------------------------------------------------

test('never-checked items rank ahead of checked items when exposure is otherwise equal', () => {
  const unchecked = candidate({ itemId: 'unchecked', everCheckedOff: false, lastShownAt: null })
  const checked = candidate({ itemId: 'checked', everCheckedOff: true, lastShownAt: null })
  const result = selectWhatsGood([unchecked, checked], NOW)
  assert.deepEqual(result.selectedItemIds, ['unchecked', 'checked'])
})

test('checked items remain eligible — never hard-excluded, even when several unchecked items exist', () => {
  const candidates = [
    candidate({ itemId: 'unchecked-1' }),
    candidate({ itemId: 'unchecked-2' }),
    candidate({ itemId: 'checked-1', everCheckedOff: true }),
  ]
  const result = selectWhatsGood(candidates, NOW)
  assert.ok(result.selectedItemIds.includes('checked-1'), 'a checked item must still be selectable, just downranked')
})

// ---------------------------------------------------------------------------
// Exposure tiers / boundaries
// ---------------------------------------------------------------------------

test('exposureTier: never shown -> 0', () => {
  assert.equal(exposureTier(null, NOW), 0)
})

test('exposureTier boundaries: exactly at EXPOSURE_TIER_RECENT_DAYS and EXPOSURE_TIER_MODERATE_DAYS', () => {
  assert.equal(EXPOSURE_TIER_RECENT_DAYS, 3)
  assert.equal(EXPOSURE_TIER_MODERATE_DAYS, 14)

  assert.equal(exposureTier(daysAgo(0), NOW), 2, 'shown today -> tier 2')
  assert.equal(exposureTier(daysAgo(2.9), NOW), 2, 'just under the recent boundary -> tier 2')
  assert.equal(exposureTier(daysAgo(3), NOW), 1, 'exactly at the recent boundary -> tier 1 (< is strict)')
  assert.equal(exposureTier(daysAgo(13.9), NOW), 1, 'just under the moderate boundary -> tier 1')
  assert.equal(exposureTier(daysAgo(14), NOW), 0, 'exactly at the moderate boundary -> tier 0 (fully recycled)')
  assert.equal(exposureTier(daysAgo(100), NOW), 0, 'shown long ago -> tier 0')
})

test('checkedPenalty: 0 when never checked off, CHECKED_PENALTY_WEIGHT when checked off', () => {
  assert.equal(CHECKED_PENALTY_WEIGHT, 1)
  assert.equal(checkedPenalty(false), 0)
  assert.equal(checkedPenalty(true), 1)
})

// ---------------------------------------------------------------------------
// Long-unshown recycling
// ---------------------------------------------------------------------------

test('a long-unshown item recycles back to the best exposure tier — ranks the same as a never-shown item, all else equal', () => {
  const neverShown = candidate({ itemId: 'never-shown', lastShownAt: null })
  const longUnshown = candidate({ itemId: 'long-unshown', lastShownAt: daysAgo(50) })
  assert.equal(freshnessClass(neverShown, NOW), freshnessClass(longUnshown, NOW))
})

// ---------------------------------------------------------------------------
// The five pairwise examples from the approved preflight
// ---------------------------------------------------------------------------

test('pairwise 1: unchecked+never-shown beats checked+never-shown', () => {
  const a = candidate({ itemId: 'a-unchecked-never-shown', everCheckedOff: false, lastShownAt: null })
  const b = candidate({ itemId: 'b-checked-never-shown', everCheckedOff: true, lastShownAt: null })
  assert.deepEqual(selectWhatsGood([a, b], NOW).selectedItemIds, ['a-unchecked-never-shown', 'b-checked-never-shown'])
})

test('pairwise 2: checked+long-unshown beats unchecked+very-recently-shown (exposure gap outweighs a single checkoff penalty step)', () => {
  const uncheckedVeryRecent = candidate({ itemId: 'unchecked-very-recent', everCheckedOff: false, lastShownAt: daysAgo(0) })
  const checkedLongUnshown = candidate({ itemId: 'checked-long-unshown', everCheckedOff: true, lastShownAt: daysAgo(50) })
  assert.deepEqual(
    selectWhatsGood([uncheckedVeryRecent, checkedLongUnshown], NOW).selectedItemIds,
    ['checked-long-unshown', 'unchecked-very-recent']
  )
})

test('pairwise 3 (CRITICAL INVARIANT): unchecked+long-unshown beats checked+recent+high-momentum, unconditionally — momentum is never even consulted', () => {
  const uncheckedLongUnshown = candidate({ itemId: 'unchecked-long-unshown', everCheckedOff: false, lastShownAt: daysAgo(50), momentumScore: 0 })
  const checkedRecentHighMomentum = candidate({ itemId: 'checked-recent-high-momentum', everCheckedOff: true, lastShownAt: daysAgo(0), momentumScore: 1000 })
  const result = selectWhatsGood([uncheckedLongUnshown, checkedRecentHighMomentum], NOW)
  assert.deepEqual(result.selectedItemIds, ['unchecked-long-unshown', 'checked-recent-high-momentum'])

  // Prove it structurally, not just for this one momentum value: sweep an
  // enormous range and confirm the outcome never flips.
  for (const momentum of [0, 1, 10, 1e6, Number.MAX_SAFE_INTEGER]) {
    const b = candidate({ itemId: 'checked-recent-high-momentum', everCheckedOff: true, lastShownAt: daysAgo(0), momentumScore: momentum })
    const r = selectWhatsGood([uncheckedLongUnshown, b], NOW)
    assert.equal(r.selectedItemIds[0], 'unchecked-long-unshown', `invariant broken at momentumScore=${momentum}`)
  }
})

test('pairwise 4: checked+long-unshown beats checked+recent (exposure freshness still differentiates within the same checked status)', () => {
  const checkedLongUnshown = candidate({ itemId: 'checked-long-unshown', everCheckedOff: true, lastShownAt: daysAgo(50) })
  const checkedRecent = candidate({ itemId: 'checked-recent', everCheckedOff: true, lastShownAt: daysAgo(0) })
  assert.deepEqual(selectWhatsGood([checkedLongUnshown, checkedRecent], NOW).selectedItemIds, ['checked-long-unshown', 'checked-recent'])
})

test('pairwise 5: two equally fresh unchecked items are ordered by momentum', () => {
  const lowMomentum = candidate({ itemId: 'low-momentum', everCheckedOff: false, lastShownAt: null, momentumScore: 2 })
  const highMomentum = candidate({ itemId: 'high-momentum', everCheckedOff: false, lastShownAt: null, momentumScore: 8 })
  assert.deepEqual(selectWhatsGood([lowMomentum, highMomentum], NOW).selectedItemIds, ['high-momentum', 'low-momentum'])
})

// ---------------------------------------------------------------------------
// Momentum only breaks ties within the same freshnessClass
// ---------------------------------------------------------------------------

test('momentum never reorders candidates across different freshnessClass values (structural, not incidental)', () => {
  const betterClass = candidate({ itemId: 'better-class', everCheckedOff: false, lastShownAt: daysAgo(50), momentumScore: 0 })
  const worseClassHighMomentum = candidate({ itemId: 'worse-class-high-momentum', everCheckedOff: true, lastShownAt: daysAgo(0), momentumScore: 999 })
  assert.notEqual(freshnessClass(betterClass, NOW), freshnessClass(worseClassHighMomentum, NOW))
  const result = selectWhatsGood([betterClass, worseClassHighMomentum], NOW)
  assert.equal(result.selectedItemIds[0], 'better-class')
})

// ---------------------------------------------------------------------------
// Stable itemId tie-break
// ---------------------------------------------------------------------------

test('deterministic itemId tie-break: identical freshnessClass and momentumScore always resolve the same way, sorted ascending by itemId', () => {
  const a = candidate({ itemId: 'zzz-item', momentumScore: 5 })
  const b = candidate({ itemId: 'aaa-item', momentumScore: 5 })
  const result1 = selectWhatsGood([a, b], NOW)
  const result2 = selectWhatsGood([b, a], NOW)
  assert.deepEqual(result1.selectedItemIds, ['aaa-item', 'zzz-item'])
  assert.deepEqual(result2.selectedItemIds, ['aaa-item', 'zzz-item'])
})

test('compareCandidates never relies on randomness — repeated calls with the same inputs return the same comparison', () => {
  const a = candidate({ itemId: 'a', momentumScore: 3 })
  const b = candidate({ itemId: 'b', momentumScore: 3 })
  const results = new Set()
  for (let i = 0; i < 20; i++) results.add(compareCandidates(a, b, NOW))
  assert.equal(results.size, 1)
})

// ---------------------------------------------------------------------------
// Fewer than 3 eligible candidates
// ---------------------------------------------------------------------------

test('fewer than 3 eligible candidates -> returns fewer than 3, never pads or fabricates', () => {
  const result = selectWhatsGood([candidate({ itemId: 'only-one' })], NOW)
  assert.deepEqual(result.selectedItemIds, ['only-one'])
})

test('zero eligible candidates (e.g. all Home Rail) -> empty selection, not an error', () => {
  const result = selectWhatsGood([candidate({ itemId: 'rail-only', isHomeRail: true })], NOW)
  assert.deepEqual(result.selectedItemIds, [])
  assert.deepEqual(result.ranked, [])
})

test('more than 3 eligible candidates -> exactly 3 selected', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => candidate({ itemId: `item-${i}` }))
  const result = selectWhatsGood(candidates, NOW)
  assert.equal(result.selectedItemIds.length, 3)
})

// ---------------------------------------------------------------------------
// No input mutation
// ---------------------------------------------------------------------------

test('never mutates the input candidates array or its objects', () => {
  const candidates = [
    candidate({ itemId: 'c', momentumScore: 1 }),
    candidate({ itemId: 'a', momentumScore: 2 }),
    candidate({ itemId: 'b', momentumScore: 3, isHomeRail: true }),
  ]
  const snapshot = JSON.parse(JSON.stringify(candidates))
  selectWhatsGood(candidates, NOW)
  assert.deepEqual(JSON.parse(JSON.stringify(candidates)), snapshot)
  // Order of the original array is untouched too (selectWhatsGood must
  // sort a copy, never Array.prototype.sort() on the caller's own array).
  assert.deepEqual(candidates.map((c) => c.itemId), ['c', 'a', 'b'])
})

// ---------------------------------------------------------------------------
// Mixed table-driven scenario — final ordering with explanation
// ---------------------------------------------------------------------------

test('table-driven scenario: a realistic mix of checked/unseen/exposed/high-momentum items produces an explainable final ordering', () => {
  const scenario = [
    // itemId                 | everCheckedOff | lastShownAt   | momentumScore | expected freshnessClass | why
    { itemId: 'fresh-hot',      everCheckedOff: false, lastShownAt: null,       momentumScore: 9, expectedClass: 0 }, // never checked, never shown, big momentum tie-break winner within class 0
    { itemId: 'fresh-cold',     everCheckedOff: false, lastShownAt: null,       momentumScore: 0, expectedClass: 0 }, // never checked, never shown, no momentum — loses the class-0 tie-break to fresh-hot
    { itemId: 'checked-stale',  everCheckedOff: true,  lastShownAt: daysAgo(60), momentumScore: 0, expectedClass: 1 }, // checked but long-unshown: class 1, beats anything in class 2/3
    { itemId: 'unchecked-warm', everCheckedOff: false, lastShownAt: daysAgo(7), momentumScore: 0, expectedClass: 1 }, // never checked, moderately shown: also class 1
    { itemId: 'checked-recent', everCheckedOff: true,  lastShownAt: daysAgo(1), momentumScore: 500, expectedClass: 3 }, // checked AND recently shown: worst class, regardless of momentum
  ]

  const candidates = scenario.map((s) => candidate(s))
  for (const s of scenario) {
    assert.equal(freshnessClass(candidate(s), NOW), s.expectedClass, `${s.itemId} expected freshnessClass ${s.expectedClass}`)
  }

  const result = selectWhatsGood(candidates, NOW)

  // Class 0 (fresh-hot, fresh-cold) come first, ordered by momentum within
  // the class; class 1 (checked-stale, unchecked-warm) come next, tied on
  // momentum (both 0) so ordered by itemId; class 3 (checked-recent) comes
  // dead last no matter how large its momentum is.
  assert.deepEqual(result.ranked.map((r) => r.itemId), ['fresh-hot', 'fresh-cold', 'checked-stale', 'unchecked-warm', 'checked-recent'])
  assert.deepEqual(result.selectedItemIds, ['fresh-hot', 'fresh-cold', 'checked-stale'])
})
