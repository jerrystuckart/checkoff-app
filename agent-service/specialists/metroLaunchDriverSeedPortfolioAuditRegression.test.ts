// M5_75_SEED_PORTFOLIO_AUDIT — remaining regression coverage (commit 5/5):
// bounded loop termination (never cycles forever, even with an unresolved
// gap or HOLD candidates present), and the two in-flight-run states not
// already covered by metroLaunchDriverSeedPortfolioAudit.test.ts (commit
// 2/5) — a run BEFORE this stage in sequence, and a fully COMPLETED run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, type MetroM0Decisions } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor } from './testExecutor'
import type { CategoryCoveragePlan } from '../playbooks/metroLaunch'

const RESOLVED_M0: MetroM0Decisions = {
  geographicScope: 'Downtown only',
  categoryCatalogTargets: 'n/a',
  launchSeason: null,
  executionGoAhead: true,
  metroCountry: 'US',
  metroCenter: { lat: 0, lng: 0 },
}

const PLAN: CategoryCoveragePlan = { targets: [{ categoryName: 'Food & drink', minimumViable: 5, healthyTarget: 10, qualityNotes: [] }] }
const EMPTY_PLAN: CategoryCoveragePlan = { targets: [] }

function baseDeps() {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  return { runStore, execStore, executor, deps: { runStore, execStore, executors: [executor] } }
}

function dish(name: string) {
  return { name, category: 'Food & drink', neighborhood: 'Downtown', claimSupported: `${name} serves a specific signature dish found nowhere else`, source: `https://example.com/${name}`, needsVerification: false }
}

test('loop termination: iterations already at the configured bound escalates to NEEDS_JERRY rather than looping again', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'loop-bound-test', 'M0_METRO_DEFINITION')
  run.currentStage = 'M6_QUALITY_VERIFICATION'
  run.status = 'RUNNING'
  run.state = {
    m0Decisions: RESOLVED_M0,
    plan: PLAN,
    depthTargets: [],
    neighborhoods: [],
    candidates: [dish('Only Dish')], // 1/5 minimumViable — a real, unresolved CATEGORY gap.
    hasRunM6: true,
    seedPortfolioAuditIterations: 1, // already at the configured bound below.
  }
  await runStore.put(run)

  const result = await driveMetroLaunch(
    { ...deps, seedPortfolioAuditLoopControls: { maxTargetedResearchIterations: 1, maxCandidatesAddedPerIteration: 5 } },
    'loop-bound-test',
    { categoryPlan: EMPTY_PLAN, maxSteps: 3 }
  )
  assert.equal(result.status, 'NEEDS_JERRY')
  assert.equal(result.currentStage, 'M5_75_SEED_PORTFOLIO_AUDIT')
  assert.match(result.jerryReason ?? '', /exhausted|iterations/i)
})

test('loop termination: HOLD candidates (duplicate cluster) never block progression — only unresolved CATEGORY/GEOGRAPHIC/COMMERCIAL_MIX gaps do', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'hold-never-blocks-test', 'M0_METRO_DEFINITION')
  run.currentStage = 'M6_QUALITY_VERIFICATION'
  run.status = 'RUNNING'
  // Two candidates sharing a normalized name -> a HOLD-triggering seed
  // duplicate cluster — but the plan itself has no category targets, so
  // there is no CATEGORY/GEOGRAPHIC gap to block on.
  run.state = {
    m0Decisions: RESOLVED_M0,
    plan: EMPTY_PLAN,
    depthTargets: [],
    neighborhoods: [],
    candidates: [dish('Signature Spot'), { ...dish('SIGNATURE SPOT'), claimSupported: 'A second write-up of the exact same signature dish' }],
    hasRunM6: true,
  }
  await runStore.put(run)

  const result = await driveMetroLaunch({ ...deps }, 'hold-never-blocks-test', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  assert.notEqual(result.status, 'NEEDS_JERRY')
  const report = (result.state as { seedPortfolioAuditReport?: { candidateDecisions: { hold: unknown[] } } }).seedPortfolioAuditReport
  assert.ok((report?.candidateDecisions.hold.length ?? 0) > 0, 'expected at least one HOLD candidate from the duplicate cluster')
})

test('resume: a run BEFORE M5_75 in sequence (e.g. M4_COVERAGE_AUDIT) is structurally unaffected — its own case is untouched, it simply arrives at M5_75 once its own loop naturally settles', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'before-stage-test', 'M0_METRO_DEFINITION')
  run.currentStage = 'M4_COVERAGE_AUDIT'
  run.status = 'RUNNING'
  run.state = { m0Decisions: RESOLVED_M0, plan: EMPTY_PLAN, depthTargets: [], neighborhoods: [], candidates: [], hasRunM6: true }
  await runStore.put(run)

  const result = await driveMetroLaunch(deps, 'before-stage-test', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  assert.notEqual(result.status, 'NEEDS_JERRY')
  // With an empty plan and zero candidates, M4 finds no gaps and proceeds
  // straight through M5_75 (trivially READY_FOR_EDITORIAL) onward.
  assert.notEqual(result.currentStage, 'M4_COVERAGE_AUDIT')
})

test('resume: a fully COMPLETED (DONE) run is returned untouched — driveMetroLaunch never re-enters any stage for it', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'done-run-test', 'M0_METRO_DEFINITION')
  run.currentStage = 'LAUNCH_READINESS_BOUNDARY_DONE'
  run.status = 'DONE'
  run.state = { m0Decisions: RESOLVED_M0 }
  await runStore.put(run)
  const before = JSON.stringify(run)

  const result = await driveMetroLaunch(deps, 'done-run-test', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  assert.equal(JSON.stringify(result), before)
  assert.equal(result.status, 'DONE')
})
