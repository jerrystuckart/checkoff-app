import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectNearYouCompactRows, NEAR_YOU_COMPACT_ROW_COUNT } from './nearYouCompact.js'

test('default row count is 3, not the full 5-item rail', () => {
  assert.equal(NEAR_YOU_COMPACT_ROW_COUNT, 3)
})

test('takes only the first 3 of a longer proximity-sorted list, preserving order', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
  const rows = selectNearYouCompactRows(items)
  assert.deepEqual(rows.map(i => i.id), ['a', 'b', 'c'])
})

test('fewer than 3 items available: returns them all, no padding/invention', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(selectNearYouCompactRows(items).map(i => i.id), ['a', 'b'])
})

test('empty/undefined input never throws, returns empty array', () => {
  assert.deepEqual(selectNearYouCompactRows([]), [])
  assert.deepEqual(selectNearYouCompactRows(undefined), [])
})

test('maxRows override is respected', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  assert.deepEqual(selectNearYouCompactRows(items, 2).map(i => i.id), ['a', 'b'])
})

// FINAL UI PASS BEFORE BUILD 144 — item 6: the active What's the Thing
// hero item must not also appear as a Near You row.

test('excludes the exact at-place hero item, backfilling from further down the list', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const rows = selectNearYouCompactRows(items, 3, 'a')
  assert.deepEqual(rows.map(i => i.id), ['b', 'c', 'd'])
})

test('excludes the hero item wherever it sits in the proximity order, not just first', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const rows = selectNearYouCompactRows(items, 3, 'c')
  assert.deepEqual(rows.map(i => i.id), ['a', 'b', 'd'])
})

test('does NOT exclude other items at the same venue — only the exact item id', () => {
  const items = [
    { id: 'a', partnerName: 'Red Zone Sports Grill' },
    { id: 'a2', partnerName: 'Red Zone Sports Grill' },
    { id: 'b' },
  ]
  const rows = selectNearYouCompactRows(items, 3, 'a')
  assert.deepEqual(rows.map(i => i.id), ['a2', 'b'])
})

test('no exclusion id (null/undefined): behaves exactly as before', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(selectNearYouCompactRows(items, 3, null).map(i => i.id), ['a', 'b', 'c'])
  assert.deepEqual(selectNearYouCompactRows(items, 3, undefined).map(i => i.id), ['a', 'b', 'c'])
})

test('excluded item not present in the list at all: no-op, no crash', () => {
  const items = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(selectNearYouCompactRows(items, 3, 'not-here').map(i => i.id), ['a', 'b'])
})
