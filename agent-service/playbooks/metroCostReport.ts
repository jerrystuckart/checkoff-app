// Chief Phase 3B — cost observability (Vienna post-mortem, item 8).
//
// Vienna's internal repair telemetry (state.usageByStage, recorded by
// metroLaunchDriver.ts's recordStageUsage on every accepted executor
// call) reported ~$1.52 while Jerry's OpenAI dashboard showed at least
// $17.11 of real spend, because usageByStage was only ever wired into
// the M8.5 repair path at the time — most of the run's real paid calls
// (M1/M3/M5/M6.5/M7 research and editorial writing) predated that
// instrumentation. recordStageUsage is now called from the SAME generic
// runStepWithRetry/runStepWithInfraRetry path every stage's executor
// call already goes through (see metroLaunchDriver.ts), so every paid
// call from M1 onward is captured going forward — this module is the
// pure rollup that turns state.usageByStage into the final report Jerry
// actually reads.

export interface StageUsage {
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  unknownCostCalls: number
}

export interface MetroCostReport {
  totalCalls: number
  totalKnownCostUsd: number
  totalUnknownCostCalls: number
  byStage: Array<{ stage: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; unknownCostCalls: number }>
  placesPaidCalls: number
  placesCacheHits: number
  /** null when retainedItemCount is 0 — never a divide-by-zero placeholder value. */
  openAiCostPerRetainedItemUsd: number | null
  /** True whenever any stage recorded a call with unknown cost — the honest flag that totalKnownCostUsd is a floor, not a guarantee. */
  hasUnknownCostCalls: boolean
}

export function buildCostReport(usageByStage: Readonly<Record<string, StageUsage>>, placesPaidCalls: number, placesCacheHits: number, retainedItemCount: number): MetroCostReport {
  const byStage = Object.entries(usageByStage)
    .map(([stage, u]) => ({ stage, calls: u.calls, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costUsd: u.costUsd, unknownCostCalls: u.unknownCostCalls }))
    .sort((a, b) => b.costUsd - a.costUsd)

  const totalCalls = byStage.reduce((sum, s) => sum + s.calls, 0)
  const totalKnownCostUsd = byStage.reduce((sum, s) => sum + s.costUsd, 0)
  const totalUnknownCostCalls = byStage.reduce((sum, s) => sum + s.unknownCostCalls, 0)

  return {
    totalCalls,
    totalKnownCostUsd,
    totalUnknownCostCalls,
    byStage,
    placesPaidCalls,
    placesCacheHits,
    openAiCostPerRetainedItemUsd: retainedItemCount > 0 ? totalKnownCostUsd / retainedItemCount : null,
    hasUnknownCostCalls: totalUnknownCostCalls > 0,
  }
}
