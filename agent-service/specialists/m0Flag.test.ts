// Regression tests for the 2026-09-11 Munich re-entry bug: the CLI's
// `--m0` handling previously called recordJerryDecision() for ANY
// NEEDS_JERRY run, regardless of which stage it was parked at. That
// preempted driveMetroLaunch's own re-entry guards (including
// `--reopen-from-launch-boundary`, added in 04b7455) — a NEEDS_JERRY run
// parked at LAUNCH_READINESS_BOUNDARY (Munich) was silently resumed out of
// NEEDS_JERRY by the mere presence of `--m0` on the command line, before
// driveMetroLaunch ever got a chance to see reopenFromLaunchBoundary, and
// was then immediately re-escalated right back to NEEDS_JERRY.
//
// applyM0Flag() now only calls recordJerryDecision() when the run is
// NEEDS_JERRY AND parked exactly at M0_METRO_DEFINITION — mirroring
// driveMetroLaunch's own M0 re-entry condition exactly. These tests prove:
//   1. M0-parked NEEDS_JERRY run is still resumed by --m0 (existing behavior).
//   2. LAUNCH_READINESS_BOUNDARY-parked NEEDS_JERRY run is NOT resumed by
//      --m0 alone (state/status unchanged).
//   3. Combined path: --m0 alone doesn't resume a launch-boundary-parked
//      run, but --m0 followed by driveMetroLaunch with
//      reopenFromLaunchBoundary:true does.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyM0Flag } from './m0Flag'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { driveMetroLaunch, type MetroM0Decisions } from './metroLaunchDriver'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 2, healthyTarget: 5, qualityNotes: [] }] }

const M0: MetroM0Decisions = {
  geographicScope: 'Test metro',
  categoryCatalogTargets: 'Food & drink',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'DE',
  metroCenter: { lat: 48.1, lng: 11.6 },
}

function baseDeps(runStore: InstanceType<typeof InMemoryPlaybookRunStore>) {
  return {
    runStore,
    execStore: new InMemoryExecutionStore(),
    executors: [new TestExecutor()],
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
  }
}

async function seedAtM0(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.status = 'NEEDS_JERRY'
  seeded.currentStage = 'M0_METRO_DEFINITION'
  seeded.jerryReason = 'M0 metro definition needs Jerry input.'
  seeded.decisionPacket = { decisionNeeded: 'Provide M0 decisions', options: [] }
  await runStore.put(seeded)
  return seeded
}

async function seedAtLaunchBoundary(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, projectId: string) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', projectId)))!
  seeded.state = { m0Decisions: M0, candidates: [], neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: {} }
  seeded.currentStage = 'LAUNCH_READINESS_BOUNDARY'
  seeded.status = 'NEEDS_JERRY'
  seeded.jerryReason = 'Metro build reached the launch-readiness boundary — public launch always requires Jerry.'
  seeded.decisionPacket = { decisionNeeded: 'Approve public launch', options: [] }
  await runStore.put(seeded)
  return seeded
}

test('applyM0Flag: a NEEDS_JERRY run parked at M0_METRO_DEFINITION is still resumed by --m0 (unchanged existing behavior)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtM0(runStore, 'munich_germany')

  await applyM0Flag(runStore, 'metro_launch', 'munich_germany', M0)

  const after = await runStore.get(playbookRunId('metro_launch', 'munich_germany'))
  assert.equal(after!.status, 'RUNNING')
  assert.equal(after!.jerryReason, null)
  assert.deepEqual((after!.state as Record<string, unknown>).m0Decisions, M0)
})

test('applyM0Flag: a NEEDS_JERRY run parked at LAUNCH_READINESS_BOUNDARY is NOT resumed by --m0 alone (state/status unchanged)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const seeded = await seedAtLaunchBoundary(runStore, 'munich_germany')
  const before = JSON.parse(JSON.stringify(seeded))

  await applyM0Flag(runStore, 'metro_launch', 'munich_germany', M0)

  const after = await runStore.get(playbookRunId('metro_launch', 'munich_germany'))
  assert.equal(after!.status, 'NEEDS_JERRY')
  assert.equal(after!.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.deepEqual(JSON.parse(JSON.stringify(after)), before)
})

test('applyM0Flag + driveMetroLaunch: --m0 alone does not resume a launch-boundary-parked run, but --m0 + reopenFromLaunchBoundary together does', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await seedAtLaunchBoundary(runStore, 'munich_germany')

  // Step 1: apply --m0 exactly as the CLI would, with no reopen flag.
  await applyM0Flag(runStore, 'metro_launch', 'munich_germany', M0)
  const stillParked = await driveMetroLaunch(baseDeps(runStore), 'munich_germany', { categoryPlan: PLAN })
  assert.equal(stillParked.status, 'NEEDS_JERRY')
  assert.equal(stillParked.currentStage, 'LAUNCH_READINESS_BOUNDARY')

  // Step 2: same run, now also pass reopenFromLaunchBoundary — this is the
  // combined path a real Munich retry invocation exercises.
  const reopened = await driveMetroLaunch(baseDeps(runStore), 'munich_germany', { categoryPlan: PLAN, maxSteps: 1, reopenFromLaunchBoundary: true })
  assert.notEqual(reopened.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.notEqual(reopened.status, 'NEEDS_JERRY')
})

test('applyM0Flag: a NEEDS_JERRY run parked at an unrelated stage is left byte-identical (e.g. a different metro is unaffected)', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  await getOrCreateRun(runStore, 'metro_launch', 'denver_colorado', 'M0_METRO_DEFINITION')
  const seeded = (await runStore.get(playbookRunId('metro_launch', 'denver_colorado')))!
  seeded.status = 'NEEDS_JERRY'
  seeded.currentStage = 'M1_GEOGRAPHY_MAP'
  seeded.jerryReason = 'unrelated M1 escalation'
  seeded.decisionPacket = { decisionNeeded: 'unrelated', why: 'test fixture' }
  await runStore.put(seeded)
  const before = JSON.parse(JSON.stringify(seeded))

  await applyM0Flag(runStore, 'metro_launch', 'denver_colorado', M0)

  const after = await runStore.get(playbookRunId('metro_launch', 'denver_colorado'))
  assert.deepEqual(JSON.parse(JSON.stringify(after)), before)
})
