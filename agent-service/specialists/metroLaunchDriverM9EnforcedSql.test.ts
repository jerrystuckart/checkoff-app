// Session 3, Phase 6 — proves the real driveMetroLaunch entry point can
// carry a READY ENFORCED plan all the way through safe SQL generation and
// into M10, when real (here: fake, test-supplied) production resolvers
// are wired in — and that it stays parked at WAITING, exactly as Session
// 2 left it, when they are not. No generated SQL is ever executed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import type { M9EnforcedCurationArtifact, M9OperatorDecisionInput } from './m9EnforcedTypes'
import type { M9SafeSqlIntegrationResult } from './m9SafeSqlIntegration'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Adventure', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }
const M0: MetroM0Decisions = { geographicScope: 'Test metro', categoryCatalogTargets: 'Adventure', launchSeason: null, executionGoAhead: true, metroCountry: 'US', metroCenter: { lat: 44.5, lng: -88.0 } }

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
  return { candidateName: name, classification: 'EXACT' as const, reason: 'test fixture', placeId: `p-${name}`, formattedAddress: `${name}, Downtown, Test Metro`, lat: 44.51, lng: -88.01, geoRadiusM: null, websiteUrl: 'https://example.com/site' }
}

function cleanClusterSpecs(count = 20, prefix = 'Canal Stop') {
  return Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${i}`, tags: ['riverside-walk', `u-${prefix}-${i}`] }))
}
function fillerItems(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${i}`, tags: [`filler-${prefix}-${i}`] }))
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
      finalBody: `Try the real, specific thing at '${s.name}'.`,
      finalTags: s.tags,
      supportingFact: `${s.name} has a real specific attraction.`,
      verifiedAt: '2026-09-15T00:00:00.000Z',
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
    metroAreaFacts: { name: 'Test Metro', state: 'WI', timezone: 'America/Chicago' },
    metroAreaSlug: 'test-metro',
    canonicalNeighborhoods: ['Downtown'],
    verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
    checkImageReadiness: async (plan: { requiresImage: boolean; label: string }[]) => plan.filter((p) => p.requiresImage).map((p) => ({ cardLabel: p.label, required: true, hasImage: true })),
    checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
    flagshipListTitle: 'Fall 2026 — Test Metro',
    now: () => '2026-09-15T00:00:00.000Z',
    m9CurationMode: 'ENFORCED' as const,
    ...overrides,
  }
}

function enforcedState(run: Awaited<ReturnType<typeof driveMetroLaunch>>) {
  return run.state as { m9EnforcedCuration?: M9EnforcedCurationArtifact; homeListPlan?: unknown[]; homeListSqlPatch?: string; m9SafeSqlPlan?: M9SafeSqlIntegrationResult; m9SqlValidationManifest?: unknown; finalCertificationReport?: unknown }
}

async function driveToApproved(runStore: InMemoryPlaybookRunStore, projectId: string, deps: ReturnType<typeof baseDeps>) {
  const first = await driveMetroLaunch(deps as never, projectId, { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const input: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Reviewed and approved.', decidedBy: 'jerry' }
  return driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [input] } as never, projectId, { categoryPlan: PLAN, maxSteps: 30 })
}

test('M10 CONSUMPTION: with no production resolvers wired, a READY plan stays parked at WAITING — never advances to M10 (unchanged from Session 2)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'sql-no-resolvers', specs)
  const approved = await driveToApproved(runStore, 'sql-no-resolvers', baseDeps(runStore))
  assert.equal(approved.status, 'WAITING')
  assert.equal(approved.currentStage, 'M9_HOME_LIST_MIRROR')
  const state = enforcedState(approved)
  assert.equal(state.homeListPlan, undefined)
  assert.equal(state.m9SafeSqlPlan?.ok, false)
})

test('M10 CONSUMPTION: with real (fake, test-supplied) production resolvers, a READY plan generates safe SQL, derives a compatibility plan, and reaches M10 in the same drive call', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'sql-with-resolvers', specs)
  const deps = baseDeps(runStore, {
    metroAreaId: 'metro-a',
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) =>
      input.items.map((i, idx) => ({ candidateName: i.candidateName, conceptId: i.conceptId, matchedItemIds: [`${idx}0000000-0000-0000-0000-000000000000`], active: true, metroId: 'metro-a' })),
    resolveM9ProductionLists: async (input: { concepts: readonly { conceptId: string; proposedTitle: string }[] }) =>
      input.concepts.map((c) => ({ conceptId: c.conceptId, existingList: { listId: 'list-existing-1', title: c.proposedTitle, status: 'ACTIVE' as const } })),
  })
  const approved = await driveToApproved(runStore, 'sql-with-resolvers', deps)
  const state = enforcedState(approved)
  assert.equal(state.m9SafeSqlPlan?.ok, true, 'the safe SQL plan must succeed with clean fake resolvers')
  assert.ok(state.homeListPlan && state.homeListPlan.length > 0, 'state.homeListPlan must be derived (the compatibility projection)')
  assert.ok(state.homeListSqlPatch && state.homeListSqlPatch.length > 0, 'state.homeListSqlPatch must be the real generated SQL')
  assert.match(state.homeListSqlPatch!, /BEGIN;/)
  assert.ok(state.m9SqlValidationManifest, 'the validation manifest must be persisted')
  assert.ok(state.finalCertificationReport, 'M10 must have actually run (in the SAME drive call) and consumed the derived artifacts')
  assert.notEqual(approved.currentStage, 'M9_HOME_LIST_MIRROR', 'must have advanced past M9 in the same drive call')
})

test('M10 CONSUMPTION: a stale/mismatched manifest (hand-tampered state) is rejected before M10 consumes anything', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'sql-stale-manifest', specs)
  const deps = baseDeps(runStore, {
    metroAreaId: 'metro-a',
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) =>
      input.items.map((i, idx) => ({ candidateName: i.candidateName, conceptId: i.conceptId, matchedItemIds: [`${idx}0000000-0000-0000-0000-000000000000`], active: true, metroId: 'metro-a' })),
    resolveM9ProductionLists: async (input: { concepts: readonly { conceptId: string; proposedTitle: string }[] }) =>
      input.concepts.map((c) => ({ conceptId: c.conceptId, existingList: { listId: 'list-existing-1', title: c.proposedTitle, status: 'ACTIVE' as const } })),
  })
  const first = await driveMetroLaunch(deps as never, 'sql-stale-manifest', { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const input: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Approved.', decidedBy: 'jerry' }

  // Drive the run all the way to M10 for real, then hand-tamper the
  // persisted state (simulating a manual/partial artifact edit) so
  // state.m9EnforcedCuration no longer matches the manifest it's
  // supposed to be consistent with, and force it back to RUNNING at the
  // M10 stage to prove the consistency check itself catches it.
  const real = await driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [input] } as never, 'sql-stale-manifest', { categoryPlan: PLAN, maxSteps: 30 })
  assert.ok((enforcedState(real)).finalCertificationReport, 'M10 must have run for real before this test tampers with the persisted state')
  const corrupted = await runStore.get(playbookRunId('metro_launch', 'sql-stale-manifest'))
  const corruptedState = corrupted!.state as { m9EnforcedCuration: M9EnforcedCurationArtifact }
  corruptedState.m9EnforcedCuration.inputCatalogFingerprint = 'tampered-fingerprint'
  corrupted!.currentStage = 'M10_METRO_LAUNCH_CERTIFICATION'
  corrupted!.status = 'RUNNING'
  await runStore.put(corrupted!)

  const rerun = await driveMetroLaunch(deps as never, 'sql-stale-manifest', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(rerun.status, 'BLOCKED')
  assert.match(rerun.jerryReason ?? '', /ENFORCED artifact consistency check failed/)
})
