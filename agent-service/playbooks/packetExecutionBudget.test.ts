import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePacketExecutionContinuation, DEFAULT_PACKET_EXECUTION_BUDGET, type PacketExecutionBudget } from './packetExecutionBudget'

const BUDGET: PacketExecutionBudget = { maxIncrementalSpendUsd: 3, maxCertificationAttempts: 5 }

test('evaluatePacketExecutionContinuation: continues when spend/attempts are under budget and leads remain', () => {
  const decision = evaluatePacketExecutionContinuation(BUDGET, { spentUsd: 0, attemptsMade: 0, remainingLeads: 4 })
  assert.equal(decision.shouldContinue, true)
})

test('evaluatePacketExecutionContinuation: stops mid-queue once spend budget is reached', () => {
  const decision = evaluatePacketExecutionContinuation(BUDGET, { spentUsd: 3, attemptsMade: 1, remainingLeads: 10 })
  assert.equal(decision.shouldContinue, false)
  assert.match(decision.reason, /spend/i)
})

test('evaluatePacketExecutionContinuation: stops mid-queue once the attempt-count budget is reached', () => {
  const decision = evaluatePacketExecutionContinuation(BUDGET, { spentUsd: 0.5, attemptsMade: 5, remainingLeads: 10 })
  assert.equal(decision.shouldContinue, false)
  assert.match(decision.reason, /attempt/i)
})

test('evaluatePacketExecutionContinuation: stops once the prioritized queue is exhausted, even with budget to spare (never pads to hit a number)', () => {
  const decision = evaluatePacketExecutionContinuation(BUDGET, { spentUsd: 0, attemptsMade: 0, remainingLeads: 0 })
  assert.equal(decision.shouldContinue, false)
  assert.match(decision.reason, /queue/i)
})

test('evaluatePacketExecutionContinuation: a low absolute catalog count elsewhere is irrelevant here — this is purely queue/spend/attempt bounded', () => {
  // Simulates "checkReadinessNotGatedOnCountAlone"-style discipline at the
  // execution layer: an empty queue stops the loop regardless of how few
  // total items the catalog has overall (that is a DIFFERENT metric this
  // module never looks at).
  const decision = evaluatePacketExecutionContinuation(DEFAULT_PACKET_EXECUTION_BUDGET, { spentUsd: 0, attemptsMade: 0, remainingLeads: 0 })
  assert.equal(decision.shouldContinue, false)
})

test('DEFAULT_PACKET_EXECUTION_BUDGET is a real, overridable default, not hardcoded per-metro magic', () => {
  assert.equal(typeof DEFAULT_PACKET_EXECUTION_BUDGET.maxIncrementalSpendUsd, 'number')
  assert.equal(typeof DEFAULT_PACKET_EXECUTION_BUDGET.maxCertificationAttempts, 'number')
})
