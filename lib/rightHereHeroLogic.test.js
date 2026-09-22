// Right Here Hero redesign — lib/rightHereHeroLogic.js unit tests. Pure
// functions, no I/O, no stubs needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoShowExplainer, shouldFireRightHereViewed } from './rightHereHeroLogic.js'

test('shouldAutoShowExplainer: null (never dismissed) -> true', () => {
  assert.equal(shouldAutoShowExplainer(null), true)
})

test('shouldAutoShowExplainer: any persisted value -> false', () => {
  assert.equal(shouldAutoShowExplainer('done'), false)
  assert.equal(shouldAutoShowExplainer(''), false)
  assert.equal(shouldAutoShowExplainer('anything'), false)
})

test('shouldFireRightHereViewed: compact mode never fires', () => {
  assert.equal(shouldFireRightHereViewed({ compact: true, itemId: 'abc', lastFiredItemId: null }), false)
  assert.equal(shouldFireRightHereViewed({ compact: true, itemId: 'abc', lastFiredItemId: 'xyz' }), false)
})

test('shouldFireRightHereViewed: no itemId never fires', () => {
  assert.equal(shouldFireRightHereViewed({ compact: false, itemId: null, lastFiredItemId: null }), false)
  assert.equal(shouldFireRightHereViewed({ compact: false, itemId: undefined, lastFiredItemId: null }), false)
})

test('shouldFireRightHereViewed: dominant mode, new item, never fired before -> true', () => {
  assert.equal(shouldFireRightHereViewed({ compact: false, itemId: 'abc', lastFiredItemId: null }), true)
})

test('shouldFireRightHereViewed: dominant mode, same item as last fired -> false (no re-fire on re-render)', () => {
  assert.equal(shouldFireRightHereViewed({ compact: false, itemId: 'abc', lastFiredItemId: 'abc' }), false)
})

test('shouldFireRightHereViewed: dominant mode, item changed since last fired -> true', () => {
  assert.equal(shouldFireRightHereViewed({ compact: false, itemId: 'def', lastFiredItemId: 'abc' }), true)
})

test('shouldFireRightHereViewed: itemId 0 is a valid id, not treated as missing', () => {
  assert.equal(shouldFireRightHereViewed({ compact: false, itemId: 0, lastFiredItemId: null }), true)
  assert.equal(shouldFireRightHereViewed({ compact: false, itemId: 0, lastFiredItemId: 0 }), false)
})
