// Phase 1B/1C — getChiefBrief() run-lifecycle + reconciliation unit tests.
// Mock data source and mock run repository, no database, no network.
// Covers: first brief (since=null), second brief uses the previous
// SUCCEEDED run's timestamp, a failed run never advances the checkpoint,
// the current RUNNING row can never be its own checkpoint (call-order
// proof), no mutation beyond the run lifecycle when there's nothing to
// reconcile, a task auto-reconciled to DONE disappears from its section in
// the SAME pass, and assessment-only mode performs zero writes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getChiefBrief, type ChiefBriefDataSource, type ChiefRunRepository } from './chiefBrief'
import type { ChiefBriefSummaryCounts } from './chiefBriefTypes'
import type { ReconciliationFinding } from './reconciliationTypes'
import type { TaskSummary, JerryTaskSummary, WaitingTaskSummary, BlockedTaskSummary } from './types'

function makeTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    title: 'A task',
    description: null,
    status: 'READY',
    priority: null,
    project: null,
    owner: null,
    dueAt: null,
    nextCheckAt: null,
    nextAction: 'do the thing',
    requiresJerry: false,
    jerryRequest: null,
    blockedBy: null,
    blockerNote: null,
    contact: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceType: 'bootstrap_v1',
    sourceRef: 'test-task',
    projectType: null,
    ...overrides,
  }
}

function emptyDataSource(overrides: Partial<ChiefBriefDataSource> = {}): ChiefBriefDataSource {
  return {
    needsJerryTasks: async () => [],
    waitingTasks: async () => [],
    blockedTasks: async () => [],
    readyTasks: async () => [],
    pendingRecommendations: async () => [],
    decisionsAwaitingSync: async () => [],
    interactionsRequiringAction: async () => [],
    recentTaskChanges: async () => [],
    recentDecisionEvents: async () => [],
    recentInteractions: async () => [],
    assessReconciliation: async () => [],
    applyReconciliationFinding: async (_finding, task) => task,
    planActions: async () => [],
    ...overrides,
  }
}

class MockRunRepository implements ChiefRunRepository {
  /** The only "database" this mock has — a single row of state, mutated only through the interface methods, exactly like the real table would be. */
  private lastSucceededStartedAt: Date | null = null
  calls: string[] = []
  runs: Array<{ id: string; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; summary?: ChiefBriefSummaryCounts; error?: string }> = []
  private nextId = 1

  constructor(initialLastSucceededStartedAt: Date | null = null) {
    this.lastSucceededStartedAt = initialLastSucceededStartedAt
  }

  async getPreviousSuccessfulRunStartedAt(): Promise<Date | null> {
    this.calls.push('getPreviousSuccessfulRunStartedAt')
    return this.lastSucceededStartedAt
  }

  async createRunningRun(): Promise<string> {
    this.calls.push('createRunningRun')
    const id = `run-${this.nextId++}`
    this.runs.push({ id, status: 'RUNNING' })
    return id
  }

  async markRunSucceeded(runId: string, summary: ChiefBriefSummaryCounts): Promise<void> {
    this.calls.push('markRunSucceeded')
    const run = this.runs.find((r) => r.id === runId)
    if (run) {
      run.status = 'SUCCEEDED'
      run.summary = summary
    }
    // Simulates the real checkpoint mechanism: only a SUCCEEDED run's
    // started_at can ever be returned by getPreviousSuccessfulRunStartedAt.
    this.lastSucceededStartedAt = new Date()
  }

  async markRunFailed(runId: string, message: string): Promise<void> {
    this.calls.push('markRunFailed')
    const run = this.runs.find((r) => r.id === runId)
    if (run) {
      run.status = 'FAILED'
      run.error = message
    }
    // Deliberately does NOT touch lastSucceededStartedAt — a failed run
    // must never advance the checkpoint.
  }
}

/**
 * A small in-memory "database" of tasks, keyed by id, with real
 * apply-mutates-state behavior — this is what makes the "excluded from
 * the same pass" test meaningful rather than a filtering trick: applying
 * a finding genuinely changes what the subsequent re-fetch returns.
 */
class MockReconciliationDataSource implements ChiefBriefDataSource {
  private tasksById: Map<string, TaskSummary>
  findings: ReconciliationFinding[]
  applyCalls: string[] = []

  constructor(tasks: TaskSummary[], findings: ReconciliationFinding[]) {
    this.tasksById = new Map(tasks.map((t) => [t.id, t]))
    this.findings = findings
  }

  private byStatus(status: TaskSummary['status']): TaskSummary[] {
    return [...this.tasksById.values()].filter((t) => t.status === status)
  }

  async needsJerryTasks(): Promise<JerryTaskSummary[]> {
    return this.byStatus('NEEDS_JERRY') as JerryTaskSummary[]
  }
  async waitingTasks(): Promise<WaitingTaskSummary[]> {
    return this.byStatus('WAITING').map((t) => ({ ...t, isDueForCheck: false })) as WaitingTaskSummary[]
  }
  async blockedTasks(): Promise<BlockedTaskSummary[]> {
    return this.byStatus('BLOCKED') as BlockedTaskSummary[]
  }
  async readyTasks(): Promise<TaskSummary[]> {
    return this.byStatus('READY')
  }
  async pendingRecommendations() {
    return []
  }
  async decisionsAwaitingSync() {
    return []
  }
  async interactionsRequiringAction() {
    return []
  }
  async recentTaskChanges() {
    return []
  }
  async recentDecisionEvents() {
    return []
  }
  async recentInteractions() {
    return []
  }
  async assessReconciliation(tasks: TaskSummary[]): Promise<ReconciliationFinding[]> {
    const ids = new Set(tasks.map((t) => t.id))
    return this.findings.filter((f) => ids.has(f.taskId))
  }
  async applyReconciliationFinding(finding: ReconciliationFinding, task: TaskSummary): Promise<TaskSummary> {
    this.applyCalls.push(finding.taskId)
    if (!finding.autoApplicable) throw new Error('not autoApplicable')
    const updated: TaskSummary = { ...task, status: finding.recommendedStatus! }
    this.tasksById.set(task.id, updated)
    return updated
  }
  async planActions(): Promise<import('./actionPolicyTypes').ActionPlan[]> {
    return []
  }
}

test('first brief: since is null when no prior SUCCEEDED chief_brief run exists', async () => {
  const runRepo = new MockRunRepository(null)
  const brief = await getChiefBrief(new Date('2026-09-02T00:00:00.000Z'), emptyDataSource(), runRepo)
  assert.equal(brief.since, null)
  assert.equal(brief.recentChanges.length, 0)
})

test('first brief: recentTaskChanges/recentDecisionEvents/recentInteractions are never called when since is null', async () => {
  let calledChangeReads = false
  const dataSource = emptyDataSource({
    recentTaskChanges: async () => {
      calledChangeReads = true
      return []
    },
    recentDecisionEvents: async () => {
      calledChangeReads = true
      return []
    },
    recentInteractions: async () => {
      calledChangeReads = true
      return []
    },
  })
  await getChiefBrief(new Date(), dataSource, new MockRunRepository(null))
  assert.equal(calledChangeReads, false, 'no point querying "since epoch" on the first-ever brief')
})

test('second brief: uses the previous SUCCEEDED run as since', async () => {
  const priorCheckpoint = new Date('2026-08-30T00:00:00.000Z')
  const runRepo = new MockRunRepository(priorCheckpoint)
  let receivedSince: Date | null = null
  const dataSource = emptyDataSource({
    recentTaskChanges: async (since) => {
      receivedSince = since
      return []
    },
  })
  const brief = await getChiefBrief(new Date('2026-09-02T00:00:00.000Z'), dataSource, runRepo)
  assert.equal(brief.since, priorCheckpoint)
  assert.equal(receivedSince, priorCheckpoint)
})

test('failed run does not advance the checkpoint', async () => {
  const priorCheckpoint = new Date('2026-08-30T00:00:00.000Z')
  const runRepo = new MockRunRepository(priorCheckpoint)
  const failingDataSource = emptyDataSource({
    needsJerryTasks: async () => {
      throw new Error('simulated read failure')
    },
  })

  await assert.rejects(() => getChiefBrief(new Date(), failingDataSource, runRepo), /simulated read failure/)

  // The run itself is marked FAILED...
  assert.equal(runRepo.runs.length, 1)
  assert.equal(runRepo.runs[0].status, 'FAILED')
  assert.match(runRepo.runs[0].error ?? '', /simulated read failure/)

  // ...and a subsequent brief still sees the OLD checkpoint, not the failed run.
  const secondRunRepo = runRepo // same mock instance — checkpoint state persists exactly like a real table would
  let sinceOnNextCall: Date | null | undefined
  const okDataSource = emptyDataSource({
    recentTaskChanges: async (since) => {
      sinceOnNextCall = since
      return []
    },
  })
  await getChiefBrief(new Date(), okDataSource, secondRunRepo)
  assert.equal(sinceOnNextCall, priorCheckpoint, 'the failed run must never have become the checkpoint')
})

test('the current RUNNING row can never be its own checkpoint: getPreviousSuccessfulRunStartedAt is always called before createRunningRun', async () => {
  const runRepo = new MockRunRepository(null)
  await getChiefBrief(new Date(), emptyDataSource(), runRepo)
  const firstCheckpointRead = runRepo.calls.indexOf('getPreviousSuccessfulRunStartedAt')
  const firstRunCreate = runRepo.calls.indexOf('createRunningRun')
  assert.ok(firstCheckpointRead !== -1 && firstRunCreate !== -1)
  assert.ok(firstCheckpointRead < firstRunCreate, 'the checkpoint must be read before this run even exists')
})

test('a successful brief marks the run SUCCEEDED with the exact summary counts', async () => {
  const runRepo = new MockRunRepository(null)
  const dataSource = emptyDataSource({ waitingTasks: async () => [] })
  const brief = await getChiefBrief(new Date(), dataSource, runRepo)
  assert.equal(runRepo.runs.length, 1)
  assert.equal(runRepo.runs[0].status, 'SUCCEEDED')
  assert.deepEqual(runRepo.runs[0].summary, brief.summary)
})

test('no operational mutation occurs during brief generation when there is nothing to reconcile — only run-lifecycle calls are made', async () => {
  const runRepo = new MockRunRepository(null)
  await getChiefBrief(new Date(), emptyDataSource(), runRepo)
  assert.deepEqual(runRepo.calls, ['getPreviousSuccessfulRunStartedAt', 'createRunningRun', 'markRunSucceeded'])
})

// ---------------------------------------------------------------------------
// Phase 1C — reconciliation integration
// ---------------------------------------------------------------------------

function completionFinding(taskId: string): ReconciliationFinding {
  return {
    taskId,
    currentStatus: 'READY',
    recommendedStatus: 'DONE',
    evidenceCategory: 'COMPLETION_PROOF',
    confidence: 'HIGH',
    evidenceSources: ['agent.decisions.open_brain_thought_id'],
    reason: 'Test completion proof',
    autoApplicable: true,
  }
}

test('reconciliation: a task auto-reconciled to DONE disappears from chiefCanHandle in the SAME pass', async () => {
  const task = makeTask({ id: 'task-done-me', status: 'READY' })
  const dataSource = new MockReconciliationDataSource([task], [completionFinding('task-done-me')])
  const runRepo = new MockRunRepository(null)

  const brief = await getChiefBrief(new Date(), dataSource, runRepo)

  assert.equal(dataSource.applyCalls.length, 1, 'the auto-applicable finding must actually be applied')
  assert.equal(brief.chiefCanHandle.some((i) => i.id === 'task-done-me'), false, 'must not appear anywhere in the same brief once genuinely DONE')
})

test('reconciliation: assessment-only mode (applyReconciliation: false) performs zero writes and the task remains visible with PROVABLY_COMPLETE', async () => {
  const task = makeTask({ id: 'task-should-stay-ready', status: 'READY' })
  const dataSource = new MockReconciliationDataSource([task], [completionFinding('task-should-stay-ready')])
  const runRepo = new MockRunRepository(null)

  const brief = await getChiefBrief(new Date(), dataSource, runRepo, { applyReconciliation: false })

  assert.equal(dataSource.applyCalls.length, 0, 'assessment-only must never call applyReconciliationFinding')
  const item = brief.chiefCanHandle.find((i) => i.id === 'task-should-stay-ready')
  assert.ok(item, 'the task must still be present — nothing was actually applied')
  assert.equal(item?.staleSignal, 'PROVABLY_COMPLETE')
})

test('reconciliation: SUPERSESSION_PROOF and AMBIGUOUS findings are never applied even in normal (non-assessment-only) mode', async () => {
  const supersededTask = makeTask({ id: 'task-superseded', status: 'READY' })
  const ambiguousTask = makeTask({ id: 'task-ambiguous', status: 'READY' })
  const findings: ReconciliationFinding[] = [
    {
      taskId: 'task-superseded',
      currentStatus: 'READY',
      recommendedStatus: 'CANCELED',
      evidenceCategory: 'SUPERSESSION_PROOF',
      confidence: 'HIGH',
      evidenceSources: ['docs/some-architectural-decision.sql'],
      reason: 'Superseded by later architecture',
      autoApplicable: false,
    },
    {
      taskId: 'task-ambiguous',
      currentStatus: 'READY',
      recommendedStatus: null,
      evidenceCategory: 'AMBIGUOUS',
      confidence: 'LOW',
      evidenceSources: ['some-inconclusive-source'],
      reason: 'Evidence exists but does not prove completion or supersession',
      autoApplicable: false,
    },
  ]
  const dataSource = new MockReconciliationDataSource([supersededTask, ambiguousTask], findings)
  const runRepo = new MockRunRepository(null)

  const brief = await getChiefBrief(new Date(), dataSource, runRepo)

  assert.equal(dataSource.applyCalls.length, 0, 'neither finding is autoApplicable — apply must never be called')
  const supersededItem = brief.chiefCanHandle.find((i) => i.id === 'task-superseded')
  const ambiguousItem = brief.chiefCanHandle.find((i) => i.id === 'task-ambiguous')
  assert.equal(supersededItem?.staleSignal, 'SUPERSEDED_REVIEW')
  assert.equal(ambiguousItem?.staleSignal, 'POSSIBLY_STALE')
})

test('reconciliation: NO_CHANGE_EVIDENCE findings leave staleSignal null and are never applied', async () => {
  const task = makeTask({ id: 'task-no-change', status: 'READY' })
  const finding: ReconciliationFinding = {
    taskId: 'task-no-change',
    currentStatus: 'READY',
    recommendedStatus: null,
    evidenceCategory: 'NO_CHANGE_EVIDENCE',
    confidence: 'HIGH',
    evidenceSources: [],
    reason: 'No evidence of execution found',
    autoApplicable: false,
  }
  const dataSource = new MockReconciliationDataSource([task], [finding])
  const brief = await getChiefBrief(new Date(), dataSource, new MockRunRepository(null))

  assert.equal(dataSource.applyCalls.length, 0)
  const item = brief.chiefCanHandle.find((i) => i.id === 'task-no-change')
  assert.equal(item?.staleSignal, null)
})

// ---------------------------------------------------------------------------
// Phase 1D — proposedAction is read-only planning only; execute() is never
// reachable via getChiefBrief() (ChiefBriefDataSource has no execute
// method at all — this is a structural guarantee, not just a runtime one).
// ---------------------------------------------------------------------------

test('proposedAction: populated on a matching ready task via planActions(), left null when there is no plan', async () => {
  const readyWithPlan = makeTask({ id: 'task-with-plan', status: 'READY' })
  const readyWithoutPlan = makeTask({ id: 'task-without-plan', status: 'READY' })
  const plan = {
    taskId: 'task-with-plan',
    actionType: 'internal_design_definition' as const,
    description: 'Begin internal design work',
    reason: 'test fixture',
    expectedEffect: 'internal_reversible' as const,
    policy: 'AUTO_ALLOWED' as const,
  }
  const dataSource = emptyDataSource({
    readyTasks: async () => [readyWithPlan, readyWithoutPlan],
    planActions: async (tasks) => tasks.filter((t) => t.id === 'task-with-plan').map(() => plan),
  })
  const brief = await getChiefBrief(new Date(), dataSource, new MockRunRepository(null))

  const withPlanItem = brief.chiefCanHandle.find((i) => i.id === 'task-with-plan')
  const withoutPlanItem = brief.chiefCanHandle.find((i) => i.id === 'task-without-plan')
  assert.deepEqual(withPlanItem?.proposedAction, plan)
  assert.equal(withoutPlanItem?.proposedAction, null)
})

test('proposedAction: getChiefBrief() has no execute path — ChiefBriefDataSource exposes only planActions, never an execute method', async () => {
  const dataSource = emptyDataSource()
  assert.ok(!('execute' in dataSource), 'briefing must never be able to reach execution — they are separate entry points')
  assert.equal(typeof dataSource.planActions, 'function')
})
