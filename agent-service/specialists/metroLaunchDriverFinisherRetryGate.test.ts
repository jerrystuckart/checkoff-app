// Munich metro build — regression tests for the Finisher retry-gate fix
// (2026-09-11). Root cause: Munich's first METRO_FINISHER_DEEP_RESEARCH
// attempt failed structural VALIDATION, so no report was ever stored
// (state.metroFinisherReport stays undefined). The old eligibility check
// (`priorNotReady = state.metroFinisherReport ? !readyToFinish : false`)
// evaluated to `false` for that case — indistinguishable from "there was
// never a first attempt at all" — so the one caller-requested follow-up
// (`requestMetroFinisherFollowUp`) could never fire, and the driver fell
// straight through to METRO_FINISHER_INTEGRATION with no report, even
// though runsCompleted (1) was still under MAX_METRO_FINISHER_RUNS (2).
//
// Fix: metroFinisherStatus now carries a `failReason` tag. A FAIL caused
// specifically by report-shape validation is tagged 'VALIDATION_FAILED'
// (distinct from 'NOT_READY_COUNT_ONLY', which is a validly-shaped report
// that simply failed the count-only readiness check, and distinct from
// 'NO_REPORT', the defensive fallback for a report missing for some other
// reason). The retry gate treats `!state.metroFinisherReport &&
// metroFinisherStatus.failReason === 'VALIDATION_FAILED'` as eligible for
// the one permitted follow-up, exactly like an explicit
// `finalAssessment.readyToFinish === false` report already was — never
// broadening eligibility to every FAIL cause, and never touching
// MAX_METRO_FINISHER_RUNS itself.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveMetroLaunch, MAX_METRO_FINISHER_RUNS, type MetroM0Decisions } from './metroLaunchDriver'
import { InMemoryPlaybookRunStore, getOrCreateRun, playbookRunId } from './playbookRun'
import { InMemoryExecutionStore } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import { buildPassingMetroFinisherReport } from './testMetroFinisherFixture'
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

/** Seeds a run positioned directly at METRO_FINISHER_DEEP_RESEARCH, with whatever prior Finisher state the test wants — skips M0-M8.75 entirely since none of that is relevant to the retry-gate logic itself. */
async function seedAtFinisherStage(
  runStore: InstanceType<typeof InMemoryPlaybookRunStore>,
  projectId: string,
  priorFinisherState: Record<string, unknown>
) {
  await getOrCreateRun(runStore, 'metro_launch', projectId, 'M0_METRO_DEFINITION')
  const seeded = await runStore.get(playbookRunId('metro_launch', projectId))
  seeded!.state = { m0Decisions: M0, candidates: [], neighborhoods: [], plan: PLAN, hasRunM6: true, itemCertifications: {}, ...priorFinisherState }
  seeded!.currentStage = 'METRO_FINISHER_DEEP_RESEARCH'
  await runStore.put(seeded!)
}

function baseDeps(runStore: InstanceType<typeof InMemoryPlaybookRunStore>, execStore: InMemoryExecutionStore, executor: TestExecutor) {
  return {
    runStore,
    execStore,
    executors: [executor],
    ensureProject: async () => ({ projectId: 'test-project', created: false }),
  }
}

test('Finisher retry gate: a first attempt that failed VALIDATION (no stored report) IS eligible for the one requested follow-up', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const projectId = 'munich-validation-retry-test'

  let finisherCalls = 0
  executor.scriptWhen(
    (r) => r.specialist === 'metro_finisher',
    (r) => {
      finisherCalls += 1
      if (finisherCalls === 1) {
        // Structurally invalid — validateMetroFinisherReport must reject
        // this, exactly like Munich's real first attempt.
        return fakeEnvelope({ taskId: r.executionId, objective: r.objective, evidence: { report: { garbage: true } }, methodologyId: r.methodologyId, methodologyVersion: r.methodologyVersion })
      }
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { report: buildPassingMetroFinisherReport(r.metroId ?? r.projectId) },
        methodologyId: r.methodologyId,
        methodologyVersion: r.methodologyVersion,
      })
    }
  )

  // First attempt: seeded fresh (runsCompleted undefined), no follow-up requested yet.
  await seedAtFinisherStage(runStore, projectId, {})
  const afterFirst = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1 })
  const stateAfterFirst = afterFirst.state as { metroFinisherReport?: unknown; metroFinisherStatus?: { verdict: string; failReason?: string }; metroFinisherRunsCompleted?: number }

  assert.equal(finisherCalls, 1, 'exactly one Finisher call so far')
  assert.equal(stateAfterFirst.metroFinisherReport, undefined, 'the invalid report must never be stored')
  assert.equal(stateAfterFirst.metroFinisherStatus?.verdict, 'FAIL')
  assert.equal(stateAfterFirst.metroFinisherStatus?.failReason, 'VALIDATION_FAILED', 'the FAIL must be tagged as a validation failure specifically')
  assert.equal(stateAfterFirst.metroFinisherRunsCompleted, 1)
  assert.equal(afterFirst.currentStage, 'METRO_FINISHER_INTEGRATION', 'falls through to integration when no follow-up is requested')

  // Re-open the gate: move currentStage back to METRO_FINISHER_DEEP_RESEARCH
  // (as the CLI's reopen-stage command would) and request the one
  // permitted follow-up this time.
  const beforeSecond = await runStore.get(playbookRunId('metro_launch', projectId))
  beforeSecond!.currentStage = 'METRO_FINISHER_DEEP_RESEARCH'
  beforeSecond!.status = 'RUNNING'
  await runStore.put(beforeSecond!)

  const afterSecond = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1, requestMetroFinisherFollowUp: true })
  const stateAfterSecond = afterSecond.state as { metroFinisherReport?: { finalAssessment: { readyToFinish: boolean } }; metroFinisherRunsCompleted?: number }

  assert.equal(finisherCalls, 2, 'the follow-up call must actually fire')
  assert.ok(stateAfterSecond.metroFinisherReport, 'the second, valid report must now be stored')
  assert.equal(stateAfterSecond.metroFinisherRunsCompleted, 2)
  assert.equal(afterSecond.currentStage, 'METRO_FINISHER_INTEGRATION')

  // Budget is still bounded: a 3rd request must NOT fire another call,
  // since runsCompleted (2) already meets MAX_METRO_FINISHER_RUNS.
  const beforeThird = await runStore.get(playbookRunId('metro_launch', projectId))
  beforeThird!.currentStage = 'METRO_FINISHER_DEEP_RESEARCH'
  beforeThird!.status = 'RUNNING'
  await runStore.put(beforeThird!)
  await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1, requestMetroFinisherFollowUp: true })
  assert.equal(finisherCalls, 2, 'a 3rd Finisher call must never happen, regardless of requestMetroFinisherFollowUp')
  assert.equal(MAX_METRO_FINISHER_RUNS, 2, 'the budget cap itself must remain untouched by this fix')
})

test('Finisher retry gate: a legitimate "not ready" report that already used its one follow-up does NOT get a 3rd attempt just because follow-up is requested again', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const projectId = 'legit-not-ready-already-followed-up-test'

  let finisherCalls = 0
  executor.scriptWhen(
    (r) => r.specialist === 'metro_finisher',
    (r) => {
      finisherCalls += 1
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { report: buildPassingMetroFinisherReport(r.metroId ?? r.projectId) },
        methodologyId: r.methodologyId,
        methodologyVersion: r.methodologyVersion,
      })
    }
  )

  // Seed as if run 1 (not ready) and run 2 (the one legitimate follow-up)
  // already both completed — the exact state driveMetroLaunch would have
  // left behind, never hand-waved.
  const notReadyReport = { ...buildPassingMetroFinisherReport(projectId), finalAssessment: { readyToFinish: false, recommendedAdditionalItemRange: { min: 1, max: 2 }, highestPriorityNextActions: ['add a signature bakery'] } }
  await seedAtFinisherStage(runStore, projectId, {
    metroFinisherReport: notReadyReport,
    metroFinisherStatus: { verdict: 'PASS' },
    metroFinisherRunsCompleted: MAX_METRO_FINISHER_RUNS,
  })

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1, requestMetroFinisherFollowUp: true })

  assert.equal(finisherCalls, 0, 'no 3rd Finisher call — the budget is exhausted regardless of the request or the "not ready" verdict')
  assert.equal(run.currentStage, 'METRO_FINISHER_INTEGRATION')
})

test('Finisher retry gate: a valid, ready report never gets a spurious 2nd attempt just because follow-up is requested', async () => {
  const runStore = new InMemoryPlaybookRunStore()
  const execStore = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const projectId = 'legit-ready-no-followup-needed-test'

  let finisherCalls = 0
  executor.scriptWhen(
    (r) => r.specialist === 'metro_finisher',
    (r) => {
      finisherCalls += 1
      return fakeEnvelope({
        taskId: r.executionId,
        objective: r.objective,
        evidence: { report: buildPassingMetroFinisherReport(r.metroId ?? r.projectId) },
        methodologyId: r.methodologyId,
        methodologyVersion: r.methodologyVersion,
      })
    }
  )

  const readyReport = buildPassingMetroFinisherReport(projectId) // finalAssessment.readyToFinish: true
  await seedAtFinisherStage(runStore, projectId, {
    metroFinisherReport: readyReport,
    metroFinisherStatus: { verdict: 'PASS' },
    metroFinisherRunsCompleted: 1,
  })

  const run = await driveMetroLaunch(baseDeps(runStore, execStore, executor), projectId, { categoryPlan: PLAN, maxSteps: 1, requestMetroFinisherFollowUp: true })

  assert.equal(finisherCalls, 0, 'a report that was already ready is never eligible for a follow-up, even if one is requested')
  assert.equal(run.currentStage, 'METRO_FINISHER_INTEGRATION')
})
