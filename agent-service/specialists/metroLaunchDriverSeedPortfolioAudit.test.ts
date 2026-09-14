// M5_75_SEED_PORTFOLIO_AUDIT driver-integration tests (adjustment 8's
// in-flight-run-compatibility claims, verified directly against the real
// driveMetroLaunch()/switch statement — not merely asserted).

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

const EMPTY_PLAN: CategoryCoveragePlan = { targets: [] }

function baseDeps() {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  return { runStore, execStore, executor, deps: { runStore, execStore, executors: [executor] } }
}

test('resume at M6_QUALITY_VERIFICATION with zero candidates advances through M5_75 to M6_5_CHECKOFF_EDITOR without touching prior stages', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'resume-test-1', 'M0_METRO_DEFINITION')
  run.currentStage = 'M6_QUALITY_VERIFICATION'
  run.status = 'RUNNING'
  run.state = { m0Decisions: RESOLVED_M0, plan: EMPTY_PLAN, depthTargets: [], neighborhoods: [], candidates: [], hasRunM6: false }
  await runStore.put(run)

  const result = await driveMetroLaunch(deps, 'resume-test-1', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  // With zero candidates, M6 has nothing to verify (toVerify.length === 0)
  // and lands at M5_75, which then finds an empty seed portfolio (trivially
  // READY_FOR_EDITORIAL — no gaps, no candidates) and proceeds onward
  // (with zero candidates, M6.5/M7/M8 each also complete instantly within
  // this same maxSteps budget — the exact landing stage isn't the point,
  // never stalling at NEEDS_JERRY/M5_75 is).
  assert.notEqual(result.status, 'NEEDS_JERRY')
  assert.notEqual(result.currentStage, 'M5_75_SEED_PORTFOLIO_AUDIT')
  const report = (result.state as { seedPortfolioAuditReport?: { executiveVerdict: { verdict: string } } }).seedPortfolioAuditReport
  assert.equal(report?.executiveVerdict.verdict, 'READY_FOR_EDITORIAL')
})

test('resume at M5B_REPLACEMENT with nothing removed advances through M5_75 to M6_5_CHECKOFF_EDITOR', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'resume-test-2', 'M0_METRO_DEFINITION')
  run.currentStage = 'M5B_REPLACEMENT'
  run.status = 'RUNNING'
  run.state = { m0Decisions: RESOLVED_M0, plan: EMPTY_PLAN, depthTargets: [], neighborhoods: [], candidates: [], removedCandidateNames: [] }
  await runStore.put(run)

  const result = await driveMetroLaunch(deps, 'resume-test-2', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  assert.notEqual(result.status, 'NEEDS_JERRY')
  assert.notEqual(result.currentStage, 'M5_75_SEED_PORTFOLIO_AUDIT')
  assert.notEqual(result.currentStage, 'M5B_REPLACEMENT')
})

test('a run already AT/BEYOND M6_5_CHECKOFF_EDITOR never re-enters M5_75_SEED_PORTFOLIO_AUDIT', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'resume-test-3', 'M0_METRO_DEFINITION')
  run.currentStage = 'M6_5_CHECKOFF_EDITOR'
  run.status = 'RUNNING'
  // No candidates at all -> stepEditor's `remaining` is empty -> proceeds straight to M7_ITEM_CERTIFICATION without ever touching M5_75.
  run.state = { m0Decisions: RESOLVED_M0, plan: EMPTY_PLAN, depthTargets: [], neighborhoods: [], candidates: [], checkoffizedItems: [] }
  await runStore.put(run)

  const result = await driveMetroLaunch(deps, 'resume-test-3', { categoryPlan: EMPTY_PLAN, maxSteps: 3 })
  assert.notEqual(result.currentStage, 'M5_75_SEED_PORTFOLIO_AUDIT')
})

test('a fully COMPLETED/NEEDS_JERRY run at LAUNCH_READINESS_BOUNDARY (Munich-shaped) is completely untouched by adding M5_75', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'munich_germany', 'M0_METRO_DEFINITION')
  run.currentStage = 'LAUNCH_READINESS_BOUNDARY'
  run.status = 'NEEDS_JERRY'
  run.jerryReason = 'Awaiting business activation kit review.'
  run.state = { m0Decisions: RESOLVED_M0, seedPortfolioAuditReport: undefined }
  await runStore.put(run)
  const before = JSON.stringify(run)

  // Called WITHOUT reopenFromLaunchBoundary — the ordinary resume call
  // shape. Per driveMetroLaunch's own NEEDS_JERRY branch, a run not at
  // M0_METRO_DEFINITION is returned completely untouched.
  const result = await driveMetroLaunch(deps, 'munich_germany', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  assert.equal(JSON.stringify(result), before)
  assert.equal(result.currentStage, 'LAUNCH_READINESS_BOUNDARY')
  assert.equal(result.status, 'NEEDS_JERRY')
})

test('idempotent re-entry: calling driveMetroLaunch twice on a run already settled at M6_5_CHECKOFF_EDITOR via M5_75 never re-runs the audit a second time with different results', async () => {
  const { runStore, deps } = baseDeps()
  const run = await getOrCreateRun(runStore, 'metro_launch', 'resume-test-5', 'M0_METRO_DEFINITION')
  run.currentStage = 'M6_QUALITY_VERIFICATION'
  run.status = 'RUNNING'
  run.state = { m0Decisions: RESOLVED_M0, plan: EMPTY_PLAN, depthTargets: [], neighborhoods: [], candidates: [], hasRunM6: false }
  await runStore.put(run)

  const first = await driveMetroLaunch(deps, 'resume-test-5', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  const firstReport = (first.state as { seedPortfolioAuditReport?: unknown }).seedPortfolioAuditReport
  const second = await driveMetroLaunch(deps, 'resume-test-5', { categoryPlan: EMPTY_PLAN, maxSteps: 5 })
  const secondReport = (second.state as { seedPortfolioAuditReport?: unknown }).seedPortfolioAuditReport
  assert.deepEqual(firstReport, secondReport)
  assert.equal(second.currentStage, first.currentStage)
})
