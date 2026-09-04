import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeContextFingerprint } from './whatsGoodContextFingerprint.js'

test('deterministic: identical inputs always produce identical output', () => {
  const input = { nearestItemIds: ['a', 'b', 'c'], atPlaceItemId: 'a' }
  assert.equal(computeContextFingerprint(input), computeContextFingerprint(input))
})

test('order-sensitive: a reordering of nearest items changes the fingerprint', () => {
  const a = computeContextFingerprint({ nearestItemIds: ['a', 'b'], atPlaceItemId: null })
  const b = computeContextFingerprint({ nearestItemIds: ['b', 'a'], atPlaceItemId: null })
  assert.notEqual(a, b)
})

test('set change (different item present) changes the fingerprint', () => {
  const a = computeContextFingerprint({ nearestItemIds: ['a', 'b'], atPlaceItemId: null })
  const b = computeContextFingerprint({ nearestItemIds: ['a', 'c'], atPlaceItemId: null })
  assert.notEqual(a, b)
})

test('at-place membership changes the fingerprint even with the same nearest set', () => {
  const a = computeContextFingerprint({ nearestItemIds: ['a', 'b'], atPlaceItemId: null })
  const b = computeContextFingerprint({ nearestItemIds: ['a', 'b'], atPlaceItemId: 'a' })
  assert.notEqual(a, b)
})

test('handles missing/undefined fields without throwing', () => {
  assert.doesNotThrow(() => computeContextFingerprint({}))
  assert.equal(computeContextFingerprint({}), computeContextFingerprint({ nearestItemIds: [], atPlaceItemId: null }))
})
