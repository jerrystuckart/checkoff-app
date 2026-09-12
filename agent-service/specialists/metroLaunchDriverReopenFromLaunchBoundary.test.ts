// Chief Phase 3C follow-up (2026-09-11 Munich re-entry bug) — regression
// tests for driveMetroLaunch's new `reopenFromLaunchBoundary` option
// (wired to the CLI's --reopen-from-launch-boundary flag). Before this
// option existed, the re-entry guard only knew how to reopen a run stuck
// at M0_METRO_DEFINITION — invoking `run` against a run parked at
// NEEDS_JERRY/LAUNCH_READINESS_BOUNDARY silently returned the run
// unchanged (no mutation, no persist()).
//
// These tests exercise the guard in isolation, not the full M9-M13
// pipeline: a run seeded WITHOUT a metroFinisherReport/metroFinisherPackets
// makes stepMetroFinisherPacketExecution take its documented "nothing to
// execute" path straight to M9_HOME_LIST_MIRROR (see that function's own
// `if (!packets)` branch) — a clean, unambiguous single-step signal that
// the reopen actually re-entered the driver loop, without needing to
// stand up the rest of the M9-M13 fixture machinery
// (metroFinisherPacketExecution.test.ts already covers real packet
// execution once inside that stage).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId, type PlaybookRunRecord } from './playbookRun'
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

function baseDeps(runStore: InstanceType<typeof InMemoryPlaybookRunStore>) {
  return {
    runStore,
    execStore: new InMemoryExecutionStore(),
    executors: [new TestExecutor()],
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
  }
}

/** Seeds a run parked exactly at NEEDS_JERRY/LAUNCH_READINESS_BOUNDARY, mirroring a real Finisher-report-in-hand run that reached the boundary before METRO_FINISHER_PACKET_EXECUTION existed. */
async function seedAtLaunchBoundary(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string, priorState: Record<string, unknown> = {}) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = { m0Decisions: M0, candidates: [], neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: {}, ...priorState }
  seeded.currentStage = 'LAUNCH_READINESS_BOUNDARY'
  seeded.status = 'NEEDS_JERRY'
  seeded.jerryReason = 'Metro build reached the launch-readiness boundary — public launch always requires Jerry.'
  seeded.decisionPacket = { decisionNeeded: 'Approve public launch', options: [] }
  await runStore.put(seeded)
  return seeded
}

/** Seeds a run parked at NEEDS_JERRY for an UNRELATED reason/stage (M1), to prove the flag never reaches across runs. */
async function seedAtUnrelatedNeedsJerry(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = { m0Decisions: M0, candidates: [] }
  seeded.currentStage = 'M1_GEOGRAPHY_MAP'
  seeded.status = 'NEEDS_JERRY'
  seeded.jerryReason = 'M1 geography research could not complete evidence validation.'
  seeded.decisionPacket = { decisionNeeded: 'unrelated M1 escalation', why: 'test fixture' }
  await runStore.put(seeded)
  return seeded
}

// ---------------------------------------------------------------------------
// 1. No flag -> a run parked at LAUNCH_READINESS_BOUNDARY does not resume.
// ---------------------------------------------------------------------------

test('reopenFromLaunchBoundary: WITHOUT the flag, a run parked at LAUNCH_READINESS_BOUNDARY does not resume (unchanged)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const seeded = await seedAtLaunchBoundary(runStore, 'munich_germany')
  const before = JSON.parse(JSON.stringify(seeded))

  const run = await driveMetroLaunch(baseDeps(runStore), 'munich_germany', { categoryPlan: PLAN })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.deepEqual(JSON.parse(JSON.stringify(run)), before)
})

// ---------------------------------------------------------------------------
// 2. WITH the flag, the same run DOES resume for that specific project.
// ---------------------------------------------------------------------------

test('reopenFromLaunchBoundary: WITH the flag, the same run resumes into METRO_FINISHER_PACKET_EXECUTION and proceeds', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtLaunchBoundary(runStore, 'munich_germany')

  const run = await driveMetroLaunch(baseDeps(runStore), 'munich_germany', { categoryPlan: PLAN, maxSteps: 1, reopenFromLaunchBoundary: true })

  // No metroFinisherPackets were seeded, so stepMetroFinisherPacketExecution
  // takes its documented "nothing to execute" path straight to M9 in this
  // one step — proof the guard actually re-entered the loop rather than
  // returning the parked run untouched.
  assert.equal(run.status, 'RUNNING')
  assert.equal(run.currentStage, 'M9_HOME_LIST_MIRROR')
  assert.equal(run.jerryReason, null)
  assert.equal(run.decisionPacket, null)
  assert.equal(run.loopIteration, 0)
  assert.equal(run.totalRetries, 0)

  const state = run.state as { launchBoundaryReopens?: Array<{ fromStage: string; toStage: string }> }
  assert.equal(state.launchBoundaryReopens?.length, 1)
  assert.equal(state.launchBoundaryReopens?.[0].fromStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.equal(state.launchBoundaryReopens?.[0].toStage, 'METRO_FINISHER_PACKET_EXECUTION')
})

// ---------------------------------------------------------------------------
// 3. A second, different parked run is completely untouched.
// ---------------------------------------------------------------------------

test('reopenFromLaunchBoundary: reopening one project leaves a second NEEDS_JERRY run byte-identical', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtLaunchBoundary(runStore, 'munich_germany')
  await seedAtUnrelatedNeedsJerry(runStore, 'denver_colorado')
  const denverBefore = JSON.parse(JSON.stringify(await runStore.get(playbookRunId('metro_launch', 'denver_colorado'))))

  await driveMetroLaunch(baseDeps(runStore), 'munich_germany', { categoryPlan: PLAN, maxSteps: 1, reopenFromLaunchBoundary: true })

  const denverAfter = JSON.parse(JSON.stringify(await runStore.get(playbookRunId('metro_launch', 'denver_colorado'))))
  assert.deepEqual(denverAfter, denverBefore)
})

// ---------------------------------------------------------------------------
// 4. Existing M0_METRO_DEFINITION reopen path is unaffected either way.
// ---------------------------------------------------------------------------

test('reopenFromLaunchBoundary: M0_METRO_DEFINITION reopen behavior (unresolved decisions) is identical with or without the flag', async () => {
  for (const reopenFromLaunchBoundary of [false, true]) {
    const runStore = new InMemoryPlaybookRunStore()
    await getOrCreateRun(runStore, 'metro_launch', 'test_metro', 'M0_METRO_DEFINITION')
    const seeded = (await runStore.get(playbookRunId('metro_launch', 'test_metro')))!
    seeded.status = 'NEEDS_JERRY'
    seeded.jerryReason = 'Metro launch cannot start — required M0 decisions are unresolved.'
    await runStore.put(seeded)

    const run = await driveMetroLaunch(baseDeps(runStore), 'test_metro', { categoryPlan: PLAN, reopenFromLaunchBoundary })

    assert.equal(run.status, 'NEEDS_JERRY')
    assert.equal(run.currentStage, 'M0_METRO_DEFINITION')
  }
})

test('reopenFromLaunchBoundary: M0_METRO_DEFINITION reopen behavior (resolved decisions) is identical with or without the flag', async () => {
  const results: PlaybookRunRecord[] = []
  for (const reopenFromLaunchBoundary of [false, true]) {
    const runStore = new InMemoryPlaybookRunStore()
    await getOrCreateRun(runStore, 'metro_launch', 'test_metro', 'M0_METRO_DEFINITION')
    const seeded = (await runStore.get(playbookRunId('metro_launch', 'test_metro')))!
    seeded.status = 'NEEDS_JERRY'
    seeded.jerryReason = 'Metro launch cannot start — required M0 decisions are unresolved.'
    seeded.state = { m0Decisions: M0 }
    await runStore.put(seeded)

    const run = await driveMetroLaunch(baseDeps(runStore), 'test_metro', { categoryPlan: PLAN, maxSteps: 1, reopenFromLaunchBoundary })
    results.push(run)
  }
  assert.equal(results[0].status, results[1].status)
  assert.equal(results[0].currentStage, results[1].currentStage)
  assert.equal(results[0].currentStage, 'M1_GEOGRAPHY_MAP')
})

// ---------------------------------------------------------------------------
// 5. The flag is inert for any stage/status other than exactly
// LAUNCH_READINESS_BOUNDARY + NEEDS_JERRY/BLOCKED.
// ---------------------------------------------------------------------------

test('reopenFromLaunchBoundary: passing the flag on a run parked at a DIFFERENT boundary (M1) has no effect', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const seeded = await seedAtUnrelatedNeedsJerry(runStore, 'green_bay_wisconsin')
  const before = JSON.parse(JSON.stringify(seeded))

  const run = await driveMetroLaunch(baseDeps(runStore), 'green_bay_wisconsin', { categoryPlan: PLAN, reopenFromLaunchBoundary: true })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'M1_GEOGRAPHY_MAP')
  assert.deepEqual(JSON.parse(JSON.stringify(run)), before)
})

test('reopenFromLaunchBoundary: passing the flag when the run is not actually parked (RUNNING) has no special effect beyond the normal M0 gate', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  // A brand-new run starts RUNNING at M0 with no decisions recorded —
  // the flag must not let it skip the M0 escalation.
  const run = await driveMetroLaunch(baseDeps(runStore), 'fresh_metro', { categoryPlan: PLAN, reopenFromLaunchBoundary: true })

  assert.equal(run.status, 'NEEDS_JERRY')
  assert.equal(run.currentStage, 'M0_METRO_DEFINITION')
})
