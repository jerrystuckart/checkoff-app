import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  verifyNoRingOverlap,
  auditCoverage,
  deriveMetroLoopAction,
  evaluateMetroGates,
  allGatesPass,
  coarseStatusForStage,
  verifyAuthorityCoverage,
  validateNeighborhoodDefinition,
  validateNeighborhoodDefinitions,
  type CoverageAuditEvidence,
  type MetroGateEvidence,
} from './metroLaunch'

const PLAN = {
  targets: [
    { categoryName: 'Food & drink', minimumViable: 10, healthyTarget: 30, qualityNotes: [] },
    { categoryName: 'Sports', minimumViable: 3, healthyTarget: 8, qualityNotes: [] },
  ],
}

const NEIGHBORHOODS = [
  { name: 'Downtown', kind: 'core_urban' as const, ring1RadiusM: 1000, ring2RadiusM: 2000 },
  { name: 'Suburb A', kind: 'suburb' as const, ring1RadiusM: 1000, ring2RadiusM: 2000 },
]

test('auditCoverage: category below minimum -> CATEGORY_BELOW_MINIMUM gap', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [{ categoryName: 'Food & drink', count: 40 }, { categoryName: 'Sports', count: 1 }],
    neighborhoodCounts: [{ neighborhoodName: 'Downtown', count: 5 }],
    plan: PLAN,
    allNeighborhoods: NEIGHBORHOODS,
  }
  const gaps = auditCoverage(evidence)
  assert.ok(gaps.some((g) => g.kind === 'CATEGORY_BELOW_MINIMUM' && g.name === 'Sports'))
})

test('auditCoverage: category between minimum and healthy target -> CATEGORY_BELOW_TARGET, not blocking', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [{ categoryName: 'Food & drink', count: 40 }, { categoryName: 'Sports', count: 5 }],
    neighborhoodCounts: [{ neighborhoodName: 'Downtown', count: 5 }],
    plan: PLAN,
    allNeighborhoods: NEIGHBORHOODS,
  }
  const gaps = auditCoverage(evidence)
  const sportsGap = gaps.find((g) => g.name === 'Sports')
  assert.equal(sportsGap?.kind, 'CATEGORY_BELOW_TARGET')
})

test('auditCoverage: overrepresented category flagged, not treated as a blocker', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [{ categoryName: 'Food & drink', count: 100 }, { categoryName: 'Sports', count: 8 }],
    neighborhoodCounts: [{ neighborhoodName: 'Downtown', count: 5 }],
    plan: PLAN,
    allNeighborhoods: NEIGHBORHOODS,
  }
  const gaps = auditCoverage(evidence)
  assert.ok(gaps.some((g) => g.kind === 'CATEGORY_OVERREPRESENTED' && g.name === 'Food & drink'))
})

test('auditCoverage: an empty core_urban/important_neighborhood is a GEOGRAPHIC_HOLE', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [{ categoryName: 'Food & drink', count: 40 }, { categoryName: 'Sports', count: 8 }],
    neighborhoodCounts: [{ neighborhoodName: 'Downtown', count: 0 }],
    plan: PLAN,
    allNeighborhoods: NEIGHBORHOODS,
  }
  const gaps = auditCoverage(evidence)
  assert.ok(gaps.some((g) => g.kind === 'GEOGRAPHIC_HOLE' && g.name === 'Downtown'))
  // a suburb with 0 items is not automatically a hole (only core_urban/important_neighborhood are)
  assert.ok(!gaps.some((g) => g.name === 'Suburb A'))
})

test('auditCoverage: never mutates its input evidence', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [{ categoryName: 'Sports', count: 1 }],
    neighborhoodCounts: [],
    plan: PLAN,
    allNeighborhoods: NEIGHBORHOODS,
  }
  const snapshot = JSON.parse(JSON.stringify(evidence))
  auditCoverage(evidence)
  assert.deepEqual(evidence, snapshot)
})

// ---------------------------------------------------------------------------
// M4 <-> M5 self-correction loop
// ---------------------------------------------------------------------------

test('deriveMetroLoopAction: a blocking gap (below-minimum category) triggers TARGETED_RESEARCH', () => {
  const result = deriveMetroLoopAction([{ kind: 'CATEGORY_BELOW_MINIMUM', name: 'Sports', detail: '1/3' }])
  assert.equal(result.action, 'TARGETED_RESEARCH')
  assert.equal(result.blockingGaps.length, 1)
})

test('deriveMetroLoopAction: a geographic hole also triggers TARGETED_RESEARCH', () => {
  const result = deriveMetroLoopAction([{ kind: 'GEOGRAPHIC_HOLE', name: 'Downtown', detail: '0 items' }])
  assert.equal(result.action, 'TARGETED_RESEARCH')
})

test('deriveMetroLoopAction: only below-target (not below-minimum) or overrepresented gaps -> PROCEED_TO_VERIFICATION', () => {
  const result = deriveMetroLoopAction([{ kind: 'CATEGORY_BELOW_TARGET', name: 'Sports', detail: '5/8' }])
  assert.equal(result.action, 'PROCEED_TO_VERIFICATION')
})

test('deriveMetroLoopAction: no gaps at all -> PROCEED_TO_VERIFICATION', () => {
  assert.equal(deriveMetroLoopAction([]).action, 'PROCEED_TO_VERIFICATION')
})

// ---------------------------------------------------------------------------
// Quality gates
// ---------------------------------------------------------------------------

function gateEvidence(overrides: Partial<MetroGateEvidence> = {}): MetroGateEvidence {
  return {
    coverageGaps: [],
    quality: { knownClosures: [], suspectedDuplicates: [], filler: [] },
    catalog: { viableItemCount: 100, targetCatalogSize: 100 },
    location: { totalItems: 100, itemsWithCoordinates: 100 },
    presentation: { homeRenders: true, listsRender: true, imagesRender: true },
    outreach: { targetBusinessCount: 20, queuedCount: 20 },
    approvedCategoryExceptions: [],
    ...overrides,
  }
}

test('evaluateMetroGates: all-clean evidence passes every gate', () => {
  const results = evaluateMetroGates(gateEvidence())
  assert.equal(allGatesPass(results), true)
  assert.equal(results.length, 7)
})

test('evaluateMetroGates: GEOGRAPHY_GATE fails on a geographic hole', () => {
  const results = evaluateMetroGates(gateEvidence({ coverageGaps: [{ kind: 'GEOGRAPHIC_HOLE', name: 'Downtown', detail: '0 items' }] }))
  const gate = results.find((r) => r.key === 'GEOGRAPHY_GATE')
  assert.equal(gate?.verdict, 'FAIL')
  assert.equal(allGatesPass(results), false)
})

test('evaluateMetroGates: CATEGORY_GATE fails on a below-minimum category with no exception', () => {
  const results = evaluateMetroGates(gateEvidence({ coverageGaps: [{ kind: 'CATEGORY_BELOW_MINIMUM', name: 'Sports', detail: '1/3' }] }))
  assert.equal(results.find((r) => r.key === 'CATEGORY_GATE')?.verdict, 'FAIL')
})

test('evaluateMetroGates: CATEGORY_GATE passes when the below-minimum category has an explicit Jerry-approved exception', () => {
  const results = evaluateMetroGates(
    gateEvidence({ coverageGaps: [{ kind: 'CATEGORY_BELOW_MINIMUM', name: 'Sports', detail: '1/3' }], approvedCategoryExceptions: ['Sports'] })
  )
  assert.equal(results.find((r) => r.key === 'CATEGORY_GATE')?.verdict, 'PASS')
})

test('evaluateMetroGates: QUALITY_GATE fails on any known closure/duplicate/filler', () => {
  const results = evaluateMetroGates(gateEvidence({ quality: { knownClosures: ['Old Diner'], suspectedDuplicates: [], filler: [] } }))
  assert.equal(results.find((r) => r.key === 'QUALITY_GATE')?.verdict, 'FAIL')
})

test('evaluateMetroGates: CATALOG_GATE fails below target viable-item count', () => {
  const results = evaluateMetroGates(gateEvidence({ catalog: { viableItemCount: 50, targetCatalogSize: 100 } }))
  assert.equal(results.find((r) => r.key === 'CATALOG_GATE')?.verdict, 'FAIL')
})

test('evaluateMetroGates: LOCATION_GATE fails when any item lacks coordinates — every item must have maps_lat/maps_lng', () => {
  const results = evaluateMetroGates(gateEvidence({ location: { totalItems: 100, itemsWithCoordinates: 99 } }))
  assert.equal(results.find((r) => r.key === 'LOCATION_GATE')?.verdict, 'FAIL')
})

test('evaluateMetroGates: PRESENTATION_GATE fails if any surface does not render', () => {
  const results = evaluateMetroGates(gateEvidence({ presentation: { homeRenders: true, listsRender: false, imagesRender: true } }))
  assert.equal(results.find((r) => r.key === 'PRESENTATION_GATE')?.verdict, 'FAIL')
})

test('evaluateMetroGates: OUTREACH_GATE fails below the target business queue count', () => {
  const results = evaluateMetroGates(gateEvidence({ outreach: { targetBusinessCount: 20, queuedCount: 5 } }))
  assert.equal(results.find((r) => r.key === 'OUTREACH_GATE')?.verdict, 'FAIL')
})

// ---------------------------------------------------------------------------
// Ring-overlap verification (M1)
// ---------------------------------------------------------------------------

test('verifyNoRingOverlap: two neighborhoods far enough apart do not overlap', () => {
  const result = verifyNoRingOverlap([
    { name: 'A', lat: 32.7157, lng: -117.1611, ring2RadiusM: 2000 },
    { name: 'B', lat: 32.8328, lng: -117.2713, ring2RadiusM: 2000 }, // La Jolla, ~15km from downtown SD
  ])
  assert.equal(result.ok, true)
})

test('verifyNoRingOverlap: two neighborhoods with large radii close together DO overlap', () => {
  const result = verifyNoRingOverlap([
    { name: 'A', lat: 32.7157, lng: -117.1611, ring2RadiusM: 20000 },
    { name: 'B', lat: 32.7357, lng: -117.1811, ring2RadiusM: 20000 },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.overlaps.length, 1)
})

// ---------------------------------------------------------------------------
// Stage -> status, readiness, authority coverage
// ---------------------------------------------------------------------------

test('coarseStatusForStage: M14 (public launch) is always NEEDS_JERRY', () => {
  assert.equal(coarseStatusForStage('M14_LAUNCH'), 'NEEDS_JERRY')
})

test('coarseStatusForStage: M11/M12 (outreach) are WAITING — hands off to Business Photo Outreach\'s own loop', () => {
  assert.equal(coarseStatusForStage('M11_OUTREACH_EXECUTION'), 'WAITING')
  assert.equal(coarseStatusForStage('M12_RESPONSE_OPERATIONS'), 'WAITING')
})

test('metro launch playbook: every declared authority operation is registered', () => {
  assert.doesNotThrow(() => verifyAuthorityCoverage())
})

// ---------------------------------------------------------------------------
// Structural bug fix regressions (San Diego run, 2026-09-05):
// GEOGRAPHIC_HOLE requires a valid `kind`, and "meaningful depth" (not
// just zero-vs-nonzero) is now a configurable, blocking gap.
// ---------------------------------------------------------------------------

test('auditCoverage: an important_neighborhood with real kind and zero items is a GEOGRAPHIC_HOLE (blocking)', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [],
    neighborhoodCounts: [],
    plan: { targets: [] },
    allNeighborhoods: [{ name: 'Oceanside', kind: 'important_neighborhood', ring1RadiusM: 1500, ring2RadiusM: 3000 }],
  }
  const gaps = auditCoverage(evidence)
  assert.ok(gaps.some((g) => g.kind === 'GEOGRAPHIC_HOLE' && g.name === 'Oceanside'))
  assert.equal(deriveMetroLoopAction(gaps).action, 'TARGETED_RESEARCH')
})

test('auditCoverage: a neighborhood object missing kind entirely produces no GEOGRAPHIC_HOLE — this is exactly the bug validateNeighborhoodDefinitions must prevent from ever reaching here', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [],
    neighborhoodCounts: [],
    plan: { targets: [] },
    // Cast: reproducing the literal shape the live M1 bug produced (no `kind` at all).
    allNeighborhoods: [{ name: 'Oceanside' } as unknown as CoverageAuditEvidence['allNeighborhoods'][number]],
  }
  const gaps = auditCoverage(evidence)
  assert.equal(gaps.length, 0, 'a malformed neighborhood silently disables the hole check — this is why evidence validation must reject it before it ever reaches auditCoverage')
})

test('auditCoverage: token coverage (1-2 items) in a configured depth-target area is a blocking GEOGRAPHIC_BELOW_MINIMUM gap', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [],
    neighborhoodCounts: [
      { neighborhoodName: 'Carlsbad', count: 2 },
      { neighborhoodName: 'Oceanside', count: 0 },
    ],
    plan: { targets: [] },
    allNeighborhoods: [],
    depthTargets: [
      { neighborhoodName: 'Carlsbad', minimumItems: 5 },
      { neighborhoodName: 'Oceanside', minimumItems: 5 },
    ],
  }
  const gaps = auditCoverage(evidence)
  const carlsbad = gaps.find((g) => g.kind === 'GEOGRAPHIC_BELOW_MINIMUM' && g.name === 'Carlsbad')
  const oceanside = gaps.find((g) => g.kind === 'GEOGRAPHIC_BELOW_MINIMUM' && g.name === 'Oceanside')
  assert.ok(carlsbad, 'Carlsbad at 2/5 must be flagged — this is exactly the "token coverage" the plain zero-check missed')
  assert.equal(carlsbad?.detail, '2/5 minimum for meaningful depth')
  assert.ok(oceanside)
  assert.equal(deriveMetroLoopAction(gaps).action, 'TARGETED_RESEARCH')
})

test('auditCoverage: a depth target that is met produces no gap', () => {
  const evidence: CoverageAuditEvidence = {
    categoryCounts: [],
    neighborhoodCounts: [{ neighborhoodName: 'Carlsbad', count: 5 }],
    plan: { targets: [] },
    allNeighborhoods: [],
    depthTargets: [{ neighborhoodName: 'Carlsbad', minimumItems: 5 }],
  }
  const gaps = auditCoverage(evidence)
  assert.equal(gaps.filter((g) => g.kind === 'GEOGRAPHIC_BELOW_MINIMUM').length, 0)
})

test('validateNeighborhoodDefinition: rejects a missing kind', () => {
  const result = validateNeighborhoodDefinition({ name: 'Oceanside' })
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('kind')))
})

test('validateNeighborhoodDefinition: rejects an invalid kind value (model inventing its own taxonomy)', () => {
  const result = validateNeighborhoodDefinition({ name: 'Oceanside', kind: 'Coastal North County' })
  assert.equal(result.valid, false)
})

test('validateNeighborhoodDefinition: accepts a real kind value with no ring radii required (driver assigns defaults)', () => {
  const result = validateNeighborhoodDefinition({ name: 'Oceanside', kind: 'important_neighborhood' })
  assert.equal(result.valid, true)
})

test('validateNeighborhoodDefinitions: one malformed entry among several valid ones still fails the whole batch', () => {
  const result = validateNeighborhoodDefinitions([
    { name: 'Downtown', kind: 'core_urban' },
    { name: 'Oceanside' }, // missing kind — exactly the real M1 bug
  ])
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('Oceanside')))
})
