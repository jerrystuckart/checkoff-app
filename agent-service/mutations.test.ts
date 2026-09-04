// Integration tests for Phase 0D's write layer. Real database — and,
// unlike queries.test.ts, these tests WRITE. Gated behind a SEPARATE,
// explicit opt-in on top of AGENT_SERVICE_DATABASE_URL:
// AGENT_SERVICE_ALLOW_MUTATION_TESTS=1. Without that flag, every test in
// this file is skipped even when a database is configured — routine
// `npm run agent:test` (e.g. run by habit, in CI, or by a future
// contributor who doesn't realize AGENT_SERVICE_DATABASE_URL is set to a
// real project) must never write to production merely by being invoked.
// Run mutation tests deliberately with:
//   AGENT_SERVICE_ALLOW_MUTATION_TESTS=1 npm run agent:test
// or the equivalent `npm run agent:test:mutations` script. This does not
// touch agent_service's own grants — the gate is entirely in this test
// file, not a database privilege change, and the production service role
// remains exactly as scoped in Phase 0A/0D.
//
// TEST FIXTURE ISOLATION FROM BOOTSTRAP V1: agent_service has no DELETE
// grant on agent.tasks or agent.task_events (verified — Phase 0A §3.2,
// unchanged by Phase 0D), so nothing this suite creates can be deleted
// afterward. Rather than expand production privileges just for test
// cleanup (explicitly out of scope — see Phase 0D spec item 10), every
// test task is created under a dedicated `phase0d_test_fixtures` project
// (never a real Bootstrap v1 project) with `source_type = 'phase0d_test'`
// and a fresh random-suffixed `source_ref` per run, so:
//   - Bootstrap v1 tasks (Phase 0B) are never touched, transitioned, or
//     reused as test subjects.
//   - Test rows are trivially identifiable and excludable by anyone
//     inspecting agent.* later (`WHERE source_type = 'phase0d_test'`).
//   - Repeated test runs never collide with each other (fresh source_ref
//     each run via a random run id).
// The test fixture project itself is created idempotently (ON CONFLICT DO
// NOTHING) via a direct call to the internal withWriteTransaction — this
// is test setup reaching into internals deliberately, not something any
// product code path does; the public index.ts surface still only exposes
// the three approved task mutations.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTask, transitionTask, updateTaskPlan } from './mutations'
import { query, withWriteTransaction, closePool } from './db'
import {
  TaskNotFoundError,
  InvalidTransitionError,
  InvalidStateFieldsError,
  ConcurrencyConflictError,
  IdempotencyConflictError,
} from './errors'
import type { CreateTaskInput, CreateTaskResult } from './mutations'
import type { TaskStatus } from './types'

const hasDb = Boolean(process.env.AGENT_SERVICE_DATABASE_URL)
const mutationsAllowed = hasDb && process.env.AGENT_SERVICE_ALLOW_MUTATION_TESTS === '1'
const skip = mutationsAllowed
  ? false
  : hasDb
    ? 'set AGENT_SERVICE_ALLOW_MUTATION_TESTS=1 to run live mutation tests (these WRITE to the connected database)'
    : 'AGENT_SERVICE_DATABASE_URL not set — skipping integration test'

const TEST_PROJECT_KEY = 'phase0d_test_fixtures'
const TEST_SOURCE_TYPE = 'phase0d_test'
const ACTOR = 'jerry' // real Bootstrap v1 owner — referenced, never mutated
const RUN_ID = randomUUID().slice(0, 8)
let seq = 0
function sourceRef(label: string): string {
  seq += 1
  return `${TEST_SOURCE_TYPE}-${RUN_ID}-${seq}-${label}`
}

async function fixtureTask(status: TaskStatus, extra: Partial<CreateTaskInput> = {}): Promise<CreateTaskResult> {
  return createTask({
    title: `Phase 0D fixture (${status})`,
    projectKey: TEST_PROJECT_KEY,
    status,
    changedByOwnerKey: ACTOR,
    nextAction: 'initial next action',
    sourceType: TEST_SOURCE_TYPE,
    sourceRef: sourceRef(status.toLowerCase()),
    ...extra,
  })
}

async function eventTypesFor(taskId: string): Promise<string[]> {
  const rows = await query<{ event_type: string }>('SELECT event_type FROM agent.task_events WHERE task_id = $1 ORDER BY changed_at', [
    taskId,
  ])
  return rows.map((r) => r.event_type)
}

before(async () => {
  if (!mutationsAllowed) return
  await withWriteTransaction(async (client) => {
    await client.query(
      `INSERT INTO agent.projects (project_key, name, project_type, status)
       VALUES ($1, 'Phase 0D Test Fixtures', 'INTERNAL', 'ACTIVE')
       ON CONFLICT (project_key) DO NOTHING`,
      [TEST_PROJECT_KEY]
    )
  })
})

after(async () => {
  if (hasDb) await closePool()
})

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

test('createTask: creates the task and exactly one CREATED event atomically', { skip }, async () => {
  const result = await fixtureTask('READY')
  assert.equal(result.created, true)
  assert.equal(result.task.status, 'READY')
  assert.deepEqual(await eventTypesFor(result.task.id), ['CREATED'])
})

test('createTask: safe retry with the same (sourceType, sourceRef) and matching identity returns the existing task, no duplicate', { skip }, async () => {
  // title/projectKey/status must match on both calls — those are exactly
  // the fields findSourceIdentityIncompatibility compares. description is
  // free to differ (a retry enriching the request slightly is still "the
  // same request" for idempotency purposes).
  const ref = sourceRef('retry')
  const base = {
    title: 'Phase 0D retry fixture',
    projectKey: TEST_PROJECT_KEY,
    status: 'READY' as const,
    changedByOwnerKey: ACTOR,
    nextAction: 'x',
    sourceType: TEST_SOURCE_TYPE,
    sourceRef: ref,
  }
  const first = await createTask({ ...base, description: 'first attempt' })
  const second = await createTask({ ...base, description: 'retried attempt, different description is fine' })
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(second.task.id, first.task.id)
  assert.deepEqual(await eventTypesFor(first.task.id), ['CREATED'], 'retry must not insert a second CREATED event')
})

test('createTask: reusing a sourceRef with a materially different request is an IdempotencyConflictError, not a silent success', { skip }, async () => {
  const ref = sourceRef('conflict')
  const first = await createTask({
    title: 'Original title',
    projectKey: TEST_PROJECT_KEY,
    status: 'READY',
    changedByOwnerKey: ACTOR,
    nextAction: 'x',
    sourceType: TEST_SOURCE_TYPE,
    sourceRef: ref,
  })
  assert.equal(first.created, true)

  await assert.rejects(
    () =>
      createTask({
        title: 'A completely different title', // <-- the incompatibility
        projectKey: TEST_PROJECT_KEY,
        status: 'READY',
        changedByOwnerKey: ACTOR,
        nextAction: 'x',
        sourceType: TEST_SOURCE_TYPE,
        sourceRef: ref,
      }),
    IdempotencyConflictError
  )
  // The original row must be completely unaffected by the rejected reuse.
  const rows = await query<{ title: string }>('SELECT title FROM agent.tasks WHERE id = $1', [first.task.id])
  assert.equal(rows[0].title, 'Original title')
  assert.deepEqual(await eventTypesFor(first.task.id), ['CREATED'])
})

test('createTask: sourceRef without sourceType (or vice versa) is rejected as an ambiguous half-pair', { skip }, async () => {
  await assert.rejects(
    () =>
      createTask({
        title: 'should not be created',
        projectKey: TEST_PROJECT_KEY,
        status: 'READY',
        changedByOwnerKey: ACTOR,
        nextAction: 'x',
        sourceRef: sourceRef('half-pair'),
        // sourceType intentionally omitted
      }),
    InvalidStateFieldsError
  )
})

test('createTask: unknown project is rejected before any row is written', { skip }, async () => {
  await assert.rejects(
    () =>
      createTask({
        title: 'should not be created',
        projectKey: 'this_project_does_not_exist',
        status: 'READY',
        changedByOwnerKey: ACTOR,
        nextAction: 'x',
      }),
    /Project not found/
  )
})

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

test('transitionTask: READY -> IN_PROGRESS sets owner and startedAt', { skip }, async () => {
  const created = await fixtureTask('READY')
  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'IN_PROGRESS',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    ownerKey: ACTOR,
    nextAction: 'working on it',
  })
  assert.equal(result.changed, true)
  assert.equal(result.task.status, 'IN_PROGRESS')
  assert.equal(result.task.owner?.ownerKey, ACTOR)
  assert.ok(result.task.startedAt !== null)
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED', 'STATUS_CHANGED'])
})

test('transitionTask: IN_PROGRESS -> WAITING requires and stores nextCheckAt', { skip }, async () => {
  const created = await fixtureTask('IN_PROGRESS', { ownerKey: ACTOR })
  const nextCheckAt = new Date(Date.now() + 60 * 60 * 1000)
  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'WAITING',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    nextCheckAt,
    nextAction: 'waiting on reply',
  })
  assert.equal(result.task.status, 'WAITING')
  assert.equal(result.task.nextCheckAt?.getTime(), nextCheckAt.getTime())
})

test('transitionTask: WAITING -> READY clears nextCheckAt', { skip }, async () => {
  const created = await fixtureTask('WAITING', { nextCheckAt: new Date(), nextAction: 'waiting' })
  assert.ok(created.task.nextCheckAt !== null)
  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'READY',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    nextAction: 'back to ready',
  })
  assert.equal(result.task.status, 'READY')
  assert.equal(result.task.nextCheckAt, null, 'leaving WAITING must clear nextCheckAt')
})

test('transitionTask: transition to BLOCKED stores blockerNote', { skip }, async () => {
  const created = await fixtureTask('READY')
  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'BLOCKED',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    blockerNote: 'waiting on a dependency',
    nextAction: 'unblock when dependency resolves',
  })
  assert.equal(result.task.status, 'BLOCKED')
  assert.equal(result.task.blockerNote, 'waiting on a dependency')
})

test('transitionTask: leaving BLOCKED clears blockedByTaskId and blockerNote', { skip }, async () => {
  const blocker = await fixtureTask('READY')
  const created = await fixtureTask('BLOCKED', {
    blockedByTaskId: blocker.task.id,
    blockerNote: 'blocked on fixture',
  })
  assert.ok(created.task.blockedBy !== null)
  assert.ok(created.task.blockerNote !== null)

  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'READY',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    nextAction: 'unblocked',
  })
  assert.equal(result.task.blockedBy, null)
  assert.equal(result.task.blockerNote, null)
})

test('transitionTask: transition to NEEDS_JERRY sets requiresJerry and stores jerryRequest', { skip }, async () => {
  const created = await fixtureTask('READY')
  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'NEEDS_JERRY',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    jerryRequest: 'please approve the budget',
    nextAction: 'wait for Jerry',
  })
  assert.equal(result.task.status, 'NEEDS_JERRY')
  assert.equal(result.task.requiresJerry, true)
  assert.equal(result.task.jerryRequest, 'please approve the budget')
})

test('transitionTask: leaving NEEDS_JERRY clears requiresJerry and jerryRequest', { skip }, async () => {
  const created = await fixtureTask('NEEDS_JERRY', { jerryRequest: 'approve this', nextAction: 'wait' })
  assert.equal(created.task.requiresJerry, true)

  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'READY',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    nextAction: 'resume',
  })
  assert.equal(result.task.requiresJerry, false)
  assert.equal(result.task.jerryRequest, null)
})

test('transitionTask: DONE sets completedAt', { skip }, async () => {
  const created = await fixtureTask('READY')
  const before = new Date()
  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'DONE',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
  })
  assert.equal(result.task.status, 'DONE')
  assert.ok(result.task.completedAt !== null)
  assert.ok(result.task.completedAt!.getTime() >= before.getTime())
})

test('transitionTask: CANCELED requires a meaningful cancellationReason, stored in the event note', { skip }, async () => {
  const created = await fixtureTask('READY')
  const result = await transitionTask({
    taskId: created.task.id,
    toStatus: 'CANCELED',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    cancellationReason: 'superseded by another fixture, not a real cancellation',
  })
  assert.equal(result.task.status, 'CANCELED')

  const events = await query<{ event_type: string; note: string | null }>(
    'SELECT event_type, note FROM agent.task_events WHERE task_id = $1 ORDER BY changed_at',
    [result.task.id]
  )
  const statusChanged = events.find((e) => e.event_type === 'STATUS_CHANGED')
  assert.equal(statusChanged?.note, 'superseded by another fixture, not a real cancellation')
})

// ---------------------------------------------------------------------------
// Phase 1C — reconciliation metadata on transitionTask()
// ---------------------------------------------------------------------------

test('transitionTask: reconciliation metadata is recorded on the STATUS_CHANGED event when provided', { skip }, async () => {
  const created = await fixtureTask('READY')
  await transitionTask({
    taskId: created.task.id,
    toStatus: 'DONE',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    reconciliation: {
      evidenceCategory: 'COMPLETION_PROOF',
      evidenceSources: ['test:structured-evidence'],
      evidenceSummary: 'Literal acceptance condition proven for this fixture',
    },
  })

  const events = await query<{ event_type: string; metadata: { reconciliation?: unknown; idempotencyKey?: unknown } }>(
    'SELECT event_type, metadata FROM agent.task_events WHERE task_id = $1 ORDER BY changed_at',
    [created.task.id]
  )
  const statusChanged = events.find((e) => e.event_type === 'STATUS_CHANGED')
  assert.deepEqual(statusChanged?.metadata.reconciliation, {
    evidenceCategory: 'COMPLETION_PROOF',
    evidenceSources: ['test:structured-evidence'],
    evidenceSummary: 'Literal acceptance condition proven for this fixture',
  })
  assert.equal('idempotencyKey' in (statusChanged?.metadata ?? {}), false, 'no idempotencyKey was supplied — it must not appear from nowhere')
})

test('transitionTask: reconciliation metadata merges with idempotencyKey rather than replacing it', { skip }, async () => {
  const created = await fixtureTask('READY')
  const key = sourceRef('reconcile-merge-key')
  await transitionTask({
    taskId: created.task.id,
    toStatus: 'DONE',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    idempotencyKey: key,
    reconciliation: {
      evidenceCategory: 'COMPLETION_PROOF',
      evidenceSources: ['test:structured-evidence'],
    },
  })

  const events = await query<{ event_type: string; metadata: { reconciliation?: unknown; idempotencyKey?: string } }>(
    'SELECT event_type, metadata FROM agent.task_events WHERE task_id = $1 ORDER BY changed_at',
    [created.task.id]
  )
  const statusChanged = events.find((e) => e.event_type === 'STATUS_CHANGED')
  assert.equal(statusChanged?.metadata.idempotencyKey, key, 'idempotencyKey must survive alongside reconciliation metadata')
  assert.deepEqual(statusChanged?.metadata.reconciliation, { evidenceCategory: 'COMPLETION_PROOF', evidenceSources: ['test:structured-evidence'] })
})

test('transitionTask: an ordinary call with NEITHER idempotencyKey nor reconciliation still produces exactly the same empty metadata shape as before Phase 1C', { skip }, async () => {
  const created = await fixtureTask('READY')
  await transitionTask({
    taskId: created.task.id,
    toStatus: 'DONE',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
  })

  const events = await query<{ event_type: string; metadata: Record<string, unknown> }>(
    'SELECT event_type, metadata FROM agent.task_events WHERE task_id = $1 ORDER BY changed_at',
    [created.task.id]
  )
  const statusChanged = events.find((e) => e.event_type === 'STATUS_CHANGED')
  assert.deepEqual(statusChanged?.metadata, {}, 'ordinary transitionTask() callers must behave exactly as before Phase 1C')
})

// ---------------------------------------------------------------------------
// Rejections — no mutation, no event
// ---------------------------------------------------------------------------

test('transitionTask: invalid transition is rejected with no mutation and no event', { skip }, async () => {
  const created = await fixtureTask('DONE') // DONE has no outgoing transitions
  // fixtureTask('DONE') needs completedAt implicitly via computeResultingFields (createTask sets it).
  await assert.rejects(
    () =>
      transitionTask({
        taskId: created.task.id,
        toStatus: 'READY',
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: created.task.updatedAt,
        nextAction: 'should not apply',
      }),
    InvalidTransitionError
  )
  const after = await query<{ status: TaskStatus }>('SELECT status FROM agent.tasks WHERE id = $1', [created.task.id])
  assert.equal(after[0].status, 'DONE', 'status must be unchanged after a rejected transition')
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED'], 'no STATUS_CHANGED event on a rejected transition')
})

test('transitionTask: missing WAITING nextCheckAt is rejected with no mutation and no event', { skip }, async () => {
  const created = await fixtureTask('READY')
  await assert.rejects(
    () =>
      transitionTask({
        taskId: created.task.id,
        toStatus: 'WAITING',
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: created.task.updatedAt,
        nextAction: 'missing nextCheckAt',
        // nextCheckAt intentionally omitted
      }),
    InvalidStateFieldsError
  )
  const after = await query<{ status: TaskStatus }>('SELECT status FROM agent.tasks WHERE id = $1', [created.task.id])
  assert.equal(after[0].status, 'READY')
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED'])
})

test('transitionTask: missing BLOCKED blocker (no id, no note) is rejected with no mutation and no event', { skip }, async () => {
  const created = await fixtureTask('READY')
  await assert.rejects(
    () =>
      transitionTask({
        taskId: created.task.id,
        toStatus: 'BLOCKED',
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: created.task.updatedAt,
        nextAction: 'missing blocker info',
      }),
    InvalidStateFieldsError
  )
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED'])
})

test('transitionTask: missing NEEDS_JERRY jerryRequest is rejected with no mutation and no event', { skip }, async () => {
  const created = await fixtureTask('READY')
  await assert.rejects(
    () =>
      transitionTask({
        taskId: created.task.id,
        toStatus: 'NEEDS_JERRY',
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: created.task.updatedAt,
        nextAction: 'missing jerryRequest',
      }),
    InvalidStateFieldsError
  )
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED'])
})

test('transitionTask: optimistic concurrency conflict is rejected with no mutation and no event', { skip }, async () => {
  const created = await fixtureTask('READY')
  const staleUpdatedAt = new Date(created.task.updatedAt.getTime() - 1000)
  await assert.rejects(
    () =>
      transitionTask({
        taskId: created.task.id,
        toStatus: 'IN_PROGRESS',
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: staleUpdatedAt,
        ownerKey: ACTOR,
        nextAction: 'should be rejected',
      }),
    ConcurrencyConflictError
  )
  const after = await query<{ status: TaskStatus }>('SELECT status FROM agent.tasks WHERE id = $1', [created.task.id])
  assert.equal(after[0].status, 'READY')
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED'])
})

test('transitionTask: retry of MY OWN request (matching idempotencyKey) after it already succeeded is a safe no-op', { skip }, async () => {
  const created = await fixtureTask('READY')
  const idempotencyKey = randomUUID()
  const first = await transitionTask({
    taskId: created.task.id,
    toStatus: 'DONE',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    idempotencyKey,
  })
  assert.equal(first.changed, true)

  // Retry with the ORIGINAL (now-stale) expectedUpdatedAt AND the SAME
  // idempotencyKey, simulating a caller that doesn't know its own first
  // call already succeeded (e.g. it timed out waiting for the response).
  // This is the ONLY combination that should be treated as a safe no-op —
  // see the next test for what happens without a matching key.
  const second = await transitionTask({
    taskId: created.task.id,
    toStatus: 'DONE',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt, // stale on purpose
    idempotencyKey,
  })
  assert.equal(second.changed, false)
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED', 'STATUS_CHANGED'], 'retry must not add a second STATUS_CHANGED event')
})

test('transitionTask: a stale caller is REJECTED even when the current status happens to match its target, if it cannot prove the request is its own', { skip }, async () => {
  // Reproduces the exact scenario optimistic concurrency exists to catch:
  //   1. caller reads the task as READY at version A
  //   2. a DIFFERENT actor independently drives it to IN_PROGRESS (version B)
  //   3. the stale caller retries its OLD "READY -> IN_PROGRESS" command
  //      with expectedUpdatedAt = A (no idempotencyKey — it never had one
  //      from a prior call, because it never actually succeeded before)
  // The resulting status coincidentally equals what the stale caller
  // wanted, but that must NOT be treated as success: without proof (a
  // matching idempotencyKey) that this is the stale caller's OWN request
  // having already landed, it must be rejected — silently accepting it
  // would make optimistic concurrency meaningless for exactly this case.
  const created = await fixtureTask('READY')
  const staleExpectedUpdatedAt = created.task.updatedAt

  // The "different actor" drives READY -> IN_PROGRESS for real.
  const other = await transitionTask({
    taskId: created.task.id,
    toStatus: 'IN_PROGRESS',
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    ownerKey: ACTOR,
    nextAction: 'a different actor is doing this',
  })
  assert.equal(other.task.status, 'IN_PROGRESS')

  // The stale caller retries its OWN old command — same target status,
  // stale version, no idempotencyKey. Must be rejected, not silently
  // treated as "already there, success."
  await assert.rejects(
    () =>
      transitionTask({
        taskId: created.task.id,
        toStatus: 'IN_PROGRESS',
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: staleExpectedUpdatedAt,
        ownerKey: ACTOR,
        nextAction: 'the stale caller does not get credit for this',
      }),
    ConcurrencyConflictError
  )
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED', 'STATUS_CHANGED'], 'the rejected stale retry must not add any event')
})

test('transitionTask: unknown task id is rejected', { skip }, async () => {
  await assert.rejects(
    () =>
      transitionTask({
        taskId: '00000000-0000-0000-0000-000000000000',
        toStatus: 'READY',
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: new Date(),
      }),
    TaskNotFoundError
  )
})

// ---------------------------------------------------------------------------
// updateTaskPlan
// ---------------------------------------------------------------------------

test('updateTaskPlan: appends PLAN_UPDATED only when something actually changed', { skip }, async () => {
  const created = await fixtureTask('READY')

  const noop = await updateTaskPlan({
    taskId: created.task.id,
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    nextAction: created.task.nextAction ?? undefined, // same value as already stored
  })
  assert.equal(noop.changed, false)
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED'], 'no-op plan update must not append an event')

  const changed = await updateTaskPlan({
    taskId: created.task.id,
    actorOwnerKey: ACTOR,
    expectedUpdatedAt: created.task.updatedAt,
    nextAction: 'a genuinely different next action',
    priority: 'high',
  })
  assert.equal(changed.changed, true)
  assert.equal(changed.task.nextAction, 'a genuinely different next action')
  assert.equal(changed.task.priority, 'high')
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED', 'PLAN_UPDATED'])
})

test('updateTaskPlan: rejects a plan edit that would violate the current status invariant', { skip }, async () => {
  const created = await fixtureTask('WAITING', { nextCheckAt: new Date(), nextAction: 'waiting' })
  await assert.rejects(
    () =>
      updateTaskPlan({
        taskId: created.task.id,
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: created.task.updatedAt,
        nextCheckAt: null, // WAITING requires this to stay non-null
      }),
    InvalidStateFieldsError
  )
})

test('updateTaskPlan: optimistic concurrency conflict is rejected with no mutation and no event', { skip }, async () => {
  const created = await fixtureTask('READY')
  const staleUpdatedAt = new Date(created.task.updatedAt.getTime() - 1000)
  await assert.rejects(
    () =>
      updateTaskPlan({
        taskId: created.task.id,
        actorOwnerKey: ACTOR,
        expectedUpdatedAt: staleUpdatedAt,
        nextAction: 'should be rejected',
      }),
    ConcurrencyConflictError
  )
  assert.deepEqual(await eventTypesFor(created.task.id), ['CREATED'])
})
