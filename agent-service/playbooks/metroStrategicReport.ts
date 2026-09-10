// Chief Phase 3B — "what is still weak?" strategic coverage report
// (Vienna post-mortem, item 10). A concise, structured close-out that
// distinguishes what genuinely blocks launch from what is future
// enrichment work — a metro does not need perfect category equality to
// launch (the M4/auditCoverage soft-target discipline this report
// reuses, never re-derives).

import type { CoverageGap } from './metroLaunch'
import type { MetroCostReport } from './metroCostReport'

export interface CategoryDistributionEntry {
  categoryName: string
  count: number
  sharePercent: number
}

export interface StrategicReportInput {
  finalItemCount: number
  categoryCounts: readonly { categoryName: string; count: number }[]
  neighborhoodCounts: readonly { neighborhoodName: string; count: number }[]
  /** Every core_urban/important_neighborhood area the metro plan named — used to report zero coverage even for an area with no candidates at all. */
  allImportantNeighborhoodNames: readonly string[]
  partnerPotentialInventoryCount: number
  duplicateClustersFound: number
  duplicateCandidateNamesInClusters: number
  weakCandidatesRejected: number
  coverageGaps: readonly CoverageGap[]
  costReport: MetroCostReport
}

export interface StrategicCoverageReport {
  finalItemCount: number
  categoryDistribution: CategoryDistributionEntry[]
  strongestCategories: string[]
  underservedCategories: string[]
  neighborhoodDistribution: Array<{ neighborhoodName: string; count: number }>
  zeroOrLowCoverageNeighborhoods: string[]
  partnerPotentialInventoryCount: number
  duplicateClustersFound: number
  duplicateCandidateNamesInClusters: number
  weakCandidatesRejected: number
  blockingIssues: string[]
  futureEnrichmentAreas: string[]
  costReport: MetroCostReport
}

const LOW_COVERAGE_THRESHOLD = 2

export function buildStrategicCoverageReport(input: StrategicReportInput): StrategicCoverageReport {
  const categoryDistribution: CategoryDistributionEntry[] = input.categoryCounts
    .map((c) => ({ categoryName: c.categoryName, count: c.count, sharePercent: input.finalItemCount > 0 ? Math.round((c.count / input.finalItemCount) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count)

  const strongestCategories = categoryDistribution.slice(0, 3).map((c) => c.categoryName)
  const underservedCategories = categoryDistribution
    .filter((c) => c.count > 0 && c.sharePercent < 3)
    .map((c) => c.categoryName)

  const neighborhoodCountByName = new Map(input.neighborhoodCounts.map((n) => [n.neighborhoodName, n.count]))
  const zeroOrLowCoverageNeighborhoods = input.allImportantNeighborhoodNames.filter((name) => (neighborhoodCountByName.get(name) ?? 0) <= LOW_COVERAGE_THRESHOLD)

  // BLOCKING = the same "real blocker" gap kinds the existing M4 loop
  // already treats as blocking (deriveMetroLoopAction) — this report
  // never invents a stricter bar than the one the pipeline itself
  // already enforced to reach this point. Anything else (dominance
  // warnings, below-healthy-target-but-above-minimum) is FUTURE
  // ENRICHMENT — real, worth doing, never a reason to hold launch.
  const blockingKinds = new Set(['CATEGORY_BELOW_MINIMUM', 'GEOGRAPHIC_HOLE', 'GEOGRAPHIC_BELOW_MINIMUM'])
  const blockingIssues = input.coverageGaps.filter((g) => blockingKinds.has(g.kind)).map((g) => `${g.kind}: ${g.name} (${g.detail})`)
  const futureEnrichmentAreas = [
    ...input.coverageGaps.filter((g) => !blockingKinds.has(g.kind)).map((g) => `${g.kind}: ${g.name} (${g.detail})`),
    ...(zeroOrLowCoverageNeighborhoods.length > 0 ? [`Low-depth areas worth a future targeted pass: ${zeroOrLowCoverageNeighborhoods.join(', ')}`] : []),
  ]

  return {
    finalItemCount: input.finalItemCount,
    categoryDistribution,
    strongestCategories,
    underservedCategories,
    neighborhoodDistribution: input.neighborhoodCounts.map((n) => ({ neighborhoodName: n.neighborhoodName, count: n.count })),
    zeroOrLowCoverageNeighborhoods,
    partnerPotentialInventoryCount: input.partnerPotentialInventoryCount,
    duplicateClustersFound: input.duplicateClustersFound,
    duplicateCandidateNamesInClusters: input.duplicateCandidateNamesInClusters,
    weakCandidatesRejected: input.weakCandidatesRejected,
    blockingIssues,
    futureEnrichmentAreas,
    costReport: input.costReport,
  }
}
