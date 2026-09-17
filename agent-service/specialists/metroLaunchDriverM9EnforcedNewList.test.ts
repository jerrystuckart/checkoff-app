// Session 4 — safe NEW-LIST creation, end to end through the REAL
// driveMetroLaunch entry point. Munich proved Winston must be able to
// discover and create genuinely new metro-specific concepts (Beer
// Gardens, Breweries & Bavarian Rituals; Day Trips & Big Adventures) —
// this file proves the real M9 ENFORCED -> buildM9SafeSqlPlan ->
// generateNewListCreationSql path does that safely. No generated SQL is
// ever executed here (or anywhere in this codebase's test suite).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import { computeM9ListId, type M9EnforcedCurationArtifact, type M9OperatorDecisionInput } from './m9EnforcedTypes'
import type { M9SafeSqlIntegrationResult } from './m9SafeSqlIntegration'

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

/**
 * 20 items sharing one seed tag — reliably clusters into exactly one
 * CREATE concept whose PASS B membership evaluation cleanly INCLUDEs
 * every member (same 'riverside-walk'-style neutral tag this codebase's
 * own existing M9 ENFORCED SQL tests rely on — deliberately NOT a
 * beer/food/nightlife/adventure keyword, which listConceptDiscovery.ts's
 * own type classifier would route to a stricter listKind, e.g.
 * FOOD_LOCAL_FLAVOR/AFTER_DARK/DAY_TRIP, requiring extra
 * evidence this fixture doesn't supply and HOLDing every member instead
 * of approving them — this file is testing safe-SQL wiring, not PASS B's
 * per-kind evidence gates). The first two are real apostrophe-bearing
 * names (Pusser's New York Bar, Schumann's) proving apostrophe safety
 * flows through the REAL driver plumbing, not just the unit-level SQL
 * generator.
 */
function newListClusterSpecs(count = 20) {
  const named = ["Pusser's New York Bar", "Schumann's"]
  return Array.from({ length: count }, (_, i) => ({ name: named[i] ?? `Metro Stop ${i}`, tags: ['riverside-walk', `u-riverside-walk-${i}`] }))
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
      verifiedAt: '2026-09-16T00:00:00.000Z',
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
    now: () => '2026-09-16T00:00:00.000Z',
    m9CurationMode: 'ENFORCED' as const,
    // Genuinely NEW list every time — the exact BLOCKED_NEW_LIST_NEEDED
    // trigger condition, now made safely creatable.
    resolveM9ProductionLists: async (input: { concepts: readonly { conceptId: string; proposedTitle: string }[] }) => input.concepts.map((c) => ({ conceptId: c.conceptId, existingList: null })),
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) =>
      input.items.map((it, idx) => ({ candidateName: it.candidateName, conceptId: it.conceptId, matchedItemIds: [`${String(idx).padStart(8, '0')}-0000-0000-0000-000000000000`], active: true, metroId: 'metro-munich' })),
    // Session 5 — resolveM9DeterministicListIds now defaults to the REAL,
    // DB-backed resolver when omitted; this safe stub keeps every test in
    // this file (except the one below that explicitly overrides it to
    // prove the real conflict-blocking wiring) off a real database.
    resolveM9DeterministicListIds: async (input: { concepts: readonly { conceptId: string; listId: string }[] }) => input.concepts.map((c) => ({ conceptId: c.conceptId, existingRowAtId: null })),
    ...overrides,
  }
}

function enforcedState(run: Awaited<ReturnType<typeof driveMetroLaunch>>) {
  return run.state as {
    m9EnforcedCuration?: M9EnforcedCurationArtifact
    homeListPlan?: unknown[]
    homeListSqlPatch?: string
    m9SafeSqlPlan?: M9SafeSqlIntegrationResult
    m9SqlValidationManifest?: { manifestFingerprint: string }
    finalCertificationReport?: unknown
  }
}

async function driveToApproved(runStore: InMemoryPlaybookRunStore, projectId: string, deps: ReturnType<typeof baseDeps>) {
  const first = await driveMetroLaunch(deps as never, projectId, { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const input: M9OperatorDecisionInput = { conceptId: decision.affectedConceptIds[0]!, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Reviewed and approved — a real, distinctive metro-specific concept.', decidedBy: 'jerry' }
  return driveMetroLaunch({ ...deps, m9OperatorDecisionInputs: [input] } as never, projectId, { categoryPlan: PLAN, maxSteps: 30 })
}

test('NEW LIST: one approved, genuinely new concept creates one safe SQL plan and reaches M10 in the same drive call', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-happy-path', specs)
  const approved = await driveToApproved(runStore, 'newlist-happy-path', baseDeps(runStore))
  const state = enforcedState(approved)

  assert.equal(state.m9SafeSqlPlan?.ok, true, 'the safe SQL plan must succeed for a genuinely new, approved concept')
  const outcomes = state.m9SafeSqlPlan!.perListOutcomes
  assert.equal(outcomes.length, 1, 'exactly one list — the beer-garden concept')
  assert.equal(outcomes[0]!.status, 'GENERATED_NEW_LIST')
  assert.ok(state.homeListSqlPatch)
  assert.match(state.homeListSqlPatch!, /INSERT INTO public\.lists/)
  assert.match(state.homeListSqlPatch!, /BEGIN;/)
  assert.equal(/INSERT INTO public\.items/i.test(state.homeListSqlPatch!), false, 'creating a list must never create a catalog item')
  assert.ok(state.homeListPlan && state.homeListPlan.length > 0)
  assert.ok(state.m9SqlValidationManifest)
  assert.ok(state.finalCertificationReport, 'M10 must have actually consumed the derived artifacts in the same drive call')
  assert.notEqual(approved.currentStage, 'M9_HOME_LIST_MIRROR')
})

test("NEW LIST: real Pusser's New York Bar / Schumann's apostrophes flow safely through the REAL driver plumbing into the generated SQL", async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-apostrophes', specs)
  const approved = await driveToApproved(runStore, 'newlist-apostrophes', baseDeps(runStore))
  const state = enforcedState(approved)
  assert.equal(state.m9SafeSqlPlan?.ok, true)
  assert.equal(state.homeListSqlPatch!.includes("Pusser's"), false, 'an undoubled apostrophe must never appear in generated SQL')
  assert.equal(state.homeListSqlPatch!.includes("Schumann's"), false)
})

test('NEW LIST: rerunning driveMetroLaunch on the SAME approved run produces byte-identical SQL/manifest — never a second/duplicate list-creation statement', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-rerun', specs)
  const deps = baseDeps(runStore)
  const first = await driveToApproved(runStore, 'newlist-rerun', deps)
  const firstState = enforcedState(first)
  assert.equal(firstState.m9SafeSqlPlan?.ok, true)

  const second = await driveMetroLaunch(deps as never, 'newlist-rerun', { categoryPlan: PLAN, maxSteps: 30 })
  const secondState = enforcedState(second)

  assert.equal(secondState.homeListSqlPatch, firstState.homeListSqlPatch, 'rerunning against the same approved/resolved state must reproduce the IDENTICAL generated SQL')
  assert.equal(secondState.m9SqlValidationManifest?.manifestFingerprint, firstState.m9SqlValidationManifest?.manifestFingerprint)
  assert.equal(secondState.m9SafeSqlPlan?.perListOutcomes.length, 1, 'still exactly one list outcome — never a second, duplicate GENERATED_NEW_LIST entry')
  const listCreateCount = (secondState.homeListSqlPatch!.match(/INSERT INTO public\.lists/g) ?? []).length
  assert.equal(listCreateCount, 1, 'exactly one list-creation statement, not two')
})

test('NEW LIST: a MISSING item (zero production matches) blocks before any executable SQL exists — run parks at WAITING, never BLOCKED/silently-safe', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-missing-item', specs)
  const deps = baseDeps(runStore, {
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) => input.items.map((it) => ({ candidateName: it.candidateName, conceptId: it.conceptId, matchedItemIds: [], active: true, metroId: 'metro-munich' })),
  })
  const approved = await driveToApproved(runStore, 'newlist-missing-item', deps)
  const state = enforcedState(approved)
  assert.equal(approved.status, 'WAITING')
  assert.equal(state.m9SafeSqlPlan?.ok, false)
  assert.equal(state.m9SafeSqlPlan?.perListOutcomes[0]?.status, 'BLOCKED_ITEM_RESOLUTION_FAILED')
  assert.equal(state.homeListSqlPatch, undefined, 'no executable SQL may exist while any item is unresolved')
})

test('NEW LIST: an INACTIVE item blocks before any executable SQL exists', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-inactive-item', specs)
  const deps = baseDeps(runStore, {
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) =>
      input.items.map((it, idx) => ({ candidateName: it.candidateName, conceptId: it.conceptId, matchedItemIds: [`${String(idx).padStart(8, '0')}-0000-0000-0000-000000000000`], active: false, metroId: 'metro-munich' })),
  })
  const approved = await driveToApproved(runStore, 'newlist-inactive-item', deps)
  const state = enforcedState(approved)
  assert.equal(approved.status, 'WAITING')
  assert.equal(state.m9SafeSqlPlan?.ok, false)
  assert.equal(state.homeListSqlPatch, undefined)
})

test('NEW LIST: an OUT-OF-METRO item blocks before any executable SQL exists', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-out-of-metro', specs)
  const deps = baseDeps(runStore, {
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) =>
      input.items.map((it, idx) => ({ candidateName: it.candidateName, conceptId: it.conceptId, matchedItemIds: [`${String(idx).padStart(8, '0')}-0000-0000-0000-000000000000`], active: true, metroId: 'metro-SOME-OTHER-CITY' })),
  })
  const approved = await driveToApproved(runStore, 'newlist-out-of-metro', deps)
  const state = enforcedState(approved)
  assert.equal(approved.status, 'WAITING')
  assert.equal(state.m9SafeSqlPlan?.ok, false)
  assert.equal(state.homeListSqlPatch, undefined)
})

test('NEW LIST: DUPLICATE membership (two candidate names resolving to the same real production item) is safely de-duplicated, never blocks', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-duplicate-membership', specs)
  const deps = baseDeps(runStore, {
    resolveM9ProductionItems: async (input: { items: readonly { candidateName: string; conceptId: string }[] }) =>
      // Every candidate in this concept resolves to the SAME real item id —
      // a genuine catalog-dedup case, per m9ReusedItemValidation.ts's own
      // MULTIPLE_CANDIDATES_SAME_ITEM (advisory only, never blocking).
      input.items.map((it) => ({ candidateName: it.candidateName, conceptId: it.conceptId, matchedItemIds: ['00000000-0000-0000-0000-000000000001'], active: true, metroId: 'metro-munich' })),
  })
  const approved = await driveToApproved(runStore, 'newlist-duplicate-membership', deps)
  const state = enforcedState(approved)
  assert.equal(state.m9SafeSqlPlan?.ok, true)
  assert.equal(state.m9SafeSqlPlan?.perListOutcomes[0]?.status, 'GENERATED_NEW_LIST')
  assert.equal(state.m9SafeSqlPlan?.perListOutcomes[0]?.expectedMembershipCount, 1, 'de-duplicated to one real membership row')
  const occurrences = (state.homeListSqlPatch!.match(/00000000-0000-0000-0000-000000000001/g) ?? []).length
  assert.equal(occurrences, 1)
})

test('NEW LIST: a STALE approval — a real post-approval membership/metadata change (computeM9ConceptFingerprint) re-requires a fresh decision instead of silently reaching M10 with SQL generated under the old approval', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-stale-approval', specs)
  const deps = baseDeps(runStore)
  const approved = await driveToApproved(runStore, 'newlist-stale-approval', deps)
  assert.equal(enforcedState(approved).m9SafeSqlPlan?.ok, true, 'must have generated real SQL under the ORIGINAL approval before this test changes the underlying content')

  // A real post-approval change: one certified member's tags change (the
  // exact class of change computeM9ConceptFingerprint's own doc names as
  // invalidating a prior approval — "a metadata-only change... also
  // invalidates a stale approval"). No new operator decision is submitted.
  const run = await runStore.get(playbookRunId('metro_launch', 'newlist-stale-approval'))
  const state = run!.state as { itemCertifications: Record<string, { finalTags: string[] }> }
  state.itemCertifications["Pusser's New York Bar"]!.finalTags = ['riverside-walk', 'u-riverside-walk-0', 'a-genuinely-new-tag-added-after-approval']
  run!.currentStage = 'M9_HOME_LIST_MIRROR'
  run!.status = 'WAITING'
  await runStore.put(run!)

  const rerun = await driveMetroLaunch(deps as never, 'newlist-stale-approval', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(rerun.status, 'NEEDS_JERRY', 'the concept fingerprint changed, so the ORIGINAL decision is now stale (decidedForFingerprint no longer matches) — a fresh decision is required again, exactly like any other outstanding concept')
  assert.ok(
    (rerun.state as { m9EnforcedCuration?: M9EnforcedCurationArtifact }).m9EnforcedCuration!.requiredDecisions.length > 0,
    'a real requiredDecision must reappear — the run can never silently treat the stale approval as still authoritative'
  )

  // Same discipline as the existing "stale/mismatched manifest" test
  // (metroLaunchDriverM9EnforcedSql.test.ts): even if something forced
  // this run back to M10 with the now-stale SQL/manifest still persisted
  // from the original approval, M10's own consistency check independently
  // refuses to consume it — a second, structural safety net beyond "the
  // run doesn't advance on its own."
  const forced = await runStore.get(playbookRunId('metro_launch', 'newlist-stale-approval'))
  forced!.currentStage = 'M10_METRO_LAUNCH_CERTIFICATION'
  forced!.status = 'RUNNING'
  await runStore.put(forced!)
  const blockedAtM10 = await driveMetroLaunch(deps as never, 'newlist-stale-approval', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(blockedAtM10.status, 'BLOCKED')
  assert.match(blockedAtM10.jerryReason ?? '', /ENFORCED artifact consistency check failed/)
})

test('NEW LIST: an unresolved HOLD/outstanding decision keeps the WHOLE run at NEEDS_JERRY — it never even reaches the safe-SQL stage, so no executable SQL can exist for anything', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-unresolved-hold', specs)
  // No operator decision ever submitted — the concept's own requiredDecision stays outstanding.
  const result = await driveMetroLaunch(baseDeps(runStore) as never, 'newlist-unresolved-hold', { categoryPlan: PLAN, maxSteps: 30 })
  const state = enforcedState(result)
  assert.equal(result.status, 'NEEDS_JERRY')
  assert.equal(state.m9SafeSqlPlan, undefined, 'the safe-SQL stage is never even attempted while a decision is outstanding')
  assert.equal(state.homeListSqlPatch, undefined)
})

test('NEW LIST: a deterministic list id already belonging to an UNRELATED METRO (real resolveM9DeterministicListIds wiring) blocks before any executable SQL exists', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-id-conflict', specs)
  const deps = baseDeps(runStore, {
    resolveM9DeterministicListIds: async (input: { concepts: readonly { conceptId: string; listId: string }[] }) =>
      input.concepts.map((c) => ({ conceptId: c.conceptId, existingRowAtId: { metroSlug: 'some-other-metro', title: 'An unrelated list', isOfficial: true } })),
  })
  const approved = await driveToApproved(runStore, 'newlist-id-conflict', deps)
  const state = enforcedState(approved)
  assert.equal(approved.status, 'WAITING')
  assert.equal(state.m9SafeSqlPlan?.ok, false)
  assert.equal(state.m9SafeSqlPlan?.perListOutcomes[0]?.status, 'BLOCKED_NEW_LIST_ID_CONFLICT')
  assert.ok(state.m9SafeSqlPlan?.perListOutcomes[0]?.errors.some((e) => e.includes('some-other-metro')))
  assert.equal(state.homeListSqlPatch, undefined, 'no executable SQL may exist while the deterministic id is claimed by an unrelated metro')
})

test('NEW LIST: the deterministic list id is derived from conceptId, never from title — proven end to end by matching the SQL against computeM9ListId(conceptId) computed independently', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...newListClusterSpecs(20), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'newlist-deterministic-id-proof', specs)
  const approved = await driveToApproved(runStore, 'newlist-deterministic-id-proof', baseDeps(runStore))
  const state = enforcedState(approved)
  const conceptId = state.m9EnforcedCuration!.conceptVerdicts.find((v) => v.approvalState === 'APPROVED')!.conceptId
  const expectedListId = computeM9ListId(conceptId)
  assert.match(state.homeListSqlPatch!, new RegExp(`v_list_id uuid := '${expectedListId}'::uuid;`))
})
