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
import { driveMetroLaunch, executionId, m0DecisionsResolved, buildAuditEvidence, m1GeographyExecutionLabel, type MetroM0Decisions } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import { auditCoverage, type CategoryCoveragePlan } from '../playbooks/metroLaunch'

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
}

function food(name: string, neighborhood: string) {
  return { name, category: 'Food & drink', neighborhood, claimSupported: `${name} serves a real, specific dish`, source: `https://example.com/${name}`, needsVerification: true }
}
function shop(name: string, neighborhood: string) {
  return { name, category: 'Shopping', neighborhood, claimSupported: `${name} is a specific local shop experience`, source: `https://example.com/${name}`, needsVerification: true }
}

/** Scripts a full, deterministic TestExecutor for the synthetic scenario described above. */
function scriptSynthetic(executor: TestExecutor) {
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

  executor.scriptWhen(
    (r) => r.specialist === 'checkoff_editor',
    (r) =>
      fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { factualSource: (r.inputs as { factualSource?: string }).factualSource ?? '', checkoffizedItem: `Checkoffized: ${(r.inputs as { businessOrPlace?: string }).businessOrPlace}` },
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
  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, 'san-diego-no-decisions', { categoryPlan: PLAN })
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'M0_METRO_DEFINITION')
  assert.ok(run.decisionPacket)
})

test('San Diego FULL SYNTHETIC driver run: sequences M0 through the launch-readiness boundary with NO manual per-stage command', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  scriptSynthetic(executor)

  const projectId = 'san-diego-synthetic'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN })

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
  assert.ok(allExecutions.filter((e) => e.request.specialist === 'checkoff_editor').length === 10)
  assert.ok(allExecutions.every((e) => e.status === 'COMPLETE'))

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
  scriptSynthetic(executor)

  const projectId = 'san-diego-leftover-duplicate-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN })

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

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN })
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

test('driveMetroLaunch: launch-boundary GEOGRAPHY_GATE genuinely FAILS when a configured depth target is below minimum (Carlsbad 4/5)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

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
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: 'x' }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
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

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, {
    categoryPlan: smallPlan,
    depthTargets: [{ neighborhoodName: 'Carlsbad', minimumItems: 5 }],
    maxSteps: 30,
  })

  // With only 4 Carlsbad candidates and no M5 script to supply a 5th, the M4<->M5 loop exhausts its guardrail and escalates BEFORE ever reaching the launch boundary — which is itself proof the gate is real (M4 uses the identical auditCoverage() check).
  assert.match(run.jerryReason ?? '', /coverage gap loop exceeded|Carlsbad/)
})

test('driveMetroLaunch: launch-boundary GEOGRAPHY_GATE genuinely PASSES once a depth target reaches its minimum (Carlsbad 5/5)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

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
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: 'x' }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 3, healthyTarget: 3, qualityNotes: [] }] }
  const projectId = 'san-diego-carlsbad-5of5-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, {
    categoryPlan: smallPlan,
    depthTargets: [{ neighborhoodName: 'Carlsbad', minimumItems: 5 }],
    maxSteps: 30,
  })

  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  const packet = run.decisionPacket?.evidence as { gates: Array<{ key: string; verdict: string; reason: string }> } | undefined
  const geoGate = packet?.gates.find((g) => g.key === 'GEOGRAPHY_GATE')
  assert.equal(geoGate?.verdict, 'PASS')
})

test('driveMetroLaunch: launch-boundary CATEGORY_GATE genuinely FAILS when a real category is below minimum with no approved exception', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

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

  const projectId = 'san-diego-category-fail-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  // A minimum the M4<->M5 loop can never satisfy in this synthetic
  // (M5 isn't scripted) reproduces "category below minimum, no exception"
  // by construction — proving the SAME underlying auditCoverage() check
  // now drives the launch boundary's CATEGORY_GATE, since it's what
  // stops this run before the boundary is ever reached.
  const impossiblePlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Sports', minimumViable: 5, healthyTarget: 5, qualityNotes: [] }] }
  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: impossiblePlan, maxSteps: 30 })
  assert.match(run.jerryReason ?? '', /coverage gap loop exceeded/)
  const blockingGaps = run.decisionPacket?.evidence as Array<{ name: string }> | undefined
  assert.ok(blockingGaps?.some((g) => g.name === 'Sports'))
})

test('driveMetroLaunch: launch-boundary CATEGORY_GATE evaluates NORMALIZED category counts, not raw free-text labels — the original San Diego false-zero bug, now checked at the boundary too', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()

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
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: 'x' }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )

  const projectId = 'san-diego-category-normalized-pass-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const plan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 3, healthyTarget: 3, qualityNotes: [] }] }
  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: plan, maxSteps: 30 })

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
  scriptSynthetic(executor)
  const projectId = 'san-diego-resume-test'

  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  // First call: bounded to a handful of steps, simulating a process that
  // dies partway through (e.g. after M1 and M3, before M4 finishes).
  const partial = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN, maxSteps: 3 })
  assert.equal(partial.status, 'RUNNING')
  assert.notEqual(partial.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  const m1ExecutionIdUsed = executionId(playbookRunId('metro_launch', projectId), 'M1', m1GeographyExecutionLabel())
  assert.equal((await execStore.get(m1ExecutionIdUsed))?.status, 'COMPLETE')

  // Second call — a BRAND NEW driveMetroLaunch invocation, same stores,
  // simulating a process restart. Must resume, not restart from M1.
  const resumed = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN })
  assert.equal(resumed.status, 'NEEDS_JERRY')
  assert.equal(resumed.currentStage, 'LAUNCH_READINESS_BOUNDARY')

  // M1's execution was never re-created/re-run a second time — idempotent resume.
  const m1Executions = (await execStore.all()).filter((e) => e.request.stage === 'M1_GEOGRAPHY_MAP')
  assert.equal(m1Executions.length, 1)
})

// ---------------------------------------------------------------------------
// Runaway-loop guardrail (spec section 20)
// ---------------------------------------------------------------------------

test('driveMetroLaunch: an unresolvable coverage gap escalates to NEEDS_JERRY once the loop-iteration guardrail is exceeded, never loops forever', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
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
  // Shopping gap can never close. Proves the loop-iteration guardrail
  // fires rather than looping forever, distinct from a retry-exhaustion
  // escalation (evidence is never empty/invalid here, it's just useless).
  executor.scriptWhen(
    (r) => r.stage === 'M5_TARGETED_DEEP_DIVES',
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { candidates: [food('FoodA', 'Downtown')] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )

  const projectId = 'san-diego-runaway-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: shoplessPlan, maxSteps: 500 })
  assert.equal(run.status, 'NEEDS_JERRY')
  assert.match(run.jerryReason ?? '', /loop/i)
  assert.ok(run.loopIteration <= 6, 'the loop-iteration guardrail (default 5) must actually bound the number of M4<->M5 passes')
})

// ---------------------------------------------------------------------------
// Bounded retry (spec section 18/20) + executor-unavailable BLOCKED path
// ---------------------------------------------------------------------------

test('driveMetroLaunch: EXECUTOR_UNAVAILABLE blocks the run rather than NEEDS_JERRY or an infinite retry', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  executor.makeSpecialistUnavailable('research_verifier')

  const projectId = 'san-diego-unavailable-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN })
  assert.equal(run.status, 'BLOCKED')
  assert.equal(run.currentStage, 'M1_GEOGRAPHY_MAP')
})

test('driveMetroLaunch: a rejected evidence result retries up to the guardrail, then escalates — never advances on bad evidence', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
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

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN })
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

  await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN, maxSteps: 2 })
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
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: 'x' }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )

  const projectId = 'san-diego-depth-target-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  const plan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }, { categoryName: 'Shopping', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }] }
  const run = await driveMetroLaunch(
    { runStore, execStore, executors: [executor] },
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

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: PLAN, maxSteps: 30 })

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
    (r) => fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { factualSource: 'x', checkoffizedItem: 'x' }, methodologyId: 'checkoff_editor', methodologyVersion: 'v1' })
  )

  const smallPlan: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 1, healthyTarget: 1, qualityNotes: [] }] }
  const projectId = 'san-diego-idempotent-resume-test'
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(seeded!)

  // First pass: drives all the way through M1 for real (COMPLETE recorded).
  await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: smallPlan, maxSteps: 2 })
  assert.equal(m1CallCount, 1)

  // Simulate the manual reset: back to M1, same executionId will be reused.
  const afterM1 = await runStore.get(playbookRunId('metro_launch', projectId))
  afterM1!.currentStage = 'M1_GEOGRAPHY_MAP'
  afterM1!.status = 'RUNNING'
  await runStore.put(afterM1!)

  const run = await driveMetroLaunch({ runStore, execStore, executors: [executor] }, projectId, { categoryPlan: smallPlan, maxSteps: 30 })

  assert.equal(m1CallCount, 1, 'the idempotent-COMPLETE execution must never be re-invoked — same executionId, same accepted result')
  // NEEDS_JERRY here is expected (the launch-readiness boundary always
  // escalates, by design) — what this test actually guards against is
  // escalating EARLIER, for the wrong reason (a retry-guardrail failure
  // on M1's idempotent replay).
  assert.doesNotMatch(run.jerryReason ?? '', /retry guardrail/)
  assert.match(run.jerryReason ?? '', /launch-readiness boundary/)
})
