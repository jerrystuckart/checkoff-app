// PART 2 of the M9 list-curation wiring task (2026-09-14) — characterization
// tests for CURRENT M9_HOME_LIST_MIRROR behavior, written BEFORE any change
// to the driver. These pin down what the LEGACY path does today so the new
// adapter/mode work (later commits) can be verified never to silently break
// it. See the trace notes at the top of m9ListCurationAdapter.ts (added in
// the next commit) for the full documented call path this file is pinning.
//
// Scope per the task spec: normal M9 entry; existing list-plan creation;
// existing artifact persistence; resume from an already-created M9
// artifact; transition to M10; a completed metro remaining untouched by a
// fresh invocation; a reopened completed metro; missing/malformed list
// input; partial list-resolution failure; rerunning M9 without duplicate
// output.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }

const M0: MetroM0Decisions = {
  geographicScope: 'Test metro',
  categoryCatalogTargets: 'Food & drink',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 44.5, lng: -88.0 },
}

function alphaCert(overrides: Partial<DriverItemCertificationRecord> = {}): DriverItemCertificationRecord {
  return {
    candidateName: 'Alpha Diner',
    venueName: 'Alpha Diner',
    attempts: 1,
    outcome: 'ITEM_CERTIFIED',
    finalBody: `Try the triple-stack pancakes at 'Alpha Diner'.`,
    finalTags: ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'craft beer'],
    supportingFact: 'Alpha Diner has a real specific dish.',
    verifiedAt: '2026-09-11T00:00:00.000Z',
    rejectionReasons: [],
    dbCategory: 'Food & drink',
    ...overrides,
  }
}

function baseMetadata(name: string) {
  return {
    candidateName: name,
    hasAlcohol: { evaluated: true, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    photoRequired: { evaluated: true, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    checkinType: { evaluated: true, value: 'tap' as const, confidence: 'HIGH' as const, reason: 'test fixture' },
    isSecret: { evaluated: true, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    difficulty: { evaluated: true, value: 1 as const, confidence: 'HIGH' as const, reason: 'test fixture' },
    visitProfileKey: { evaluated: true, value: null, confidence: 'HIGH' as const, reason: 'test fixture' },
    websiteUrl: { evaluated: false, reason: 'test fixture' },
  }
}

function baseGeo(name: string, overrides: Record<string, unknown> = {}) {
  return { candidateName: name, classification: 'EXACT' as const, reason: 'test fixture', placeId: `p-${name}`, formattedAddress: `${name}, Downtown, Green Bay, WI`, lat: 44.51, lng: -88.01, geoRadiusM: null, websiteUrl: 'https://example.com/site', ...overrides }
}

/** Seeds a run directly at M9_HOME_LIST_MIRROR with one clean certified candidate — mirrors the established pattern in metroLaunchDriverItemCreation.test.ts (seeding directly at M9 rather than re-driving M0-M8.5 for every test). */
async function seedAtM9(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, stateOverrides: Record<string, unknown> = {}) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = {
    m0Decisions: M0,
    candidates: [{ name: 'Alpha Diner', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://example.com/alpha', needsVerification: false }],
    neighborhoods: [],
    plan: PLAN,
    hasRunM6: true,
    itemCertifications: { 'Alpha Diner': alphaCert() },
    batchCertificationGates: [],
    metadataEnrichmentResults: [baseMetadata('Alpha Diner')],
    geoEnrichmentResults: [baseGeo('Alpha Diner')],
    ...stateOverrides,
  }
  seeded.currentStage = 'M9_HOME_LIST_MIRROR'
  await runStore.put(seeded)
  return seeded
}

function baseDeps(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, overrides: Record<string, unknown> = {}) {
  return {
    runStore,
    execStore: new InMemoryExecutionStore(),
    executors: [new TestExecutor()],
    metroAreaFacts: { name: 'Test Metro', state: 'WI', timezone: 'America/Chicago' },
    metroAreaSlug: 'test-metro',
    canonicalNeighborhoods: ['Downtown'],
    verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
    checkImageReadiness: async (plan: { requiresImage: boolean; label: string }[]) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
    checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
    flagshipListTitle: 'Fall 2026 — Test Metro',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. Normal M9 entry + 2. existing list-plan creation.
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: normal M9 entry builds a homeListPlan with a flagship list + curated-layer mirror from the certified catalog', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore, 'char-normal-entry')
  const run = await driveMetroLaunch(baseDeps(runStore) as never, 'char-normal-entry', { categoryPlan: PLAN, maxSteps: 30 })

  const state = run.state as { homeListPlan?: { kind: string; title: string; itemCandidateNames: string[] }[]; homeListSqlPatch?: string }
  assert.ok(state.homeListPlan && state.homeListPlan.length >= 2, 'a plan with at least the flagship + curated mirror entries must exist')
  assert.ok(state.homeListPlan!.some((p) => p.kind === 'PRIMARY_SEASONAL' && p.title === 'Fall 2026 — Test Metro'), 'the flagship list must use the supplied title verbatim')
  assert.ok(state.homeListPlan!.some((p) => p.kind === 'CURATED_MIRROR'), 'the curated-layer mirror entry must always be present today')
  assert.ok(state.homeListPlan!.find((p) => p.kind === 'PRIMARY_SEASONAL')!.itemCandidateNames.includes('Alpha Diner'), 'the certified candidate must land on the flagship list')
  assert.ok((state.homeListSqlPatch ?? '').length > 0, 'a SQL patch must be generated on the normal path')
})

// ---------------------------------------------------------------------------
// 3. Existing artifact persistence.
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: state.homeListPlan and state.homeListSqlPatch are persisted to the run store, not just held in memory', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore, 'char-persistence')
  await driveMetroLaunch(baseDeps(runStore) as never, 'char-persistence', { categoryPlan: PLAN, maxSteps: 30 })

  const persisted = await runStore.get(playbookRunId('metro_launch', 'char-persistence'))
  const state = persisted!.state as { homeListPlan?: unknown[]; homeListSqlPatch?: string }
  assert.ok(Array.isArray(state.homeListPlan) && state.homeListPlan.length > 0, 'homeListPlan must survive a fresh read from the run store')
  assert.ok((state.homeListSqlPatch ?? '').length > 0, 'homeListSqlPatch must survive a fresh read from the run store')
})

// ---------------------------------------------------------------------------
// 4. Resume from an already-created M9 artifact + 10. rerunning M9 without
//    duplicate output.
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: re-invoking driveMetroLaunch after M9/M10 already ran does not duplicate or mutate the homeListPlan/homeListSqlPatch', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore, 'char-rerun')
  const deps = baseDeps(runStore)
  const first = await driveMetroLaunch(deps as never, 'char-rerun', { categoryPlan: PLAN, maxSteps: 30 })
  const firstState = first.state as { homeListPlan?: unknown[]; homeListSqlPatch?: string }
  const firstPlanJson = JSON.stringify(firstState.homeListPlan)
  const firstSql = firstState.homeListSqlPatch

  // A fresh call against the SAME run: today's driver only re-enters the
  // loop from NEEDS_JERRY/BLOCKED when explicitly resolved, or continues
  // from RUNNING — since the run already reached a terminal, non-RUNNING
  // status (BLOCKED via verifyHomeListRows's forced failure, or NEEDS_JERRY
  // at LAUNCH_READINESS_BOUNDARY), calling again with the same deps must be
  // a no-op: no new SQL, no duplicated plan entries.
  const second = await driveMetroLaunch(deps as never, 'char-rerun', { categoryPlan: PLAN, maxSteps: 30 })
  const secondState = second.state as { homeListPlan?: unknown[]; homeListSqlPatch?: string }
  assert.equal(JSON.stringify(secondState.homeListPlan), firstPlanJson, 'homeListPlan must be byte-for-byte identical on a second, non-reopened invocation')
  assert.equal(secondState.homeListSqlPatch, firstSql, 'homeListSqlPatch must be byte-for-byte identical on a second, non-reopened invocation')
  assert.equal(second.status, first.status, 'run status must not change on a redundant invocation')
})

// ---------------------------------------------------------------------------
// 5. Transition to M10.
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: M9 transitions into M10 in the same drive call — a finalCertificationReport is produced', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore, 'char-transition-m10')
  const run = await driveMetroLaunch(baseDeps(runStore) as never, 'char-transition-m10', { categoryPlan: PLAN, maxSteps: 30 })
  const state = run.state as { finalCertificationReport?: unknown; batchCertificationGates?: { key: string }[] }
  assert.ok(state.finalCertificationReport, 'M10 must have run and produced a final certification report in the same call')
  assert.ok(state.batchCertificationGates?.some((g) => g.key === 'HOME_LIST_CERTIFICATION_GATE'), 'the M9-produced HOME_LIST_CERTIFICATION_GATE must be present for M10 to have consumed')
})

// ---------------------------------------------------------------------------
// 6. A completed metro remains untouched by a fresh invocation.
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: a run parked at NEEDS_JERRY/LAUNCH_READINESS_BOUNDARY (post-M9/M10) is NOT touched by a fresh invocation without the reopen flag', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore, 'char-completed-untouched')
  const deps = baseDeps(runStore)
  const completed = await driveMetroLaunch(deps as never, 'char-completed-untouched', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(completed.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.equal(completed.status, 'NEEDS_JERRY')
  const before = JSON.parse(JSON.stringify(completed))

  const again = await driveMetroLaunch(deps as never, 'char-completed-untouched', { categoryPlan: PLAN, maxSteps: 30 })
  assert.deepEqual(JSON.parse(JSON.stringify(again)), before, 'without reopenFromLaunchBoundary, a completed run must come back byte-for-byte identical')
})

// ---------------------------------------------------------------------------
// 7. A reopened completed metro.
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: reopenFromLaunchBoundary=true re-enters a completed run and can re-derive the M9 artifacts', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore, 'char-reopened')
  const deps = baseDeps(runStore)
  const completed = await driveMetroLaunch(deps as never, 'char-reopened', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(completed.currentStage, 'LAUNCH_READINESS_BOUNDARY')

  const reopened = await driveMetroLaunch({ ...deps } as never, 'char-reopened', { categoryPlan: PLAN, maxSteps: 30, reopenFromLaunchBoundary: true })
  const state = reopened.state as { launchBoundaryReopens?: unknown[]; homeListPlan?: unknown[] }
  assert.ok(state.launchBoundaryReopens && state.launchBoundaryReopens.length === 1, 'the reopen must be recorded')
  assert.ok(state.homeListPlan && state.homeListPlan.length > 0, 'the M9 artifact must still be present/re-derivable after reopening')
})

// ---------------------------------------------------------------------------
// 8. Missing/malformed list input.
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: missing deps.canonicalNeighborhoods fails closed with BLOCKED, never a partial SQL patch', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore, 'char-missing-neighborhoods')
  const run = await driveMetroLaunch(baseDeps(runStore, { canonicalNeighborhoods: undefined }) as never, 'char-missing-neighborhoods', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(run.status, 'BLOCKED')
  assert.match(run.jerryReason ?? '', /No explicit, frozen canonical neighborhood model/)
  const state = run.state as { homeListSqlPatch?: string }
  assert.equal(state.homeListSqlPatch, undefined, 'no SQL patch may exist when the run blocked before generating one')
})

// ---------------------------------------------------------------------------
// 9. Partial list-resolution failure (a certified item missing metadata
//    M8 should already have resolved for it).
// ---------------------------------------------------------------------------

test('CHARACTERIZATION: a certified item missing metadata/geo fails the whole package closed rather than shipping a partial one', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  // metadataEnrichmentResults deliberately omitted for Alpha Diner.
  await seedAtM9(runStore, 'char-partial-failure', { metadataEnrichmentResults: [] })
  const run = await driveMetroLaunch(baseDeps(runStore) as never, 'char-partial-failure', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(run.status, 'BLOCKED')
  assert.match(run.jerryReason ?? '', /Cannot build a self-contained item-creation package/)
  const state = run.state as { homeListSqlPatch?: string }
  assert.equal(state.homeListSqlPatch, undefined, 'no SQL patch may exist when metadata resolution is incomplete')
})
