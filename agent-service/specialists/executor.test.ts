import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  InMemoryExecutionStore,
  registerExecution,
  acceptExecutionResult,
  retryExecution,
  markExecutorUnavailable,
  assertExecutionAuthorized,
  AuthorityRejectedExecutionError,
  runExecution,
  type SpecialistExecutionRequest,
} from './executor'
import { UnknownAuthorityOperationError } from '../playbooks/standingAuthority'
import { UnknownMethodologyError } from './methodologyRegistry'
import { TestExecutor, fakeEnvelope } from './testExecutor'

function req(overrides: Partial<SpecialistExecutionRequest> = {}): SpecialistExecutionRequest {
  return {
    specialist: 'metro_builder',
    playbookKey: 'metro_launch',
    stage: 'M4_COVERAGE_AUDIT',
    objective: 'audit San Diego category coverage',
    inputs: {},
    requiredEvidenceKeys: ['categoryCounts'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: 'exec-1',
    projectId: 'project-san-diego',
    destinationId: null,
    metroId: 'metro-san-diego',
    allowedCapabilities: ['checkoff_db_read'],
    authorityOperations: ['metro_launch.coverage_count'],
    idempotencyKey: 'idem-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Authority enforcement
// ---------------------------------------------------------------------------

test('assertExecutionAuthorized: throws AuthorityRejectedExecutionError for an APPROVAL_REQUIRED operation', () => {
  assert.throws(() => assertExecutionAuthorized(req({ authorityOperations: ['metro_launch.public_launch'] })), AuthorityRejectedExecutionError)
})

test('assertExecutionAuthorized: throws UnknownAuthorityOperationError for an unregistered operation — never treated as implicitly safe', () => {
  assert.throws(() => assertExecutionAuthorized(req({ authorityOperations: ['totally_unregistered_op'] })), UnknownAuthorityOperationError)
})

test('registerExecution: refuses to create an execution requesting APPROVAL_REQUIRED authority', async () => {
  const store = new InMemoryExecutionStore()
  await assert.rejects(() => registerExecution(store, req({ authorityOperations: ['metro_launch.public_launch'] }), 'LOCAL_TOOL_EXECUTOR'), AuthorityRejectedExecutionError)
})

// ---------------------------------------------------------------------------
// Methodology validation
// ---------------------------------------------------------------------------

test('registerExecution: refuses an unregistered methodology', async () => {
  const store = new InMemoryExecutionStore()
  await assert.rejects(() => registerExecution(store, req({ methodologyId: 'made_up', methodologyVersion: 'v99', idempotencyKey: 'idem-methodology' }), 'LOCAL_TOOL_EXECUTOR'), UnknownMethodologyError)
})

test('registerExecution: refuses a methodology not allowed for this specialist', async () => {
  const store = new InMemoryExecutionStore()
  await assert.rejects(() => registerExecution(store, req({ specialist: 'checkoff_editor', idempotencyKey: 'idem-owner-mismatch' }), 'LOCAL_TOOL_EXECUTOR'), /may be executed by/)
})

// ---------------------------------------------------------------------------
// Successful execution end-to-end via runExecution
// ---------------------------------------------------------------------------

test('runExecution: a successful specialist execution is accepted and marked COMPLETE', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  const request = req()
  executor.script(request.executionId, fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { categoryCounts: [{ categoryName: 'Food', count: 10 }] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' }))

  const outcome = await runExecution(store, request, executor)
  assert.ok('accepted' in outcome && outcome.accepted)
  assert.equal((await store.get(request.executionId))?.status, 'COMPLETE')
})

// ---------------------------------------------------------------------------
// Evidence validation
// ---------------------------------------------------------------------------

test('acceptExecutionResult: missing required evidence -> NEEDS_MORE_EVIDENCE, never COMPLETE', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  const outcome = await acceptExecutionResult(
    store,
    { executionId: request.executionId, projectId: request.projectId, destinationId: request.destinationId, metroId: request.metroId, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
    fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: {}, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  assert.equal(outcome.accepted, false)
  assert.equal(outcome.record.status, 'NEEDS_MORE_EVIDENCE')
})

// ---------------------------------------------------------------------------
// Hard result isolation (spec section 15) — wrong project/destination/
// stage/methodology version must all be rejected.
// ---------------------------------------------------------------------------

test('acceptExecutionResult: rejects a result submitted against the wrong project', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  await assert.rejects(
    () =>
      acceptExecutionResult(
        store,
        { executionId: request.executionId, projectId: 'a-different-project', destinationId: request.destinationId, metroId: request.metroId, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
        fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { categoryCounts: [1] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
      ),
    /Execution identity mismatch/
  )
})

test('acceptExecutionResult: rejects a result submitted against the wrong destination', async () => {
  const store = new InMemoryExecutionStore()
  const request = req({ destinationId: 'destination-willcox', metroId: null, idempotencyKey: 'idem-dest' })
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  await assert.rejects(
    () =>
      acceptExecutionResult(
        store,
        { executionId: request.executionId, projectId: request.projectId, destinationId: 'destination-grand-lake', metroId: null, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
        fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { categoryCounts: [1] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
      ),
    /Execution identity mismatch/
  )
})

test('acceptExecutionResult: rejects a result submitted against the wrong stage', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  await assert.rejects(
    () =>
      acceptExecutionResult(
        store,
        { executionId: request.executionId, projectId: request.projectId, destinationId: request.destinationId, metroId: request.metroId, playbookKey: request.playbookKey, stage: 'M6_QUALITY_VERIFICATION', methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
        fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { categoryCounts: [1] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
      ),
    /Execution identity mismatch/
  )
})

test('acceptExecutionResult: rejects a result claiming a different methodology version', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  await assert.rejects(
    () =>
      acceptExecutionResult(
        store,
        { executionId: request.executionId, projectId: request.projectId, destinationId: request.destinationId, metroId: request.metroId, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: 'v2' },
        fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { categoryCounts: [1] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
      ),
    /Execution identity mismatch/
  )
})

// ---------------------------------------------------------------------------
// Idempotency / duplicate submission (spec section 12/16)
// ---------------------------------------------------------------------------

test('registerExecution: same idempotencyKey returns the SAME execution, never a duplicate', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  const first = await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  const second = await registerExecution(store, req({ executionId: 'exec-should-be-ignored' }), 'LOCAL_TOOL_EXECUTOR')
  assert.equal(first.request.executionId, second.request.executionId)
  assert.equal((await store.all()).length, 1)
})

test('acceptExecutionResult: the same completed execution submitted a second time is a no-op, never re-advances', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  const identity = { executionId: request.executionId, projectId: request.projectId, destinationId: request.destinationId, metroId: request.metroId, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion }
  const envelope = fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { categoryCounts: [1] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })

  const first = await acceptExecutionResult(store, identity, envelope)
  const second = await acceptExecutionResult(store, identity, envelope)

  assert.equal(first.accepted, true)
  assert.equal(second.accepted, false)
  assert.equal(second.duplicate, true)
})

// ---------------------------------------------------------------------------
// Failed execution / executor unavailable / retry
// ---------------------------------------------------------------------------

test('runExecution: an executor that cannot handle the request is recorded as EXECUTOR_UNAVAILABLE, never faked as complete', async () => {
  const store = new InMemoryExecutionStore()
  const executor = new TestExecutor()
  executor.makeSpecialistUnavailable('destination_strategist')
  const request = req({ specialist: 'destination_strategist', methodologyId: 'destination/dva1', methodologyVersion: 'v1', authorityOperations: ['destination_hub.dva1_screen'], idempotencyKey: 'idem-unavailable' })

  const outcome = await runExecution(store, request, executor)
  assert.ok('status' in outcome)
  assert.equal((outcome as { status: string }).status, 'EXECUTOR_UNAVAILABLE')
})

test('markExecutorUnavailable then retryExecution: a failed/unavailable execution can be reissued', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  await markExecutorUnavailable(store, request.executionId, 'provider outage')
  assert.equal((await store.get(request.executionId))?.status, 'EXECUTOR_UNAVAILABLE')

  const retried = await retryExecution(store, request.executionId)
  assert.equal(retried.status, 'PENDING')
  assert.equal(retried.retriedAt.length, 1)
})

test('retryExecution: refuses to retry an already-COMPLETE execution', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  await acceptExecutionResult(
    store,
    { executionId: request.executionId, projectId: request.projectId, destinationId: request.destinationId, metroId: request.metroId, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
    fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { categoryCounts: [1] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  )
  await assert.rejects(() => retryExecution(store, request.executionId), /already COMPLETE/)
})

test('a FAILED execution (evidence validation failure) does not corrupt the store — the record stays retrievable, not COMPLETE', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  await registerExecution(store, request, 'LOCAL_TOOL_EXECUTOR')
  const badEnvelope = fakeEnvelope({ taskId: '', objective: request.objective, evidence: { categoryCounts: [1] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' })
  const outcome = await acceptExecutionResult(
    store,
    { executionId: request.executionId, projectId: request.projectId, destinationId: request.destinationId, metroId: request.metroId, playbookKey: request.playbookKey, stage: request.stage, methodologyId: request.methodologyId, methodologyVersion: request.methodologyVersion },
    badEnvelope
  )
  assert.equal(outcome.accepted, false)
  assert.notEqual(outcome.record.status, 'COMPLETE')
  assert.equal((await store.get(request.executionId))?.status, outcome.record.status)
})
