import { test } from 'node:test'
import assert from 'node:assert/strict'
import { certifyMetroLaunch, runWithBoundedRetries, assertExplicitProductionStateSource, REQUIRED_GATE_CATEGORIES, DEFAULT_MAX_REPAIR_ATTEMPTS, type MetroLaunchCertificationSummary } from './metroLaunchCertification'
import type { StagingGateResult } from './metroCatalog'

function allRequiredGatesPassing(): StagingGateResult[] {
  return Object.values(REQUIRED_GATE_CATEGORIES)
    .flat()
    .map((key) => ({ key, verdict: 'PASS' as const, reason: 'ok' }))
}

function goodSummary(overrides: Partial<MetroLaunchCertificationSummary> = {}): MetroLaunchCertificationSummary {
  return {
    catalogCount: 150,
    geoCoveragePercent: 95,
    geoExceptionsCount: 8,
    tagsComplete: true,
    metadataComplete: true,
    officialListsCount: 4,
    themedListsCount: 3,
    imagesComplete: true,
    homeQueryPass: true,
    ...overrides,
  }
}

test('a fully passing metro certifies READY_TO_ACTIVATE', () => {
  const result = certifyMetroLaunch({ metroName: 'Vienna, Austria', gates: allRequiredGatesPassing(), summary: goodSummary() })
  assert.equal(result.verdict, 'READY_TO_ACTIVATE')
  assert.equal(result.failingGates.length, 0)
  assert.equal(result.missingGates.length, 0)
  assert.match(result.reportText, /READY_TO_ACTIVATE/)
  assert.match(result.reportText, /150 items/)
})

test('imageSelectionOnlyBlock: BLOCKED with the special "image selection required" framing when IMAGE_READINESS_GATE is the ONLY failing gate', () => {
  const gates = allRequiredGatesPassing().map((g) => (g.key === 'IMAGE_READINESS_GATE' ? { ...g, verdict: 'FAIL' as const, reason: '2 required Home card(s) still need an image: Primary seasonal list, Themed list: Hidden Vienna.' } : g))
  const result = certifyMetroLaunch({ metroName: 'Vienna, Austria', gates, summary: goodSummary({ imagesComplete: false }) })
  assert.equal(result.verdict, 'BLOCKED')
  assert.equal(result.imageSelectionOnlyBlock, true)
  assert.match(result.reportText, /BLOCKED — image selection required/)
  assert.match(result.reportText, /Primary seasonal list, Themed list: Hidden Vienna/)
})

test('imageSelectionOnlyBlock: false when images fail alongside another gate — never framed as "just images" when it is not', () => {
  const gates = allRequiredGatesPassing().map((g) => {
    if (g.key === 'IMAGE_READINESS_GATE') return { ...g, verdict: 'FAIL' as const, reason: 'missing images' }
    if (g.key === 'TAG_CERTIFICATION_GATE') return { ...g, verdict: 'FAIL' as const, reason: 'missing tags' }
    return g
  })
  const result = certifyMetroLaunch({ metroName: 'Vienna, Austria', gates, summary: goodSummary() })
  assert.equal(result.imageSelectionOnlyBlock, false)
  assert.doesNotMatch(result.reportText, /image selection required/)
})

test('a single failing required gate blocks the whole certification', () => {
  const gates = allRequiredGatesPassing().map((g) => (g.key === 'TAG_CERTIFICATION_GATE' ? { ...g, verdict: 'FAIL' as const, reason: '3 items have fewer than 6 tags' } : g))
  const result = certifyMetroLaunch({ metroName: 'Vienna, Austria', gates, summary: goodSummary({ tagsComplete: false }) })
  assert.equal(result.verdict, 'BLOCKED')
  assert.equal(result.failingGates.length, 1)
  assert.equal(result.failingGates[0].key, 'TAG_CERTIFICATION_GATE')
  assert.match(result.reportText, /BLOCKED/)
  assert.match(result.reportText, /TAG_CERTIFICATION_GATE/)
})

test('a gate that never ran at all (missing from the input) blocks certification the same as an explicit FAIL — never silently skipped', () => {
  const gates = allRequiredGatesPassing().filter((g) => g.key !== 'GEO_ENRICHMENT_GATE')
  const result = certifyMetroLaunch({ metroName: 'Vienna, Austria', gates, summary: goodSummary() })
  assert.equal(result.verdict, 'BLOCKED')
  assert.deepEqual(result.missingGates, ['GEO_ENRICHMENT_GATE'])
  assert.match(result.reportText, /GEO_ENRICHMENT_GATE: never ran/)
})

test('every gate category from the required list is represented in REQUIRED_GATE_CATEGORIES', () => {
  const allKeys = Object.values(REQUIRED_GATE_CATEGORIES).flat()
  for (const key of ['CATALOG_GATE', 'ITEM_CERTIFICATION_GATE', 'EDITORIAL_GATE', 'DISTINCTIVE_EXPERIENCE_GATE', 'VENUE_QUOTING_GATE', 'OPENING_DISTRIBUTION_GATE', 'TAG_CERTIFICATION_GATE', 'METADATA_COMPLETENESS_GATE', 'GEO_ENRICHMENT_GATE', 'HOME_LIST_CERTIFICATION_GATE', 'IMAGE_READINESS_GATE', 'BUSINESS_ACTIVATION_KIT_GATE']) {
    assert.ok(allKeys.includes(key), `expected ${key} in REQUIRED_GATE_CATEGORIES`)
  }
})

// ---------------------------------------------------------------------------
// Self-repair loop
// ---------------------------------------------------------------------------

test('runWithBoundedRetries: succeeds and stops as soon as the gate passes, without exhausting the retry budget', async () => {
  let calls = 0
  const result = await runWithBoundedRetries<number>(
    async (attemptNumber) => {
      calls++
      return attemptNumber // "passes" once attemptNumber reaches 2
    },
    (n) => n >= 2
  )
  assert.equal(result.succeeded, true)
  assert.equal(result.attempts, 2)
  assert.equal(calls, 2)
})

test('runWithBoundedRetries: bounded — stops after maxAttempts and reports failure rather than looping forever', async () => {
  let calls = 0
  const result = await runWithBoundedRetries<number>(
    async () => {
      calls++
      return 0 // never passes
    },
    (n) => n > 0,
    3
  )
  assert.equal(result.succeeded, false)
  assert.equal(result.attempts, 3)
  assert.equal(calls, 3)
})

test('runWithBoundedRetries: defaults to DEFAULT_MAX_REPAIR_ATTEMPTS when no explicit bound is given', async () => {
  let calls = 0
  const result = await runWithBoundedRetries<number>(
    async () => {
      calls++
      return 0
    },
    () => false
  )
  assert.equal(calls, DEFAULT_MAX_REPAIR_ATTEMPTS)
  assert.equal(result.succeeded, false)
})

// ---------------------------------------------------------------------------
// Dynamic production-state discovery
// ---------------------------------------------------------------------------

test('assertExplicitProductionStateSource: a LIVE_QUERY source never requires justification', () => {
  assert.doesNotThrow(() => assertExplicitProductionStateSource({ kind: 'LIVE_QUERY' }))
})

test('assertExplicitProductionStateSource: a FROZEN_LAUNCH_SNAPSHOT source without justification is rejected — never hardcode a historical fact silently', () => {
  assert.throws(() => assertExplicitProductionStateSource({ kind: 'FROZEN_LAUNCH_SNAPSHOT' }), /requires an explicit snapshotJustification/)
})

test('assertExplicitProductionStateSource: a justified FROZEN_LAUNCH_SNAPSHOT source is accepted', () => {
  assert.doesNotThrow(() => assertExplicitProductionStateSource({ kind: 'FROZEN_LAUNCH_SNAPSHOT', snapshotJustification: 'the exact item set this build produced, captured at generation time' }))
})
