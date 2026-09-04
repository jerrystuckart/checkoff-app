import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeExecutionUsage } from './usageAggregation'
import type { ExecutionRecord } from './executor'
import type { SpecialistResultEnvelope } from './types'

function envelope(overrides: Partial<SpecialistResultEnvelope> = {}): SpecialistResultEnvelope {
  return {
    taskId: 't',
    objective: 'o',
    actionsPerformed: [],
    evidence: {},
    artifacts: [],
    confidence: 'MEDIUM',
    blockers: [],
    discoveredFollowUpWork: [],
    recommendedNextAction: '',
    jerryRequired: false,
    jerryReason: null,
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    ...overrides,
  }
}

function record(options: { request?: Partial<ExecutionRecord['request']>; envelope?: SpecialistResultEnvelope | null }): ExecutionRecord {
  return {
    request: {
      specialist: 'research_verifier',
      playbookKey: 'metro_launch',
      stage: 'M3_BROAD_DISCOVERY',
      objective: 'o',
      inputs: {},
      requiredEvidenceKeys: [],
      methodologyId: 'metro_launch',
      methodologyVersion: 'v1',
      executionId: 'exec-1',
      projectId: 'project-1',
      destinationId: null,
      metroId: null,
      allowedCapabilities: [],
      authorityOperations: [],
      idempotencyKey: 'idem-1',
      ...options.request,
    },
    status: 'COMPLETE',
    executorType: 'REMOTE_AI_EXECUTOR',
    startedAt: '2026-09-08T00:00:00.000Z',
    completedAt: '2026-09-08T00:00:01.000Z',
    envelope: options.envelope ?? null,
    attempts: 1,
    retriedAt: [],
    errorReason: null,
  }
}

test('summarizeExecutionUsage: sums real usage/cost across all five dimensions plus overall', () => {
  const records: ExecutionRecord[] = [
    record({
      request: { projectId: 'proj-a', playbookKey: 'destination_hub_lifecycle', methodologyId: 'destination/dva1', methodologyVersion: 'v2', specialist: 'destination_strategist' },
      envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.006, pricingVersion: 'v1', available: true } }),
    }),
    record({
      request: { projectId: 'proj-a', playbookKey: 'destination_hub_lifecycle', methodologyId: 'destination/dva2', methodologyVersion: 'v2', specialist: 'destination_strategist', executionId: 'exec-2', idempotencyKey: 'idem-2' },
      envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 3000, outputTokens: 1500, totalTokens: 4500, costUsd: 0.018, pricingVersion: 'v1', available: true } }),
    }),
    record({
      request: { projectId: 'proj-b', playbookKey: 'metro_launch', methodologyId: 'metro_launch', methodologyVersion: 'v1', specialist: 'research_verifier', executionId: 'exec-3', idempotencyKey: 'idem-3' },
      envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 2000, outputTokens: 1000, totalTokens: 3000, costUsd: 0.012, pricingVersion: 'v1', available: true } }),
    }),
  ]

  const summary = summarizeExecutionUsage(records)

  assert.equal(summary.overall.executionCount, 3)
  assert.equal(summary.overall.unavailableCount, 0)
  assert.equal(summary.overall.inputTokens, 6000)
  assert.equal(summary.overall.outputTokens, 3000)
  assert.ok(Math.abs(summary.overall.costUsd - 0.036) < 1e-9)

  assert.equal(summary.byProject['proj-a'].executionCount, 2)
  assert.equal(summary.byProject['proj-b'].executionCount, 1)
  assert.equal(summary.byPlaybook['destination_hub_lifecycle'].executionCount, 2)
  assert.equal(summary.byPlaybook['metro_launch'].executionCount, 1)
  assert.equal(summary.byMethodology['destination/dva1/v2'].executionCount, 1)
  assert.equal(summary.byMethodology['destination/dva2/v2'].executionCount, 1)
  assert.equal(summary.bySpecialist['destination_strategist'].executionCount, 2)
  assert.equal(summary.bySpecialist['research_verifier'].executionCount, 1)
  assert.equal(summary.byProvider['openai'].executionCount, 3)
})

test('summarizeExecutionUsage: an execution with no usage data counts as unavailable, never as $0 cost', () => {
  const records: ExecutionRecord[] = [
    record({ envelope: envelope({ providerKey: 'openai', providerUsage: null }) }),
    record({ envelope: null, request: { executionId: 'exec-2', idempotencyKey: 'idem-2' } }), // MANUAL_EXECUTOR / TestExecutor style — no envelope at all
  ]

  const summary = summarizeExecutionUsage(records)
  assert.equal(summary.overall.executionCount, 2)
  assert.equal(summary.overall.unavailableCount, 2)
  assert.equal(summary.overall.costUsd, 0)
  assert.equal(summary.overall.inputTokens, 0)
})

test('summarizeExecutionUsage: providerUsage.available=false counts as unavailable even when the field itself is present', () => {
  const records: ExecutionRecord[] = [
    record({ envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: null, outputTokens: null, totalTokens: null, costUsd: null, pricingVersion: null, available: false } }) }),
  ]
  const summary = summarizeExecutionUsage(records)
  assert.equal(summary.overall.unavailableCount, 1)
  assert.equal(summary.overall.executionCount, 1)
})
