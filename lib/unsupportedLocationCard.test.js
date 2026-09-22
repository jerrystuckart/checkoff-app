// Phase 4 — lib/unsupportedLocationCard.js unit tests. Pure function, no
// I/O, no stubs needed. Mirrors lib/whatsGoodCoverageMode.test.js style.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveUnsupportedLocationCardState,
  UNSUPPORTED_LOCATION_TITLE,
  UNSUPPORTED_LOCATION_BODY,
} from './unsupportedLocationCard.js'
import { COVERAGE_MODE } from './whatsGoodCoverageMode.js'

test('copy has no hyphens (public-facing copy requirement)', () => {
  assert.equal(UNSUPPORTED_LOCATION_TITLE.includes('-'), false)
  assert.equal(UNSUPPORTED_LOCATION_BODY.includes('-'), false)
})

test('UNSUPPORTED mode with Universal items -> renders, exposes them, shows the action', () => {
  const items = [
    { id: 'u1', is_universal: true },
    { id: 'u2', is_universal: true },
  ]
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED, items })
  assert.equal(result.shouldRender, true)
  assert.equal(result.title, UNSUPPORTED_LOCATION_TITLE)
  assert.equal(result.body, UNSUPPORTED_LOCATION_BODY)
  assert.deepEqual(result.universalItems.map((i) => i.id), ['u1', 'u2'])
  assert.equal(result.showTryAnywhereAction, true)
})

test('UNSUPPORTED mode with zero items -> renders copy but omits the "try anywhere" action', () => {
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED, items: [] })
  assert.equal(result.shouldRender, true)
  assert.equal(result.showTryAnywhereAction, false)
  assert.deepEqual(result.universalItems, [])
})

test('UNSUPPORTED mode filters out any non-universal item defensively (should never happen upstream, but never mislabel a local item as "works anywhere")', () => {
  const items = [{ id: 'local1', is_universal: false }, { id: 'u1', is_universal: true }]
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED, items })
  assert.deepEqual(result.universalItems.map((i) => i.id), ['u1'])
})

test('PENDING_LOCATION -> never renders (still resolving, not unsupported)', () => {
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.PENDING_LOCATION, items: [] })
  assert.equal(result.shouldRender, false)
  assert.equal(result.title, null)
})

test('LOCATION_UNAVAILABLE -> never renders (handled by existing dedicated treatment elsewhere)', () => {
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.LOCATION_UNAVAILABLE, items: [] })
  assert.equal(result.shouldRender, false)
})

test('SUPPORTED_SUFFICIENT -> never renders', () => {
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.SUPPORTED_SUFFICIENT, items: [{ id: 'a' }] })
  assert.equal(result.shouldRender, false)
})

test('SUPPORTED_SPARSE -> never renders', () => {
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.SUPPORTED_SPARSE, items: [{ id: 'a' }] })
  assert.equal(result.shouldRender, false)
})

test('missing/undefined items -> treated as empty, never throws', () => {
  const result = deriveUnsupportedLocationCardState({ coverageMode: COVERAGE_MODE.UNSUPPORTED })
  assert.equal(result.shouldRender, true)
  assert.deepEqual(result.universalItems, [])
  assert.equal(result.showTryAnywhereAction, false)
})
