import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectExecutor, runExecutionRouted, orderAdaptersForSpecialist } from './routing'
import { InMemoryExecutionStore, type SpecialistExecutor, type SpecialistExecutionRequest } from './executor'
import { TestExecutor, fakeEnvelope } from './testExecutor'
import type { ProviderAdapter } from './remoteAiExecutor'

function fakeAdapter(providerKey: string): ProviderAdapter {
  return { providerKey, supportsLiveWebResearch: true, isConfigured: () => true, complete: async () => ({ text: '{}' }) }
}

test('orderAdaptersForSpecialist: research_verifier prefers openai first, anthropic second', () => {
  const ordered = orderAdaptersForSpecialist('research_verifier', [fakeAdapter('anthropic'), fakeAdapter('openai')])
  assert.deepEqual(ordered.map((a) => a.providerKey), ['openai', 'anthropic'])
})

test('orderAdaptersForSpecialist: an unlisted provider sorts after every preferred one, never dropped', () => {
  const ordered = orderAdaptersForSpecialist('research_verifier', [fakeAdapter('some_future_provider'), fakeAdapter('openai')])
  assert.deepEqual(ordered.map((a) => a.providerKey), ['openai', 'some_future_provider'])
})

function req(overrides: Partial<SpecialistExecutionRequest> = {}): SpecialistExecutionRequest {
  return {
    specialist: 'research_verifier',
    playbookKey: 'metro_launch',
    stage: 'M3_BROAD_DISCOVERY',
    objective: 'broad discovery',
    inputs: {},
    requiredEvidenceKeys: ['candidates'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: 'exec-routing-1',
    projectId: 'project-1',
    destinationId: null,
    metroId: 'metro-1',
    allowedCapabilities: [],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: 'idem-routing-1',
    ...overrides,
  }
}

function alwaysUnavailable(executorType: SpecialistExecutor['executorType']): SpecialistExecutor {
  return {
    executorType,
    canExecute: () => false,
    execute: async () => ({ unavailable: true, reason: 'never available' }),
  }
}

test('selectExecutor: picks the first (highest-priority) executor whose canExecute() is true', () => {
  const remote = new TestExecutor()
  const manual = alwaysUnavailable('MANUAL_EXECUTOR')
  // TestExecutor.canExecute defaults to true for everything not explicitly disabled.
  const chosen = selectExecutor(req(), [remote, manual])
  assert.equal(chosen, remote)
})

test('selectExecutor: falls through to a later executor when an earlier one cannot execute', () => {
  const unavailableRemote = alwaysUnavailable('REMOTE_AI_EXECUTOR')
  const manual = new TestExecutor()
  const chosen = selectExecutor(req(), [unavailableRemote, manual])
  assert.equal(chosen, manual)
})

test('selectExecutor: returns null when nothing qualifies', () => {
  const chosen = selectExecutor(req(), [alwaysUnavailable('REMOTE_AI_EXECUTOR'), alwaysUnavailable('MANUAL_EXECUTOR')])
  assert.equal(chosen, null)
})

test('runExecutionRouted: registers EXECUTOR_UNAVAILABLE (naming every executor tried) when no qualified executor exists', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  const outcome = await runExecutionRouted(store, request, [alwaysUnavailable('REMOTE_AI_EXECUTOR'), alwaysUnavailable('MANUAL_EXECUTOR')])
  assert.ok('status' in outcome)
  assert.equal((outcome as { status: string }).status, 'EXECUTOR_UNAVAILABLE')
  assert.match((outcome as { errorReason: string }).errorReason, /REMOTE_AI_EXECUTOR/)
  assert.match((outcome as { errorReason: string }).errorReason, /MANUAL_EXECUTOR/)
})

test('runExecutionRouted: a qualified executor actually runs and completes the execution', async () => {
  const store = new InMemoryExecutionStore()
  const request = req()
  const executor = new TestExecutor()
  executor.script(request.executionId, fakeEnvelope({ taskId: request.executionId, objective: request.objective, evidence: { candidates: ['a'] }, methodologyId: 'metro_launch', methodologyVersion: 'v1' }))

  const outcome = await runExecutionRouted(store, request, [executor])
  assert.ok('accepted' in outcome && outcome.accepted)
  assert.equal((await store.get(request.executionId))?.status, 'COMPLETE')
})
