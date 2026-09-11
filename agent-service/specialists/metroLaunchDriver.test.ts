// Chief Phase 2F — metro_launch driver tests. Includes the required San
// Diego FULL SYNTHETIC driver run (spec section 21): start -> M0 decisions
// resolved -> M1 -> M2 -> M3 broad discovery -> M4 fails category ->
// M5 parallel gap research -> M4 re-audit -> M6 removes stale candidates
// -> replacement research -> re-audit -> gates pass -> checkoff_editor ->
// launch-readiness boundary -> NEEDS_JERRY, with NO manual per-stage
// command — driveMetroLaunch() sequences all of it itself. Every
// executor here is the deterministic TestExecutor; nothing touches the
// network or a real AI provider.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  driveMetroLaunch,
  executionId,
  m0DecisionsResolved,
  buildAuditEvidence,
  m1GeographyExecutionLabel,
  MAX_ITEM_CERTIFICATION_ATTEMPTS,
  MAX_TAG_ASSIGNMENT_ATTEMPTS,
  type MetroM0Decisions,
  type DriverItemCertificationRecord,
} from './metroLaunchDriver'
import type { VerifiedTagSnapshot } from './tagVocabularyProvider'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import { scriptPassingMetroFinisher } from './testMetroFinisherFixture'
import { auditCoverage, type CategoryCoveragePlan } from '../playbooks/metroLaunch'
import { InMemoryGeoEnrichmentCacheStore } from './metroGeoEnrichmentDriver'

const PLAN: CategoryCoveragePlan = {
  targets: [
    { categoryName: 'Food & drink', minimumViable: 5, healthyTarget: 10, qualityNotes: [] },
    { categoryName: 'Shopping', minimumViable: 4, healthyTarget: 8, qualityNotes: [] },
  ],
}

const RESOLVED_M0: MetroM0Decisions = {
  geographicScope: 'Downtown + La Jolla only for this synthetic run',
  categoryCatalogTargets: 'Food & drink (5/10), Shopping (4/8)',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 32.7157, lng: -117.1611 }, // San Diego
}

function food(name: string, neighborhood: string) {
  return { name, category: 'Food & drink', neighborhood, claimSupported: `${name} serves a real, specific dish`, source: `https://example.com/${name}`, needsVerification: true }
}
function shop(name: string, neighborhood: string) {
  return { name, category: 'Shopping', neighborhood, claimSupported: `${name} is a specific local shop experience`, source: `https://example.com/${name}`, needsVerification: true }
}

/** M7.5 TAG_ASSIGNMENT fake: echoes the first 6 entries of the REAL shortlist the driver computed and sent (always a subset of the real canonical vocabulary, so this is always valid — never a fabricated tag name). */
function scriptTagSelection(executor: TestExecutor) {
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: shortlist.slice(0, 6) }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )
  // M8.75 CATALOG_VOICE_PASS fake: echoes the body back unchanged — a
  // real "declined to rewrite" outcome (see rewriteOneItemVoice's own
  // "keep the original" discipline), which is exactly what most fixture
  // batches here should do since they're not testing voice diversity. A
  // test that DOES want to exercise a real rewrite must call its own
  // executor.script(executionId, ...) directly (an exact-id match always
  // wins over any scriptWhen resolver — see TestExecutor.execute) rather
  // than relying on a later scriptWhen, since resolvers here are checked
  // in registration order and this one is registered first.
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'VOICE_REWRITE',
    (r) => {
      const body = (r.inputs as { body?: string }).body ?? ''
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { body }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )
}

/** Scripts a full, deterministic TestExecutor for the synthetic scenario described above. */
function scriptSynthetic(executor: TestExecutor) {
  scriptTagSelection(executor)
  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          neighborhoods: [
            { name: 'Downtown', kind: 'core_urban', ring1RadiusM: 500, ring2RadiusM: 1500 },
            { name: 'La Jolla', kind: 'important_neighborhood', ring1RadiusM: 500, ring2RadiusM: 1500 },
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )

  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          candidates: [
            food('FoodA', 'Downtown'),
            food('FoodB', 'Downtown'),
            food('FoodC', 'Downtown'),
            food('FoodD', 'La Jolla'),
            food('FoodE', 'La Jolla'),
            shop('ShopOld1', 'Downtown'),
            shop('ShopOld2', 'Downtown'),
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )

  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES' && (r.inputs as { executionType?: string }).executionType === 'CATEGORY_GAP',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { candidates: [shop('ShopGap1', 'Downtown'), shop('ShopGap2', 'Downtown'), shop('ShopGap3', 'Downtown')] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )

  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => {
      const checked = ((r.inputs as { candidates?: Array<{ name: string }> }).candidates ?? []).map((c) => c.name)
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { verifiedCandidateNames: checked, removedCandidateNames: ['ShopOld1', 'ShopOld2'] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
        blockers: ['ShopOld1 and ShopOld2 confirmed closed via live verification'],
      })
    }
  )

  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES' && (r.inputs as { executionType?: string }).executionType === 'REPLACEMENT',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { candidates: [shop('ShopReplacement1', 'Downtown'), shop('ShopReplacement2', 'Downtown')] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )

  // M7_ITEM_CERTIFICATION critique calls — a distinct call shape (same
  // specialist, distinguished by stage + inputs.mode) from the M6_5
  // write call below. Scripted BEFORE the generic checkoff_editor
  // catch-all so it takes priority (TestExecutor.scriptWhen resolves in
  // registration order) — every item certifies cleanly on its first
  // attempt in this baseline synthetic scenario, matching the real
  // driver calling this stage for real (see the self-repair-specific
  // test below for the deliberately-generic-then-fixed case).
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'passes on first attempt in this synthetic scenario' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  executor.scriptWhen(
    (r) => r.specialist === 'checkoff_editor',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          factualSource: (r.inputs as { factualSource?: string }).factualSource ?? '',
          checkoffizedItem: `Checkoffized: order the 'signature dish' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`,
          tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'],
          canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace,
        },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )
}

test('m0DecisionsResolved: all 4 fields present (launchSeason may be null) resolves true', () => {
  assert.equal(m0DecisionsResolved(RESOLVED_M0), true)
})

test('m0DecisionsResolved: missing executionGoAhead resolves false', () => {
  assert.equal(m0DecisionsResolved({ ...RESOLVED_M0, executionGoAhead: false }), false)
})

test('m0DecisionsResolved: missing launchSeason key entirely (not even null) resolves false — a real decision must be recorded, even if the decision is "defer"', () => {
  const { launchSeason, ...rest } = RESOLVED_M0
  assert.equal(m0DecisionsResolved(rest), false)
})

test('driveMetroLaunch: with NO M0 decisions recorded, stops at NEEDS_JERRY before any research starts', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, 'san-diego-no-decisions', { categoryPlan: PLAN })
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'M0_METRO_DEFINITION')
  assert.ok(run.decisionPacket)
})

test('San Diego FULL SYNTHETIC driver run: sequences M0 through the launch-readiness boundary with NO manual per-stage command', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  scriptSynthetic(executor)

  const projectId = 'san-diego-synthetic'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.match(run.jerryReason ?? '', /launch-readiness boundary/)

  const state = run.state as { candidates: Array<{ name: string }>; checkoffizedItems: Array<{ name: string; checkoffizedItem: string }>; removedCandidateNames: string[] }
  assert.equal(state.candidates.length, 10, '5 Food + (2 original Shopping - 2 removed + 3 gap + 2 replacement) = 10')
  assert.ok(!state.candidates.some((c) => c.name === 'ShopOld1' || c.name === 'ShopOld2'), 'removed-by-verification candidates must not survive into the final set')
  assert.equal(state.checkoffizedItems.length, 10, 'every surviving candidate must have been checkoffized before the launch boundary')
  assert.ok(state.checkoffizedItems.every((c) => c.checkoffizedItem.startsWith('Checkoffized:')))

  // Real execution/run records exist for the trail — never faked.
  const allExecutions = await execStore.all()
  assert.ok(allExecutions.some((e) => e.request.stage === 'M1_GEOGRAPHY_MAP'))
  assert.ok(allExecutions.some((e) => e.request.stage === 'M3_BROAD_DISCOVERY'))
  assert.ok(allExecutions.filter((e) => e.request.stage === 'M5_TARGETED_DEEP_DIVES').length >= 2, 'both the gap pass and the replacement pass are M5-stage executions')
  assert.ok(allExecutions.some((e) => e.request.stage === 'M6_QUALITY_VERIFICATION'))
  // 10 M6_5 write calls + 10 M7 independent critique calls (one attempt
  // each, since every item certifies on its first pass in this baseline
  // scenario) — proves ITEM_CERTIFICATION_LOOP is actually invoked by
  // the real driver, not merely available as a library function.
  assert.ok(allExecutions.filter((e) => e.request.specialist === 'checkoff_editor' && e.request.stage === 'M6_5_CHECKOFF_EDITOR').length === 10)
  assert.ok(allExecutions.filter((e) => e.request.stage === 'M7_ITEM_CERTIFICATION').length === 10)
  assert.ok(allExecutions.every((e) => e.status === 'COMPLETE'))

  // The real M8-M10 gates actually ran and are reflected in the final report.
  const finalReport = (state as unknown as { finalCertificationReport?: { verdict: string; passingGates: string[] } }).finalCertificationReport
  assert.ok(finalReport, 'M10 must have produced a real finalCertificationReport, not left it unset')
  assert.ok(finalReport!.passingGates.includes('ITEM_CERTIFICATION_GATE'))
  assert.ok(finalReport!.passingGates.includes('DISTINCTIVE_EXPERIENCE_GATE'))
  assert.ok(finalReport!.passingGates.includes('VENUE_QUOTING_GATE'))

  // Structural bug fix regression (San Diego run, 2026-09-05): the
  // launch boundary's QUALITY_GATE duplicate check is no longer a
  // hardcoded `[]` — on this genuinely-deduped synthetic candidate set
  // it must report zero suspected duplicates and PASS for real, not by
  // construction.
  const qualityGate = run.decisionPacket?.evidence as { gates: Array<{ key: string; verdict: string }> } | undefined
  assert.equal(qualityGate?.gates.find((g) => g.key === 'QUALITY_GATE')?.verdict, 'PASS')
})

test('driveMetroLaunch: QUALITY_GATE genuinely FAILS the launch boundary when a duplicate slips into the canonical candidate set', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  scriptSynthetic(executor)

  const projectId = 'san-diego-leftover-duplicate-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN })

  // Simulate a duplicate slipping past dedupe (e.g. added by a process
  // that bypassed dedupeCandidates) directly into the persisted state,
  // then let the driver re-evaluate the boundary.
  const afterFirstPass = await runStore.get(playbookRunId('metro_launch', projectId))
  const state = afterFirstPass!.state as { candidates: Array<{ name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean }> }
  const dupe = { ...state.candidates[0], source: 'https://a-second-independent-source.example.com' }
  state.candidates = [...state.candidates, dupe]
  afterFirstPass!.currentStage = 'LAUNCH_READINESS_BOUNDARY'
  afterFirstPass!.status = 'RUNNING'
  await runStore.put(afterFirstPass!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN })
  const qualityGate = run.decisionPacket?.evidence as { gates: Array<{ key: string; verdict: string; reason: string }> } | undefined
  const result = qualityGate?.gates.find((g) => g.key === 'QUALITY_GATE')
  assert.equal(result?.verdict, 'FAIL')
  assert.match(result?.reason ?? '', /duplicate/)
})

// ---------------------------------------------------------------------------
// Structural bug fix, part 2 (San Diego run, 2026-09-05): CATEGORY_GATE
// and GEOGRAPHY_GATE at the launch boundary used to evaluate against a
// hardcoded `coverageGaps: []` — Carlsbad dropping to 4/5 after a real
// dedupe went completely undetected. stepLaunchBoundary now reuses
// buildAuditEvidence/auditCoverage (the SAME canonical-normalization
// path M4 uses), never a second free-text comparison.
// ---------------------------------------------------------------------------

function foodCandidate(name: string, neighborhood: string, categoryLabel = 'Food & drink') {
  return { name, category: categoryLabel, neighborhood, claimSupported: `${name} serves a real, specific dish`, source: `https://example.com/${name}`, needsVerification: true }
}

test('driveMetroLaunch: a plateaued district-depth gap (Carlsbad 4/5) self-relaxes instead of escalating, and the relaxation is recorded', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: ['placeholder'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )
  // M3 returns exactly 4 Carlsbad candidates and enough Downtown Food & drink to clear the category minimum.
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          candidates: [
            foodCandidate('Downtown1', 'Downtown'),
            foodCandidate('Downtown2', 'Downtown'),
            foodCandidate('Downtown3', 'Downtown'),
            foodCandidate('CarlsbadA', 'Carlsbad'),
            foodCandidate('CarlsbadB', 'Carlsbad'),
            foodCandidate('CarlsbadC', 'Carlsbad'),
            foodCandidate('CarlsbadD', 'Carlsbad'),
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )
  // M5 (targeted Carlsbad research) only ever re-discovers an EXISTING
  // candidate (dedupeCandidates collapses it, net zero new candidates) —
  // simulating a real gap loop that genuinely can't close, so the
  // guardrail trips instead of the depth target ever being satisfied.
  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [foodCandidate('CarlsbadA', 'Carlsbad')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 3, healthyTarget: 3, qualityNotes: [] }] }
  const projectId = 'san-diego-carlsbad-4of5-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, {
    categoryPlan: smallPlan,
    depthTargets: [{ neighborhoodName: 'Carlsbad', minimumItems: 5 }],
    maxSteps: 35,
  })

  // With only 4 Carlsbad candidates and every M5 pass re-discovering the
  // SAME existing one (a genuine plateau, not under-research), the
  // depth-target minimum self-relaxes from 5 to 4 instead of escalating
  // — the run proceeds all the way to the (always-escalating) launch
  // boundary, never gets stuck at M4, and the relaxation is a permanent,
  // recorded artifact.
  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.match(run.jerryReason ?? '', /launch-readiness boundary/)
  const state = run.state as { planRelaxations?: Array<{ kind: string; targetName: string; fromValue: string; toValue: string }> }
  assert.ok(state.planRelaxations?.some((r) => r.kind === 'DISTRICT_DEPTH' && r.targetName === 'Carlsbad' && r.fromValue === '5' && r.toValue === '4'), `expected a recorded Carlsbad depth relaxation, got: ${JSON.stringify(state.planRelaxations)}`)
  const packet = run.decisionPacket?.evidence as { gates: Array<{ key: string; verdict: string }> } | undefined
  const geoGate = packet?.gates.find((g) => g.key === 'GEOGRAPHY_GATE')
  assert.equal(geoGate?.verdict, 'PASS', 'the relaxed target is what the launch-boundary gate re-audits against, so it now genuinely passes')
})

test('driveMetroLaunch: launch-boundary GEOGRAPHY_GATE genuinely PASSES once a depth target reaches its minimum (Carlsbad 5/5)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          candidates: [
            foodCandidate('Downtown1', 'Downtown'),
            foodCandidate('Downtown2', 'Downtown'),
            foodCandidate('Downtown3', 'Downtown'),
            foodCandidate('CarlsbadA', 'Carlsbad'),
            foodCandidate('CarlsbadB', 'Carlsbad'),
            foodCandidate('CarlsbadC', 'Carlsbad'),
            foodCandidate('CarlsbadD', 'Carlsbad'),
            foodCandidate('CarlsbadE', 'Carlsbad'),
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: ['Downtown1', 'Downtown2', 'Downtown3', 'CarlsbadA', 'CarlsbadB', 'CarlsbadC', 'CarlsbadD', 'CarlsbadE'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 3, healthyTarget: 3, qualityNotes: [] }] }
  const projectId = 'san-diego-carlsbad-5of5-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, {
    categoryPlan: smallPlan,
    depthTargets: [{ neighborhoodName: 'Carlsbad', minimumItems: 5 }],
    maxSteps: 35,
  })

  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  const packet = run.decisionPacket?.evidence as { gates: Array<{ key: string; verdict: string; reason: string }> } | undefined
  const geoGate = packet?.gates.find((g) => g.key === 'GEOGRAPHY_GATE')
  assert.equal(geoGate?.verdict, 'PASS')
})

test('driveMetroLaunch: a category with genuinely zero real-world inventory (Sports, plateaued at 0) self-relaxes to its achieved count instead of escalating', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [foodCandidate('OnlyFood', 'Downtown')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [foodCandidate('OnlyFood', 'Downtown')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: ['OnlyFood'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const projectId = 'san-diego-category-fail-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  // Sports never gets a single real candidate — every M5 pass only
  // re-surfaces the unrelated existing Food & drink candidate, a genuine
  // plateau at 0. The category minimum self-relaxes to 0 instead of
  // escalating; Sports effectively drops out of the plan rather than
  // blocking the whole build or being backfilled with a fake Sports item.
  const impossiblePlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Sports', minimumViable: 5, healthyTarget: 5, qualityNotes: [] }] }
  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: impossiblePlan, maxSteps: 30 })

  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.match(run.jerryReason ?? '', /launch-readiness boundary/)
  const state = run.state as { planRelaxations?: Array<{ kind: string; targetName: string; fromValue: string; toValue: string }>; candidates?: Array<{ name: string }> }
  assert.ok(state.planRelaxations?.some((r) => r.kind === 'CATEGORY_MINIMUM' && r.targetName === 'Sports' && r.fromValue === '5' && r.toValue === '0'), `expected a recorded Sports minimum relaxation, got: ${JSON.stringify(state.planRelaxations)}`)
  // No fake Sports item was manufactured to hit the (now-relaxed) minimum.
  assert.ok(!state.candidates?.some((c) => c.name !== 'OnlyFood'), 'no filler candidate was invented for Sports')
})

test('driveMetroLaunch: launch-boundary CATEGORY_GATE evaluates NORMALIZED category counts, not raw free-text labels — the original San Diego false-zero bug, now checked at the boundary too', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          // Deliberately descriptive, non-canonical labels — exactly what real research_verifier output looks like.
          candidates: [
            foodCandidate('A', 'Downtown', 'Restaurant (Japanese/izakaya)'),
            foodCandidate('B', 'Downtown', 'Food Hall'),
            foodCandidate('C', 'Downtown', 'Café / coffee shop'),
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: ['A', 'B', 'C'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const projectId = 'san-diego-category-normalized-pass-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const plan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 3, healthyTarget: 3, qualityNotes: [] }] }
  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: plan, maxSteps: 30 })

  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  const packet = run.decisionPacket?.evidence as { gates: Array<{ key: string; verdict: string }> } | undefined
  assert.equal(packet?.gates.find((g) => g.key === 'CATEGORY_GATE')?.verdict, 'PASS')
})

// ---------------------------------------------------------------------------
// Resumability (spec section 2) — a fresh call against the SAME store
// resumes deterministically, never restarts from M1.
// ---------------------------------------------------------------------------

test('driveMetroLaunch: RESUME — a second call against the same run store continues from persisted state, never re-runs M1', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  scriptSynthetic(executor)
  const projectId = 'san-diego-resume-test'

  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  // First call: bounded to a handful of steps, simulating a process that
  // dies partway through (e.g. after M1 and M3, before M4 finishes).
  const partial = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN, maxSteps: 3 })
  assert.equal(partial.status, 'RUNNING')
  assert.notEqual(partial.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  const m1ExecutionIdUsed = executionId(playbookRunId('metro_launch', projectId), 'M1', m1GeographyExecutionLabel())
  assert.equal((await execStore.get(m1ExecutionIdUsed))?.status, 'COMPLETE')

  // Second call — a BRAND NEW driveMetroLaunch invocation, same stores,
  // simulating a process restart. Must resume, not restart from M1.
  const resumed = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN })
  assert.equal(resumed.status, 'NEEDS_JERRY')
  assert.equal(resumed.currentStage, 'LAUNCH_READINESS_BOUNDARY')

  // M1's execution was never re-created/re-run a second time — idempotent resume.
  const m1Executions = (await execStore.all()).filter((e) => e.request.stage === 'M1_GEOGRAPHY_MAP')
  assert.equal(m1Executions.length, 1)
})

// ---------------------------------------------------------------------------
// Runaway-loop guardrail (spec section 20)
// ---------------------------------------------------------------------------

test('driveMetroLaunch: a coverage gap that plateaus rather than closing self-relaxes and proceeds, never loops forever', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const shoplessPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Shopping', minimumViable: 4, healthyTarget: 8, qualityNotes: [] }] }

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 500, ring2RadiusM: 1500 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  // M3 seeds a single irrelevant (non-Shopping) candidate — non-empty
  // evidence (a real result was returned), but it does nothing for the
  // actual Shopping deficit.
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [food('FoodA', 'Downtown')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  // Every M5 Shopping-gap pass deliberately re-returns the SAME
  // already-known candidate — dedupe collapses it to nothing new, so the
  // Shopping gap can never close via more research. Proves the
  // loop-iteration guardrail still bounds M4<->M5 passes, but the
  // response to exhausting it is now self-relaxation, never an unbounded
  // loop AND never an immediate human escalation for what plan adaptation
  // can resolve on its own.
  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [food('FoodA', 'Downtown')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: ['FoodA'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const projectId = 'san-diego-runaway-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: shoplessPlan, maxSteps: 500 })

  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.match(run.jerryReason ?? '', /launch-readiness boundary/)
  assert.ok(run.loopIteration <= 6, 'the loop-iteration guardrail (default 5) must actually bound each round of M4<->M5 passes')
  const state = run.state as { planRelaxations?: Array<{ kind: string; targetName: string }>; planRelaxationRounds?: number }
  assert.ok(state.planRelaxations?.some((r) => r.kind === 'CATEGORY_MINIMUM' && r.targetName === 'Shopping'))
  assert.equal(state.planRelaxationRounds, 1, 'closed on the FIRST relaxation round — never needed the full relaxation-round budget')
})

test('driveMetroLaunch: a TRULY unsatisfiable metro (relaxation-round budget already exhausted) still escalates to NEEDS_JERRY — self-repair is bounded, not unlimited', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const shoplessPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Shopping', minimumViable: 4, healthyTarget: 8, qualityNotes: [] }] }

  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [food('FoodA', 'Downtown')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [food('FoodA', 'Downtown')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )

  const projectId = 'san-diego-truly-unsatisfiable-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  // Seeded already at the M4<->M5 loop, one relaxation round short of
  // the bound, with a category minimum that is ALSO already at 0 (i.e.
  // already relaxed as far as it can go) — simulating a run that has
  // genuinely been through the full self-repair budget for real. This
  // is the deterministic way to reach "relaxation budget exhausted" in
  // a unit test without needing dozens of real loop passes.
  seeded!.state = {
    m0Decisions: RESOLVED_M0,
    plan: { targets: [{ categoryName: 'Shopping', minimumViable: 1, healthyTarget: 8, qualityNotes: [] }] },
    neighborhoods: [],
    candidates: [],
    planRelaxationRounds: 3, // == DEFAULT_DRIVER_GUARDRAILS.maxPlanRelaxationRounds
    planRelaxations: [{ kind: 'CATEGORY_MINIMUM', targetName: 'Shopping', fromValue: '4', toValue: '1', reason: 'prior rounds (test fixture)', relaxedAtRound: 1 }],
  }
  seeded!.currentStage = 'M4_COVERAGE_AUDIT'
  seeded!.loopIteration = 5 // already at the per-round bound
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: shoplessPlan, maxSteps: 30 })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'M4_COVERAGE_AUDIT')
  assert.match(run.jerryReason ?? '', /genuine product decision/)
  const state = run.state as { planRelaxations?: unknown[] }
  assert.equal(state.planRelaxations?.length, 1, 'the escalation preserves the relaxation history already recorded — never discards it')
})

// ---------------------------------------------------------------------------
// Bounded retry (spec section 18/20) + executor-unavailable BLOCKED path
// ---------------------------------------------------------------------------

test('driveMetroLaunch: EXECUTOR_UNAVAILABLE blocks the run rather than NEEDS_JERRY or an infinite retry', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  executor.makeSpecialistUnavailable('research_verifier')

  const projectId = 'san-diego-unavailable-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN })
  assert.equal(run.status, 'BLOCKED')
  assert.equal(run.currentStage, 'M1_GEOGRAPHY_MAP')
})

test('driveMetroLaunch: a rejected evidence result retries up to the guardrail, then escalates — never advances on bad evidence', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  // Every M1 attempt returns an envelope MISSING the required evidence key.
  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: {}, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )

  const projectId = 'san-diego-bad-evidence-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN })
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.match(run.jerryReason ?? '', /evidence validation/)
  assert.ok(run.totalRetries > 0 && run.totalRetries <= 3, 'retries must be bounded, not infinite')
})

// ---------------------------------------------------------------------------
// Phase 2H — a real live-provider proof against OpenAI exposed that the
// M0 geographic-scope decision (including an explicitly flagged open
// question, e.g. "does North County belong in scope?") never reached the
// M1 research prompt at all, producing comparably-generic results. Fixed
// by threading state.m0Decisions.geographicScope into M1's request
// inputs — this test locks that in.
// ---------------------------------------------------------------------------

test('driveMetroLaunch: M1 request inputs carry the M0 geographicScope decision, so the research prompt can actually address it', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  let capturedGeographicScope: unknown = 'NEVER_CALLED'

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => {
      capturedGeographicScope = (r.inputs as { geographicScope?: unknown }).geographicScope
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
    }
  )

  const projectId = 'san-diego-geoscope-threading-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN, maxSteps: 2 })
  assert.equal(capturedGeographicScope, RESOLVED_M0.geographicScope)
})

// ---------------------------------------------------------------------------
// Structural bug fix regressions (San Diego run, 2026-09-05)
// ---------------------------------------------------------------------------

test('m1GeographyExecutionLabel: is stable (same call twice = same id, so normal idempotency is unaffected)', () => {
  assert.equal(m1GeographyExecutionLabel(), m1GeographyExecutionLabel())
  assert.match(m1GeographyExecutionLabel(), /^geography-contract-v\d+$/)
})

test('buildAuditEvidence: regression — real free-text categories from the San Diego run no longer produce false 0/minimum counts', () => {
  const state = {
    plan: PLAN, // Food & drink min 5, Shopping min 4
    neighborhoods: [],
    candidates: [
      { name: 'A', category: 'Restaurant (Japanese/izakaya)', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'B', category: 'Food Hall', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'C', category: 'Café / coffee shop', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'D', category: 'Restaurant (Mexican regional)', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'E', category: 'Taco shop', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'F', category: 'Shopping Mall', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'G', category: 'Outlet Center', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'H', category: 'Antique District', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'I', category: 'Shopping District', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
    ],
  }
  const { evidence, unclassifiedCategories } = buildAuditEvidence(state)
  const foodCount = evidence.categoryCounts.find((c) => c.categoryName === 'Food & drink')?.count ?? 0
  const shoppingCount = evidence.categoryCounts.find((c) => c.categoryName === 'Shopping')?.count ?? 0
  assert.equal(foodCount, 5, 'all 5 descriptive restaurant/food labels must normalize to Food & drink')
  assert.equal(shoppingCount, 4, 'all 4 descriptive shopping labels must normalize to Shopping')
  assert.equal(unclassifiedCategories.length, 0)

  // With the fix, auditCoverage sees real counts — neither category is falsely below minimum.
  const gaps = auditCoverage(evidence)
  assert.equal(gaps.some((g) => g.kind === 'CATEGORY_BELOW_MINIMUM'), false)
})

test('buildAuditEvidence: an unmappable category is reported as unclassified, never silently forced into a canonical bucket', () => {
  const state = {
    plan: PLAN,
    neighborhoods: [],
    candidates: [{ name: 'Z', category: 'Upscale Contemporary', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true }],
  }
  const { unclassifiedCategories } = buildAuditEvidence(state)
  assert.equal(unclassifiedCategories.length, 1)
  assert.equal(unclassifiedCategories[0].raw, 'Upscale Contemporary')
})

test('buildAuditEvidence: neighborhood counts use fuzzy substring matching, so "Carlsbad (North County)" counts toward a "Carlsbad" depth target', () => {
  const state = {
    plan: { targets: [] },
    neighborhoods: [],
    depthTargets: [{ neighborhoodName: 'Carlsbad', minimumItems: 5 }],
    candidates: [
      { name: 'A', category: 'Food & drink', neighborhood: 'Carlsbad (North County)', claimSupported: 'x', source: 'https://x', needsVerification: true },
      { name: 'B', category: 'Food & drink', neighborhood: 'Carlsbad', claimSupported: 'x', source: 'https://x', needsVerification: true },
    ],
  }
  const { evidence } = buildAuditEvidence(state)
  const carlsbadCount = evidence.neighborhoodCounts.find((n) => n.neighborhoodName === 'Carlsbad')?.count
  assert.equal(carlsbadCount, 2)
})

test('driveMetroLaunch: a configured depth target with only token coverage triggers real M5 targeted research (the Carlsbad/Oceanside "meaningful depth" fix)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const gapDepthRequests: unknown[] = []

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { neighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: {
          candidates: [
            { name: 'FoodA', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true },
            { name: 'ShopA', category: 'Shopping', neighborhood: 'Carlsbad', claimSupported: 'x', source: 'https://x', needsVerification: true }, // token coverage: 1 item
          ],
        },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES',
    (r) => {
      gapDepthRequests.push(r.inputs)
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { candidates: [{ name: 'CarlsbadFix', category: 'Shopping', neighborhood: 'Carlsbad', claimSupported: 'x', source: 'https://x', needsVerification: true }] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
    }
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: [] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const projectId = 'san-diego-depth-target-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const plan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }, { categoryName: 'Shopping', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }] }
  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: plan, depthTargets: [{ neighborhoodName: 'Carlsbad', minimumItems: 2 }], maxSteps: 30 }
  )

  assert.ok(gapDepthRequests.some((i) => JSON.stringify(i).includes('Carlsbad')), 'the depth-target gap must have triggered a real M5 targeted-research execution for Carlsbad')
  assert.equal(run.status, 'NEEDS_JERRY') // reaches the launch-readiness boundary, which always escalates
})

test('driveMetroLaunch: M1 output missing a valid neighborhood "kind" fails evidence validation and retries rather than silently disabling geographic-hole detection', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  let m1Attempts = 0

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => {
      m1Attempts += 1
      // Reproduces the real bug: a neighborhood record shaped like a candidate, missing `kind` entirely.
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { neighborhoods: [{ name: 'Oceanside', category: 'Coastal North County', source: 'https://x', claimSupported: 'x' }] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
    }
  )

  const projectId = 'san-diego-malformed-m1-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: PLAN, maxSteps: 30 })

  assert.ok(m1Attempts > 1, 'a malformed neighborhood must trigger at least one real retry, not be accepted on the first attempt')
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.match(run.jerryReason ?? '', /evidence validation/)
})

test('driveMetroLaunch: re-entering a stage whose execution is already COMPLETE (idempotent replay) is accepted, not retried and escalated', async () => {
  // Reproduces the real San Diego resume bug: after manually resetting
  // run.currentStage back to M1_GEOGRAPHY_MAP (to force fresh geography
  // research under the fixed prompt/validation) while M1's execution
  // record from the ORIGINAL run was already COMPLETE, runStepWithRetry
  // wrongly treated the idempotent-replay ExecutionRecord as a failure.
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  let m1CallCount = 0

  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => {
      m1CallCount += 1
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { neighborhoods: [{ name: 'Downtown', kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
    }
  )
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { candidates: [{ name: 'X', category: 'Food & drink', neighborhood: 'Downtown', claimSupported: 'x', source: 'https://x', needsVerification: true }] },
        methodologyId: 'metro_launch',
        methodologyVersion: 'v1',
      })
  )

  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: ['X'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }] }
  const projectId = 'san-diego-idempotent-resume-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  // First pass: drives all the way through M1 for real (COMPLETE recorded).
  await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: smallPlan, maxSteps: 2 })
  assert.equal(m1CallCount, 1)

  // Simulate the manual reset: back to M1, same executionId will be reused.
  const afterM1 = await runStore.get(playbookRunId('metro_launch', projectId))
  afterM1!.currentStage = 'M1_GEOGRAPHY_MAP'
  afterM1!.status = 'RUNNING'
  await runStore.put(afterM1!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }, projectId, { categoryPlan: smallPlan, maxSteps: 30 })

  assert.equal(m1CallCount, 1, 'the idempotent-COMPLETE execution must never be re-invoked — same executionId, same accepted result')
  // NEEDS_JERRY here is expected (the launch-readiness boundary always
  // escalates, by design) — what this test actually guards against is
  // escalating EARLIER, for the wrong reason (a retry-guardrail failure
  // on M1's idempotent replay).
  assert.doesNotMatch(run.jerryReason ?? '', /retry guardrail/)
  assert.match(run.jerryReason ?? '', /launch-readiness boundary/)
})

// ---------------------------------------------------------------------------
// ENSURE_METRO_PROJECT — Chief Phase 2X bootstrap step. Fakes throughout
// (no real DB) — mutations.test.ts's ensureProject tests cover the real
// idempotent-insert/reuse/fail-closed behavior against a real database;
// these tests prove the DRIVER actually calls it, with the right
// arguments, at the right time, on every entry (not just the first).
// ---------------------------------------------------------------------------

test('ensureMetroProject: a missing project is bootstrapped BEFORE M0 — before the run even exists in the store', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const calls: string[] = []

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [],
      ensureProject: async (input) => {
        calls.push(input.projectKey)
        // Bootstrap must happen before getOrCreateRun's first put() —
        // i.e. before ANY run record exists for this project yet.
        const existingRun = await runStore.get(playbookRunId('metro_launch', 'vienna-bootstrap-test'))
        assert.equal(existingRun, undefined, 'ensureProject must be called before the run record is first persisted')
        return { projectId: 'agent-projects-uuid-1', created: true }
      },
    },
    'vienna-bootstrap-test',
    { categoryPlan: PLAN }
  )

  assert.deepEqual(calls, ['vienna-bootstrap-test'])
  // M0 is unresolved (no m0Decisions seeded) -> escalates immediately,
  // proving no hidden "create a project row first" manual prerequisite:
  // the ONLY thing blocking this run is the ordinary M0 decision gate.
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.match(run.jerryReason ?? '', /M0 decisions are unresolved/)
})

test('ensureMetroProject: an existing project is reused, not recreated — driver behavior is identical either way', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  let createdFlag: boolean | null = null

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [],
      ensureProject: async () => {
        createdFlag = false // simulates a real DB reusing an existing row
        return { projectId: 'agent-projects-uuid-existing', created: false }
      },
    },
    'vienna-bootstrap-reuse-test',
    { categoryPlan: PLAN }
  )

  assert.equal(createdFlag, false)
  assert.equal(run.status, 'NEEDS_JERRY') // same M0 gate — bootstrap outcome never changes driver behavior
})

test('ensureMetroProject: a resumed run calls bootstrap again on every entry, but it stays idempotent — no duplicate project is ever created', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const projectId = 'vienna-bootstrap-resume-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  let bootstrapCalls = 0
  const deps = {
    runStore,
    execStore,
    executors: [],
    placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }),
    geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
    verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
    checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
    // Simulates a real ensureProject's idempotency: created only the first time.
    ensureProject: async () => {
      bootstrapCalls += 1
      return { projectId: 'agent-projects-uuid-resume', created: bootstrapCalls === 1 }
    },
  }

  // maxSteps: 1 forces multiple separate driveMetroLaunch invocations —
  // each one is a fresh "entry" into the driver, exactly like a resumed
  // CLI run after a process restart.
  await driveMetroLaunch(deps, projectId, { categoryPlan: PLAN, maxSteps: 1 })
  await driveMetroLaunch(deps, projectId, { categoryPlan: PLAN, maxSteps: 1 })
  await driveMetroLaunch(deps, projectId, { categoryPlan: PLAN, maxSteps: 1 })

  assert.ok(bootstrapCalls >= 3, 'bootstrap runs on every entry to the driver')
  // The real duplicate-prevention guarantee (DB-level, ON CONFLICT DO
  // NOTHING) is proven directly against a real database in
  // mutations.test.ts — what matters here is that the driver passes the
  // exact SAME projectKey every time, which is what makes that DB-level
  // idempotency actually apply. bootstrapCalls > 1 with no error and no
  // divergent projectId is exactly the expected, safe steady state.
})

test('ensureMetroProject: an ambiguous/wrong project type fails closed — the driver never swallows the error', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()

  await assert.rejects(
    () =>
      driveMetroLaunch(
        {
          runStore,
          execStore,
          executors: [],
          ensureProject: async () => {
            throw new Error("Idempotency conflict (project vienna-bootstrap-conflict-test): existing project_type 'DESTINATION_HUB' differs from requested 'METRO'")
          },
        },
        'vienna-bootstrap-conflict-test',
        { categoryPlan: PLAN }
      ),
    /existing project_type 'DESTINATION_HUB' differs from requested 'METRO'/
  )

  // No run record was ever persisted — the failure happened before
  // getOrCreateRun's first put(), so there is nothing partially created
  // to clean up.
  const run = await runStore.get(playbookRunId('metro_launch', 'vienna-bootstrap-conflict-test'))
  assert.equal(run, undefined)
})

// ---------------------------------------------------------------------------
// International geo defaults (Chief Phase 2Y) — expectedCountry/
// metroCenterBias must derive from THIS metro's own resolved M0
// decisions (metroCountry/metroCenter), never a hardcoded 'US' default.
// No deps.expectedCountry/deps.metroCenterBias override is passed in
// either test below — proving the value genuinely comes from
// state.m0Decisions, not a lingering test convenience.
// ---------------------------------------------------------------------------

function scriptThroughM8(executor: TestExecutor, candidateName: string, neighborhood: string) {
  executor.scriptWhen(
    (r) => r.stage === 'M1_GEOGRAPHY_MAP',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { neighborhoods: [{ name: neighborhood, kind: 'core_urban', ring1RadiusM: 1500, ring2RadiusM: 3000 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M3_BROAD_DISCOVERY',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [foodCandidate(candidateName, neighborhood)] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_QUALITY_VERIFICATION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { verifiedCandidateNames: [candidateName] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: `Order the 'signature item' at '${(r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace}'.`, tags: ['tag-a', 'tag-b', 'tag-c', 'tag-d', 'tag-e', 'tag-f'], canonicalVenueUsed: (r.inputs as { canonicalVenueName?: string; businessOrPlace?: string }).canonicalVenueName ?? (r.inputs as { businessOrPlace?: string }).businessOrPlace }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )
}

test('driveMetroLaunch: a US metro (metroCountry "US") resolves geo enrichment against a US Places result as EXACT — the ordinary, already-covered case', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  scriptThroughM8(executor, 'DowntownDiner', 'Downtown')

  const projectId = 'us-metro-country-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 } // metroCountry: 'US', metroCenter: San Diego
  await runStore.put(seeded!)

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }] }
  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      // NO expectedCountry/metroCenterBias override — must come from state.m0Decisions.
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p-us', name: 'DowntownDiner', formattedAddress: q, lat: 32.7, lng: -117.1, websiteUri: 'https://example.com', country: 'US', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: smallPlan, maxSteps: 30 }
  )

  const state = run.state as { geoEnrichmentResults?: Array<{ candidateName: string; classification: string }> }
  const result = state.geoEnrichmentResults?.find((r) => r.candidateName === 'DowntownDiner')
  assert.equal(result?.classification, 'EXACT', `expected EXACT, got ${JSON.stringify(state.geoEnrichmentResults)}`)
})

test('driveMetroLaunch: M10 summary.geoCoveragePercent/geoExceptionsCount are really derived from geoEnrichmentResults, not the old hardcoded 0/certified.length', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  scriptThroughM8(executor, 'DowntownDiner', 'Downtown')

  const projectId = 'geo-coverage-percent-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 } // metroCountry: 'US', metroCenter: San Diego
  await runStore.put(seeded!)

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }] }
  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      // A confidently-matched EXACT result — the single certified item
      // here must be reflected as 100% geo coverage, zero exceptions,
      // never the old hardcoded 0%/1 (certified.length).
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p-us', name: 'DowntownDiner', formattedAddress: q, lat: 32.7, lng: -117.1, websiteUri: 'https://example.com', country: 'US', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Downtown'], emptyNeighborhoodFallbackCentroids: { Downtown: { lat: 32.7, lng: -117.1 } },
    },
    projectId,
    { categoryPlan: smallPlan, maxSteps: 30 }
  )

  const state = run.state as { finalCertificationReport?: { summary: { catalogCount: number; geoCoveragePercent: number; geoExceptionsCount: number } } }
  const summary = state.finalCertificationReport?.summary
  assert.ok(summary, `expected M10 to have produced a finalCertificationReport, got run.status=${run.status} jerryReason=${run.jerryReason}`)
  assert.equal(summary!.catalogCount, 1)
  assert.equal(summary!.geoCoveragePercent, 100, `expected 100% coverage for a single EXACT-classified certified item, got ${JSON.stringify(summary)}`)
  assert.equal(summary!.geoExceptionsCount, 0, `expected zero NO_CANONICAL_VENUE exceptions, got ${JSON.stringify(summary)}`)
})

test('driveMetroLaunch: a non-US metro (Vienna, metroCountry "AT") resolves geo enrichment against an AT Places result as EXACT — no US default leaks into international matching', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  scriptThroughM8(executor, 'CafeWien', 'Innere Stadt')

  const projectId = 'at-metro-country-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: { ...RESOLVED_M0, metroCountry: 'AT', metroCenter: { lat: 48.2082, lng: 16.3738 } } }
  await runStore.put(seeded!)

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }] }
  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      // NO expectedCountry/metroCenterBias override — a bug here would
      // default to 'US' and misclassify this AT result as a country
      // mismatch (REJECTED_WRONG_MATCH), exactly the real Vienna defect.
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p-at', name: 'CafeWien', formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: 'https://example.at', country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: smallPlan, maxSteps: 30 }
  )

  const state = run.state as { geoEnrichmentResults?: Array<{ candidateName: string; classification: string }> }
  const result = state.geoEnrichmentResults?.find((r) => r.candidateName === 'CafeWien')
  assert.equal(result?.classification, 'EXACT', `expected EXACT (not a country-mismatch rejection), got ${JSON.stringify(state.geoEnrichmentResults)}`)
})

test('m0DecisionsResolved: missing metroCountry or metroCenter resolves false — no metro can start M1 research without its own real geography identity', () => {
  const { metroCountry, ...withoutCountry } = RESOLVED_M0
  assert.equal(m0DecisionsResolved(withoutCountry), false)
  const { metroCenter, ...withoutCenter } = RESOLVED_M0
  assert.equal(m0DecisionsResolved(withoutCenter), false)
  assert.equal(m0DecisionsResolved({ ...RESOLVED_M0, metroCenter: { lat: 48.2, lng: NaN as unknown as number } }), true) // NaN is still typeof 'number' — a distinct, not-this-function's-job validation concern
})

// ---------------------------------------------------------------------------
// Canonical venue identity (Chief Phase 2Z) — the Vienna 1/450
// certification regression. VENUE_QUOTING_GATE was validating against
// the raw M3 discovery label instead of a resolved canonical venue
// name; these tests exercise the REAL driver (M6.5 write -> M7
// critique/rewrite) end to end, not just the pure canonicalVenueName.ts
// unit tests.
// ---------------------------------------------------------------------------

async function seedForM7(
  runStore: InstanceType<typeof InMemoryPlaybookRunStore>,
  projectId: string,
  candidate: { name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean },
  item: { name: string; checkoffizedItem: string; tags: string[]; canonicalVenueName: string }
) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0, candidates: [candidate], checkoffizedItems: [item], neighborhoods: [], plan: PLAN, hasRunM6: true }
  seeded!.currentStage = 'M7_ITEM_CERTIFICATION'
  await runStore.put(seeded!)
}

function bundledCandidate(claimSupported = 'The Spanish Riding School performs a real, specific Lipizzaner dressage routine most mornings.') {
  return {
    name: 'Hofburg Palace Complex (incl. Sisi Museum, Spanish Riding School)',
    category: 'Arts & Culture',
    neighborhood: 'Innere Stadt',
    claimSupported,
    source: 'https://example.com/hofburg',
    needsVerification: false,
  }
}

test('driveMetroLaunch: a bundled discovery label certifies when the body quotes the RESOLVED canonical alternative — the compound label is never required verbatim', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const candidate = bundledCandidate()
  const item = { name: candidate.name, checkoffizedItem: "Watch the Lipizzaner stallions train at 'Spanish Riding School'.", tags: ['t1', 't2', 't3', 't4', 't5', 't6'], canonicalVenueName: 'Spanish Riding School' }

  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const projectId = 'vienna-bundled-venue-certifies'
  await seedForM7(runStore, projectId, candidate, item)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: PLAN, maxSteps: 5 }
  )

  const state = run.state as { itemCertifications: Record<string, { outcome: string; venueName: string; rejectionReasons: string[] }> }
  const cert = state.itemCertifications[candidate.name]
  assert.equal(cert.outcome, 'ITEM_CERTIFIED', `expected certified, got: ${JSON.stringify(cert)}`)
  assert.equal(cert.venueName, 'Spanish Riding School', 'certified against the resolved alternative, never the compound discovery label')
  // Never required the parenthetical discovery metadata in the final copy.
  assert.equal(cert.rejectionReasons.length, 0)
})

test('driveMetroLaunch: the SAME bundled item fails venue quoting when the body does not contain the canonical name quoted — deterministic, never fuzzy', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const candidate = bundledCandidate()
  // Body never wraps ANY canonical option in single quotes.
  const item = { name: candidate.name, checkoffizedItem: 'Watch the Lipizzaner stallions train at the Spanish Riding School.', tags: ['t1', 't2', 't3', 't4', 't5', 't6'], canonicalVenueName: 'Hofburg Palace Complex' }

  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'REWRITE',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { checkoffizedItem: 'Watch the Lipizzaner stallions train at the Spanish Riding School, still unquoted.', tags: ['t1', 't2', 't3', 't4', 't5', 't6'], canonicalVenueUsed: 'Hofburg Palace Complex' }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )

  const projectId = 'vienna-bundled-venue-unquoted-fails'
  await seedForM7(runStore, projectId, candidate, item)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: PLAN, maxSteps: 5 }
  )

  const state = run.state as { itemCertifications: Record<string, { outcome: string; rejectionReasons: string[] }> }
  const cert = state.itemCertifications[candidate.name]
  assert.equal(cert.outcome, 'EXHAUSTED_RETRIES')
  assert.ok(cert.rejectionReasons.some((r) => r.includes('destination venue wrapped in single quotes')), `expected a quoting failure, got: ${JSON.stringify(cert.rejectionReasons)}`)
})

test('driveMetroLaunch: 429/infra failures during critique are retried and do NOT consume an editorial content-repair attempt', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl serves a real, specific Sperl Torte.', source: 'https://example.com/sperl', needsVerification: false }
  const item = { name: candidate.name, checkoffizedItem: "Order the 'Sperl Torte' at 'Cafe Sperl'.", tags: ['t1', 't2', 't3', 't4', 't5', 't6'], canonicalVenueName: 'Cafe Sperl' }

  let critiqueDispatches = 0
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) => {
      critiqueDispatches += 1
      // First 2 dispatches for this SAME executionId simulate a
      // provider/network failure (surfaces as EXECUTOR_UNAVAILABLE,
      // exactly like an OpenAI 429 after OpenAiAdapter's own retries are
      // exhausted); the 3rd genuinely succeeds.
      if (critiqueDispatches <= 2) return { unavailable: true, reason: 'openai: OpenAI Responses API returned 429 after 6 retries: rate limited' }
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
    }
  )

  const projectId = 'vienna-infra-retry-no-attempt-consumed'
  await seedForM7(runStore, projectId, candidate, item)

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
      sleepImpl: async () => {}, // instant — the retry COUNT is under test, not real backoff timing
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 5 }
  )

  assert.equal(critiqueDispatches, 3, '2 infra failures + 1 real dispatch — proves the infra retry actually happened')
  const state = run.state as { itemCertifications: Record<string, { outcome: string; attempts: number }> }
  const cert = state.itemCertifications[candidate.name]
  assert.equal(cert.outcome, 'ITEM_CERTIFIED')
  assert.equal(cert.attempts, 1, 'the 2 infra failures must NOT count as editorial content-repair attempts — only 1 real attempt was ever graded')
})

test('driveMetroLaunch: three genuine bad editorial bodies still exhaust the content retry limit — infra-retry exemption never becomes unlimited retries', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl serves a real, specific Sperl Torte.', source: 'https://example.com/sperl', needsVerification: false }
  const item = { name: candidate.name, checkoffizedItem: 'Visit Cafe Sperl, a nice coffeehouse.', tags: ['t1', 't2', 't3', 't4', 't5', 't6'], canonicalVenueName: 'Cafe Sperl' }

  let critiqueCalls = 0
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) => {
      critiqueCalls += 1
      // Genuinely, repeatedly generic — every real content attempt fails.
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: false, moreSpecificThanVenuePurpose: false, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: false, soundsLikeCheckoff: false, concise: true, critiqueNotes: 'still generic, venue-level' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
    }
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'REWRITE',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { checkoffizedItem: 'Visit Cafe Sperl again, still generic.', tags: ['t1', 't2', 't3', 't4', 't5', 't6'], canonicalVenueUsed: 'Cafe Sperl' }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )

  const projectId = 'vienna-genuine-repeated-failure-exhausts'
  await seedForM7(runStore, projectId, candidate, item)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } }, sleepImpl: async () => {} },
    projectId,
    { categoryPlan: PLAN, maxSteps: 5 }
  )

  assert.equal(critiqueCalls, MAX_ITEM_CERTIFICATION_ATTEMPTS, 'exactly 3 genuine content critique passes — never more, never fewer')
  const state = run.state as { itemCertifications: Record<string, { outcome: string; attempts: number }> }
  const cert = state.itemCertifications[candidate.name]
  assert.equal(cert.outcome, 'EXHAUSTED_RETRIES')
  assert.equal(cert.attempts, MAX_ITEM_CERTIFICATION_ATTEMPTS)
})

test('driveMetroLaunch: a single candidate that genuinely exhausts M6.5 write-evidence retries is REJECTED and recorded — never escalates the whole metro build to NEEDS_JERRY for one isolated failure', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const goodCandidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl serves a real, specific Sperl Torte.', source: 'https://example.com/sperl', needsVerification: false }
  const badCandidate = { name: 'Thin Source Museum', category: 'Arts & Culture', neighborhood: 'Innere Stadt', claimSupported: 'Exists.', source: 'https://example.com/thin', needsVerification: false }

  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR',
    (r) => {
      const venue = (r.inputs as { canonicalVenueName?: string }).canonicalVenueName ?? ''
      if (venue === 'Thin Source Museum') {
        // Genuinely, repeatedly missing `tags` — a real evidence-shape failure, never a rate limit.
        return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'Exists.', checkoffizedItem: 'Nothing specific to say.', canonicalVenueUsed: venue }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
      }
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: (r.inputs as { factualSource?: string }).factualSource ?? '', checkoffizedItem: `Order the 'Sperl Torte' at '${venue}'.`, tags: ['t1', 't2', 't3', 't4', 't5', 't6'], canonicalVenueUsed: venue }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )
  executor.scriptWhen(
    (r) => r.stage === 'M7_ITEM_CERTIFICATION' && (r.inputs as { mode?: string }).mode === 'CRITIQUE',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { hasConcreteAction: true, moreSpecificThanVenuePurpose: true, supportedByResearch: true, isCurrent: true, tellsUsefulNonObviousDetail: true, soundsLikeCheckoff: true, concise: true, critiqueNotes: 'ok' },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
      })
  )

  const projectId = 'vienna-isolated-write-failure-rejected'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0, candidates: [goodCandidate, badCandidate], neighborhoods: [], plan: PLAN, hasRunM6: true }
  seeded!.currentStage = 'M6_5_CHECKOFF_EDITOR'
  await runStore.put(seeded!)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: PLAN, maxSteps: 10 }
  )

  const state = run.state as {
    checkoffizedItems: Array<{ name: string }>
    editorRejectedCandidates: Array<{ name: string; reason: string }>
    itemCertifications: Record<string, { outcome: string }>
  }
  assert.deepEqual(
    state.editorRejectedCandidates.map((c) => c.name),
    ['Thin Source Museum']
  )
  assert.match(state.editorRejectedCandidates[0].reason, /tags/)
  assert.ok(state.checkoffizedItems.some((i) => i.name === 'Cafe Sperl'), 'the good candidate is never held back by the bad one')
  assert.equal(state.itemCertifications['Cafe Sperl']?.outcome, 'ITEM_CERTIFIED')
  assert.equal(state.itemCertifications['Thin Source Museum'], undefined, 'the rejected candidate never reaches M7 at all')
  // The run must have PROGRESSED, never stopped at M6.5 with NEEDS_JERRY over one isolated failure.
  assert.notEqual(run.currentStage, 'M6_5_CHECKOFF_EDITOR')
})

// ---------------------------------------------------------------------------
// M7.5 TAG_ASSIGNMENT (Chief Phase 2AA) — a dedicated stage, decoupled
// from M6.5/M7 editorial writing. Vienna certified 299 real items whose
// bodies must never be re-spent just to fix tags.
// ---------------------------------------------------------------------------

const TEST_TAG_VOCAB: VerifiedTagSnapshot = {
  version: 1,
  capturedAt: '2026-09-09',
  justification: 'test fixture standing in for a real captured production tag export',
  tagNames: ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'museum', 'hidden gem', 'wine', 'dessert', 'art', 'classical music', 'palace', 'garden'],
}

async function seedForTagAssignment(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, candidate: { name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean }, cert: DriverItemCertificationRecord) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0, candidates: [candidate], neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: { [cert.candidateName]: cert } }
  seeded!.currentStage = 'M7_5_TAG_ASSIGNMENT'
  await runStore.put(seeded!)
}

test('driveMetroLaunch: TAG_ASSIGNMENT replaces finalTags on an already-certified item without touching finalBody/outcome — the editorial artifact is never re-spent', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl is a historic Vienna coffeehouse serving a real Sperl Torte.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = {
    candidateName: 'Cafe Sperl',
    venueName: 'Cafe Sperl',
    attempts: 1,
    outcome: 'ITEM_CERTIFIED',
    finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.",
    finalTags: ['invented-tag-a', 'invented-tag-b'], // exactly the Vienna bug: whatever the write call guessed
    supportingFact: candidate.claimSupported,
    verifiedAt: '2026-09-09T00:00:00.000Z',
    rejectionReasons: [],
  }

  let editorialCallsMade = 0
  executor.scriptWhen(
    (r) => r.stage === 'M6_5_CHECKOFF_EDITOR' || r.stage === 'M7_ITEM_CERTIFICATION',
    () => {
      editorialCallsMade += 1
      throw new Error('editorial stages must never be re-invoked by a tag repair')
    }
  )
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: shortlist.slice(0, 6) }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )

  const projectId = 'vienna-tag-repair-preserves-body'
  await seedForTagAssignment(runStore, projectId, candidate, cert)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], verifiedTagSnapshot: TEST_TAG_VOCAB, placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: PLAN, maxSteps: 10 }
  )

  assert.equal(editorialCallsMade, 0, 'the editorial write/critique stages were never re-invoked')
  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord> }
  const updated = state.itemCertifications['Cafe Sperl']
  assert.equal(updated.finalBody, "Order the 'Sperl Torte' at 'Cafe Sperl'.", 'body untouched')
  assert.equal(updated.outcome, 'ITEM_CERTIFIED', 'outcome untouched')
  assert.equal(updated.attempts, 1, 'editorial attempt count untouched')
  assert.notDeepEqual(updated.finalTags, ['invented-tag-a', 'invented-tag-b'])
  for (const t of updated.finalTags) assert.ok(TEST_TAG_VOCAB.tagNames.includes(t), `tag "${t}" must be from the real canonical vocabulary`)
  assert.ok(updated.finalTags.length >= 6 && updated.finalTags.length <= 8)
})

test('driveMetroLaunch: TAG_ASSIGNMENT rejects a tag outside the supplied shortlist and retries ONLY the tagging call, bounded', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl is a historic Vienna coffeehouse.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: [], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  let tagCalls = 0
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      tagCalls += 1
      if (tagCalls === 1) {
        // Invents a tag not in the shortlist — must never be accepted.
        return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: ['invented-not-in-shortlist', 'coffee', 'historic', 'wine', 'dessert', 'art'] }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
      }
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: shortlist.slice(0, 6) }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )

  const projectId = 'vienna-tag-repair-rejects-invented'
  await seedForTagAssignment(runStore, projectId, candidate, cert)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], verifiedTagSnapshot: TEST_TAG_VOCAB, placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: PLAN, maxSteps: 10 }
  )

  assert.equal(tagCalls, 2, 'the invented-tag attempt was retried exactly once more, not accepted, not treated as permanently failed')
  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord> }
  const updated = state.itemCertifications['Cafe Sperl']
  assert.ok(!updated.finalTags.includes('invented-not-in-shortlist'))
  for (const t of updated.finalTags) assert.ok(TEST_TAG_VOCAB.tagNames.includes(t))
})

test('driveMetroLaunch: TAG_ASSIGNMENT exhausts its own bounded retry budget on repeated invalid selections — never falls back to inventing/accepting an invalid set', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl is a historic Vienna coffeehouse.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: [], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  let tagCalls = 0
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      tagCalls += 1
      // Only 2 tags, every time — genuinely, repeatedly invalid (below the 6 minimum).
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: ['coffee', 'historic'] }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )

  const projectId = 'vienna-tag-repair-exhausts'
  await seedForTagAssignment(runStore, projectId, candidate, cert)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], verifiedTagSnapshot: TEST_TAG_VOCAB, placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: PLAN, maxSteps: 10 }
  )

  // M7.5's own bounded loop exhausts at MAX_TAG_ASSIGNMENT_ATTEMPTS, then
  // M8 routes the still-invalid item to M8.5 CATALOG_PRUNING, which makes
  // ONE more bounded attempt series (a genuinely NEW attempt series, not
  // an idempotent replay — see assignTagsForOneItem's labelPrefix) before
  // giving up and dropping the item (Chief Phase 2AD, 2026-09-09
  // instruction: never hand a thin/unresolved item to Jerry in bulk).
  assert.equal(tagCalls, MAX_TAG_ASSIGNMENT_ATTEMPTS * 2, `bounded at exactly ${MAX_TAG_ASSIGNMENT_ATTEMPTS} original attempts plus ${MAX_TAG_ASSIGNMENT_ATTEMPTS} M8.5 repair attempts, never unlimited`)
  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord>; tagAssignmentResults: Record<string, { tags: string[] | null }> }
  assert.equal(state.tagAssignmentResults['Cafe Sperl'].tags, null, 'exhausted — no invalid set is ever silently accepted')
  assert.equal(state.itemCertifications['Cafe Sperl'].outcome, 'REJECTED_INSUFFICIENT_TAG_CONTEXT', 'a tag-only failure that survives even the M8.5 widened-shortlist repair attempt is dropped from the catalog, never left as a silent ITEM_CERTIFIED with invalid tags and never sent to Jerry for bulk review')
})

test('driveMetroLaunch: TAG_ASSIGNMENT infra failures (429) are retried and do NOT consume a tag-selection attempt', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl is a historic Vienna coffeehouse.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: [], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  let dispatches = 0
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      dispatches += 1
      if (dispatches <= 2) return { unavailable: true, reason: 'openai: 429 rate limited' }
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: shortlist.slice(0, 6) }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )

  const projectId = 'vienna-tag-repair-infra-retry'
  await seedForTagAssignment(runStore, projectId, candidate, cert)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], verifiedTagSnapshot: TEST_TAG_VOCAB, placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } }, sleepImpl: async () => {} },
    projectId,
    { categoryPlan: PLAN, maxSteps: 10 }
  )

  assert.equal(dispatches, 3, '2 infra failures + 1 real dispatch')
  const state = run.state as { tagAssignmentResults: Record<string, { tags: string[] | null; attempts: number }> }
  assert.equal(state.tagAssignmentResults['Cafe Sperl'].attempts, 1, 'infra retries never counted as a real tag-selection attempt')
  assert.ok(state.tagAssignmentResults['Cafe Sperl'].tags !== null)
})

// ---------------------------------------------------------------------------
// Cost/usage instrumentation (Chief Phase 2Z — multiple real OpenAI
// usage alerts during the Vienna run).
// ---------------------------------------------------------------------------

test('driveMetroLaunch: real provider usage is accumulated per stage, and infra retries are tracked separately from a fresh acceptance', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl serves a real, specific Sperl Torte.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: [], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  let tagDispatches = 0
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      tagDispatches += 1
      if (tagDispatches === 1) return { unavailable: true, reason: 'openai: 429 rate limited' }
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { tags: shortlist.slice(0, 6) },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
        providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 500, outputTokens: 100, totalTokens: 600, costUsd: 0.0018, pricingVersion: '2026-09-08', available: true },
      })
    }
  )

  const projectId = 'vienna-usage-instrumentation'
  await seedForTagAssignment(runStore, projectId, candidate, cert)

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], verifiedTagSnapshot: TEST_TAG_VOCAB, placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } }, sleepImpl: async () => {} },
    projectId,
    { categoryPlan: PLAN, maxSteps: 10 }
  )

  const state = run.state as {
    usageByStage: Record<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number; unknownCostCalls: number }>
    infraRetriesByStage: Record<string, number>
  }
  const tagUsage = state.usageByStage['M7_5_TAG_ASSIGNMENT']
  assert.equal(tagUsage.calls, 1, 'the infra-failed attempt is never counted as a real usage-recording call — only the genuine acceptance is')
  assert.equal(tagUsage.inputTokens, 500)
  assert.equal(tagUsage.outputTokens, 100)
  assert.ok(Math.abs(tagUsage.costUsd - 0.0018) < 1e-9)
  assert.equal(state.infraRetriesByStage['M7_5_TAG_ASSIGNMENT'], 1, 'exactly one infra retry was recorded')
})

test('driveMetroLaunch: an idempotent-replay acceptance (already COMPLETE) never double-counts usage', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl serves a real, specific Sperl Torte.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: [], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      const shortlist = (r.inputs as { shortlist?: string[] }).shortlist ?? []
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { tags: shortlist.slice(0, 6) },
        methodologyId: 'checkoff_editor',
        methodologyVersion: 'v1',
        providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 500, outputTokens: 100, totalTokens: 600, costUsd: 0.0018, pricingVersion: '2026-09-08', available: true },
      })
    }
  )

  const projectId = 'vienna-usage-no-double-count'
  await seedForTagAssignment(runStore, projectId, candidate, cert)
  const deps = { runStore, execStore, executors: [executor], verifiedTagSnapshot: TEST_TAG_VOCAB, placesLookup: async () => ({ topResult: null, apiError: 'no network access in tests' }), geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(), verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } }

  await driveMetroLaunch(deps, projectId, { categoryPlan: PLAN, maxSteps: 10 })

  // Force a re-entry into M7.5 for the SAME item — clearing
  // tagAssignmentResults (but NOT the execStore, which still holds the
  // original COMPLETE execution record under the same deterministic
  // executionId) reproduces exactly the idempotent-replay path: the
  // driver dispatches the "same" attempt-1 request again, and
  // runExecution returns the already-COMPLETE record rather than
  // re-invoking the executor.
  const stored = await runStore.get(playbookRunId('metro_launch', projectId))
  stored!.state = { ...stored!.state, tagAssignmentResults: {} }
  stored!.currentStage = 'M7_5_TAG_ASSIGNMENT'
  stored!.status = 'RUNNING'
  await runStore.put(stored!)

  const finalRun = await driveMetroLaunch(deps, projectId, { categoryPlan: PLAN, maxSteps: 10 })

  const state = finalRun.state as { usageByStage: Record<string, { calls: number }> }
  assert.equal(state.usageByStage['M7_5_TAG_ASSIGNMENT']?.calls, 1, 'a second driveMetroLaunch call against the SAME completed state must not re-record usage')
})

// ---------------------------------------------------------------------------
// M8.5 CATALOG_PRUNING (Chief Phase 2AD, 2026-09-09 instruction) — a
// catalog-wide TAG/METADATA/GEO gate FAIL is never handed to Jerry as a
// bulk review. Each failing item gets exactly ONE bounded repair-or-drop
// decision: TAG failures get a genuinely NEW widened-shortlist attempt
// series; METADATA/GEO failures with real evidence already exhausted at
// M8 are dropped directly; a GEO failure with NO real Places evidence at
// all (an apiError/never-enriched case) is left untouched rather than
// silently dropped, since there is nothing there to have judged.
// ---------------------------------------------------------------------------

async function seedForBatchCertification(
  runStore: InstanceType<typeof InMemoryPlaybookRunStore>,
  projectId: string,
  candidates: Array<{ name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean }>,
  certs: Record<string, DriverItemCertificationRecord>
) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0, candidates, neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: certs }
  seeded!.currentStage = 'M8_BATCH_CERTIFICATION'
  await runStore.put(seeded!)
}

test('driveMetroLaunch: M8.5 drops a TAG_CERTIFICATION_GATE failure only after a genuinely NEW widened-shortlist repair attempt fails too — never a silent idempotent replay', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: ['coffee', 'historic'] }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl is a historic Vienna coffeehouse.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: ['coffee', 'historic'], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  const projectId = 'vienna-m85-tag-drop'
  await seedForBatchCertification(runStore, projectId, [candidate], { [cert.candidateName]: cert })

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p1', name: 'Cafe Sperl', formattedAddress: q, lat: 48.2, lng: 16.36, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 15 }
  )

  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord>; catalogPruningDrops?: Array<{ candidateName: string; reason: string }> }
  assert.equal(state.itemCertifications['Cafe Sperl'].outcome, 'REJECTED_INSUFFICIENT_TAG_CONTEXT', 'starting finalTags had only 2 (below the 6 minimum) and no fake response was scripted for TAG_SELECTION, so both the original and the M8.5 repair series exhaust — dropped, never left invalid, never escalated to Jerry')
  assert.ok(state.catalogPruningDrops?.some((d) => d.candidateName === 'Cafe Sperl' && d.reason === 'REJECTED_INSUFFICIENT_TAG_CONTEXT'))
})

test('driveMetroLaunch: M8.5 repairs a TAG_CERTIFICATION_GATE failure when the widened-shortlist attempt now succeeds — item stays certified, body untouched', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl is a historic Vienna coffeehouse.', source: 'https://example.com/sperl', needsVerification: false }
  const originalBody = "Order the 'Sperl Torte' at 'Cafe Sperl'."
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: originalBody, finalTags: ['coffee', 'historic'], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  const projectId = 'vienna-m85-tag-repair'
  await seedForBatchCertification(runStore, projectId, [candidate], { [cert.candidateName]: cert })

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p1', name: 'Cafe Sperl', formattedAddress: q, lat: 48.2, lng: 16.36, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 15 }
  )

  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord>; catalogPruningRepairs?: Array<{ candidateName: string; repaired: string }> }
  const rec = state.itemCertifications['Cafe Sperl']
  assert.equal(rec.outcome, 'ITEM_CERTIFIED', 'a repaired tag set keeps the item certified')
  assert.equal(rec.finalBody, originalBody, 'M8.5 tag repair never touches the already-certified editorial body')
  assert.ok(rec.finalTags.length >= 6 && rec.finalTags.length <= 8, 'the widened-shortlist repair produced a valid 6-8 tag set')
  assert.ok(state.catalogPruningRepairs?.some((r) => r.candidateName === 'Cafe Sperl' && r.repaired === 'TAGS'))
})

test('driveMetroLaunch: M8.5 drops a GEO_ENRICHMENT_GATE failure only when a REAL Places result was actually evaluated (an ambiguous/rejected match) — never a bare apiError/no-result case', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  // Three candidates: one whose Places lookup returns a real but
  // genuinely unmatched result (should DROP), one whose search genuinely
  // completed and found nothing at all — a true zero-result response,
  // no apiError (should ALSO DROP — the check ran and found no venue),
  // and one whose lookup fails entirely with an infra error (should be
  // LEFT UNTOUCHED — no evidence was ever gathered to judge).
  const ambiguous = { name: 'Vienna Hofburg Orchestra', category: 'Arts & Culture', neighborhood: 'Innere Stadt', claimSupported: 'Real chamber concert.', source: 'https://example.com/orch', needsVerification: false }
  const zeroResults = { name: 'Folie 1 von 12 – Elstar', category: 'Misc', neighborhood: 'Neubau', claimSupported: 'A garbled, likely non-venue discovery artifact.', source: 'https://example.com/folie', needsVerification: false }
  const noEvidence = { name: 'Untraceable Pop-Up Market', category: 'Shopping', neighborhood: 'Neubau', claimSupported: 'Real weekend market stalls.', source: 'https://example.com/market', needsVerification: false }
  const ambiguousCert: DriverItemCertificationRecord = { candidateName: ambiguous.name, venueName: ambiguous.name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Hear Mozart at the 'Vienna Hofburg Orchestra'.", finalTags: ['classical music', 'art'], supportingFact: ambiguous.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  const zeroResultsCert: DriverItemCertificationRecord = { candidateName: zeroResults.name, venueName: zeroResults.name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "See slide 1 of 12 at 'Folie 1 von 12 – Elstar'.", finalTags: ['hidden gem', 'art'], supportingFact: zeroResults.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  const noEvidenceCert: DriverItemCertificationRecord = { candidateName: noEvidence.name, venueName: noEvidence.name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Browse local stalls at the 'Untraceable Pop-Up Market'.", finalTags: ['hidden gem', 'art'], supportingFact: noEvidence.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  const projectId = 'vienna-m85-geo-selective-drop'
  await seedForBatchCertification(runStore, projectId, [ambiguous, zeroResults, noEvidence], { [ambiguousCert.candidateName]: ambiguousCert, [zeroResultsCert.candidateName]: zeroResultsCert, [noEvidenceCert.candidateName]: noEvidenceCert })

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      placesLookup: async (q: string) => {
        if (q.includes('Untraceable')) return { topResult: null, apiError: 'no network access in tests' }
        if (q.includes('Folie')) return { topResult: null, apiError: null }
        // A real result, but for a totally different, unrelated venue — genuinely evaluated and rejected/ambiguous.
        return { topResult: { placeId: 'p-unrelated', name: 'Vienna Premium Concert Hall Rentals', formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }
      },
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 15 }
  )

  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord>; catalogPruningDrops?: Array<{ candidateName: string; reason: string }> }
  assert.equal(state.itemCertifications[ambiguous.name].outcome, 'REJECTED_GEO_UNRESOLVED', 'a genuinely evaluated, still-unconfident Places match is dropped by M8.5')
  assert.equal(state.itemCertifications[zeroResults.name].outcome, 'REJECTED_GEO_UNRESOLVED', 'a search that genuinely completed and found zero results (no apiError) is real evidence the venue does not resolve — dropped, same as an ambiguous match')
  assert.equal(state.itemCertifications[noEvidence.name].outcome, 'ITEM_CERTIFIED', 'an item whose Places lookup never returned any real evidence at all (an apiError) is left untouched — never silently dropped over an infra gap')
  assert.ok(state.catalogPruningDrops?.some((d) => d.candidateName === ambiguous.name && d.reason === 'REJECTED_GEO_UNRESOLVED'))
  assert.ok(state.catalogPruningDrops?.some((d) => d.candidateName === zeroResults.name && d.reason === 'REJECTED_GEO_UNRESOLVED'))
  assert.ok(!state.catalogPruningDrops?.some((d) => d.candidateName === noEvidence.name))
})

test('driveMetroLaunch: M8.5 drops a METADATA_COMPLETENESS_GATE failure when neither the raw category nor the body carries a classifiable signal', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)
  const candidate = { name: 'Local District Initiative', category: 'District', neighborhood: 'Ottakring', claimSupported: 'A real neighborhood civic initiative.', source: 'https://example.com/district', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: candidate.name, venueName: candidate.name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Join the 'Local District Initiative' meeting.", finalTags: ['hidden gem', 'art'], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  const projectId = 'vienna-m85-metadata-drop'
  await seedForBatchCertification(runStore, projectId, [candidate], { [cert.candidateName]: cert })

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      placesLookup: async (q: string) => ({ topResult: { placeId: 'p1', name: candidate.name, formattedAddress: q, lat: 48.2, lng: 16.33, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 15 }
  )

  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord>; catalogPruningDrops?: Array<{ candidateName: string; reason: string }> }
  assert.equal(state.itemCertifications[candidate.name].outcome, 'REJECTED_UNCLASSIFIABLE_METADATA', 'neither "District" nor the body text names a recognizable venue-type keyword — dropped, never forced into an arbitrary category')
  assert.ok(state.catalogPruningDrops?.some((d) => d.candidateName === candidate.name && d.reason === 'REJECTED_UNCLASSIFIABLE_METADATA'))
})

test('driveMetroLaunch: M8.5 pruning is idempotent — a resumed run never re-spends a second real tag-repair call on an item already given its one pruning decision', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  let tagRepairCalls = 0
  executor.scriptWhen(
    (r) => (r.inputs as { mode?: string }).mode === 'TAG_SELECTION',
    (r) => {
      tagRepairCalls += 1
      return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { tags: ['coffee', 'historic'] }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
    }
  )
  const candidate = { name: 'Cafe Sperl', category: 'Food & drink', neighborhood: 'Mariahilf', claimSupported: 'Cafe Sperl is a historic Vienna coffeehouse.', source: 'https://example.com/sperl', needsVerification: false }
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: ['coffee', 'historic'], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  const projectId = 'vienna-m85-idempotent'
  await seedForBatchCertification(runStore, projectId, [candidate], { [cert.candidateName]: cert })

  const deps = {
    runStore,
    execStore,
    executors: [executor],
    verifiedTagSnapshot: TEST_TAG_VOCAB,
    placesLookup: async (q: string) => ({ topResult: { placeId: 'p1', name: 'Cafe Sperl', formattedAddress: q, lat: 48.2, lng: 16.36, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }),
    geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
    verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
    checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
    ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
  }

  const first = await driveMetroLaunch(deps, projectId, { categoryPlan: PLAN, maxSteps: 15 })
  const firstState = first.state as { itemCertifications: Record<string, DriverItemCertificationRecord> }
  assert.equal(firstState.itemCertifications['Cafe Sperl'].outcome, 'REJECTED_INSUFFICIENT_TAG_CONTEXT')
  const callsAfterFirstRun = tagRepairCalls
  assert.ok(callsAfterFirstRun > 0)

  // Force the run back to M8_BATCH_CERTIFICATION to simulate a resume —
  // catalogPruningAttempted (state, never reset) must prevent a second
  // real repair call on the same item.
  const stored = await runStore.get(playbookRunId('metro_launch', projectId))
  stored!.currentStage = 'M8_BATCH_CERTIFICATION'
  stored!.status = 'RUNNING'
  await runStore.put(stored!)

  await driveMetroLaunch(deps, projectId, { categoryPlan: PLAN, maxSteps: 15 })
  assert.equal(tagRepairCalls, callsAfterFirstRun, 'a resumed run must never re-spend a second real tag-repair call on an item that already received its one bounded M8.5 decision')
})

// ---------------------------------------------------------------------------
// M9 Home-list SQL package (Chief Phase 2AD, 2026-09-09 instruction) — a
// single atomic, self-contained package: ensures metro_areas exists,
// creates/reuses each planned list idempotently, and links certified
// items via public.list_items, matched against a real (already-created)
// public.items row by exact body text. Never silently proceeds with a
// guessed metro identity when the caller hasn't supplied one.
// ---------------------------------------------------------------------------

async function seedForHomeListMirror(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, candidates: Array<{ name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean }>, certs: Record<string, DriverItemCertificationRecord>) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  // Chief Phase 2AN (2026-09-11): a real M9 entry always follows a real M8
  // pass, which always resolves dbCategory + persists metadataEnrichmentResults
  // for every certified item (buildHomeListSqlPatch's new item-creation
  // section fails closed without them). These tests seed directly at M9,
  // bypassing M8 — synthesize the same minimal-but-real state M8 would have
  // left behind so these still-relevant list/metro_areas/decision-packet
  // assertions keep exercising a realistic M9 entry, not a state M8 could
  // never actually produce.
  const certsWithCategory: Record<string, DriverItemCertificationRecord> = Object.fromEntries(Object.entries(certs).map(([name, c]) => [name, { ...c, dbCategory: c.dbCategory ?? 'Food & drink' }]))
  const metadataEnrichmentResults = Object.keys(certsWithCategory).map((candidateName) => ({
    candidateName,
    hasAlcohol: { evaluated: true as const, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    photoRequired: { evaluated: true as const, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    checkinType: { evaluated: true as const, value: 'tap' as const, confidence: 'HIGH' as const, reason: 'test fixture' },
    isSecret: { evaluated: true as const, value: false, confidence: 'HIGH' as const, reason: 'test fixture' },
    difficulty: { evaluated: true as const, value: 1 as const, confidence: 'HIGH' as const, reason: 'test fixture' },
    visitProfileKey: { evaluated: true as const, value: null, confidence: 'HIGH' as const, reason: 'test fixture' },
    websiteUrl: { evaluated: false as const, reason: 'test fixture' },
  }))
  seeded!.state = { m0Decisions: RESOLVED_M0, candidates, neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: certsWithCategory, batchCertificationGates: [], metadataEnrichmentResults }
  seeded!.currentStage = 'M9_HOME_LIST_MIRROR'
  await runStore.put(seeded!)
}

test('driveMetroLaunch: M9 Home-list SQL keeps the old fail-closed metro_areas check when no metroAreaFacts are supplied — never guesses a metro identity', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = food('Cafe Sperl', 'Mariahilf')
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: ['coffee', 'historic'], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }

  const projectId = 'vienna-m9-sql-fail-closed'
  await seedForHomeListMirror(runStore, projectId, [candidate], { [cert.candidateName]: cert })

  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor], verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }), checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }), ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } } },
    projectId,
    { categoryPlan: PLAN, maxSteps: 3 }
  )

  const state = run.state as { homeListSqlPatch: string }
  assert.ok(state.homeListSqlPatch.includes('no known metroAreaFacts were supplied'), 'without metroAreaFacts, the generated SQL still just checks-and-fails, never fabricates a metro_areas row')
  assert.ok(!state.homeListSqlPatch.includes('INSERT INTO public.metro_areas'))
})

test('driveMetroLaunch: M9 Home-list SQL creates metro_areas, reuses lists idempotently, and matches list_items by exact certified body text when metroAreaFacts are supplied', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = food('Cafe Sperl', 'Mariahilf')
  const body = "Order the 'Sperl Torte' at 'Cafe Sperl'."
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: body, finalTags: ['coffee', 'historic'], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [], dbCategory: 'Food & drink' }

  const projectId = 'vienna-m9-sql-full'
  await seedForHomeListMirror(runStore, projectId, [candidate], { [cert.candidateName]: cert })

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
      metroAreaFacts: { name: 'Vienna Metro', state: 'Vienna', timezone: 'Europe/Vienna' },
      officialListCreatorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 3 }
  )

  const state = run.state as { homeListSqlPatch: string }
  const sql = state.homeListSqlPatch
  assert.ok(sql.includes("INSERT INTO public.metro_areas (name, slug, state, timezone, is_active, center_lat, center_lng)"), 'metroAreaFacts + a real metroCenter produce a real ensure-insert, never a guess')
  assert.ok(sql.includes("'Vienna Metro'") && sql.includes("'Vienna'") && sql.includes("'Europe/Vienna'"))
  // Chief Phase 2AH (2026-09-09 product-rule update): is_active is a
  // normal production flag, never a staging/launch gate — the generated
  // ensure-insert must write is_active=true from creation, never false.
  assert.ok(sql.includes(`VALUES ('Vienna Metro', ${JSON.stringify(projectId).replace(/"/g, "'")}, 'Vienna', 'Europe/Vienna', true,`), 'metro_areas is created with is_active=true, never staged as false')
  assert.ok(sql.includes('SELECT id INTO v_list_id FROM public.lists WHERE metro_id = v_metro_id AND title'), 'idempotent existence check before ever inserting a list')
  assert.ok(sql.includes("'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'"), 'uses the supplied creator id, never a silently different default')
  assert.ok(sql.includes(`FROM public.items WHERE body = '${body.replace(/'/g, "''")}'`), 'list_items population matches the real, exact certified body text — never a name-based guess')
  assert.ok(sql.includes('has this item been created yet via Item Intake'), 'a missing items row fails closed with an honest, specific reason, never silently skipped')
  assert.ok(sql.includes('ON CONFLICT (list_id, item_id) DO NOTHING'), 'list_items linking is idempotent on re-apply')
  assert.ok(sql.includes('postflight: expected at least'), 'a postflight assertion verifies the real applied state, not just that the block ran without error')
})

test('driveMetroLaunch: the launch-readiness decisionPacket never frames the human decision as "flip metro_areas.is_active" — is_active is a normal production flag, not a launch gate', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  const candidate = food('Cafe Sperl', 'Mariahilf')
  const cert: DriverItemCertificationRecord = { candidateName: 'Cafe Sperl', venueName: 'Cafe Sperl', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the 'Sperl Torte' at 'Cafe Sperl'.", finalTags: ['coffee', 'historic'], supportingFact: candidate.claimSupported, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [], dbCategory: 'Food & drink' }

  const projectId = 'vienna-decisionpacket-language'
  await seedForHomeListMirror(runStore, projectId, [candidate], { [cert.candidateName]: cert })

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 3 }
  )

  const packet = run.decisionPacket as { decisionNeeded?: string; why?: string; impact?: string; options?: string[] } | null
  const wholePacket = JSON.stringify(packet)
  assert.ok(!wholePacket.includes('flip metro_areas.is_active'), 'the decision must never be framed as flipping is_active — it is a normal production flag, not a launch gate')
  assert.match(packet?.decisionNeeded ?? '', /public launch|announce|promote/i)
  assert.match(packet?.impact ?? '', /is_active/i, 'the impact text should explain is_active is the normal production default, not the thing being gated')
})

// ---------------------------------------------------------------------------
// Themed-list category architecture (Chief Phase 2AE, 2026-09-09
// instruction) — buildHomeListPlan previously grouped by the RAW,
// un-normalized candidate.category discovery label instead of the real
// production dbCategory, so "Museum"/"museum" (same real category, only
// differing by capitalization) became TWO separate themed lists, and
// non-canonical labels like "restaurant"/"Adventure & outdoors" leaked
// straight into list titles. Verifies: (1) dbCategory is resolved and
// persisted once by M8, (2) case/wording variants of the same real
// category merge into ONE themed list, (3) the list title is a fixed,
// visitor-facing name, never the raw label.
// ---------------------------------------------------------------------------

test('driveMetroLaunch: dbCategory is resolved and persisted from the real, normalized production classification — never the raw candidate.category text — regardless of case/wording variants like "Museum"/"museum"/"restaurant"', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)

  const validTags = ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'art']
  const museumNames = ['Kunsthistorisches Wing', 'Belvedere Annex', 'Leopold Extension', 'Albertina North']
  const lowerMuseumNames = ['Sigmund Freud House', 'Strauss Residence', 'Haydn Residence']
  const restaurantNames = ['Steirereck Garden', 'Figlmuller Old Town', 'Plachutta Wieden', 'Meissl & Schadn', 'Zum Schwarzen Kameel']

  const candidates: Array<{ name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean }> = []
  const certs: Record<string, DriverItemCertificationRecord> = {}
  for (const name of museumNames) {
    candidates.push({ name, category: 'Museum', neighborhood: 'Innere Stadt', claimSupported: `${name} has a real, specific exhibit.`, source: `https://example.com/${name}`, needsVerification: false })
    certs[name] = { candidateName: name, venueName: name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: `See the real exhibit at '${name}'.`, finalTags: validTags, supportingFact: `${name} has a real, specific exhibit.`, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  }
  for (const name of lowerMuseumNames) {
    candidates.push({ name, category: 'museum', neighborhood: 'Alsergrund', claimSupported: `${name} has a real, specific exhibit.`, source: `https://example.com/${name}`, needsVerification: false })
    certs[name] = { candidateName: name, venueName: name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: `See the real exhibit at '${name}'.`, finalTags: validTags, supportingFact: `${name} has a real, specific exhibit.`, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  }
  for (const name of restaurantNames) {
    candidates.push({ name, category: 'restaurant', neighborhood: 'Innere Stadt', claimSupported: `${name} serves a real, specific dish.`, source: `https://example.com/${name}`, needsVerification: false })
    certs[name] = { candidateName: name, venueName: name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: `Order the specialty at '${name}'.`, finalTags: validTags, supportingFact: `${name} serves a real, specific dish.`, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  }

  const projectId = 'vienna-m9-theme-architecture'
  await seedForBatchCertification(runStore, projectId, candidates, certs)

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      placesLookup: async (q: string) => ({ topResult: { placeId: `p-${q}`, name: q, formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 20 }
  )

  const state = run.state as { itemCertifications: Record<string, DriverItemCertificationRecord>; homeListPlan: Array<{ label: string; kind: string; itemCandidateNames: string[] }> }

  // 1. dbCategory resolved and persisted for every certified item.
  for (const name of [...museumNames, ...lowerMuseumNames]) {
    assert.equal(state.itemCertifications[name].dbCategory, 'Arts & Culture', `${name} (raw category variant) must resolve to the real Arts & Culture production category`)
  }
  for (const name of restaurantNames) {
    assert.equal(state.itemCertifications[name].dbCategory, 'Food & drink', `${name} (raw category "restaurant") must resolve to the real Food & drink production category`)
  }

  // 2. the flagship list is built from the real dbCategory-tagged pool (Chief Phase 2AF) — with only
  // 12 certified items total (well under the flagship target size), every one is included.
  const flagship = state.homeListPlan.find((p) => p.kind === 'PRIMARY_SEASONAL')!
  assert.equal(flagship.itemCandidateNames.length, museumNames.length + lowerMuseumNames.length + restaurantNames.length)

  // 3. no themed list ever surfaces a raw, un-normalized category label as its title — whatever
  // themed lists DO ship (Chief Phase 2AF's editorial theme engine, keyword/tag-grounded) use a
  // fixed visitor-facing title, never "Museum"/"museum"/"restaurant" verbatim.
  const themed = state.homeListPlan.filter((p) => p.kind === 'THEMED')
  assert.ok(!themed.some((p) => p.label === 'Themed list: Museum' || p.label === 'Themed list: museum' || p.label === 'Themed list: restaurant'), 'a raw, un-normalized category label must never appear as a list title')
})

// ---------------------------------------------------------------------------
// Chief Phase 3B (Vienna post-mortem regression tests) — partnerPotential,
// venue duplicate clustering (reporting-only), M8.75 CATALOG_VOICE_PASS
// sequencing, and the M10 strategic report + stage artifacts.
// ---------------------------------------------------------------------------

test('driveMetroLaunch: partnerPotential is advisory-only and never blocks certification, venue duplicate clusters are reported (never auto-dropped), and the M10 strategic report + stage artifacts are populated', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)

  const validTags = ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'art']
  const candidates = [
    { name: 'DupVenueA', category: 'Food & drink', neighborhood: 'Innere Stadt', claimSupported: 'DupVenueA serves a specific dish.', source: 'https://example.com/DupVenueA', needsVerification: false },
    { name: 'DupVenueB', category: 'Food & drink', neighborhood: 'Innere Stadt', claimSupported: 'DupVenueB serves a specific dish.', source: 'https://example.com/DupVenueB', needsVerification: false },
    { name: 'SoloCafe', category: 'Food & drink', neighborhood: 'Innere Stadt', claimSupported: 'SoloCafe serves a specific dish.', source: 'https://example.com/SoloCafe', needsVerification: false },
  ]
  const certs: Record<string, DriverItemCertificationRecord> = {
    DupVenueA: { candidateName: 'DupVenueA', venueName: 'DupVenueA', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Order the signature dish at 'DupVenueA'.", finalTags: validTags, supportingFact: 'DupVenueA serves a specific dish.', verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] },
    DupVenueB: { candidateName: 'DupVenueB', venueName: 'DupVenueB', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Ask the bartender for a tasting flight at 'DupVenueB'.", finalTags: validTags, supportingFact: 'DupVenueB serves a specific dish.', verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] },
    SoloCafe: { candidateName: 'SoloCafe', venueName: 'SoloCafe', attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: "Eat a meal at 'SoloCafe'.", finalTags: validTags, supportingFact: 'SoloCafe serves a specific dish.', verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] },
  }

  const projectId = 'vienna-m10-strategic-report'
  await seedForBatchCertification(runStore, projectId, candidates, certs)

  const writtenArtifacts: Record<string, string> = {}
  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      // DupVenueA and DupVenueB deliberately resolve to the SAME Google
      // Place ID (simulating two discovery-time labels for one real
      // venue) — SoloCafe gets its own, distinct placeId.
      placesLookup: async (q: string) => ({
        topResult: { placeId: q.includes('DupVenueA') || q.includes('DupVenueB') ? 'shared-place-id' : `p-${q}`, name: q, formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null },
        apiError: null,
      }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
      writeStageArtifact: async (name, content) => {
        writtenArtifacts[name] = content
      },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 20 }
  )

  const state = run.state as {
    itemCertifications: Record<string, DriverItemCertificationRecord>
    venueDuplicateClusters?: Array<{ placeId: string; members: Array<{ candidateName: string }> }>
    strategicReport?: { finalItemCount: number; partnerPotentialInventoryCount: number; duplicateClustersFound: number }
    stageArtifactManifest?: string[]
  }

  // 1. Every certified item still reaches ITEM_CERTIFIED — nothing about
  // partnerPotential or duplicate-cluster detection blocks certification.
  for (const name of ['DupVenueA', 'DupVenueB', 'SoloCafe']) {
    assert.equal(state.itemCertifications[name].outcome, 'ITEM_CERTIFIED')
  }

  // 2. partnerPotential resolved, advisory-only, never 0 for a genuinely
  // signaled item.
  assert.ok((state.itemCertifications.DupVenueA.partnerPotential?.score ?? 0) > 0)
  assert.ok((state.itemCertifications.DupVenueB.partnerPotential?.score ?? 0) > 0)

  // 3. Duplicate venue clustering: DupVenueA/DupVenueB reported together,
  // SoloCafe never included, and BOTH duplicates remain ITEM_CERTIFIED
  // (reporting-only — never an automatic drop).
  const cluster = state.venueDuplicateClusters?.find((c) => c.placeId === 'shared-place-id')
  assert.ok(cluster, 'expected a reported cluster for the shared Place ID')
  assert.deepEqual(new Set(cluster!.members.map((m) => m.candidateName)), new Set(['DupVenueA', 'DupVenueB']))

  // 4. The M10 strategic report reflects the same facts.
  assert.equal(state.strategicReport?.finalItemCount, 3)
  assert.equal(state.strategicReport?.duplicateClustersFound, 1)
  assert.ok((state.strategicReport?.partnerPotentialInventoryCount ?? 0) >= 2)

  // 5. Durable stage artifacts were actually written via the injected hook.
  assert.ok(state.stageArtifactManifest?.includes('05-final-retained-catalog.json'))
  assert.ok('05-final-retained-catalog.json' in writtenArtifacts)
  assert.equal(JSON.parse(writtenArtifacts['05-final-retained-catalog.json']).length, 3)

  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
})

test('driveMetroLaunch: the flagship Home list is capped at ~30 balanced items (never all certified items), and editorial themed lists cross real production category lines — never a bare per-category dump', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptPassingMetroFinisher(executor)
  scriptTagSelection(executor)

  const validTags = ['coffee', 'historic', 'family friendly', 'live music', 'outdoor', 'art']
  const candidates: Array<{ name: string; category: string; neighborhood: string; claimSupported: string; source: string; needsVerification: boolean }> = []
  const certs: Record<string, DriverItemCertificationRecord> = {}

  // 50 generic Arts & Culture museums — no theme keywords, just bulk category inventory.
  for (let i = 0; i < 50; i++) {
    const name = `Museum Number ${String(i).padStart(3, '0')}`
    candidates.push({ name, category: 'Museum', neighborhood: 'Innere Stadt', claimSupported: `${name} has a real exhibit.`, source: `https://example.com/${i}`, needsVerification: false })
    certs[name] = { candidateName: name, venueName: name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: `See the exhibit at '${name}'.`, finalTags: validTags, supportingFact: `${name} has a real exhibit.`, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  }
  // 10 genuine Imperial-keyword items (Arts & Culture) — a real cross-cutting editorial theme.
  const imperialNames: string[] = []
  for (let i = 0; i < 10; i++) {
    const name = `Palace Number ${String(i).padStart(3, '0')}`
    imperialNames.push(name)
    candidates.push({ name, category: 'Palace', neighborhood: 'Innere Stadt', claimSupported: `${name} is a real imperial residence.`, source: `https://example.com/palace${i}`, needsVerification: false })
    certs[name] = { candidateName: name, venueName: name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: `Tour the imperial palace at '${name}'.`, finalTags: validTags, supportingFact: `${name} is a real imperial residence.`, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  }
  // 3 Sports items — a thin real category that must still get at least one flagship slot.
  for (let i = 0; i < 3; i++) {
    const name = `Stadium Number ${String(i).padStart(3, '0')}`
    candidates.push({ name, category: 'Sports venue', neighborhood: 'Prater', claimSupported: `${name} hosts real matches.`, source: `https://example.com/stadium${i}`, needsVerification: false })
    certs[name] = { candidateName: name, venueName: name, attempts: 1, outcome: 'ITEM_CERTIFIED', finalBody: `Watch a match at '${name}'.`, finalTags: validTags, supportingFact: `${name} hosts real matches.`, verifiedAt: '2026-09-09T00:00:00.000Z', rejectionReasons: [] }
  }

  const projectId = 'vienna-m9-flagship-scale'
  await seedForBatchCertification(runStore, projectId, candidates, certs)

  const run = await driveMetroLaunch(
    {
      runStore,
      execStore,
      executors: [executor],
      verifiedTagSnapshot: TEST_TAG_VOCAB,
      placesLookup: async (q: string) => ({ topResult: { placeId: `p-${q}`, name: q, formattedAddress: q, lat: 48.2, lng: 16.37, websiteUri: null, country: 'AT', viewportRadiusM: null }, apiError: null }),
      geoEnrichmentCache: new InMemoryGeoEnrichmentCacheStore(),
      verifyHomeListRows: async () => ({ failed: true as const, reason: 'no DB access in tests' }),
      checkActivationKitLive: async () => ({ live: true, reason: 'HTTP 200 (test fake)' }),
      ensureProject: async () => ({ projectId: 'test-project', created: false }), canonicalNeighborhoods: ['Innere Stadt'], emptyNeighborhoodFallbackCentroids: { 'Innere Stadt': { lat: 48.2, lng: 16.37 } },
    },
    projectId,
    { categoryPlan: PLAN, maxSteps: 20 }
  )

  const state = run.state as { homeListPlan: Array<{ label: string; kind: string; itemCandidateNames: string[] }> }
  const flagship = state.homeListPlan.find((p) => p.kind === 'PRIMARY_SEASONAL')!
  assert.ok(flagship.itemCandidateNames.length < 63, 'the flagship list must never be all 63 certified items')
  assert.ok(flagship.itemCandidateNames.length >= 28 && flagship.itemCandidateNames.length <= 32, `expected ~30 flagship items, got ${flagship.itemCandidateNames.length}`)
  assert.ok(flagship.itemCandidateNames.some((n) => n.startsWith('Stadium')), 'a real, non-trivial Sports category must still get at least one flagship slot, never zeroed out')

  const themed = state.homeListPlan.filter((p) => p.kind === 'THEMED')
  const imperialList = themed.find((p) => p.label.includes('Imperial'))
  assert.ok(imperialList, 'a real, keyword-supported cross-cutting theme (Imperial & Grand Landmarks) must ship')
  assert.deepEqual(imperialList!.itemCandidateNames.sort(), imperialNames.sort())
  assert.ok(!themed.some((p) => p.label === 'Themed list: Arts & Culture'), 'the bare, un-curated 60-item Arts & Culture category dump must never ship as a themed list')
})
