// M9 wiring, Session 2 (2026-09-14) — PHASE 7: end-to-end ENFORCED
// integration coverage through the real driveMetroLaunch entry point (no
// adapter mocking). See docs/metro-launch-audit/munich/calibration-analysis/
// 16-m9-wiring-handoff.md (Session 1 scope), 17-m9-shadow-wiring.md
// (Session 1 SHADOW wiring), and 18-m9-enforced-wiring.md (this session's
// own handoff) for full context.
//
// Preserves every existing LEGACY/SHADOW test unchanged (see
// metroLaunchDriverM9Characterization.test.ts and
// metroLaunchDriverM9ShadowWiring.test.ts, neither modified this session).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import type { M9EnforcedCurationArtifact } from './m9EnforcedTypes'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Adventure', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }

const M0: MetroM0Decisions = {
  geographicScope: 'Test metro',
  categoryCatalogTargets: 'Adventure',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 44.5, lng: -88.0 },
}

interface ItemSpec {
  name: string
  venueName?: string
  tags: string[]
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

function baseGeo(name: string) {
  return { candidateName: name, classification: 'EXACT' as const, reason: 'test fixture', placeId: `p-${name}`, formattedAddress: `${name}, Downtown, Test Metro`, lat: 44.51, lng: -88.01, geoRadiusM: null, websiteUrl: 'https://example.com/site' }
}

function buildCatalog(specs: ItemSpec[]) {
  const candidates: { name: string; category: string; neighborhood: string; claimSupported: string; source: string }[] = []
  const itemCertifications: Record<string, DriverItemCertificationRecord> = {}
  const metadataEnrichmentResults: ReturnType<typeof baseMetadata>[] = []
  const geoEnrichmentResults: ReturnType<typeof baseGeo>[] = []

  for (const spec of specs) {
    candidates.push({ name: spec.name, category: 'Adventure', neighborhood: 'Downtown', claimSupported: 'x', source: `https://example.com/${spec.name}` })
    itemCertifications[spec.name] = {
      candidateName: spec.name,
      venueName: spec.venueName ?? spec.name,
      attempts: 1,
      outcome: 'ITEM_CERTIFIED',
      finalBody: `Try the real, specific thing at '${spec.venueName ?? spec.name}'.`,
      finalTags: spec.tags,
      supportingFact: `${spec.name} has a real specific attraction.`,
      verifiedAt: '2026-09-14T00:00:00.000Z',
      rejectionReasons: [],
      dbCategory: 'Adventure',
    }
    metadataEnrichmentResults.push(baseMetadata(spec.name))
    geoEnrichmentResults.push(baseGeo(spec.name))
  }
  return { candidates, itemCertifications, metadataEnrichmentResults, geoEnrichmentResults }
}

/**
 * A large, mostly-unique-tagged filler pool so a target cluster's own tag
 * prevalence stays under listConceptDiscovery.ts's 50% genericness ceiling,
 * and so the legacy flagship list's own 30-item cap (FLAGSHIP_LIST_TARGET_SIZE,
 * metroLaunchDriver.ts) can never cover a large majority of any one
 * target cluster — keeping the REQUIRES_JERRY overlap check from firing
 * on plain, unrelated test clusters.
 */
function fillerItems(count: number, prefix: string): ItemSpec[] {
  return Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${i}`, tags: [`filler-${prefix}-${i}`] }))
}

async function seedAtM9(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, specs: ItemSpec[]) {
  const catalog = buildCatalog(specs)
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = {
    m0Decisions: M0,
    candidates: catalog.candidates.map((c) => ({ ...c, needsVerification: false })),
    neighborhoods: [],
    plan: PLAN,
    hasRunM6: true,
    itemCertifications: catalog.itemCertifications,
    batchCertificationGates: [],
    metadataEnrichmentResults: catalog.metadataEnrichmentResults,
    geoEnrichmentResults: catalog.geoEnrichmentResults,
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
    now: () => '2026-09-14T00:00:00.000Z',
    m9CurationMode: 'ENFORCED' as const,
    ...overrides,
  }
}

function enforcedState(run: Awaited<ReturnType<typeof driveMetroLaunch>>) {
  return run.state as { m9EnforcedCuration?: M9EnforcedCurationArtifact; homeListPlan?: unknown; homeListSqlPatch?: string; m9OperatorDecisions?: Record<string, unknown> }
}

// A clean, coherent 20-item cluster with no duplicates and no overlap risk.
function cleanClusterSpecs(count = 20, prefix = 'Canal Stop'): ItemSpec[] {
  return Array.from({ length: count }, (_, i) => ({ name: `${prefix} ${i}`, tags: ['canal-crawl', `u-${prefix}-${i}`] }))
}

// ---------------------------------------------------------------------------
// 1 & 4. ENFORCED discovers a new concept and requests approval; insufficient
// depth (a too-small cluster) blocks outright rather than padding.
// ---------------------------------------------------------------------------

test('ENFORCED: discovers a new concept and requests Jerry approval; a too-small cluster is auto-excluded (blocks, never padded)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20, 'Canal Stop'), ...Array.from({ length: 6 }, (_, i) => ({ name: `Tiny Spot ${i}`, tags: ['too-small-cluster', `t-${i}`] })), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'enf-discover', specs)
  const run = await driveMetroLaunch(baseDeps(runStore) as never, 'enf-discover', { categoryPlan: PLAN, maxSteps: 30 })
  const state = enforcedState(run)

  assert.ok(state.m9EnforcedCuration, 'ENFORCED must populate state.m9EnforcedCuration')
  const artifact = state.m9EnforcedCuration!
  assert.notEqual(artifact.result.kind, 'READY', 'a freshly-discovered concept must not be immediately authoritative with no operator decision')
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'M9_HOME_LIST_MIRROR', 'must remain parked at M9, never advance')

  const canalVerdict = artifact.conceptVerdicts.find((v) => v.seedTags.includes('canal-crawl'))
  assert.ok(canalVerdict, 'the real canal-crawl cluster must have been discovered')
  assert.ok(['PENDING', 'HOLD'].includes(canalVerdict!.approvalState))

  const tinyVerdict = artifact.conceptVerdicts.find((v) => v.seedTags.includes('too-small-cluster'))
  assert.equal(tinyVerdict, undefined, 'a 6-item cluster is below minViableItems and must never even be discovered as a scoreable concept — it is rejected at PASS A, not surfaced here as a pending decision')
})

// ---------------------------------------------------------------------------
// 2 & 9. Approved concept proceeds to membership curation and becomes READY,
// parked at M9 (WAITING) rather than advancing to M10.
// ---------------------------------------------------------------------------

test('ENFORCED: an approved concept proceeds to membership curation and the plan becomes READY, parked at M9 with status WAITING', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20, 'Canal Stop'), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'enf-approve', specs)
  const deps = baseDeps(runStore)

  const first = await driveMetroLaunch(deps as never, 'enf-approve', { categoryPlan: PLAN, maxSteps: 30 })
  const firstArtifact = enforcedState(first).m9EnforcedCuration!
  assert.equal(first.status, 'NEEDS_JERRY')
  const decision = firstArtifact.requiredDecisions[0]
  assert.ok(decision, 'a required decision must exist for the discovered concept')

  const second = await driveMetroLaunch(
    { ...deps, m9OperatorDecisionInputs: [{ conceptId: decision.affectedConceptIds[0], action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Reviewed the Canal Stop cluster — coherent, approved.', decidedBy: 'jerry' }] } as never,
    'enf-approve',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  const secondState = enforcedState(second)
  const secondArtifact = secondState.m9EnforcedCuration!
  assert.equal(secondArtifact.result.kind, 'READY', 'once the only outstanding concept is approved, the plan must become READY')
  assert.equal(second.status, 'WAITING', 'READY parks the run at WAITING — approved/valid, but no safe SQL path yet (Session 3)')
  assert.equal(second.currentStage, 'M9_HOME_LIST_MIRROR', 'must never advance to M10 in this session, even when READY')
  const conceptId = decision.affectedConceptIds[0]
  assert.ok(secondArtifact.finalApprovedMemberships[conceptId] && secondArtifact.finalApprovedMemberships[conceptId]!.length > 0, 'membership curation (PASS B) must have run for the approved concept')
})

// ---------------------------------------------------------------------------
// 3. Rejected concept stays excluded.
// ---------------------------------------------------------------------------

test('ENFORCED: a rejected concept stays excluded from finalApprovedMemberships, including on a later rerun', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20, 'Canal Stop'), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'enf-reject', specs)
  const deps = baseDeps(runStore)

  const first = await driveMetroLaunch(deps as never, 'enf-reject', { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]

  const second = await driveMetroLaunch(
    { ...deps, m9OperatorDecisionInputs: [{ conceptId: decision.affectedConceptIds[0], action: decision.action, resolutionAction: 'REJECT', decisionText: 'Not a strong enough concept for this metro — reject.', decidedBy: 'jerry' }] } as never,
    'enf-reject',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  const secondArtifact = enforcedState(second).m9EnforcedCuration!
  const conceptId = decision.affectedConceptIds[0]
  assert.equal(secondArtifact.finalApprovedMemberships[conceptId], undefined, 'a rejected concept must never appear in finalApprovedMemberships')
  const verdict = secondArtifact.conceptVerdicts.find((v) => v.conceptId === conceptId)
  assert.equal(verdict?.approvalState, 'REJECTED')
  assert.equal(second.status, 'WAITING', 'with the only concept resolved (rejected), the plan is READY (nothing left outstanding)')

  // Rerun again with NO new decisions — the rejection must still hold
  // (rejected candidates cannot silently reenter).
  const third = await driveMetroLaunch(deps as never, 'enf-reject', { categoryPlan: PLAN, maxSteps: 30 })
  const thirdArtifact = enforcedState(third).m9EnforcedCuration!
  assert.equal(thirdArtifact.finalApprovedMemberships[conceptId], undefined, 'a rejected concept must stay excluded on a later rerun with no new decisions')
  assert.equal(thirdArtifact.conceptVerdicts.find((v) => v.conceptId === conceptId)?.approvalState, 'REJECTED')
})

// ---------------------------------------------------------------------------
// 5, 6 & 7. Unresolved venue duplicate (the real Vereinsheim/Kunst Oase
// pattern) enters HOLD; a bare force-approval cannot clear it; a real,
// substantive decision (supplied evidence) resolves it via targeted reopen.
// ---------------------------------------------------------------------------

test('ENFORCED: an unresolved venue duplicate (Vereinsheim/Kunst Oase pattern) enters HOLD; bare force-approval cannot clear it; a real decision resolves it', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  // Two distinct certified candidates (different claims/candidateNames —
  // exactly how the real research pipeline produced the Vereinsheim pub-
  // quiz-night pair) that both resolve to the SAME real-world venue.
  const specs: ItemSpec[] = [
    { name: 'Vereinsheim Pub Quiz', venueName: 'Vereinsheim', tags: ['beer-garden', 'v-1'] },
    { name: 'Vereinsheim Live Music', venueName: 'Vereinsheim', tags: ['beer-garden', 'v-2'] },
    ...Array.from({ length: 13 }, (_, i) => ({ name: `Beer Garden ${i}`, tags: ['beer-garden', `bg-${i}`] })),
    ...fillerItems(40, 'Filler'),
  ]
  await seedAtM9(runStore, 'enf-duplicate', specs)
  const deps = baseDeps(runStore)

  const first = await driveMetroLaunch(deps as never, 'enf-duplicate', { categoryPlan: PLAN, maxSteps: 30 })
  const firstArtifact = enforcedState(first).m9EnforcedCuration!
  const beerConcept = firstArtifact.conceptVerdicts.find((v) => v.seedTags.includes('beer-garden'))
  assert.ok(beerConcept, 'the beer-garden cluster (including the Vereinsheim duplicate pair) must be discovered')
  assert.ok(beerConcept!.duplicateFindings.some((d) => d.kind === 'DUPLICATE_VENUE'), 'the same-venue Vereinsheim pair must be flagged as a duplicate finding')
  const decision = firstArtifact.requiredDecisions.find((d) => d.affectedConceptIds.includes(beerConcept!.conceptId))
  assert.ok(decision, 'a required decision must exist for the duplicate-containing concept')
  assert.equal(decision!.approvalSufficiency, 'EVIDENCE_REQUIRED', 'an unresolved venue duplicate must require real evidence, not a plain approval')
  assert.equal(first.status, 'NEEDS_JERRY')

  // 1. Empty force approval — refused outright.
  const bareForce = await driveMetroLaunch(
    { ...deps, m9OperatorDecisionInputs: [{ conceptId: beerConcept!.conceptId, action: decision!.action, resolutionAction: 'APPROVE', decisionText: '', decidedBy: 'jerry' }] } as never,
    'enf-duplicate',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  const bareForceArtifact = enforcedState(bareForce).m9EnforcedCuration!
  assert.equal(bareForceArtifact.finalApprovedMemberships[beerConcept!.conceptId], undefined, 'an empty force-approval must never clear an unresolved venue duplicate')
  assert.notEqual(bareForce.status, 'WAITING', 'the run must not become READY/parked-as-approved from an empty force-approval')

  // 2. Nonempty "looks fine to me" APPROVE — real text, but APPROVE can
  // never resolve an EVIDENCE_REQUIRED decision at all (PREREQUISITE 2).
  const vagueApprove = await driveMetroLaunch(
    { ...deps, m9OperatorDecisionInputs: [{ conceptId: beerConcept!.conceptId, action: decision!.action, resolutionAction: 'APPROVE', decisionText: 'looks fine to me', decidedBy: 'jerry' }] } as never,
    'enf-duplicate',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  const vagueApproveArtifact = enforcedState(vagueApprove).m9EnforcedCuration!
  assert.equal(vagueApproveArtifact.finalApprovedMemberships[beerConcept!.conceptId], undefined, 'a nonempty but non-evidentiary APPROVE must never resolve an EVIDENCE_REQUIRED duplicate')
  assert.notEqual(vagueApprove.status, 'WAITING')

  // 3. Structured evidence supplied, but for an UNRELATED issue (issueResolved
  // does not match the real outstanding reasonCode) — refused.
  const unrelatedEvidence = await driveMetroLaunch(
    {
      ...deps,
      m9OperatorDecisionInputs: [
        {
          conceptId: beerConcept!.conceptId,
          action: decision!.action,
          resolutionAction: 'SUPPLY_EVIDENCE',
          decisionText: 'Attaching evidence.',
          decidedBy: 'jerry',
          evidence: { sourceOrEvidenceId: 'https://example.com/unrelated', evidenceSummary: 'This is about hours of operation, not the duplicate.', dateVerified: '2026-09-15', confidence: 'HIGH', affectedConceptId: beerConcept!.conceptId, issueResolved: 'CONCEPT_CREATE_PENDING_APPROVAL' },
        },
      ],
    } as never,
    'enf-duplicate',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  const unrelatedEvidenceArtifact = enforcedState(unrelatedEvidence).m9EnforcedCuration!
  assert.equal(unrelatedEvidenceArtifact.finalApprovedMemberships[beerConcept!.conceptId], undefined, 'evidence whose issueResolved does not match the real outstanding reasonCode must be refused')

  // 4. Real, structured duplicate-resolution evidence — the actual Kunst
  // Oase/Vereinsheim precedent (an explicit decision addressing the
  // specific duplicate) — must resolve it.
  const resolved = await driveMetroLaunch(
    {
      ...deps,
      m9OperatorDecisionInputs: [
        {
          conceptId: beerConcept!.conceptId,
          action: decision!.action,
          resolutionAction: 'SUPPLY_EVIDENCE',
          decisionText: 'Reviewed: Vereinsheim pub quiz night and live music night are genuinely distinct recurring experiences at the same venue — keep both, same precedent as the real Kunst Oase case.',
          decidedBy: 'jerry',
          evidence: {
            sourceOrEvidenceId: 'operator-review-2026-09-15',
            evidenceSummary: 'Confirmed via the venue\'s own event calendar: pub quiz night (Tuesdays) and live music night (Fridays) are two separate, independently-bookable recurring events at the same address.',
            dateVerified: '2026-09-15',
            confidence: 'HIGH',
            affectedConceptId: beerConcept!.conceptId,
            issueResolved: 'UNRESOLVED_VENUE_DUPLICATE',
          },
        },
      ],
    } as never,
    'enf-duplicate',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  const resolvedArtifact = enforcedState(resolved).m9EnforcedCuration!
  assert.ok(resolvedArtifact.finalApprovedMemberships[beerConcept!.conceptId], 'real, structured, on-issue evidence must resolve the duplicate and finalize membership')
  assert.equal(resolved.status, 'WAITING', 'now READY/parked, since the only outstanding concept is resolved')
})

// ---------------------------------------------------------------------------
// Explicit rejection of a duplicate-containing concept — REJECT always
// resolves by exclusion, regardless of approvalSufficiency.
// ---------------------------------------------------------------------------

test('ENFORCED: explicit REJECT resolves a duplicate-containing concept by exclusion, without needing evidence', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs: ItemSpec[] = [
    { name: 'Vereinsheim Pub Quiz', venueName: 'Vereinsheim', tags: ['beer-garden', 'v-1'] },
    { name: 'Vereinsheim Live Music', venueName: 'Vereinsheim', tags: ['beer-garden', 'v-2'] },
    ...Array.from({ length: 13 }, (_, i) => ({ name: `Beer Garden ${i}`, tags: ['beer-garden', `bg-${i}`] })),
    ...fillerItems(40, 'Filler'),
  ]
  await seedAtM9(runStore, 'enf-duplicate-reject', specs)
  const deps = baseDeps(runStore)
  const first = await driveMetroLaunch(deps as never, 'enf-duplicate-reject', { categoryPlan: PLAN, maxSteps: 30 })
  const beerConcept = enforcedState(first).m9EnforcedCuration!.conceptVerdicts.find((v) => v.seedTags.includes('beer-garden'))!
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions.find((d) => d.affectedConceptIds.includes(beerConcept.conceptId))!

  const rejected = await driveMetroLaunch(
    { ...deps, m9OperatorDecisionInputs: [{ conceptId: beerConcept.conceptId, action: decision.action, resolutionAction: 'REJECT', decisionText: 'Not resolving the duplicate — dropping this concept entirely.', decidedBy: 'jerry' }] } as never,
    'enf-duplicate-reject',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  const rejectedArtifact = enforcedState(rejected).m9EnforcedCuration!
  assert.equal(rejectedArtifact.conceptVerdicts.find((v) => v.conceptId === beerConcept.conceptId)?.approvalState, 'REJECTED')
  assert.equal(rejectedArtifact.finalApprovedMemberships[beerConcept.conceptId], undefined)
  assert.equal(rejected.status, 'WAITING', 'the only concept is now resolved (rejected), so the plan is READY')
})

// ---------------------------------------------------------------------------
// 8. Changed concept fingerprint invalidates a stale approval.
// ---------------------------------------------------------------------------

test('ENFORCED: a changed catalog that alters a concept\'s membership invalidates its prior approval', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20, 'Canal Stop'), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'enf-stale', specs)
  const deps = baseDeps(runStore)

  const first = await driveMetroLaunch(deps as never, 'enf-stale', { categoryPlan: PLAN, maxSteps: 30 })
  const decision = enforcedState(first).m9EnforcedCuration!.requiredDecisions[0]
  const conceptId = decision.affectedConceptIds[0]

  const approved = await driveMetroLaunch(
    { ...deps, m9OperatorDecisionInputs: [{ conceptId, action: decision.action, resolutionAction: 'APPROVE', decisionText: 'Approved.', decidedBy: 'jerry' }] } as never,
    'enf-stale',
    { categoryPlan: PLAN, maxSteps: 30 }
  )
  assert.equal(approved.status, 'WAITING')

  // Change the catalog: rename one Canal Stop member so the cluster's
  // membership set (and hence its fingerprint) differs, while its
  // identity (conceptId, from seedTags alone) stays the same.
  const changedSpecs = specs.map((s) => (s.name === 'Canal Stop 0' ? { ...s, name: 'Canal Stop 0 Renamed' } : s))
  const runStore2 = new InMemoryPlaybookRunStore()
  await seedAtM9(runStore2, 'enf-stale', changedSpecs)
  // Re-seed the SAME run id with the changed catalog but carry forward the
  // prior run's persisted operator decision — simulates a real re-run
  // after upstream stages produced a materially different certified set.
  const priorRun = await runStore.get(playbookRunId('metro_launch', 'enf-stale'))
  const changedSeed = await runStore2.get(playbookRunId('metro_launch', 'enf-stale'))
  ;(changedSeed!.state as Record<string, unknown>).m9OperatorDecisions = (priorRun!.state as Record<string, unknown>).m9OperatorDecisions
  await runStore2.put(changedSeed!)

  const afterChange = await driveMetroLaunch(baseDeps(runStore2) as never, 'enf-stale', { categoryPlan: PLAN, maxSteps: 30 })
  const afterChangeArtifact = enforcedState(afterChange).m9EnforcedCuration!
  assert.notEqual(afterChange.status, 'WAITING', 'a catalog change that alters the concept\'s membership must invalidate the stale approval, not silently keep it READY')
  assert.equal(afterChangeArtifact.finalApprovedMemberships[conceptId], undefined, 'the stale approval must not populate finalApprovedMemberships after the fingerprint changed')
})

// ---------------------------------------------------------------------------
// 10, 11. ENFORCED never emits/uses a legacy authoritative plan and never
// reaches M10 in this session — checked across every scenario above, plus
// explicitly here for the plain discovery case.
// ---------------------------------------------------------------------------

test('ENFORCED: never writes state.homeListPlan/state.homeListSqlPatch and never reaches M10', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20, 'Canal Stop'), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'enf-no-legacy', specs)
  const run = await driveMetroLaunch(baseDeps(runStore) as never, 'enf-no-legacy', { categoryPlan: PLAN, maxSteps: 30 })
  const state = enforcedState(run)
  assert.equal(state.homeListPlan, undefined, 'ENFORCED must never write state.homeListPlan')
  assert.equal(state.homeListSqlPatch, undefined, 'ENFORCED must never write state.homeListSqlPatch')
  assert.equal(run.currentStage, 'M9_HOME_LIST_MIRROR')
  assert.equal((run.state as { finalCertificationReport?: unknown }).finalCertificationReport, undefined, 'M10 must never have run')
})

// ---------------------------------------------------------------------------
// 12 & 13. LEGACY and SHADOW reach M10 exactly as before ENFORCED existed.
// ---------------------------------------------------------------------------

test('ENFORCED\'s existence does not change LEGACY or SHADOW: both still reach M10 in the same drive call', async () => {
  const specs = [...cleanClusterSpecs(20, 'Canal Stop'), ...fillerItems(40, 'Filler')]

  const legacyStore = new InMemoryPlaybookRunStore()
  await seedAtM9(legacyStore, 'enf-sanity-legacy', specs)
  const legacyRun = await driveMetroLaunch(baseDeps(legacyStore, { m9CurationMode: undefined }) as never, 'enf-sanity-legacy', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(legacyRun.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.ok((legacyRun.state as { homeListPlan?: unknown[] }).homeListPlan)

  const shadowStore = new InMemoryPlaybookRunStore()
  await seedAtM9(shadowStore, 'enf-sanity-shadow', specs)
  const shadowRun = await driveMetroLaunch(baseDeps(shadowStore, { m9CurationMode: 'SHADOW' }) as never, 'enf-sanity-shadow', { categoryPlan: PLAN, maxSteps: 30 })
  assert.equal(shadowRun.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.ok((shadowRun.state as { homeListPlan?: unknown[] }).homeListPlan)
  assert.ok((shadowRun.state as { m9ShadowCuration?: unknown }).m9ShadowCuration)
})

// ---------------------------------------------------------------------------
// 15. Repeated ENFORCED execution is idempotent.
// ---------------------------------------------------------------------------

test('ENFORCED: repeated execution with no new input is idempotent — identical artifact, no re-escalation drift', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const specs = [...cleanClusterSpecs(20, 'Canal Stop'), ...fillerItems(40, 'Filler')]
  await seedAtM9(runStore, 'enf-idempotent', specs)
  const deps = baseDeps(runStore)

  const first = await driveMetroLaunch(deps as never, 'enf-idempotent', { categoryPlan: PLAN, maxSteps: 30 })
  const firstArtifact = enforcedState(first).m9EnforcedCuration!
  assert.equal(first.status, 'NEEDS_JERRY')

  const second = await driveMetroLaunch(deps as never, 'enf-idempotent', { categoryPlan: PLAN, maxSteps: 30 })
  const secondArtifact = enforcedState(second).m9EnforcedCuration!
  assert.equal(second.status, 'NEEDS_JERRY', 're-invoking with no new decisions must reproduce the same outcome, not drift')
  assert.deepEqual(
    secondArtifact.conceptVerdicts.map((v) => ({ conceptId: v.conceptId, approvalState: v.approvalState, memberDecisions: v.memberDecisions })),
    firstArtifact.conceptVerdicts.map((v) => ({ conceptId: v.conceptId, approvalState: v.approvalState, memberDecisions: v.memberDecisions })),
    'concept verdicts/member decisions must be identical across repeated ENFORCED execution with no new input'
  )
})
