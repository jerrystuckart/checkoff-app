import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeVisibleNearbyItems, clearSearchState, clearCategoryState,
  isAllFilterActive, applyAllFilter,
} from './nearbyFilterState.js'

function items() {
  return [
    { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
  ]
}

// ── Saved filter ────────────────────────────────────────────────────────────
test('Saved filter: shows only items in savedItemIds when savedOnly is true', () => {
  const result = computeVisibleNearbyItems({
    items: items(), savedOnly: true, notDoneOnly: false,
    savedItemIds: new Set(['a', 'c']), completedItemIds: new Set(),
  })
  assert.deepEqual(result.map(i => i.id), ['a', 'c'])
})

test('Saved filter: inactive when savedOnly is false — no items excluded on that basis', () => {
  const result = computeVisibleNearbyItems({
    items: items(), savedOnly: false, notDoneOnly: false,
    savedItemIds: new Set(['a']), completedItemIds: new Set(),
  })
  assert.deepEqual(result.map(i => i.id), ['a', 'b', 'c', 'd'])
})

// ── Not Done filter ──────────────────────────────────────────────────────────
test('Not Done filter: hides completed items when notDoneOnly is true', () => {
  const result = computeVisibleNearbyItems({
    items: items(), savedOnly: false, notDoneOnly: true,
    savedItemIds: new Set(), completedItemIds: new Set(['b', 'd']),
  })
  assert.deepEqual(result.map(i => i.id), ['a', 'c'])
})

test('Completed items are visible by default (notDoneOnly false does not exclude them)', () => {
  const result = computeVisibleNearbyItems({
    items: items(), savedOnly: false, notDoneOnly: false,
    savedItemIds: new Set(), completedItemIds: new Set(['a', 'b', 'c', 'd']),
  })
  assert.deepEqual(result.map(i => i.id), ['a', 'b', 'c', 'd'])
})

// ── Saved + Not Done combined (AND) ─────────────────────────────────────────
test('Saved + Not Done combine with AND logic', () => {
  const result = computeVisibleNearbyItems({
    items: items(), savedOnly: true, notDoneOnly: true,
    savedItemIds: new Set(['a', 'b', 'c']), completedItemIds: new Set(['b']),
  })
  // must be saved AND not completed
  assert.deepEqual(result.map(i => i.id), ['a', 'c'])
})

test('Saved + Not Done: an item satisfying neither dimension is always excluded', () => {
  const result = computeVisibleNearbyItems({
    items: items(), savedOnly: true, notDoneOnly: true,
    savedItemIds: new Set(['a']), completedItemIds: new Set(['a']),
  })
  assert.deepEqual(result, [])
})

// ── Filter independence ─────────────────────────────────────────────────────
test('clearSearchState: clears only search-related fields, never category/Saved/Not-Done (those are simply absent from the update)', () => {
  const next = clearSearchState()
  assert.deepEqual(Object.keys(next).sort(), ['activeTags', 'searchText', 'suggestions', 'tagMatchData', 'tagResultItems'].sort())
  assert.equal(next.searchText, '')
  assert.deepEqual(next.activeTags, [])
  assert.equal(next.tagResultItems, null)
  assert.deepEqual(next.tagMatchData, { counts: {} })
  assert.ok(!('activeCategoryName' in next), 'must not touch category')
  assert.ok(!('savedOnly' in next), 'must not touch Saved')
  assert.ok(!('notDoneOnly' in next), 'must not touch Not Done')
})

test('clearCategoryState: clears only activeCategoryName, never search/tags/Saved/Not-Done', () => {
  const next = clearCategoryState()
  assert.deepEqual(Object.keys(next), ['activeCategoryName'])
  assert.equal(next.activeCategoryName, 'All')
})

// ── "All" pill semantics ────────────────────────────────────────────────────
test('isAllFilterActive: true only when Saved/Not-Done/category are all inactive', () => {
  assert.equal(isAllFilterActive({ savedOnly: false, notDoneOnly: false, activeCategoryName: 'All' }), true)
  assert.equal(isAllFilterActive({ savedOnly: false, notDoneOnly: false, activeCategoryName: null }), true)
  assert.equal(isAllFilterActive({ savedOnly: true, notDoneOnly: false, activeCategoryName: 'All' }), false)
  assert.equal(isAllFilterActive({ savedOnly: false, notDoneOnly: true, activeCategoryName: 'All' }), false)
  assert.equal(isAllFilterActive({ savedOnly: false, notDoneOnly: false, activeCategoryName: 'Food' }), false)
})

test('applyAllFilter: resets Saved/Not-Done/category, does not reference search at all', () => {
  const next = applyAllFilter()
  assert.deepEqual(next, { savedOnly: false, notDoneOnly: false, activeCategoryName: 'All' })
})
