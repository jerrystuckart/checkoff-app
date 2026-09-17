// M9 wiring, Session 5 — proves two things through the REAL driveMetroLaunch
// entry point that the pure resolver unit tests (m9ProductionResolvers.test.ts)
// cannot: (1) production-shaped records returned by the REAL resolver
// functions (m9ProductionResolvers.ts, backed by an injected fake DB — never
// a real one) actually reach buildM9SafeSqlPlan through the real driver
// wiring, and (2) ENFORCED can never silently fall back to an empty
// resolver — when no override is supplied and the real DB is genuinely
// unavailable, the run fails closed (throws) rather than quietly
// succeeding with fabricated "nothing found" data.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import type { M9EnforcedCurationArtifact, M9OperatorDecisionInput } from './m9EnforcedTypes'
import type { M9SafeSqlIntegrationResult } from './m9SafeSqlIntegration'
import { resolveM9ProductionItemsReal, resolveM9ProductionListsReal, resolveM9DeterministicListIdsReal, type QueryFn } from './m9ProductionResolvers'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Adventure', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }
const M0: MetroM0Decisions = { geographicScope: 'Test metro', categoryCatalogTargets: 'Adventure', launchSeason: null, executionGoAhead: true, metroCountry: 'US', metroCenter: { lat: 48.13, lng: 11.58 } }

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
function baseGeo(name: string) {
  return { candidateName: name, classification: 'EXACT' as const, reason: 'test fixture', placeId: `p-${name}`, formattedAddress: `${name}, Downtown, Test Metro`, lat: 48.14, lng: 11.59, geoRadiusM: null, websiteUrl: 'https://example.com/site' }
}
function newListClusterSpecs(count = 20) {
  return Array.from({ length: count }, (_, i) => ({ name: `Metro Stop ${i}`, tags: ['riverside-walk', `u-riverside-walk-${i}`] }))
}
function fillerItems(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${i}`, tags: [`filler-${prefix}-${i}`] }))
}

function bodyFor(name: string): string {
  return `Try the real, specific thing at '${name}'.`
}

async function seedAtM9(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, specs: { name: string; tags: string[] }[]) {
  const candidates = specs.map((s) => ({ name: s.name, category: 'Adventure', neighborhood: 'Downtown', claimSupported: 'x', source: `https://example.com/${s.name}`, needsVerification: false }))
  const itemCertifications: Record<string, DriverItemCertificationRecord> = {}
  const metadataEnrichmentResults = []
  const geoEnrichmentResults = []
  for (const s of specs) {
    itemCertifications[s.name] = {
      candidateName: s.name,
      venueName: s.name,
      attempts: 1,
      outcome: 'ITEM_CERTIFIED',
      finalBody: bodyFor(s.name),
      finalTags: s.tags,
      supportingFact: `${s.name} has a real specific attraction.`,
      verifiedAt: '2026-09-17T00:00:00.000Z',
      rejectionReasons: [],
      dbCategory: 'Adventure',
    }
    metadataEnrichmentResults.push(baseMetadata(s.name))
    geoEnrichmentResults.push(baseGeo(s.name))
  }
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = { m0Decisions: M0, candidates, neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications, batchCertificationGates: [], metadataEnrichmentResults, geoEnrichmentResults }
  seeded.currentStage = 'M9_HOME_LIST_MIRROR'
  await runStore.put(seeded)
}

function baseDeps(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, overrides: Record<string, unknown> = {}) {
  return {
    runStore,
    execStore: new InMemoryExecutionStore(),
    executors: [new TestExecutor()],
    metroAreaFacts: { name: 'Test Metro', state: 'BY', timezone: 'Europe/Berlin' },
    metroAreaSlug: 'munich',
    metroAreaId: 'metro-munich',
    canonicalNeighborhoods: ['Downtown'],
    verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
    checkImageReadiness: async (plan: { requiresImage: boolean; label: string }[]) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
    checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
    flagshipListTitle: 'Fall 2026 — Test Metro',
    now: () => '2026-09-17T00:00:00.000Z',
    m9CurationMode: 'ENFORCED' as const,
    ...overrides,
  }
}

function enforcedState(run: Awaited<ReturnType<typeof driveMetroLaunch>>) {
  return run.state as {
    m9EnforcedCuration?: M9EnforcedCurationArtifact
    homeListSqlPatch?: string
    m9SafeSqlPlan?: M9SafeSqlIntegrationResult
  }
}

async function driveToApproved(runStore: InMemoryPlaybookRunStore, projectId: string, deps: ReturnType<typeof baseDeps>) {
  const first = await driveMetroLaunch(deps as never, projectId, { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const input: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Reviewed and approved.', decidedBy: 'jerry' }
  return driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [input] } as never, projectId, { categoryPlan: PLAN, maxSteps: 30 })
}

// ---------------------------------------------------------------------------
// Real resolver functions, injected fake DB, driven through the real driver
// — production-shaped records reaching buildM9SafeSqlPlan end to end.
// ---------------------------------------------------------------------------

test('END TO END: production-shaped records from the REAL resolver functions (fake DB, real resolver logic) reach buildM9SafeSqlPlan through the real driver', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'e2e-real-resolvers', specs)

  const itemBodyByCandidateName = new Map(specs.map((s) => [s.name, bodyFor(s.name)]))
  const productionItemIds = new Map(specs.map((s, idx) => [bodyFor(s.name), `${String(idx).padStart(8, '0')}-0000-0000-0000-000000000000`]))

  const itemsQueryFn: QueryFn = (async (text: string, params: unknown[] = []) => {
    if (text.includes('i.body = ANY')) {
      const [metroSlug, bodies] = params as [string, string[]]
      if (metroSlug !== 'munich') return []
      return bodies.filter((b) => productionItemIds.has(b)).map((b) => ({ id: productionItemIds.get(b), body: b }))
    }
    const requested = new Set(params[0] as string[])
    return [...productionItemIds.values()]
      .filter((id) => requested.has(id))
      .map((id) => ({ id, is_active: true, metro_id: 'metro-munich', google_place_id: null }))
  }) as QueryFn

  const listsQueryFn: QueryFn = (async () => []) as QueryFn // genuinely new list every time — no existing production row anywhere

  const deps = baseDeps(runStore, {
    resolveM9ProductionItems: (i: { items: readonly { candidateName: string; conceptId: string }[]; metroSlug: string }) => resolveM9ProductionItemsReal(i, itemBodyByCandidateName, itemsQueryFn),
    resolveM9ProductionLists: (i: { concepts: readonly { conceptId: string; proposedTitle: string }[]; metroSlug: string }) => resolveM9ProductionListsReal(i, listsQueryFn),
    resolveM9DeterministicListIds: (i: { concepts: readonly { conceptId: string; listId: string }[]; metroSlug: string }) => resolveM9DeterministicListIdsReal(i, listsQueryFn),
  })

  const approved = await driveToApproved(runStore, 'e2e-real-resolvers', deps)
  const state = enforcedState(approved)
  assert.equal(state.m9SafeSqlPlan?.ok, true, 'the real resolver functions must have produced usable, matched production records')
  assert.equal(state.m9SafeSqlPlan?.perListOutcomes[0]?.status, 'GENERATED_NEW_LIST')
  assert.ok(state.homeListSqlPatch)
  assert.match(state.homeListSqlPatch!, /INSERT INTO public\.lists/)
  // Prove the REAL production item ids (not test-fixture placeholders) are the ones actually embedded in the generated SQL.
  const anyRealId = [...productionItemIds.values()][0]!
  assert.match(state.homeListSqlPatch!, new RegExp(anyRealId))
})

// ---------------------------------------------------------------------------
// ENFORCED must never silently fall back to the empty resolver.
//
// IMPORTANT: this deliberately never touches process.env.AGENT_SERVICE_DATABASE_URL
// or lets `deps.resolveM9ProductionItems` fall through to its real default
// (resolveM9ProductionItemsReal with db.ts's own `realQuery`) — db.ts reads
// that env var exactly ONCE, at module import time, into a module-level
// const; deleting it at test-run time would NOT stop an already-imported
// db.ts from using the value it captured, and could instead attempt a real
// network connection. Every scenario below simulates "the real resolver is
// configured but unavailable" the SAFE way: by explicitly overriding the
// dependency with the real resolveM9ProductionItemsReal FUNCTION, backed by
// an injected queryFn that throws — proving the exact same fail-closed
// contract without ever touching db.ts's real singleton.
// ---------------------------------------------------------------------------

test('FAIL CLOSED: a real resolver function backed by an unavailable database FAILS THE RUN — never silently succeeds with empty/fabricated resolution', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'e2e-fail-closed', specs)

  const itemBodyByCandidateName = new Map(specs.map((s) => [s.name, bodyFor(s.name)]))
  const unavailableQueryFn: QueryFn = (async () => {
    throw new Error('connection refused — database genuinely unavailable')
  }) as QueryFn

  const deps = baseDeps(runStore, {
    resolveM9ProductionItems: (i: { items: readonly { candidateName: string; conceptId: string }[]; metroSlug: string }) => resolveM9ProductionItemsReal(i, itemBodyByCandidateName, unavailableQueryFn),
  })
  const first = await driveMetroLaunch(deps as never, 'e2e-fail-closed', { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const input: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Approved.', decidedBy: 'jerry' }
  await assert.rejects(
    () => driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [input] } as never, 'e2e-fail-closed', { categoryPlan: PLAN, maxSteps: 30 }),
    /connection refused/,
    'a real resolver failure must fail closed (throw/reject) — never caught and silently converted into an empty, "nothing to resolve" success'
  )
  // Confirm the failed attempt never got far enough to produce executable SQL.
  const afterFailedRun = await runStore.get(playbookRunId('metro_launch', 'e2e-fail-closed'))
  const failedState = afterFailedRun!.state as { homeListSqlPatch?: string; m9SafeSqlPlan?: unknown }
  assert.equal(failedState.homeListSqlPatch, undefined)
  assert.equal(failedState.m9SafeSqlPlan, undefined)
})

test('FAIL CLOSED: the driver\'s own DEFAULT wiring (no deps.resolveM9ProductionItems/Lists/DeterministicListIds override at all) is the REAL, DB-backed resolver — never the old silent "resolves nothing" stub (source-level proof, no I/O)', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const source = fs.readFileSync(path.join(__dirname, 'metroLaunchDriver.ts'), 'utf8')
  assert.match(source, /deps\.resolveM9ProductionItems\s*\?\?\s*\(.*resolveM9ProductionItemsReal/, 'the default must be the real resolver function, not an inline stub')
  assert.match(source, /deps\.resolveM9ProductionLists\s*\?\?\s*\(.*resolveM9ProductionListsReal/)
  assert.match(source, /deps\.resolveM9DeterministicListIds\s*\?\?\s*\(.*resolveM9DeterministicListIdsReal/)
  assert.doesNotMatch(source, /resolveM9ProductionItems\s*\?\?\s*\(async \(i.*matchedItemIds:\s*\[\]/, 'the old inline "resolves nothing" stub must be gone from the default wiring')
})
