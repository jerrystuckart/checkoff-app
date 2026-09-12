// Chief Phase 3C, Phase A — driver-level tests for
// METRO_FINISHER_PACKET_EXECUTION: the new stage that automatically
// EXECUTES the already-approved, bounded Finisher work packets against
// Winston's EXISTING certified workflows (certifyLateAddItem, the
// duplicate-cluster resolver, the geographic-consistency audit) — never
// bypassing any gate, never touching production.
//
// These tests drive the REAL driver, seeded directly at
// METRO_FINISHER_PACKET_EXECUTION with real metroFinisherPackets already
// built from a hand-crafted MetroFinisherReport (mirrors
// metroLaunchDriverFinisherRetryGate.test.ts's seedAtFinisherStage
// pattern, positioned one stage later).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions, type DriverItemCertificationRecord, type MetroFinisherPacketExecutionState } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import { InMemoryGeoEnrichmentCacheStore } from './metroGeoEnrichmentDriver'
import type { VerifiedTagSnapshot } from './tagVocabularyProvider'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'
import { buildMetroFinisherWorkPackets } from '../playbooks/metroFinisherIntegration'
import type { MetroFinisherReport } from '../playbooks/metroFinisherReport'
import { evaluateFinalReadyToApplyAudit } from '../playbooks/finalReadyToApplyAudit'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }

const M0: MetroM0Decisions = {
  geographicScope: 'Test metro',
  categoryCatalogTargets: 'Food & drink',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 44.5, lng: -88.0 },
}

const TEST_TAG_VOCAB: VerifiedTagSnapshot = {
  version: 1,
  capturedAt: '2026-09-09T00:00:00.000Z',
  justification: 'TEST_FIXTURE',
  tagNames: ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'craft beer', 'local favorite', 'walkable'],
}
const GOOD_TAGS = ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'craft beer']

function emptyReport(overrides: Partial<MetroFinisherReport> = {}): MetroFinisherReport {
  return {
    metro: 'test-metro',
    generatedAt: '2026-09-11T00:00:00Z',
    catalogAssessment: { currentItemCount: 2, strengths: [], weaknesses: [], categoryGaps: [], neighborhoodGaps: [] },
    cityIdentity: { signatureFoodAndDrink: [], ritualsAndTraditions: [], artisanAndMakerCulture: [], localOnlyExperiences: [], unusualOrHidden: [], sportsAndCivicCulture: [] },
    mustHaveMissingExperiences: [],
    enrichmentCandidates: [],
    neighborhoodRecommendations: { keep: [], split: [], add: [], reject: [] },
    themedListOpportunities: [],
    duplicateOrIdentityConcerns: [],
    finalAssessment: { readyToFinish: true, recommendedAdditionalItemRange: { min: 0, max: 0 }, highestPriorityNextActions: [] },
    ...overrides,
  }
}

async function seedAtPacketExecution(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, report: MetroFinisherReport, priorState: Record<string, unknown> = {}) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = {
    m0Decisions: M0,
    candidates: [],
    neighborhoods: [],
    plan: PLAN,
    hasRunM6: true,
    itemCertifications: {},
    metroFinisherReport: report,
    metroFinisherPackets: buildMetroFinisherWorkPackets(report),
    metroFinisherStatus: { verdict: 'PASS' },
    metroFinisherRunsCompleted: 1,
    ...priorState,
  }
  seeded!.currentStage = 'METRO_FINISHER_PACKET_EXECUTION'
  await runStore.put(seeded!)
}

function basePlacesLookup() {
  return async (q: string) => ({ topResult: { placeId: `place-${q}`, name: q, formattedAddress: `${q}, Testville, WI 54301, USA`, lat: 44.51, lng: -88.01, websiteUri: 'https://example.com/site', country: 'US' as const, viewportRadiusM: 50 }, apiError: null })
}

function scriptResearchAndEditor(executor: TestExecutor, opts: { editorTags?: string[]; bodyTemplate?: (venue: string) => string } = {}) {
  const tags = opts.editorTags ?? GOOD_TAGS
  const bodyTemplate = opts.bodyTemplate ?? ((venue: string) => `Try the house specialty at '${venue}'.`)
  executor.scriptWhen(
    (r) => r.specialist === 'research_verifier',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { claimSupported: 'A real, specific, checkable fact about this venue.' }, methodologyId: r.methodologyId, methodologyVersion: r.methodologyVersion })
  )
  executor.scriptWhen(
    (r) => r.specialist === 'checkoff_editor',
    (r) => {
      const venue = (r.inputs as { businessOrPlace?: string }).businessOrPlace ?? 'Unknown Venue'
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { checkoffizedItem: bodyTemplate(venue), tags, canonicalVenueUsed: venue }, methodologyId: r.methodologyId, methodologyVersion: r.methodologyVersion })
    }
  )
}

function baseDeps(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, execStore: InMemoryExecutionStore, executor: TestExecutor, extra: Record<string, unknown> = {}) {
  return {
    runStore,
    execStore,
    executors: [executor],
    verifiedTagSnapshot: TEST_TAG_VOCAB,
    placesLookup: basePlacesLookup(),
    geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
    ...extra,
  }
}

function packetExecState(run: Awaited<ReturnType<typeof driveMetroLaunch>>): MetroFinisherPacketExecutionState | undefined {
  return (run.state as { metroFinisherPacketExecution?: MetroFinisherPacketExecutionState }).metroFinisherPacketExecution
}

// ---------------------------------------------------------------------------
// 1 & 8. A HIGH-priority ENRICHMENT_PACKET candidate is automatically
// certified through the real certifyLateAddItem-equivalent pipeline,
// without any human trigger — and cannot bypass that gate even though
// the Finisher report framed it as "must-have."
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: a HIGH-priority mustHave candidate is automatically run through late-add certification and certifies', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-certify-test'

  const report = emptyReport({
    mustHaveMissingExperiences: [{ candidateName: 'Charlie Creamery scoop', venueName: 'Charlie Creamery', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'A signature local creamery the catalog is missing.', distinctivenessNote: 'Only creamery in the metro making its own waffle cones.' }],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const state = run.state as { itemCertifications?: Record<string, DriverItemCertificationRecord> }

  assert.equal(run.currentStage, 'M9_HOME_LIST_MIRROR')
  assert.equal(state.itemCertifications?.['Charlie Creamery scoop']?.outcome, 'ITEM_CERTIFIED', 'the mustHave candidate was auto-certified without a human trigger')
  const exec = packetExecState(run)
  assert.deepEqual(exec?.enrichmentCertifiedNames, ['Charlie Creamery scoop'])
  assert.deepEqual(exec?.enrichmentRejected, [])
})

test('METRO_FINISHER_PACKET_EXECUTION: a live-style array-of-source-objects claimSupported (the real Munich/Schmalznudeln shape) still certifies via normalizeClaimSupported', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  executor.scriptWhen(
    (r) => r.specialist === 'research_verifier',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          claimSupported: [
            { name: 'Café Frischhut', source: 'https://www.frischhut.de/', category: 'Bakery/Café', neighborhood: 'Altstadt-Lehel', freshnessDate: null, claimSupported: 'Café Frischhut is renowned for its Schmalznudeln.', needsVerification: true, verificationConfidence: 'HIGH' },
            { name: 'TasteAtlas', source: 'https://www.tasteatlas.com/cafe-frischhut', category: 'Bakery', neighborhood: 'Altstadt-Lehel', freshnessDate: null, claimSupported: 'TasteAtlas cites it as the top Schmalznudeln source in Munich.', needsVerification: true, verificationConfidence: 'HIGH' },
          ],
        },
        methodologyId: r.methodologyId,
        methodologyVersion: r.methodologyVersion,
      })
  )
  executor.scriptWhen(
    (r) => r.specialist === 'checkoff_editor',
    (r) => {
      const venue = (r.inputs as { businessOrPlace?: string }).businessOrPlace ?? 'Unknown Venue'
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { checkoffizedItem: `Try the house specialty at '${venue}'.`, tags: GOOD_TAGS, canonicalVenueUsed: venue }, methodologyId: r.methodologyId, methodologyVersion: r.methodologyVersion })
    }
  )
  const projectId = 'finisher-packet-array-claim-support-test'

  const report = emptyReport({
    mustHaveMissingExperiences: [{ candidateName: 'Schmalznudeln at Café Frischhut', venueName: 'Café Frischhut', category: 'Food & drink', neighborhoodName: 'Altstadt-Lehel', rationale: 'Iconic Bavarian pastry, missing from the catalog.', distinctivenessNote: 'Singular specialty bakery with decades-old ritual.' }],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const state = run.state as { itemCertifications?: Record<string, DriverItemCertificationRecord> }

  assert.equal(state.itemCertifications?.['Schmalznudeln at Café Frischhut']?.outcome, 'ITEM_CERTIFIED', 'the live array-shaped claimSupported was normalized and did not crash or block certification')
  assert.ok(state.itemCertifications?.['Schmalznudeln at Café Frischhut']?.supportingFact.includes('Schmalznudeln'), 'the normalized supporting fact text is preserved on the certification record')
})

test('METRO_FINISHER_PACKET_EXECUTION: even a "definitely needed" candidate still goes through the full certifyLateAddItem check set and can be rejected', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  // Editor returns too FEW tags (3, below the 6-8 required range) —
  // certifyLateAddItem must reject this regardless of how the report framed it.
  scriptResearchAndEditor(executor, { editorTags: ['coffee', 'historic'] })
  const projectId = 'finisher-packet-cannot-bypass-test'

  const report = emptyReport({
    mustHaveMissingExperiences: [{ candidateName: 'Definitely Needed Spot', venueName: 'Definitely Needed Spot', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'The report insists this is definitely needed.', distinctivenessNote: 'Definitely distinctive, per the report.' }],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const state = run.state as { itemCertifications?: Record<string, DriverItemCertificationRecord> }

  assert.equal(state.itemCertifications?.['Definitely Needed Spot'], undefined, 'a rejected candidate never enters itemCertifications')
  const exec = packetExecState(run)
  assert.deepEqual(exec?.enrichmentCertifiedNames, [])
  assert.equal(exec?.enrichmentRejected.length, 1)
  assert.ok(exec?.enrichmentRejected[0]!.reasons.some((r) => /tag/i.test(r)), 'the rejection reason names the real failing check')
})

// ---------------------------------------------------------------------------
// 2. A candidate that fails certification for a data reason (bad Places
// match) does not enter the catalog — a real rejection, not soft.
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: a candidate with unresolved Places data is rejected, not silently added', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-bad-places-test'

  const report = emptyReport({
    enrichmentCandidates: [{ candidateName: 'Ghost Venue Tour', venueName: 'Ghost Venue', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'A nice-to-have addition.', distinctivenessNote: 'Somewhat distinctive.' }],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  // No Places match at all — classification/placeId stay unresolved.
  const noMatchDeps = baseDeps(runStore, execStore, executor, { placesLookup: async () => ({ topResult: null, apiError: null }) })
  const run = await driveMetroLaunch(noMatchDeps, projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const state = run.state as { itemCertifications?: Record<string, DriverItemCertificationRecord> }

  assert.equal(state.itemCertifications?.['Ghost Venue Tour'], undefined)
  const exec = packetExecState(run)
  assert.equal(exec?.enrichmentRejected.length, 1)
})

// ---------------------------------------------------------------------------
// Munich/Schmalznudeln regression — a research_verifier envelope whose
// evidence.claimSupported comes back as a genuinely malformed/unrecognized
// shape (neither the legacy plain string nor the live array-of-source-
// objects shape normalizeClaimSupported() also handles) must cleanly
// REJECT that one candidate via the normal certification-rejection path,
// never crash the run (the original bug: `claimSupported.trim is not a
// function`) and never touch any other candidate or unrelated state.
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: a malformed claimSupported shape from research_verifier cleanly rejects only that one candidate, without crashing the run', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

  // One candidate's research response comes back with a malformed
  // claimSupported (neither a string nor a recognizable array of source
  // objects) — must not throw. The other candidate gets a normal,
  // well-formed response and must certify unaffected.
  executor.scriptWhen(
    (r) => r.specialist === 'research_verifier' && (r.inputs as { candidateName?: string }).candidateName === 'Malformed Research Candidate',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { claimSupported: { unexpected: 'shape', notAnArray: true } }, methodologyId: r.methodologyId, methodologyVersion: r.methodologyVersion })
  )
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-malformed-claim-support-test'

  const report = emptyReport({
    mustHaveMissingExperiences: [
      { candidateName: 'Malformed Research Candidate', venueName: 'Malformed Venue', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'Triggers the malformed claimSupported fixture.', distinctivenessNote: 'n/a' },
      { candidateName: 'Charlie Creamery scoop', venueName: 'Charlie Creamery', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'A signature local creamery the catalog is missing.', distinctivenessNote: 'Only creamery in the metro making its own waffle cones.' },
    ],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  // No exception should propagate out of driveMetroLaunch.
  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const state = run.state as { itemCertifications?: Record<string, DriverItemCertificationRecord> }

  assert.equal(run.currentStage, 'M9_HOME_LIST_MIRROR', 'the run progressed normally past packet execution, not blocked/crashed')
  assert.equal(state.itemCertifications?.['Malformed Research Candidate'], undefined, 'the malformed candidate never entered itemCertifications')
  assert.equal(state.itemCertifications?.['Charlie Creamery scoop']?.outcome, 'ITEM_CERTIFIED', 'the unrelated, well-formed candidate certified normally — unaffected by the other candidate\'s malformed shape')

  const exec = packetExecState(run)
  assert.deepEqual(exec?.enrichmentCertifiedNames, ['Charlie Creamery scoop'])
  assert.equal(exec?.enrichmentRejected.length, 1)
  assert.equal(exec?.enrichmentRejected[0]!.candidateName, 'Malformed Research Candidate')
  assert.ok(exec?.enrichmentRejected[0]!.reasons.some((r) => /research failed|no supported claim/i.test(r)), 'rejected via the normal research-failure reason, not a thrown exception')
})

// ---------------------------------------------------------------------------
// 3 & 10. Budget cap stops further candidate research mid-queue; an
// exhausted queue (not a low absolute catalog count) is the only other
// stopping condition.
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: an exhausted certification-attempt budget stops the loop mid-queue', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-budget-test'

  const report = emptyReport({
    mustHaveMissingExperiences: [
      { candidateName: 'First Spot', venueName: 'First Spot', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'r', distinctivenessNote: 'd' },
      { candidateName: 'Second Spot', venueName: 'Second Spot', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'r', distinctivenessNote: 'd' },
      { candidateName: 'Third Spot', venueName: 'Third Spot', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'r', distinctivenessNote: 'd' },
    ],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor, { packetExecutionBudget: { maxIncrementalSpendUsd: 999, maxCertificationAttempts: 1 } }), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)

  assert.equal(exec?.enrichmentAttempted.length, 1, 'only 1 attempt was made before the attempt-budget stopped the loop')
  assert.ok(exec?.budgetStoppedReason && /attempt/i.test(exec.budgetStoppedReason))
  assert.equal(run.currentStage, 'M9_HOME_LIST_MIRROR', 'budget exhaustion never blocks the run itself, only the enrichment loop')
})

test('METRO_FINISHER_PACKET_EXECUTION: an empty queue never loops just because a large budget remains (never padded to hit a number)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-empty-queue-test'

  const report = emptyReport() // catalogAssessment.currentItemCount is low (2), but no leads at all.
  await seedAtPacketExecution(runStore, projectId, report)

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)

  assert.equal(exec?.enrichmentAttempted.length, 0)
  assert.equal(run.currentStage, 'M9_HOME_LIST_MIRROR')
})

// ---------------------------------------------------------------------------
// 4 & 5. Duplicate cluster resolution — decisive vs. ambiguous.
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: a decisive same-venue-same-experience duplicate cluster resolves automatically', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-duplicate-decisive-test'

  const report = emptyReport({
    duplicateOrIdentityConcerns: [
      { venueName: 'Riverside Diner', placeId: 'place-riverside', itemIds: ['Riverside Diner breakfast', 'Riverside Diner brunch'], verdict: 'MERGE_RECOMMENDED', rationale: 'Two items about the same venue.' },
    ],
  })
  await seedAtPacketExecution(runStore, projectId, report, {
    itemCertifications: {
      'Riverside Diner breakfast': { candidateName: 'Riverside Diner breakfast', venueName: 'Riverside Diner', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the stacked pancakes at 'Riverside Diner'.", finalTags: GOOD_TAGS, supportingFact: 'f', verifiedAt: '2026-01-01T00:00:00Z', rejectionReasons: [] },
      'Riverside Diner brunch': { candidateName: 'Riverside Diner brunch', venueName: 'Riverside Diner', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the stacked pancakes at 'Riverside Diner'.", finalTags: GOOD_TAGS, supportingFact: 'f', verifiedAt: '2026-01-01T00:00:00Z', rejectionReasons: [] },
    },
  })

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)

  assert.equal(exec?.duplicateResolutions.length, 1)
  assert.notEqual(exec?.duplicateResolutions[0]!.verdict, 'NEEDS_HUMAN_REVIEW')
  assert.equal(exec?.duplicateResolutions[0]!.verdict, 'DROP_DUPLICATE')
})

test('METRO_FINISHER_PACKET_EXECUTION: a genuinely ambiguous duplicate cluster is left as NEEDS_HUMAN_REVIEW', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-duplicate-ambiguous-test'

  const report = emptyReport({
    duplicateOrIdentityConcerns: [{ venueName: 'Lion’s Mouth Bookstore', placeId: 'place-lions-mouth', itemIds: ['a', 'b'], verdict: 'NEEDS_HUMAN_REVIEW', rationale: 'Not sure if these are the same experience.' }],
  })
  await seedAtPacketExecution(runStore, projectId, report, {
    itemCertifications: {
      a: { candidateName: 'a', venueName: 'Lion’s Mouth Bookstore', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Browse the staff-picked local author shelf and grab a coffee at 'Lion’s Mouth Bookstore' on a quiet afternoon.", finalTags: GOOD_TAGS, supportingFact: 'f', verifiedAt: '2026-01-01T00:00:00Z', rejectionReasons: [] },
      b: { candidateName: 'b', venueName: 'Lion’s Mouth Bookstore', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Grab a coffee and browse the poetry section at 'Lion’s Mouth Bookstore' on a quiet weekend morning.", finalTags: GOOD_TAGS, supportingFact: 'f', verifiedAt: '2026-01-01T00:00:00Z', rejectionReasons: [] },
    },
  })

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)

  assert.equal(exec?.duplicateResolutions[0]!.verdict, 'NEEDS_HUMAN_REVIEW')
})

// ---------------------------------------------------------------------------
// 6. Neighborhood split proposal automatically executes the migration
// review workflow and produces a migration table.
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: a neighborhood split proposal produces a real migration table, never silently skipped', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-neighborhood-split-test'

  const report = emptyReport({
    neighborhoodRecommendations: {
      keep: [],
      split: [{ parentNeighborhood: 'Downtown', proposedChildren: ['Downtown North', 'Downtown South'], rationale: 'Downtown is geographically too large.', affectedExistingItemIds: ['Alpha Diner'] }],
      add: [],
      reject: [],
    },
  })
  await seedAtPacketExecution(runStore, projectId, report, {
    candidates: [{ name: 'Alpha Diner', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://example.com', needsVerification: false }],
    geoEnrichmentResults: [{ candidateName: 'Alpha Diner', classification: 'EXACT', reason: 'x', placeId: 'place-alpha', formattedAddress: 'Alpha Diner, Downtown North, WI 54301, USA', lat: 44.5, lng: -88.0, websiteUrl: null, geoRadiusM: 50 }],
  })

  const registry = { 'Downtown North': { municipalityAliases: ['Downtown North'] }, 'Downtown South': { municipalityAliases: ['Downtown South'] } }
  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor, { neighborhoodMunicipalityRegistry: registry }), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)

  assert.equal(exec?.neighborhoodMigration.length, 1, 'the migration review produced a real table entry, never silently skipped')
  assert.equal(exec?.neighborhoodMigration[0]!.candidateName, 'Alpha Diner')
  assert.equal(exec?.neighborhoodMigration[0]!.newNeighborhood, 'Downtown North')
  assert.equal(exec?.neighborhoodMigration[0]!.resolutionMethod, 'ADDRESS_AUDIT')

  const stateAfter = run.state as { candidates?: Array<{ name: string; neighborhood: string | null }> }
  assert.equal(stateAfter.candidates?.find((c) => c.name === 'Alpha Diner')?.neighborhood, 'Downtown North', 'the run\'s own proposed package state was migrated consistently')
})

test('METRO_FINISHER_PACKET_EXECUTION: a migration item is honestly reported unresolved (never skipped) when no registry is configured', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-neighborhood-no-registry-test'

  const report = emptyReport({
    neighborhoodRecommendations: { keep: [], split: [{ parentNeighborhood: 'Downtown', proposedChildren: ['Downtown North'], rationale: 'r', affectedExistingItemIds: ['Alpha Diner'] }], add: [], reject: [] },
  })
  await seedAtPacketExecution(runStore, projectId, report, { candidates: [{ name: 'Alpha Diner', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://example.com', needsVerification: false }] })

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)
  assert.equal(exec?.neighborhoodMigration[0]!.newNeighborhood, null)
  assert.equal(exec?.neighborhoodMigration[0]!.resolutionMethod, 'UNRESOLVED_NO_REGISTRY')
})

// ---------------------------------------------------------------------------
// 7. ENRICH_THEN_CREATE only creates when enough needed items certify.
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: an ENRICH_THEN_CREATE theme is created only when enough of its needed items certify', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-theme-success-test'

  const report = emptyReport({
    themedListOpportunities: [
      {
        title: 'Local Coffee Crawl',
        rationale: 'Strong existing base, needs one more stop.',
        existingItemIds: [],
        missingExperiences: [{ candidateName: 'Roast House pour-over', venueName: 'Roast House', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'r', distinctivenessNote: 'd' }],
        strengthScore: 0.8,
        recommendation: 'ENRICH_THEN_CREATE',
      },
    ],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)

  assert.equal(exec?.enrichmentCertifiedNames.includes('Roast House pour-over'), true)
  const decision = exec?.themedListDecisions.find((d) => d.title === 'Local Coffee Crawl')
  assert.equal(decision?.verdict, 'CREATED')
  assert.ok(decision?.itemCandidateNames.includes('Roast House pour-over'))
})

test('METRO_FINISHER_PACKET_EXECUTION: an ENRICH_THEN_CREATE theme is NOT created when enrichment mostly fails', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  // Editorial writer returns too few tags -> certifyLateAddItem rejects every enrichment attempt.
  scriptResearchAndEditor(executor, { editorTags: ['coffee'] })
  const projectId = 'finisher-packet-theme-fail-test'

  const report = emptyReport({
    themedListOpportunities: [
      {
        title: 'Local Coffee Crawl',
        rationale: 'Needs several more stops.',
        existingItemIds: [],
        missingExperiences: [
          { candidateName: 'Roast House pour-over', venueName: 'Roast House', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'r', distinctivenessNote: 'd' },
          { candidateName: 'Second Stop espresso', venueName: 'Second Stop', category: 'Food & drink', neighborhoodName: 'Downtown', rationale: 'r', distinctivenessNote: 'd' },
        ],
        strengthScore: 0.4,
        recommendation: 'ENRICH_THEN_CREATE',
      },
    ],
  })
  await seedAtPacketExecution(runStore, projectId, report)

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)
  const decision = exec?.themedListDecisions.find((d) => d.title === 'Local Coffee Crawl')

  assert.equal(decision?.verdict, 'NOT_CREATED')
  assert.deepEqual(decision?.itemCandidateNames, [])
})

// ---------------------------------------------------------------------------
// 9. Final readiness stays BLOCKED when a NEEDS_HUMAN_REVIEW duplicate
// cluster remains unresolved.
// ---------------------------------------------------------------------------

test('METRO_FINISHER_PACKET_EXECUTION: finalReadyToApplyAudit stays BLOCKED with an unresolved NEEDS_HUMAN_REVIEW duplicate cluster', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptResearchAndEditor(executor)
  const projectId = 'finisher-packet-final-audit-blocked-test'

  const report = emptyReport({
    duplicateOrIdentityConcerns: [{ venueName: 'Lion’s Mouth Bookstore', placeId: 'place-lions-mouth', itemIds: ['a', 'b'], verdict: 'NEEDS_HUMAN_REVIEW', rationale: 'Ambiguous.' }],
  })
  await seedAtPacketExecution(runStore, projectId, report, {
    itemCertifications: {
      a: { candidateName: 'a', venueName: 'Lion’s Mouth Bookstore', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Browse the staff-picked local author shelf and grab a coffee at 'Lion’s Mouth Bookstore' on a quiet afternoon.", finalTags: GOOD_TAGS, supportingFact: 'f', verifiedAt: '2026-01-01T00:00:00Z', rejectionReasons: [] },
      b: { candidateName: 'b', venueName: 'Lion’s Mouth Bookstore', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Grab a coffee and browse the poetry section at 'Lion’s Mouth Bookstore' on a quiet weekend morning.", finalTags: GOOD_TAGS, supportingFact: 'f', verifiedAt: '2026-01-01T00:00:00Z', rejectionReasons: [] },
    },
    venueDuplicateClusters: [{ placeId: 'place-lions-mouth', members: [{ candidateName: 'a', placeId: 'place-lions-mouth', finalBody: 'x' }, { candidateName: 'b', placeId: 'place-lions-mouth', finalBody: 'y' }] }],
  })

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const exec = packetExecState(run)
  assert.equal(exec?.duplicateResolutions[0]!.verdict, 'NEEDS_HUMAN_REVIEW')

  const state = run.state as { metroFinisherPacketExecution?: MetroFinisherPacketExecutionState; venueDuplicateClusters?: unknown[] }
  const duplicateResolutionByPlaceId = new Map((state.metroFinisherPacketExecution?.duplicateResolutions ?? []).filter((d) => d.placeId).map((d) => [d.placeId as string, d]))
  const unresolved = (state.venueDuplicateClusters as Array<{ placeId: string }>).filter((c) => {
    const r = duplicateResolutionByPlaceId.get(c.placeId)
    return !r || r.verdict === 'NEEDS_HUMAN_REVIEW'
  })
  const audit = evaluateFinalReadyToApplyAudit({
    outOfMarketContaminationVerdict: 'PASS',
    allDuplicateClustersResolved: unresolved.length === 0,
    unresolvedDuplicateClusterCount: unresolved.length,
    allItemsCertified: true,
    uncertifiedItemCount: 0,
    emptyNeighborhoods: [],
    placesCompletenessVerdict: 'PASS',
    listTitlesWithInternalPrefix: [],
    homeList: { packageValid: true, itemProvenanceValid: true },
    reusedItemsAdditiveOnly: true,
    sqlSafetyVerdict: 'PASS',
    executionState: 'GENERATED',
    metroFinisherStatus: { verdict: 'PASS' },
  })

  assert.equal(audit.verdict, 'BLOCKED')
  assert.ok(audit.reasons.some((r) => /cluster/i.test(r)))
})
