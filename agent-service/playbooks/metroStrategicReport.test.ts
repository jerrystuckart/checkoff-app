import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStrategicCoverageReport } from './metroStrategicReport'
import { buildCostReport } from './metroCostReport'

const emptyCost = buildCostReport({}, 0, 0, 0)

test('buildStrategicCoverageReport: separates BLOCKING gap kinds from FUTURE_ENRICHMENT ones', () => {
  const report = buildStrategicCoverageReport({
    finalItemCount: 100,
    categoryCounts: [{ categoryName: 'Arts & Culture', count: 60 }, { categoryName: 'Sports', count: 5 }],
    neighborhoodCounts: [{ neighborhoodName: 'Downtown', count: 40 }],
    allImportantNeighborhoodNames: ['Downtown', 'Old Town'],
    partnerPotentialInventoryCount: 12,
    duplicateClustersFound: 3,
    duplicateCandidateNamesInClusters: 7,
    weakCandidatesRejected: 15,
    coverageGaps: [
      { kind: 'CATEGORY_BELOW_MINIMUM', name: 'Sports', detail: '5/8 minimum viable' },
      { kind: 'GEOGRAPHIC_HOLE', name: 'Old Town', detail: '0 items' },
      { kind: 'CATEGORY_APPROACHING_DOMINANCE', name: 'Arts & Culture', detail: '60 is 1.7x healthy target' },
    ],
    costReport: emptyCost,
  })

  assert.equal(report.blockingIssues.length, 2)
  assert.ok(report.blockingIssues.some((i) => i.includes('Sports')))
  assert.ok(report.blockingIssues.some((i) => i.includes('Old Town')))
  assert.ok(report.futureEnrichmentAreas.some((i) => i.includes('CATEGORY_APPROACHING_DOMINANCE')))
  assert.ok(report.zeroOrLowCoverageNeighborhoods.includes('Old Town'))
  assert.equal(report.duplicateClustersFound, 3)
  assert.equal(report.partnerPotentialInventoryCount, 12)
})

test('buildStrategicCoverageReport: category distribution is sorted descending with computed share', () => {
  const report = buildStrategicCoverageReport({
    finalItemCount: 10,
    categoryCounts: [{ categoryName: 'A', count: 2 }, { categoryName: 'B', count: 8 }],
    neighborhoodCounts: [],
    allImportantNeighborhoodNames: [],
    partnerPotentialInventoryCount: 0,
    duplicateClustersFound: 0,
    duplicateCandidateNamesInClusters: 0,
    weakCandidatesRejected: 0,
    coverageGaps: [],
    costReport: emptyCost,
  })
  assert.equal(report.categoryDistribution[0].categoryName, 'B')
  assert.equal(report.categoryDistribution[0].sharePercent, 80)
  assert.equal(report.strongestCategories[0], 'B')
})

test('buildStrategicCoverageReport: no blocking issues yields an empty blockingIssues array', () => {
  const report = buildStrategicCoverageReport({
    finalItemCount: 10,
    categoryCounts: [],
    neighborhoodCounts: [],
    allImportantNeighborhoodNames: [],
    partnerPotentialInventoryCount: 0,
    duplicateClustersFound: 0,
    duplicateCandidateNamesInClusters: 0,
    weakCandidatesRejected: 0,
    coverageGaps: [],
    costReport: emptyCost,
  })
  assert.deepEqual(report.blockingIssues, [])
})
