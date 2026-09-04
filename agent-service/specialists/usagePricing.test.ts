import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateCostUsd, USAGE_PRICING_TABLE_VERSION } from './usagePricing'

test('estimateCostUsd: computes a real cost for a known model with real usage', () => {
  const result = estimateCostUsd('openai', 'gpt-4.1', { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 })
  assert.ok(result)
  assert.equal(result?.costUsd, 2.0 + 8.0)
  assert.equal(result?.pricingVersion, USAGE_PRICING_TABLE_VERSION)
})

test('estimateCostUsd: scales linearly with token counts', () => {
  const result = estimateCostUsd('openai', 'gpt-4.1-mini', { inputTokens: 500_000, outputTokens: 250_000, totalTokens: 750_000 })
  assert.ok(result)
  assert.equal(result?.costUsd, 0.5 * 0.4 + 0.25 * 1.6)
})

test('estimateCostUsd: returns null (never a guessed $0) for an unpriced model', () => {
  const result = estimateCostUsd('openai', 'some-future-model-not-in-the-table', { inputTokens: 100, outputTokens: 100, totalTokens: 200 })
  assert.equal(result, null)
})

test('estimateCostUsd: returns null for an unpriced provider', () => {
  const result = estimateCostUsd('anthropic', 'claude-sonnet-5', { inputTokens: 100, outputTokens: 100, totalTokens: 200 })
  assert.equal(result, null)
})

test('estimateCostUsd: returns null when token counts are missing — never treats a missing count as 0 tokens', () => {
  assert.equal(estimateCostUsd('openai', 'gpt-4.1', { inputTokens: null, outputTokens: 100, totalTokens: 100 }), null)
  assert.equal(estimateCostUsd('openai', 'gpt-4.1', { inputTokens: 100, outputTokens: null, totalTokens: 100 }), null)
})

test('estimateCostUsd: returns null when the model id is null', () => {
  assert.equal(estimateCostUsd('openai', null, { inputTokens: 100, outputTokens: 100, totalTokens: 200 }), null)
})
