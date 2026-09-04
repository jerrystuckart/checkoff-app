// Phase 1D — actionExecution.ts unit tests. Pure, no DB, no network — a
// mock ActionExecutionDataSource stands in for fetchTask/transition.
// Covers the narrow-transition-authority guarantees: claim is the only
// automatic READY->IN_PROGRESS transition, OPERATIONAL_CONDITION can only
// route to WAITING/BLOCKED/NEEDS_JERRY, and DONE is only ever reached
// after an independent verifyCompletion() — never from a transition alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeAutonomousAction, type ActionExecutionDataSource } from './actionExecution'
import type { ActionHandler, ActionExecuteOutcome } from './actionHandlers'
import type { TaskSummary } from './types'
import type { TransitionTaskInput, UpdateTaskPlanInput } from './mutations'

function makeTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    title: 'A task',
    description: null,
    status: 'READY',
    priority: null,
    project: { id: 'proj-1', projectKey: 'test_project', name: 'Test Project' },
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
    sourceRef: 'test-source-ref',
    projectType: 'PRODUCT',
    ...overrides,
  }
}

function makeHandler(overrides: Partial<ActionHandler> = {}): ActionHandler {
  return {
    actionType: 'internal_design_definition',
    policy: 'AUTO_ALLOWED',
    expectedEffect: 'internal_reversible',
    async plan(task) {
      return {
        taskId: task.id,
        actionType: 'internal_design_definition',
        description: 'x',
        reason: 'x',
        expectedEffect: 'internal_reversible',
        policy: 'AUTO_ALLOWED',
      }
    },
    ...overrides,
  }
}

/** Records every transition()/updatePlan() call and applies it to an in-memory task so fetchTask reflects it. */
function makeMockDataSource(initialTask: TaskSummary) {
  let current = initialTask
  const transitionCalls: TransitionTaskInput[] = []
  const updatePlanCalls: UpdateTaskPlanInput[] = []
  const dataSource: ActionExecutionDataSource = {
    async fetchTask(taskId) {
      return taskId === current.id ? current : null
    },
    async transition(input) {
      transitionCalls.push(input)
      current = { ...current, status: input.toStatus, updatedAt: new Date(current.updatedAt.getTime() + 1000) }
      return current
    },
    async updatePlan(input) {
      updatePlanCalls.push(input)
      current = { ...current, nextAction: input.nextAction ?? current.nextAction, updatedAt: new Date(current.updatedAt.getTime() + 1000) }
      return current
    },
  }
  return { dataSource, transitionCalls, updatePlanCalls, getCurrent: () => current }
}

test('refuses (throws) for a non-AUTO_ALLOWED handler, even before touching the data source', async () => {
  const task = makeTask()
  const handler = makeHandler({ policy: 'APPROVAL_REQUIRED' })
  const { dataSource, transitionCalls } = makeMockDataSource(task)
  await assert.rejects(() => executeAutonomousAction(task.id, task.updatedAt, handler, dataSource), /not AUTO_ALLOWED/)
  assert.deepEqual(transitionCalls, [])
})

test('refuses when the task is no longer READY', async () => {
  const task = makeTask({ status: 'IN_PROGRESS' })
  const handler = makeHandler()
  const { dataSource } = makeMockDataSource(task)
  await assert.rejects(() => executeAutonomousAction(task.id, task.updatedAt, handler, dataSource), /no longer READY/)
})

test('refuses when updatedAt no longer matches the expected snapshot', async () => {
  const task = makeTask()
  const handler = makeHandler()
  const { dataSource } = makeMockDataSource(task)
  const stale = new Date(task.updatedAt.getTime() - 5000)
  await assert.rejects(() => executeAutonomousAction(task.id, stale, handler, dataSource), /modified since the plan was made/)
})

test('refuses when the handler no longer applies on re-check', async () => {
  const task = makeTask()
  const handler = makeHandler({ plan: async () => null })
  const { dataSource } = makeMockDataSource(task)
  await assert.rejects(() => executeAutonomousAction(task.id, task.updatedAt, handler, dataSource), /no longer applies/)
})

test('claims READY -> IN_PROGRESS with a deterministic idempotency key before calling execute()', async () => {
  const task = makeTask()
  const handler = makeHandler({ execute: async () => ({ outcome: 'CLAIMED_ONLY', note: 'claimed' }) })
  const { dataSource, transitionCalls } = makeMockDataSource(task)
  await executeAutonomousAction(task.id, task.updatedAt, handler, dataSource)
  assert.equal(transitionCalls.length, 1)
  assert.equal(transitionCalls[0].toStatus, 'IN_PROGRESS')
  assert.equal(transitionCalls[0].idempotencyKey, `phase1d-claim:${task.id}:internal_design_definition`)
})

test('a handler with no execute() at all just claims and stops — CLAIMED, single transition only', async () => {
  const task = makeTask()
  const handler = makeHandler({ execute: undefined })
  const { dataSource, transitionCalls } = makeMockDataSource(task)
  const result = await executeAutonomousAction(task.id, task.updatedAt, handler, dataSource)
  assert.equal(result.status, 'CLAIMED')
  assert.equal(transitionCalls.length, 1, 'only the claim — no further transition when there is no execute() to run')
})

test('CLAIMED_ONLY outcome -> status CLAIMED, no transition beyond the initial claim', async () => {
  const task = makeTask()
  const handler = makeHandler({ execute: async () => ({ outcome: 'CLAIMED_ONLY', note: 'still working' }) })
  const { dataSource, transitionCalls } = makeMockDataSource(task)
  const result = await executeAutonomousAction(task.id, task.updatedAt, handler, dataSource)
  assert.equal(result.status, 'CLAIMED')
  assert.equal(transitionCalls.length, 1)
})

for (const nonterminal of ['WAITING', 'BLOCKED', 'NEEDS_JERRY'] as const) {
  test(`OPERATIONAL_CONDITION(${nonterminal}) -> loop transitions to exactly that nonterminal status, never DONE/CANCELED`, async () => {
    const task = makeTask()
    const outcome: ActionExecuteOutcome = { outcome: 'OPERATIONAL_CONDITION', nonterminalStatus: nonterminal, note: 'condition hit', blockerNote: 'b', jerryRequest: 'j' }
    const handler = makeHandler({ execute: async () => outcome })
    const { dataSource, transitionCalls } = makeMockDataSource(task)
    const result = await executeAutonomousAction(task.id, task.updatedAt, handler, dataSource)
    assert.equal(result.status, 'RETURNED_TO_NONTERMINAL')
    assert.equal(transitionCalls.length, 2, 'claim, then the operational-condition transition')
    assert.equal(transitionCalls[1].toStatus, nonterminal)
  })
}

test('READY_TO_VERIFY with no verifyCompletion() defined -> hard error, never treats the transition itself as evidence', async () => {
  const task = makeTask()
  const handler = makeHandler({
    execute: async () => ({ outcome: 'READY_TO_VERIFY', note: 'looks done' }),
    verifyCompletion: undefined,
  })
  const { dataSource, transitionCalls } = makeMockDataSource(task)
  await assert.rejects(() => executeAutonomousAction(task.id, task.updatedAt, handler, dataSource), /can never itself be used as evidence/)
  assert.equal(transitionCalls.length, 1, 'the claim happened, but no DONE transition was ever attempted')
})

test('READY_TO_VERIFY + verifyCompletion() returning false -> NOT_YET_VERIFIABLE, task left IN_PROGRESS, no DONE transition', async () => {
  const task = makeTask()
  const handler = makeHandler({
    execute: async () => ({ outcome: 'READY_TO_VERIFY', note: 'looks done' }),
    verifyCompletion: async () => false,
  })
  const { dataSource, transitionCalls } = makeMockDataSource(task)
  const result = await executeAutonomousAction(task.id, task.updatedAt, handler, dataSource)
  assert.equal(result.status, 'NOT_YET_VERIFIABLE')
  assert.equal(result.taskStatusAfter, 'IN_PROGRESS')
  assert.equal(transitionCalls.length, 1, 'only the claim — verification failing must never trigger a DONE transition')
})

test('CLAIMED_WITH_PLAN_UPDATE -> loop calls updatePlan() with the handler-supplied nextAction, never a status transition beyond the claim', async () => {
  const task = makeTask()
  const handler = makeHandler({
    execute: async () => ({ outcome: 'CLAIMED_WITH_PLAN_UPDATE', note: 'artifact created', nextAction: 'Next: do the real next thing.' }),
  })
  const { dataSource, transitionCalls, updatePlanCalls } = makeMockDataSource(task)
  const result = await executeAutonomousAction(task.id, task.updatedAt, handler, dataSource)
  assert.equal(result.status, 'PLAN_UPDATED')
  assert.equal(transitionCalls.length, 1, 'only the claim — CLAIMED_WITH_PLAN_UPDATE must never trigger a further status transition')
  assert.equal(updatePlanCalls.length, 1)
  assert.equal(updatePlanCalls[0].nextAction, 'Next: do the real next thing.')
  assert.equal(updatePlanCalls[0].taskId, task.id)
})

test('READY_TO_VERIFY + verifyCompletion() returning true -> DONE transition, status COMPLETED', async () => {
  const task = makeTask()
  const handler = makeHandler({
    execute: async () => ({ outcome: 'READY_TO_VERIFY', note: 'done' }),
    verifyCompletion: async () => true,
  })
  const { dataSource, transitionCalls } = makeMockDataSource(task)
  const result = await executeAutonomousAction(task.id, task.updatedAt, handler, dataSource)
  assert.equal(result.status, 'COMPLETED')
  assert.equal(transitionCalls.length, 2)
  assert.equal(transitionCalls[1].toStatus, 'DONE')
})
