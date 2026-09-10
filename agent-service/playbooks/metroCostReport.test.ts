import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCostReport } from './metroCostReport'

test('buildCostReport: rolls up totals across stages, sorted by cost descending', () => {
  const report = buildCostReport(
    {
      M3_BROAD_DISCOVERY: { calls: 5, inputTokens: 1000, outputTokens: 500, costUsd: 1.2, unknownCostCalls: 0 },
      M6_5_CHECKOFF_EDITOR: { calls: 20, inputTokens: 4000, outputTokens: 2000, costUsd: 5.5, unknownCostCalls: 1 },
    },
    30,
    10,
    100
  )
  assert.equal(report.totalCalls, 25)
  assert.ok(Math.abs(report.totalKnownCostUsd - 6.7) < 1e-9)
  assert.equal(report.totalUnknownCostCalls, 1)
  assert.equal(report.hasUnknownCostCalls, true)
  assert.equal(report.byStage[0].stage, 'M6_5_CHECKOFF_EDITOR')
  assert.equal(report.placesPaidCalls, 30)
  assert.equal(report.placesCacheHits, 10)
  assert.ok(Math.abs((report.openAiCostPerRetainedItemUsd ?? 0) - 0.067) < 1e-6)
})

test('buildCostReport: costPerRetainedItem is null (never a divide-by-zero) when retainedItemCount is 0', () => {
  const report = buildCostReport({}, 0, 0, 0)
  assert.equal(report.openAiCostPerRetainedItemUsd, null)
  assert.equal(report.hasUnknownCostCalls, false)
})
