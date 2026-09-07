import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateImageReadinessGate } from './imageReadiness'

test('evaluateImageReadinessGate: fails closed on an empty card list', () => {
  const result = evaluateImageReadinessGate([])
  assert.equal(result.gate.verdict, 'FAIL')
  assert.deepEqual(result.missingCards, [])
})

test('evaluateImageReadinessGate: names every required card missing an image, not just the first', () => {
  const result = evaluateImageReadinessGate([
    { cardLabel: 'Primary seasonal list', required: true, hasImage: false },
    { cardLabel: 'Themed list: Hidden Vienna', required: true, hasImage: false },
    { cardLabel: 'Curated mirror (no image needed)', required: false, hasImage: false },
  ])
  assert.equal(result.gate.verdict, 'FAIL')
  assert.deepEqual(result.missingCards, ['Primary seasonal list', 'Themed list: Hidden Vienna'])
})

test('evaluateImageReadinessGate: a card that does not require an image is never penalized for lacking one', () => {
  const result = evaluateImageReadinessGate([{ cardLabel: 'Curated mirror', required: false, hasImage: false }])
  assert.equal(result.gate.verdict, 'PASS')
})

test('evaluateImageReadinessGate: PASSes once every required card has an image', () => {
  const result = evaluateImageReadinessGate([
    { cardLabel: 'Primary seasonal list', required: true, hasImage: true },
    { cardLabel: 'Themed list: Hidden Vienna', required: true, hasImage: true },
  ])
  assert.equal(result.gate.verdict, 'PASS')
  assert.deepEqual(result.missingCards, [])
})
