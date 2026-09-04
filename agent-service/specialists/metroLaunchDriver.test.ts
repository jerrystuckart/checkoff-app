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
import { driveMetroLaunch, executionId, m0DecisionsResolved, type MetroM0Decisions } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'

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
  const m1ExecutionIdUsed = executionId(playbookRunId('metro_launch', projectId), 'M1', 'geography')
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
