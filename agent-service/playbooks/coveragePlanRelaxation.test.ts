import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyGapForRelaxation,
  classifyGapsForRelaxation,
  relaxPlanForGaps,
  sortGapsForDispatch,
  gapHistoryKey,
  DEFAULT_MIN_DISPATCHES_BEFORE_RELAXATION,
  type GapResearchHistory,
} from './coveragePlanRelaxation'
import type { CategoryCoveragePlan, CoverageGap, GeographicDepthTarget, NeighborhoodDefinition } from './metroLaunch'

const categoryGap: CoverageGap = { kind: 'CATEGORY_BELOW_MINIMUM', name: 'Shopping', detail: '0/4 minimum viable' }
const districtGap: CoverageGap = { kind: 'GEOGRAPHIC_BELOW_MINIMUM', name: 'Carlsbad', detail: '4/5 minimum for meaningful depth' }
const holeGap: CoverageGap = { kind: 'GEOGRAPHIC_HOLE', name: 'Oceanside', detail: '0 items in a core urban' }

// ---------------------------------------------------------------------------
// classifyGapForRelaxation
// ---------------------------------------------------------------------------

test('classifyGapForRelaxation: a never-dispatched gap is GENUINE_MISSING_COVERAGE, never eligible', () => {
  const result = classifyGapForRelaxation(categoryGap, undefined)
  assert.equal(result.classification, 'GENUINE_MISSING_COVERAGE')
  assert.equal(result.eligibleForRelaxation, false)
})

test('classifyGapForRelaxation: dispatched fewer than minDispatches times is GENUINE_MISSING_COVERAGE, never eligible', () => {
  const history = { timesDispatched: 1, countAfterDispatch: [0] }
  const result = classifyGapForRelaxation(categoryGap, history)
  assert.equal(result.classification, 'GENUINE_MISSING_COVERAGE')
  assert.equal(result.eligibleForRelaxation, false)
  assert.match(result.reason, /researched only 1 time/)
})

test('classifyGapForRelaxation: dispatched enough times but STILL gaining candidates is GENUINE_MISSING_COVERAGE, never eligible', () => {
  const history = { timesDispatched: 3, countAfterDispatch: [1, 2, 3] } // strictly increasing — real progress
  const result = classifyGapForRelaxation(categoryGap, history)
  assert.equal(result.classification, 'GENUINE_MISSING_COVERAGE')
  assert.equal(result.eligibleForRelaxation, false)
  assert.match(result.reason, /still gaining candidates/)
})

test('classifyGapForRelaxation: dispatched enough times and plateaued (CATEGORY_BELOW_MINIMUM) is UNREALISTIC_CATEGORY_MINIMUM, eligible', () => {
  const history = { timesDispatched: 2, countAfterDispatch: [2, 2] } // no improvement on the last pass
  const result = classifyGapForRelaxation(categoryGap, history)
  assert.equal(result.classification, 'UNREALISTIC_CATEGORY_MINIMUM')
  assert.equal(result.eligibleForRelaxation, true)
})

test('classifyGapForRelaxation: plateaued GEOGRAPHIC_BELOW_MINIMUM is UNREALISTIC_DISTRICT_DEPTH, eligible', () => {
  const history = { timesDispatched: 2, countAfterDispatch: [4, 4] }
  const result = classifyGapForRelaxation(districtGap, history)
  assert.equal(result.classification, 'UNREALISTIC_DISTRICT_DEPTH')
  assert.equal(result.eligibleForRelaxation, true)
})

test('classifyGapForRelaxation: plateaued GEOGRAPHIC_HOLE is INSUFFICIENT_REAL_WORLD_INVENTORY, eligible', () => {
  const history = { timesDispatched: 2, countAfterDispatch: [0, 0] }
  const result = classifyGapForRelaxation(holeGap, history)
  assert.equal(result.classification, 'INSUFFICIENT_REAL_WORLD_INVENTORY')
  assert.equal(result.eligibleForRelaxation, true)
})

test('classifyGapForRelaxation: a REGRESSING count (dispatch removed something, e.g. verification) still counts as plateaued, not "gaining"', () => {
  const history = { timesDispatched: 2, countAfterDispatch: [3, 2] }
  const result = classifyGapForRelaxation(categoryGap, history)
  assert.equal(result.eligibleForRelaxation, true)
})

test('classifyGapForRelaxation: respects a custom minDispatches threshold', () => {
  const history = { timesDispatched: 3, countAfterDispatch: [1, 1, 1] }
  assert.equal(classifyGapForRelaxation(categoryGap, history, 5).eligibleForRelaxation, false)
  assert.equal(classifyGapForRelaxation(categoryGap, history, 2).eligibleForRelaxation, true)
})

test('classifyGapsForRelaxation: classifies a mixed batch independently, and DEFAULT_MIN_DISPATCHES_BEFORE_RELAXATION is 2', () => {
  assert.equal(DEFAULT_MIN_DISPATCHES_BEFORE_RELAXATION, 2)
  const history: GapResearchHistory = {
    [gapHistoryKey(categoryGap)]: { timesDispatched: 2, countAfterDispatch: [1, 1] }, // eligible
    [gapHistoryKey(districtGap)]: { timesDispatched: 1, countAfterDispatch: [4] }, // not yet eligible
  }
  const results = classifyGapsForRelaxation([categoryGap, districtGap, holeGap], history)
  assert.equal(results.find((r) => r.gap === categoryGap)?.eligibleForRelaxation, true)
  assert.equal(results.find((r) => r.gap === districtGap)?.eligibleForRelaxation, false)
  assert.equal(results.find((r) => r.gap === holeGap)?.eligibleForRelaxation, false) // never dispatched at all
})

// ---------------------------------------------------------------------------
// sortGapsForDispatch
// ---------------------------------------------------------------------------

test('sortGapsForDispatch: least-dispatched gaps come first, so a long tail rotates through fairly', () => {
  const history: GapResearchHistory = {
    [gapHistoryKey(categoryGap)]: { timesDispatched: 3, countAfterDispatch: [] },
    [gapHistoryKey(districtGap)]: { timesDispatched: 0, countAfterDispatch: [] },
    [gapHistoryKey(holeGap)]: { timesDispatched: 1, countAfterDispatch: [] },
  }
  const sorted = sortGapsForDispatch([categoryGap, districtGap, holeGap], history)
  assert.deepEqual(
    sorted.map((g) => g.name),
    ['Carlsbad', 'Oceanside', 'Shopping']
  )
})

test('sortGapsForDispatch: an unknown (never-seen) gap defaults to 0 dispatches, sorting first', () => {
  const history: GapResearchHistory = { [gapHistoryKey(categoryGap)]: { timesDispatched: 1, countAfterDispatch: [] } }
  const sorted = sortGapsForDispatch([categoryGap, districtGap], history)
  assert.equal(sorted[0].name, 'Carlsbad')
})

// ---------------------------------------------------------------------------
// relaxPlanForGaps
// ---------------------------------------------------------------------------

function basePlan(): CategoryCoveragePlan {
  return { targets: [{ categoryName: 'Shopping', minimumViable: 4, healthyTarget: 8, qualityNotes: ['no filler'] }] }
}
function baseDepthTargets(): GeographicDepthTarget[] {
  return [{ neighborhoodName: 'Carlsbad', minimumItems: 5 }]
}
function baseNeighborhoods(): NeighborhoodDefinition[] {
  return [{ name: 'Oceanside', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }]
}

test('relaxPlanForGaps: CATEGORY_BELOW_MINIMUM lowers minimumViable to the achieved count, never below it, and raises healthyTarget only if it fell below the new minimum', () => {
  const result = relaxPlanForGaps({
    plan: basePlan(),
    depthTargets: baseDepthTargets(),
    neighborhoods: baseNeighborhoods(),
    categoryCounts: [{ categoryName: 'Shopping', count: 1 }],
    neighborhoodCounts: [],
    gapsToRelax: [categoryGap],
    round: 1,
  })
  const target = result.plan.targets.find((t) => t.categoryName === 'Shopping')
  assert.equal(target?.minimumViable, 1)
  assert.equal(target?.healthyTarget, 8, 'healthyTarget stays an aspirational target, untouched when already above the new minimum')
  assert.equal(result.relaxations.length, 1)
  assert.equal(result.relaxations[0].kind, 'CATEGORY_MINIMUM')
  assert.equal(result.relaxations[0].fromValue, '4')
  assert.equal(result.relaxations[0].toValue, '1')
  assert.equal(result.relaxations[0].relaxedAtRound, 1)
})

test('relaxPlanForGaps: CATEGORY_BELOW_MINIMUM can relax all the way to 0 — an honest "this category genuinely has no inventory" outcome, not filler', () => {
  const result = relaxPlanForGaps({
    plan: basePlan(),
    depthTargets: baseDepthTargets(),
    neighborhoods: baseNeighborhoods(),
    categoryCounts: [{ categoryName: 'Shopping', count: 0 }],
    neighborhoodCounts: [],
    gapsToRelax: [categoryGap],
    round: 1,
  })
  assert.equal(result.plan.targets.find((t) => t.categoryName === 'Shopping')?.minimumViable, 0)
})

test('relaxPlanForGaps: healthyTarget is raised to match a new minimumViable that would otherwise exceed it (never leaves minimum > target)', () => {
  const plan: CategoryCoveragePlan = { targets: [{ categoryName: 'Shopping', minimumViable: 4, healthyTarget: 3, qualityNotes: [] }] } // pathological input, but must not go inconsistent
  const result = relaxPlanForGaps({
    plan,
    depthTargets: [],
    neighborhoods: [],
    categoryCounts: [{ categoryName: 'Shopping', count: 3 }],
    neighborhoodCounts: [],
    gapsToRelax: [categoryGap],
    round: 1,
  })
  const target = result.plan.targets.find((t) => t.categoryName === 'Shopping')
  assert.equal(target?.minimumViable, 3)
  assert.equal(target?.healthyTarget, 3)
})

test('relaxPlanForGaps: GEOGRAPHIC_BELOW_MINIMUM lowers the depth target minimumItems to the achieved count', () => {
  const result = relaxPlanForGaps({
    plan: basePlan(),
    depthTargets: baseDepthTargets(),
    neighborhoods: baseNeighborhoods(),
    categoryCounts: [],
    neighborhoodCounts: [{ neighborhoodName: 'Carlsbad', count: 4 }],
    gapsToRelax: [districtGap],
    round: 2,
  })
  const target = result.depthTargets.find((d) => d.neighborhoodName === 'Carlsbad')
  assert.equal(target?.minimumItems, 4)
  assert.equal(result.relaxations[0].kind, 'DISTRICT_DEPTH')
  assert.equal(result.relaxations[0].relaxedAtRound, 2)
})

test('relaxPlanForGaps: GEOGRAPHIC_HOLE downgrades the neighborhood kind away from zero-tolerance coverage', () => {
  const result = relaxPlanForGaps({
    plan: basePlan(),
    depthTargets: baseDepthTargets(),
    neighborhoods: baseNeighborhoods(),
    categoryCounts: [],
    neighborhoodCounts: [{ neighborhoodName: 'Oceanside', count: 0 }],
    gapsToRelax: [holeGap],
    round: 1,
  })
  const n = result.neighborhoods.find((nb) => nb.name === 'Oceanside')
  assert.equal(n?.kind, 'destination_worthy_outer')
  assert.equal(result.relaxations[0].kind, 'NEIGHBORHOOD_KIND_DOWNGRADE')
  assert.equal(result.relaxations[0].fromValue, 'core_urban')
})

test('relaxPlanForGaps: never touches a target/category/neighborhood NOT named in gapsToRelax', () => {
  const plan: CategoryCoveragePlan = {
    targets: [
      { categoryName: 'Shopping', minimumViable: 4, healthyTarget: 8, qualityNotes: [] },
      { categoryName: 'Food & drink', minimumViable: 10, healthyTarget: 20, qualityNotes: [] },
    ],
  }
  const result = relaxPlanForGaps({
    plan,
    depthTargets: [],
    neighborhoods: [],
    categoryCounts: [{ categoryName: 'Shopping', count: 1 }],
    neighborhoodCounts: [],
    gapsToRelax: [categoryGap], // Shopping only
    round: 1,
  })
  const food = result.plan.targets.find((t) => t.categoryName === 'Food & drink')
  assert.equal(food?.minimumViable, 10, 'quality/other-category targets are completely untouched by a relaxation elsewhere')
})

test('relaxPlanForGaps: is a pure function — never mutates its inputs', () => {
  const plan = basePlan()
  const depthTargets = baseDepthTargets()
  const neighborhoods = baseNeighborhoods()
  relaxPlanForGaps({
    plan,
    depthTargets,
    neighborhoods,
    categoryCounts: [{ categoryName: 'Shopping', count: 1 }],
    neighborhoodCounts: [{ neighborhoodName: 'Carlsbad', count: 2 }],
    gapsToRelax: [categoryGap, districtGap],
    round: 1,
  })
  assert.equal(plan.targets[0].minimumViable, 4, 'original plan object untouched')
  assert.equal(depthTargets[0].minimumItems, 5, 'original depthTargets array untouched')
  assert.equal(neighborhoods[0].kind, 'core_urban', 'original neighborhoods array untouched')
})

test('relaxPlanForGaps: a gap whose target already closed since classification (achieved >= current minimum) is left alone — no relaxation record is fabricated', () => {
  const result = relaxPlanForGaps({
    plan: basePlan(), // minimumViable 4
    depthTargets: [],
    neighborhoods: [],
    categoryCounts: [{ categoryName: 'Shopping', count: 4 }], // already meets it
    neighborhoodCounts: [],
    gapsToRelax: [categoryGap],
    round: 1,
  })
  assert.equal(result.relaxations.length, 0)
  assert.equal(result.plan.targets[0].minimumViable, 4)
})
