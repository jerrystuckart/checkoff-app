// Phase 3 — PostCheckoffSheet's immediate payoff line(s). Pure function,
// no I/O, no stubs needed (mirrors lib/whatsGoodCoverageMode.test.js).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { derivePayoffLines } from './postCheckoffPayoff.js'

test('positive integer pointsAwarded -> "+X points"', () => {
  assert.deepEqual(derivePayoffLines({ pointsAwarded: 5 }), { pointsLabel: '+5 points' })
  assert.deepEqual(derivePayoffLines({ pointsAwarded: 1 }), { pointsLabel: '+1 points' })
})

test('pointsAwarded omitted -> no fabricated line', () => {
  assert.deepEqual(derivePayoffLines({}), { pointsLabel: null })
  assert.deepEqual(derivePayoffLines(), { pointsLabel: null })
})

test('pointsAwarded null/undefined -> no line', () => {
  assert.deepEqual(derivePayoffLines({ pointsAwarded: null }), { pointsLabel: null })
  assert.deepEqual(derivePayoffLines({ pointsAwarded: undefined }), { pointsLabel: null })
})

test('pointsAwarded zero -> no line (nothing to celebrate, not "+0 points")', () => {
  assert.deepEqual(derivePayoffLines({ pointsAwarded: 0 }), { pointsLabel: null })
})

test('pointsAwarded negative -> no line (treated as invalid, never shown)', () => {
  assert.deepEqual(derivePayoffLines({ pointsAwarded: -3 }), { pointsLabel: null })
})

test('pointsAwarded non-finite (NaN/Infinity) -> no line', () => {
  assert.deepEqual(derivePayoffLines({ pointsAwarded: NaN }), { pointsLabel: null })
  assert.deepEqual(derivePayoffLines({ pointsAwarded: Infinity }), { pointsLabel: null })
})

test('pointsAwarded as a non-number (string) -> no line, never coerced', () => {
  assert.deepEqual(derivePayoffLines({ pointsAwarded: '5' }), { pointsLabel: null })
})

test('fractional pointsAwarded still renders (caller already Math.rounds before threading it in)', () => {
  assert.deepEqual(derivePayoffLines({ pointsAwarded: 2.5 }), { pointsLabel: '+2.5 points' })
})
