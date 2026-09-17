// Session 3, Phase 7 — the remaining end-to-end proofs not already
// covered by metroLaunchDriverM9Enforced.test.ts,
// m9ListCurationAdapterEvidenceResolution.test.ts, and
// metroLaunchDriverM9EnforcedSql.test.ts: completed-list rules running
// through the real driver, idempotent rerun of an already-completed SQL
// generation, and confirmation that ENFORCED's generated SQL is the SAFE
// module's own shape, never the legacy path's.

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
    itemCertifications[s.name] = { candidateName: s.name, venueName: s.name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: `Try the real, specific thing at '${s.name}'.`, finalTags: s.tags, supportingFact: `${s.name} has a real specific attraction.`, verifiedAt: '2026-09-15T00:00:00.000Z', rejectionReasons: [], dbCategory: 'Adventure' }
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
    metroAreaId: 'metro-a',
    // Session 5 — resolveM9ProductionItems/Lists/DeterministicListIds now
    // default to the REAL, DB-backed resolvers when omitted. This file's
    // own tests already override items/lists per-test (via cleanResolvers()
    // and their own resolveM9ProductionLists); resolveM9DeterministicListIds
    // runs for EVERY approved concept regardless of REUSE vs CREATE_NEW, so
    // it needs a safe default here too, even though none of this file's
    // tests exercise CREATE_NEW.
    resolveM9DeterministicListIds: async (input: { concepts: readonly { conceptId: string; listId: string }[] }) => input.concepts.map((c) => ({ conceptId: c.conceptId, existingRowAtId: null })),
    ...overrides,
  }
}
function enforcedState(run: Awaited<ReturnType<typeof driveMetroLaunch>>) {
  return run.state as { m9EnforcedCuration?: M9EnforcedCurationArtifact; homeListPlan?: unknown[]; homeListSqlPatch?: string; m9SafeSqlPlan?: M9SafeSqlIntegrationResult; finalCertificationReport?: unknown }
}
function cleanResolvers() {
  return {
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) =>
      input.items.map((i, idx) => ({ candidateName: i.candidateName, conceptId: i.conceptId, matchedItemIds: [`${idx}0000000-0000-0000-0000-000000000000`], active: true, metroId: 'metro-a' })),
  }
}

// ---------------------------------------------------------------------------
// Completed-list rules running through the real driver.
// ---------------------------------------------------------------------------

test('END TO END: a completed production list blocks safe SQL generation through the real driver until explicitly reopened', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'e2e-completed-list', specs)
  const deps = baseDeps(runStore, {
    ...cleanResolvers(),
    resolveM9ProductionLists: async (input: { concepts: readonly { conceptId: string; proposedTitle: string }[] }) => input.concepts.map((c) => ({ conceptId: c.conceptId, existingList: { listId: 'list-1', title: c.proposedTitle, status: 'COMPLETED' as const } })),
  })

  const first = await driveMetroLaunch(deps as never, 'e2e-completed-list', { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const approveOnly: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Concept approved.', decidedBy: 'jerry' }
  const approved = await driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [approveOnly] } as never, 'e2e-completed-list', { categoryPlan: PLAN, maxSteps: 30 })
  const approvedState = enforcedState(approved)
  assert.equal(approved.status, 'WAITING', 'concept-level approval alone is not enough — the target production list is still COMPLETED and unreopened')
  assert.equal(approvedState.m9SafeSqlPlan?.ok, false)
  assert.ok(approvedState.m9SafeSqlPlan?.perListOutcomes.some((o) => o.status === 'BLOCKED_NEEDS_REOPEN'))

  const reopen: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'REOPEN', decisionText: 'Reopening the completed list to refresh membership for Fall 2026.', decidedBy: 'jerry' }
  const reopened = await driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [reopen] } as never, 'e2e-completed-list', { categoryPlan: PLAN, maxSteps: 30 })
  const reopenedState = enforcedState(reopened)
  assert.equal(reopenedState.m9SafeSqlPlan?.ok, true, 'an explicit REOPEN must unblock safe SQL generation for the completed list')
  assert.ok(reopenedState.homeListSqlPatch)
  assert.match(reopenedState.homeListSqlPatch!, /BEGIN;/)
})

// ---------------------------------------------------------------------------
// ENFORCED's generated SQL is the SAFE module's own shape, never legacy's.
// ---------------------------------------------------------------------------

test('END TO END: ENFORCED never invokes legacy authoritative SQL generation — the generated patch is the safe module\'s own shape', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'e2e-no-legacy-sql', specs)
  const deps = baseDeps(runStore, {
    ...cleanResolvers(),
    resolveM9ProductionLists: async (input: { concepts: readonly { conceptId: string; proposedTitle: string }[] }) => input.concepts.map((c) => ({ conceptId: c.conceptId, existingList: { listId: 'list-1', title: c.proposedTitle, status: 'ACTIVE' as const } })),
  })
  const first = await driveMetroLaunch(deps as never, 'e2e-no-legacy-sql', { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const input: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Approved.', decidedBy: 'jerry' }
  const approved = await driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [input] } as never, 'e2e-no-legacy-sql', { categoryPlan: PLAN, maxSteps: 30 })
  const sql = enforcedState(approved).homeListSqlPatch!
  // Legacy buildHomeListSqlPatch always creates the metro_areas row and
  // public.items rows for new items — the safe module never does either.
  assert.doesNotMatch(sql, /INSERT INTO public\.items/)
  assert.doesNotMatch(sql, /metro_areas \(slug, name/i)
  // The safe module's own real shape (listSqlGeneration.ts).
  assert.match(sql, /SELECT id INTO v_list_id FROM public\.lists/)
  assert.match(sql, /ON CONFLICT \(list_id, item_id\) DO NOTHING/)
})

// ---------------------------------------------------------------------------
// Idempotent rerun after a completed SQL generation.
// ---------------------------------------------------------------------------

test('END TO END: rerunning driveMetroLaunch after ENFORCED SQL generation succeeded is idempotent — no drift, no duplicate work', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'e2e-idempotent-sql', specs)
  const deps = baseDeps(runStore, {
    ...cleanResolvers(),
    resolveM9ProductionLists: async (input: { concepts: readonly { conceptId: string; proposedTitle: string }[] }) => input.concepts.map((c) => ({ conceptId: c.conceptId, existingList: { listId: 'list-1', title: c.proposedTitle, status: 'ACTIVE' as const } })),
  })
  const first = await driveMetroLaunch(deps as never, 'e2e-idempotent-sql', { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const input: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Approved.', decidedBy: 'jerry' }
  const approved = await driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [input] } as never, 'e2e-idempotent-sql', { categoryPlan: PLAN, maxSteps: 30 })
  const approvedState = enforcedState(approved)
  const firstSql = approvedState.homeListSqlPatch
  const firstPlanJson = JSON.stringify(approvedState.homeListPlan)

  // Re-invoke with the SAME deps and no new decisions.
  const again = await driveMetroLaunch(deps as never, 'e2e-idempotent-sql', { categoryPlan: PLAN, maxSteps: 30 })
  const againState = enforcedState(again)
  assert.equal(again.status, approved.status, 'status must not drift on a redundant invocation')
  assert.equal(againState.homeListSqlPatch, firstSql, 'homeListSqlPatch must be byte-for-byte identical on a redundant invocation')
  assert.equal(JSON.stringify(againState.homeListPlan), firstPlanJson, 'homeListPlan must be byte-for-byte identical on a redundant invocation')
})
