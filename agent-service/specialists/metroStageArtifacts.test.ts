import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStageArtifactFiles } from './metroStageArtifacts'
import type { DriverItemCertificationRecord } from './metroLaunchDriver'

test('buildStageArtifactFiles: produces all 10 named artifacts', () => {
  const certified: DriverItemCertificationRecord = {
    candidateName: 'Cafe A',
    venueName: 'Cafe A',
    attempts: 1,
    outcome: 'ITEM_CERTIFIED',
    finalBody: "Order the signature torte at 'Cafe A'.",
    finalTags: ['coffee'],
    supportingFact: 'fact',
    verifiedAt: '2026-01-01T00:00:00Z',
    rejectionReasons: [],
    dbCategory: 'Food & drink',
  }
  const files = buildStageArtifactFiles({
    candidates: [{ name: 'Cafe A', category: 'cafe', neighborhood: 'Innere Stadt', claimSupported: 'x', source: 'y', needsVerification: false }],
    itemCertifications: { 'Cafe A': certified },
    catalogPruningDrops: [{ candidateName: 'Dropped Item', reason: 'REJECTED_GEO_UNRESOLVED', detail: 'no match' }],
    homeListPlan: [{ label: 'Flagship', kind: 'PRIMARY_SEASONAL', itemCandidateNames: ['Cafe A'], requiresImage: true }],
    categoryCounts: [{ categoryName: 'Food & drink', count: 1 }],
    neighborhoodCounts: [{ neighborhoodName: 'Innere Stadt', count: 1 }],
    homeListSqlPatch: 'BEGIN; COMMIT;',
    venueDuplicateClusters: [],
    finalReportJson: { verdict: 'READY_TO_ACTIVATE' },
  })

  const expectedNames = [
    '01-discovered-candidates.json',
    '02-canonical-venues.json',
    '03-editorial-certified.json',
    '04-pruning-decisions.json',
    '05-final-retained-catalog.json',
    '05-final-retained-catalog.csv',
    '06-category-coverage.json',
    '07-geographic-coverage.json',
    '08-home-list-package.json',
    '09-production-package.sql',
    '10-final-report.json',
  ]
  for (const name of expectedNames) assert.ok(name in files, `missing artifact ${name}`)

  const finalCatalog = JSON.parse(files['03-editorial-certified.json'])
  assert.equal(finalCatalog.length, 1)
  assert.equal(finalCatalog[0].candidateName, 'Cafe A')

  const pruning = JSON.parse(files['04-pruning-decisions.json'])
  assert.ok(pruning.some((p: { candidateName: string }) => p.candidateName === 'Dropped Item'))

  assert.match(files['05-final-retained-catalog.csv'], /Cafe A/)
  assert.equal(files['09-production-package.sql'], 'BEGIN; COMMIT;')
})

test('buildStageArtifactFiles: never errors on empty/missing upstream data', () => {
  const files = buildStageArtifactFiles({
    candidates: [],
    itemCertifications: {},
    catalogPruningDrops: [],
    homeListPlan: [],
    categoryCounts: [],
    neighborhoodCounts: [],
    homeListSqlPatch: null,
    venueDuplicateClusters: [],
    finalReportJson: null,
  })
  assert.equal(files['09-production-package.sql'], '-- not yet generated')
  assert.deepEqual(JSON.parse(files['03-editorial-certified.json']), [])
})
