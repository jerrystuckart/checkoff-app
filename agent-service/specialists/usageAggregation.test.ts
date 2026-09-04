import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeExecutionUsage, computeChiefBriefUsageSummary } from './usageAggregation'
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

function record(options: { request?: Partial<ExecutionRecord['request']>; envelope?: SpecialistResultEnvelope | null; completedAt?: string | null }): ExecutionRecord {
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
    completedAt: options.completedAt !== undefined ? options.completedAt : '2026-09-08T00:00:01.000Z',
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

test('summarizeExecutionUsage: bySpecialist correctly rolls up destination_relationship_manager executions alongside destination_strategist ones (Phase 2I)', () => {
  const records: ExecutionRecord[] = [
    record({
      request: { projectId: 'destination-hood-river-or', destinationId: 'destination-hood-river-or', playbookKey: 'destination_relationship', methodologyId: 'destination_commercial', methodologyVersion: 'v1', specialist: 'destination_relationship_manager' },
      envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1-mini', inputTokens: 500, outputTokens: 200, totalTokens: 700, costUsd: 0.0005, pricingVersion: 'v1', available: true } }),
    }),
  ]
  const summary = summarizeExecutionUsage(records)
  assert.equal(summary.bySpecialist['destination_relationship_manager'].executionCount, 1)
  assert.ok(Math.abs(summary.bySpecialist['destination_relationship_manager'].costUsd - 0.0005) < 1e-9)
})

// ---------------------------------------------------------------------------
// computeChiefBriefUsageSummary — the optional daily/portfolio-brief section
// ---------------------------------------------------------------------------

test('computeChiefBriefUsageSummary: sums today/this-month spend and per-destination spend from real completedAt timestamps', () => {
  const now = new Date('2026-09-08T18:00:00.000Z')
  const records: ExecutionRecord[] = [
    record({
      request: { projectId: 'destination-hood-river-or', destinationId: 'destination-hood-river-or' },
      completedAt: '2026-09-08T10:00:00.000Z', // today
      envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.03, pricingVersion: 'v1', available: true } }),
    }),
    record({
      request: { projectId: 'destination-hood-river-or', destinationId: 'destination-hood-river-or', executionId: 'exec-2', idempotencyKey: 'idem-2' },
      completedAt: '2026-09-01T10:00:00.000Z', // earlier this month, not today
      envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.02, pricingVersion: 'v1', available: true } }),
    }),
    record({
      request: { projectId: 'destination-willcox-az', destinationId: 'destination-willcox-az', executionId: 'exec-3', idempotencyKey: 'idem-3' },
      completedAt: '2026-08-01T10:00:00.000Z', // last month — excluded from both totals
      envelope: envelope({ providerKey: 'openai', providerUsage: { provider: 'openai', model: 'gpt-4.1', inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.05, pricingVersion: 'v1', available: true } }),
    }),
  ]

  const summary = computeChiefBriefUsageSummary(records, now)
  assert.ok(Math.abs(summary.spendTodayUsd - 0.03) < 1e-9)
  assert.ok(Math.abs(summary.spendThisMonthUsd - 0.05) < 1e-9) // today's + earlier-this-month's, never last month's
  assert.ok(Math.abs(summary.perDestinationSpendUsd['destination-hood-river-or'] - 0.05) < 1e-9)
  assert.ok(Math.abs(summary.perDestinationSpendUsd['destination-willcox-az'] - 0.05) < 1e-9)
})

test('computeChiefBriefUsageSummary: unavailable usage never contributes a fabricated cost', () => {
  const now = new Date('2026-09-08T18:00:00.000Z')
  const records: ExecutionRecord[] = [record({ completedAt: '2026-09-08T10:00:00.000Z', envelope: envelope({ providerKey: 'openai', providerUsage: null }) })]
  const summary = computeChiefBriefUsageSummary(records, now)
  assert.equal(summary.spendTodayUsd, 0)
  assert.equal(summary.spendThisMonthUsd, 0)
})
