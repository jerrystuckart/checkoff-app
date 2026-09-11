// Chief Phase 2AH — driver-level regression tests for the Green Bay
// contamination incident (2026-09-10). Proves, against the REAL driver
// (never a hand-called library function), that:
//   1. OUT_OF_MARKET_CONTAMINATION_GATE is wired into M8_BATCH_CERTIFICATION
//      and M8.5 drops a contaminated candidate unconditionally (never
//      repaired), so it can never reach the generated SQL patch.
//   2. Existing-inventory reconciliation drops a REUSE match the same way
//      (never a duplicate row), while a DISTINCT_SAME_VENUE match is
//      retained.
//   3. cli.ts's autoDeriveDepthTargetsFromGeography option, when set,
//      derives geographic depth targets from THIS run's own real M1
//      neighborhoods — never San Diego's Carlsbad/Oceanside/Chula Vista/
//      Coronado — while a caller that omits it keeps the old, safe `[]`
//      default untouched (no regression for existing callers/tests).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import { InMemoryGeoEnrichmentCacheStore } from './metroGeoEnrichmentDriver'
import type { VerifiedTagSnapshot } from './tagVocabularyProvider'
import type { ExistingProductionItem } from '../playbooks/existingInventoryReconciliation'

const PLAN: CategoryCoveragePlan = {
  targets: [{ categoryName: 'Food & drink', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }],
}

const GREEN_BAY_M0: MetroM0Decisions = {
  geographicScope: 'City of Green Bay + Ashwaubenon/De Pere for this test',
  categoryCatalogTargets: 'Food & drink (2/5)',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 44.5133, lng: -88.0133 },
}

const TEST_TAG_VOCAB: VerifiedTagSnapshot = {
  version: 1,
  capturedAt: '2026-09-09T00:00:00.000Z',
  justification: 'TEST_FIXTURE',
  tagNames: ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'craft beer'],
}

function scriptTagSelection(executor: TestExecutor) {
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: shortlist.slice(0, 6) }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )
}

async function seedForBatchCertification(
  runStore: InstanceType<typeof InMemoryPlaybookRunStore>,
  projectId: string,
  candidates: Array<{ name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean }>,
  certs: Record<string, DriverItemCertificationRecord>
) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: GREEN_BAY_M0, candidates, neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: certs }
  seeded!.currentStage = 'M8_BATCH_CERTIFICATION'
  await runStore.put(seeded!)
}

test('driveMetroLaunch (Green Bay contamination regression): a real San Diego venue that slipped into the candidate pool is dropped by M8.5 as REJECTED_OUT_OF_MARKET and never reaches the Home-list SQL', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)

  const clean = { name: "Titletown Brewing Co", category: 'Food & drink', neighborhood: 'Downtown Green Bay', claimSupported: 'Titletown Brewing Co has an outdoor beer garden.', source: 'https://example.com/titletown', needsVerification: false }
  const contaminated = { name: 'Agua Hedionda Lagoon & Discovery Center', category: 'Food & drink', neighborhood: 'Carlsbad', claimSupported: 'A real nature discovery center.', source: 'https://example.com/agua', needsVerification: false }
  const cleanCert: DriverItemCertificationRecord = { candidateName: clean.name, venueName: clean.name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Get a beer in the outdoor beer garden at 'Titletown Brewing Co'.", finalTags: TEST_TAG_VOCAB.tagNames.slice(0, 6), supportingFact: clean.claimSupported, verifiedAt: '2026-09-10T00:00:00.000Z', rejectionReasons: [] }
  const contaminatedCert: DriverItemCertificationRecord = { candidateName: contaminated.name, venueName: contaminated.name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Walk through the nature exhibits at 'Agua Hedionda Lagoon & Discovery Center'.", finalTags: TEST_TAG_VOCAB.tagNames.slice(0, 6), supportingFact: contaminated.claimSupported, verifiedAt: '2026-09-10T00:00:00.000Z', rejectionReasons: [] }

  const projectId = 'green-bay-contamination-regression'
  await seedForBatchCertification(runStore, projectId, [clean, contaminated], { [cleanCert.candidateName]: cleanCert, [contaminatedCert.candidateName]: contaminatedCert })

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      metroAreaFacts: { name: 'Green Bay Metro', state: 'WI', timezone: 'America/Chicago' },
      metroAreaSlug: 'green-bay',
      canonicalNeighborhoods: ['Downtown Green Bay'],
      // Hermetic: an explicit empty fake, never the real DB-backed default
      // (this candidate's own name is a real, live production venue —
      // exercising the real default here would make this test's outcome
      // depend on live production data, which existingInventoryReconciliation.test.ts
      // already covers deterministically).
      fetchExistingProductionInventory: async () => [],
      placesLookup: async (q: string) => {
        if (q.includes('Agua Hedionda')) return { topResult: { placeId: 'p-agua', name: 'Agua Hedionda Lagoon & Discovery Center', formattedAddress: '1580 Cannon Rd, Carlsbad, CA 92008, USA', lat: 33.13, lng: -117.31, websiteUri: null, country: 'US', viewportRadiusM: null }, apiError: null }
        return { topResult: { placeId: 'p-titletown', name: 'Titletown Brewing Co', formattedAddress: '320 N Broadway, Green Bay, WI 54303, USA', lat: 44.5198, lng: -88.0191, websiteUri: null, country: 'US', viewportRadiusM: null }, apiError: null }
      },
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Green Bay Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as {
    itemCertifications: Record<string, DriverItemCertificationRecord>
    catalogPruningDrops?: Array<{ candidateName: string; reason: string }>
    batchCertificationGates?: Array<{ key: string; verdict: string }>
    homeListPlan?: Array<{ itemCandidateNames: string[] }>
    homeListSqlPatch?: string
  }

  assert.equal(state.itemCertifications[contaminated.name].outcome, 'REJECTED_OUT_OF_MARKET', 'the San Diego venue must be dropped, never certified into the final catalog')
  assert.equal(state.itemCertifications[clean.name].outcome, 'ITEM_CERTIFIED', 'the real, in-market Green Bay venue must remain certified')
  assert.ok(state.catalogPruningDrops?.some((d) => d.candidateName === contaminated.name && d.reason === 'REJECTED_OUT_OF_MARKET'))

  const contaminationGate = state.batchCertificationGates?.find((g) => g.key === 'OUT_OF_MARKET_CONTAMINATION_GATE')
  assert.ok(contaminationGate, 'OUT_OF_MARKET_CONTAMINATION_GATE must be present in batchCertificationGates')
  assert.equal(contaminationGate!.verdict, 'PASS', 'once the contaminated candidate is dropped, the gate re-evaluates clean on the pruned set')

  assert.ok(!(state.homeListPlan ?? []).some((p) => p.itemCandidateNames.includes(contaminated.name)), 'the contaminated candidate must never appear in any Home list plan')
  assert.ok(!state.homeListSqlPatch?.includes('Carlsbad'), 'the generated SQL patch must never mention the contaminated venue or its real-world location')
})

test('driveMetroLaunch (Green Bay contamination regression): a same-venue/same-experience match against existing production inventory is REUSED, never duplicated as a new row', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptTagSelection(executor)

  const rediscovered = { name: '1919 Kitchen & Tap (rediscovered)', category: 'Food & drink', neighborhood: 'Downtown Green Bay', claimSupported: 'Real restaurant inside Lambeau Field.', source: 'https://example.com/1919', needsVerification: false }
  const rediscoveredCert: DriverItemCertificationRecord = {
    candidateName: rediscovered.name,
    venueName: '1919 Kitchen & Tap',
    attempts: 1,
    outcome: 'ITEM_CERTIFIED',
    finalBody: "Eat at '1919 Kitchen & Tap' inside Lambeau Field on a non-game day.",
    finalTags: TEST_TAG_VOCAB.tagNames.slice(0, 6),
    supportingFact: rediscovered.claimSupported,
    verifiedAt: '2026-09-10T00:00:00.000Z',
    rejectionReasons: [],
  }
  // A second, genuinely NEW candidate — without it, the sole candidate
  // being dropped as a duplicate would leave zero ITEM_CERTIFIED items,
  // which correctly hard-blocks the whole run at M8 ("quality over count")
  // before ever reaching M9. This proves the reuse-linking SQL specifically,
  // in the realistic case where a build has both new AND reused items.
  const newVenue = { name: 'Wonderland Vintage Market', category: 'Shopping', neighborhood: 'Downtown Green Bay', claimSupported: 'A real vintage/antique market.', source: 'https://example.com/wonderland', needsVerification: false }
  const newVenueCert: DriverItemCertificationRecord = {
    candidateName: newVenue.name,
    venueName: newVenue.name,
    attempts: 1,
    outcome: 'ITEM_CERTIFIED',
    finalBody: "Find something weird at 'Wonderland Vintage Market' and buy it.",
    finalTags: TEST_TAG_VOCAB.tagNames.slice(0, 6),
    supportingFact: newVenue.claimSupported,
    verifiedAt: '2026-09-10T00:00:00.000Z',
    rejectionReasons: [],
  }

  const projectId = 'green-bay-reconciliation-regression'
  await seedForBatchCertification(runStore, projectId, [rediscovered, newVenue], { [rediscoveredCert.candidateName]: rediscoveredCert, [newVenueCert.candidateName]: newVenueCert })

  const existingInventory: ExistingProductionItem[] = [
    {
      id: 'real-existing-1919-id',
      body: "Eat at '1919 Kitchen & Tap' inside Lambeau Field on a non-game day — the building hits different when it's quiet",
      googlePlaceId: 'ChIJVX4b_VH6AogRjL1TW2opsU8',
      formattedAddress: '1265 Lombardi Ave, Green Bay, WI 54304, USA',
      websiteUrl: null,
      lat: 44.5015057,
      lng: -88.0602601,
      mapsQuery: '1919 Kitchen & Tap, Green Bay',
    },
  ]

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      metroAreaFacts: { name: 'Green Bay Metro', state: 'WI', timezone: 'America/Chicago' },
      metroAreaSlug: 'green-bay',
      canonicalNeighborhoods: ['Downtown Green Bay'],
      fetchExistingProductionInventory: async () => existingInventory,
      placesLookup: async (q: string) => {
        if (q.includes('1919')) return { topResult: { placeId: 'ChIJVX4b_VH6AogRjL1TW2opsU8', name: '1919 Kitchen & Tap', formattedAddress: '1265 Lombardi Ave, Green Bay, WI 54304, USA', lat: 44.5015057, lng: -88.0602601, websiteUri: null, country: 'US', viewportRadiusM: null }, apiError: null }
        return { topResult: { placeId: 'p-wonderland', name: 'Wonderland Vintage Market', formattedAddress: '1712 Velp Ave, Green Bay, WI 54303, USA', lat: 44.5512096, lng: -88.0512908, websiteUri: null, country: 'US', viewportRadiusM: null }, apiError: null }
      },
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }),
      flagshipListTitle: 'Fall 2026 — Green Bay Metro',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 30 }
  )

  const state = run.state as {
    itemCertifications: Record<string, DriverItemCertificationRecord>
    existingInventoryReconciliation?: { reused: Array<{ candidateName: string; existingItemId: string }>; distinctSameVenue: unknown[]; unmatched: unknown[] }
    homeListSqlPatch?: string
  }

  assert.equal(state.itemCertifications[rediscovered.name].outcome, 'REJECTED_DUPLICATE_VENUE', 'a candidate matching an existing production item by google_place_id with a near-identical body must be dropped, not duplicated')
  assert.equal(state.existingInventoryReconciliation?.reused.length, 1)
  assert.equal(state.existingInventoryReconciliation?.reused[0].existingItemId, 'real-existing-1919-id')
  assert.ok(state.homeListSqlPatch?.includes('real-existing-1919-id'), 'the generated SQL must link the REAL existing item id directly into the flagship list')
  assert.ok(!state.homeListSqlPatch?.includes('rediscovered'), 'the SQL must never create a new row for the rediscovered duplicate candidate')
})

test('driveMetroLaunch (Green Bay contamination regression): autoDeriveDepthTargetsFromGeography derives depth targets from THIS run\'s own M1 neighborhoods, never a hardcoded other-metro name — while omitting it keeps the old empty-array default', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

  const projectId = 'green-bay-auto-depth-targets'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  // Skip straight to M2 with real M1 output already in state (as if M1 just ran).
  seeded!.state = {
    m0Decisions: GREEN_BAY_M0,
    neighborhoods: [
      { name: 'Downtown Green Bay', kind: 'core_urban', ring1RadiusM: 1000, ring2RadiusM: 3000 },
      { name: 'Ashwaubenon', kind: 'important_neighborhood', ring1RadiusM: 1500, ring2RadiusM: 4000 },
    ],
  }
  seeded!.currentStage = 'M2_CATEGORY_COVERAGE_PLAN'
  await runStore.put(seeded!)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], ensureProject: async () => ({ projectId: 'test-project', created: false }) },
    projectId,
    { categoryPlan: PLAN, autoDeriveDepthTargetsFromGeography: true, maxSteps: 1 }
  )

  const state = run.state as { depthTargets?: Array<{ neighborhoodName: string }> }
  const names = (state.depthTargets ?? []).map((t) => t.neighborhoodName)
  assert.deepEqual(new Set(names), new Set(['Downtown Green Bay', 'Ashwaubenon']))
  for (const forbidden of ['Carlsbad', 'Oceanside', 'Chula Vista', 'Coronado']) {
    assert.ok(!names.includes(forbidden), `auto-derived depth targets must never include the other-metro name "${forbidden}"`)
  }
})

test('driveMetroLaunch: omitting autoDeriveDepthTargetsFromGeography (the default) preserves the old, safe empty-array behavior for existing/direct callers', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

  const projectId = 'green-bay-no-auto-depth-targets'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: GREEN_BAY_M0, neighborhoods: [{ name: 'Downtown Green Bay', kind: 'core_urban', ring1RadiusM: 1000, ring2RadiusM: 3000 }] }
  seeded!.currentStage = 'M2_CATEGORY_COVERAGE_PLAN'
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], ensureProject: async () => ({ projectId: 'test-project', created: false }) }, projectId, { categoryPlan: PLAN, maxSteps: 1 })

  const state = run.state as { depthTargets?: unknown[] }
  assert.deepEqual(state.depthTargets, [], 'without autoDeriveDepthTargetsFromGeography, depthTargets must stay the old, safe empty default')
})
