// What's Good V1 — lib/whatsGoodCoverageMode.js unit tests. Pure function,
// no I/O, no stubs needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveCoverageMode, COVERAGE_MODE, WHATS_GOOD_TARGET_COUNT } from './whatsGoodCoverageMode.js'

test('WHATS_GOOD_TARGET_COUNT is 3 — the verified, pre-existing value (not invented by this fix)', () => {
  assert.equal(WHATS_GOOD_TARGET_COUNT, 3)
})

test('locationState "pending" -> PENDING_LOCATION, regardless of eligibleLocalCount', () => {
  assert.equal(deriveCoverageMode({ locationState: 'pending', eligibleLocalCount: 0, targetCount: 3 }), COVERAGE_MODE.PENDING_LOCATION)
  assert.equal(deriveCoverageMode({ locationState: 'pending', eligibleLocalCount: 99, targetCount: 3 }), COVERAGE_MODE.PENDING_LOCATION)
})

test('locationState "unavailable" with no explicit selection -> LOCATION_UNAVAILABLE, regardless of eligibleLocalCount', () => {
  assert.equal(deriveCoverageMode({ locationState: 'unavailable', eligibleLocalCount: 0, targetCount: 3 }), COVERAGE_MODE.LOCATION_UNAVAILABLE)
  assert.equal(deriveCoverageMode({ locationState: 'unavailable', eligibleLocalCount: 10, targetCount: 3, hasExplicitSelection: false }), COVERAGE_MODE.LOCATION_UNAVAILABLE)
})

test('locationState "unavailable" WITH hasExplicitSelection -> classified exactly like "ready" against the supplied count', () => {
  assert.equal(deriveCoverageMode({ locationState: 'unavailable', eligibleLocalCount: 5, targetCount: 3, hasExplicitSelection: true }), COVERAGE_MODE.SUPPORTED_SUFFICIENT)
  assert.equal(deriveCoverageMode({ locationState: 'unavailable', eligibleLocalCount: 1, targetCount: 3, hasExplicitSelection: true }), COVERAGE_MODE.SUPPORTED_SPARSE)
  assert.equal(deriveCoverageMode({ locationState: 'unavailable', eligibleLocalCount: 0, targetCount: 3, hasExplicitSelection: true }), COVERAGE_MODE.UNSUPPORTED)
})

test('locationState "ready": eligibleLocalCount >= targetCount -> SUPPORTED_SUFFICIENT', () => {
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 3, targetCount: 3 }), COVERAGE_MODE.SUPPORTED_SUFFICIENT)
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 64, targetCount: 3 }), COVERAGE_MODE.SUPPORTED_SUFFICIENT, 'Munich has 64 real eligible local items — confirmed via a read-only query during this fix')
})

test('locationState "ready": 1 <= eligibleLocalCount < targetCount -> SUPPORTED_SPARSE (both boundary values)', () => {
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 1, targetCount: 3 }), COVERAGE_MODE.SUPPORTED_SPARSE)
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 2, targetCount: 3 }), COVERAGE_MODE.SUPPORTED_SPARSE) // target - 1
})

test('locationState "ready": eligibleLocalCount 0 -> UNSUPPORTED', () => {
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 0, targetCount: 3 }), COVERAGE_MODE.UNSUPPORTED)
})

test('San Francisco example (real coordinates confirmed unsupported during this fix — no metro_areas row within MAX_NEARBY_RADIUS_M): eligibleLocalCount naturally 0 -> UNSUPPORTED', () => {
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: 0, targetCount: WHATS_GOOD_TARGET_COUNT }), COVERAGE_MODE.UNSUPPORTED)
})

test('eligibleLocalCount omitted/null -> treated as 0', () => {
  assert.equal(deriveCoverageMode({ locationState: 'ready', targetCount: 3 }), COVERAGE_MODE.UNSUPPORTED)
  assert.equal(deriveCoverageMode({ locationState: 'ready', eligibleLocalCount: null, targetCount: 3 }), COVERAGE_MODE.UNSUPPORTED)
})

test('hasExplicitSelection defaults to false when omitted', () => {
  assert.equal(deriveCoverageMode({ locationState: 'unavailable', eligibleLocalCount: 5, targetCount: 3 }), COVERAGE_MODE.LOCATION_UNAVAILABLE)
})

test('COVERAGE_MODE is frozen (cannot be accidentally mutated by a caller)', () => {
  assert.throws(() => { COVERAGE_MODE.SUPPORTED_SUFFICIENT = 'MUTATED' })
})
