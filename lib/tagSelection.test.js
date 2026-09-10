import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySelectTag, applyRemoveTag } from './tagSelection.js'

// Regression coverage for the production crash: tapping a suggested tag
// chip called a removed setter (setBodyMatchIds) and threw a
// ReferenceError immediately. These pure functions have no setState calls
// at all, so this exact bug class can't recur here — these tests exercise
// the actual state-shape transitions the crash-fix code now runs through.

const BBQ_TAG = { id: 'tag-bbq', name: 'bbq' }
const BRUNCH_TAG = { id: 'tag-brunch', name: 'brunch' }

// ── The exact repro: type BBQ -> suggestion +bbq -> tap suggestion ─────────
test('tapping the +bbq suggestion (adding one suggested tag) does not throw and produces the expected state', () => {
  assert.doesNotThrow(() => applySelectTag([], BBQ_TAG))
  const result = applySelectTag([], BBQ_TAG)
  assert.deepEqual(result, {
    activeTags: [BBQ_TAG],
    changed: true,
    clearSuggestions: true,
    clearSearchText: true,
  })
})

test('adding multiple suggested tags accumulates without duplicates', () => {
  const afterFirst = applySelectTag([], BBQ_TAG)
  const afterSecond = applySelectTag(afterFirst.activeTags, BRUNCH_TAG)
  assert.deepEqual(afterSecond.activeTags, [BBQ_TAG, BRUNCH_TAG])
  assert.equal(afterSecond.changed, true)
})

test('selecting an already-active tag again is a no-op, not a duplicate or an error', () => {
  const result = applySelectTag([BBQ_TAG], BBQ_TAG)
  assert.equal(result.changed, false)
  assert.deepEqual(result.activeTags, [BBQ_TAG])
})

// ── Removing a selected tag ─────────────────────────────────────────────────
test('removing the only selected tag clears results (falls back to nearbyItems)', () => {
  const result = applyRemoveTag([BBQ_TAG], BBQ_TAG.id)
  assert.deepEqual(result, { activeTags: [], shouldClearResults: true })
})

test('removing one of several selected tags keeps the rest and does not clear results', () => {
  const result = applyRemoveTag([BBQ_TAG, BRUNCH_TAG], BBQ_TAG.id)
  assert.deepEqual(result, { activeTags: [BRUNCH_TAG], shouldClearResults: false })
})

test('removing a tag that was never active is a safe no-op', () => {
  const result = applyRemoveTag([BBQ_TAG], 'not-a-real-id')
  assert.deepEqual(result.activeTags, [BBQ_TAG])
  assert.equal(result.shouldClearResults, false)
})
