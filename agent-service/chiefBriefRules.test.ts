// Phase 1B — chiefBriefRules.ts unit tests. Pure computation, no DB, no
// network. Covers: each P0-P3 tier rule, blocked resolutionOwner
// (structured-evidence-only), interaction classification (conservative,
// schema-supported only), deterministic ordering, and the first-brief
// since=null enforcement.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeChiefBrief, computeResolutionOwner, type ChiefBriefInputs } from './chiefBriefRules'
import type {
  TaskSummary,
  JerryTaskSummary,
  WaitingTaskSummary,
  BlockedTaskSummary,
  InteractionSummary,
  TaskEventSummary,
  DecisionEventSummary,
  BlockerRef,
} from './types'
import type { DecisionPromotionSummary } from './queries'

const NOW = new Date('2026-09-02T12:00:00.000Z')
const PROJECT = { id: 'proj-1', projectKey: 'test_project', name: 'Test Project' }

function baseTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    title: 'A task',
    description: null,
    status: 'READY',
    priority: null,
    project: PROJECT,
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
    sourceType: null,
    sourceRef: null,
    projectType: null,
    ...overrides,
  }
}

function jerryTask(overrides: Partial<TaskSummary> = {}): JerryTaskSummary {
  return { ...baseTask({ status: 'NEEDS_JERRY', requiresJerry: true, jerryRequest: 'please decide X', ...overrides }), status: 'NEEDS_JERRY' }
}

function waitingTask(isDueForCheck: boolean, overrides: Partial<TaskSummary> = {}): WaitingTaskSummary {
  return { ...baseTask({ status: 'WAITING', ...overrides }), status: 'WAITING', isDueForCheck }
}

function blockedTask(blockedBy: BlockerRef | null, overrides: Partial<TaskSummary> = {}): BlockedTaskSummary {
  return { ...baseTask({ status: 'BLOCKED', blockedBy, ...overrides }), status: 'BLOCKED' }
}

function decisionPromotion(overrides: Partial<DecisionPromotionSummary> = {}): DecisionPromotionSummary {
  return {
    id: 'decision-1',
    decisionKey: 'test_decision',
    decision: 'We decided a thing.',
    decidedAt: new Date('2026-08-01T00:00:00.000Z'),
    decidedBy: null,
    project: PROJECT,
    durableMemoryRecommendation: 'RECOMMENDED',
    openBrainEligible: false,
    openBrainThoughtId: null,
    ...overrides,
  }
}

function interaction(overrides: Partial<InteractionSummary> = {}): InteractionSummary {
  return {
    id: 'interaction-1',
    channel: 'email',
    direction: 'INBOUND',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
    subject: 'A subject',
    summary: null,
    outcome: null,
    requiresAction: true,
    contact: null,
    project: PROJECT,
    taskId: null,
    ...overrides,
  }
}

function emptyInputs(overrides: Partial<ChiefBriefInputs> = {}): ChiefBriefInputs {
  return {
    needsJerryTasks: [],
    waitingTasks: [],
    blockedTasks: [],
    readyTasks: [],
    pendingRecommendations: [],
    decisionsAwaitingSync: [],
    interactionsRequiringAction: [],
    recentTaskEvents: [],
    recentDecisionEvents: [],
    recentInteractions: [],
    findings: [],
    actionPlans: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// P0-P3 tier rules
// ---------------------------------------------------------------------------

test('tier: NEEDS_JERRY task with no due date is P1', () => {
  const brief = computeChiefBrief(emptyInputs({ needsJerryTasks: [jerryTask()] }), NOW, null)
  assert.equal(brief.needsYou.length, 1)
  assert.equal(brief.needsYou[0].tier, 'P1')
})

test('tier: NEEDS_JERRY task past its due date is P0', () => {
  const brief = computeChiefBrief(emptyInputs({ needsJerryTasks: [jerryTask({ dueAt: new Date('2026-08-01T00:00:00.000Z') })] }), NOW, null)
  assert.equal(brief.needsYou[0].tier, 'P0')
})

test('tier: pending durable-memory recommendation is always P1', () => {
  const brief = computeChiefBrief(emptyInputs({ pendingRecommendations: [decisionPromotion()] }), NOW, null)
  assert.equal(brief.needsYou.length, 1)
  assert.equal(brief.needsYou[0].tier, 'P1')
  assert.equal(brief.needsYou[0].kind, 'decision')
})

test('tier: WAITING task due for check is P1; not due for check is P3', () => {
  const brief = computeChiefBrief(emptyInputs({ waitingTasks: [waitingTask(true, { id: 'w1' }), waitingTask(false, { id: 'w2' })] }), NOW, null)
  const w1 = brief.waiting.find((i) => i.id === 'w1')
  const w2 = brief.waiting.find((i) => i.id === 'w2')
  assert.equal(w1?.tier, 'P1')
  assert.equal(w2?.tier, 'P3')
})

test('tier: READY task with no due date is P2; overdue READY task is P0', () => {
  const brief = computeChiefBrief(
    emptyInputs({
      readyTasks: [baseTask({ id: 'r1' }), baseTask({ id: 'r2', dueAt: new Date('2026-08-01T00:00:00.000Z') })],
    }),
    NOW,
    null
  )
  const r1 = brief.chiefCanHandle.find((i) => i.id === 'r1')
  const r2 = brief.chiefCanHandle.find((i) => i.id === 'r2')
  assert.equal(r1?.tier, 'P2')
  assert.equal(r2?.tier, 'P0')
})

test('tier: an approved-but-unsynced decision is P2 and appears in chiefCanHandle', () => {
  const brief = computeChiefBrief(emptyInputs({ decisionsAwaitingSync: [decisionPromotion({ openBrainEligible: true, durableMemoryRecommendation: 'RECOMMENDED' })] }), NOW, null)
  assert.equal(brief.chiefCanHandle.length, 1)
  assert.equal(brief.chiefCanHandle[0].tier, 'P2')
})

test('tier: blocked task with no due date is P1; overdue blocked task is P0', () => {
  const brief = computeChiefBrief(
    emptyInputs({ blockedTasks: [blockedTask(null, { id: 'b1' }), blockedTask(null, { id: 'b2', dueAt: new Date('2026-08-01T00:00:00.000Z') })] }),
    NOW,
    null
  )
  const b1 = brief.blocked.find((i) => i.id === 'b1')
  const b2 = brief.blocked.find((i) => i.id === 'b2')
  assert.equal(b1?.tier, 'P1')
  assert.equal(b2?.tier, 'P0')
})

// ---------------------------------------------------------------------------
// resolutionOwner — structured evidence only
// ---------------------------------------------------------------------------

test('resolutionOwner: blocker task READY or IN_PROGRESS -> CHIEF', () => {
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'READY' }), 'CHIEF')
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'IN_PROGRESS' }), 'CHIEF')
})

test('resolutionOwner: blocker task NEEDS_JERRY -> JERRY', () => {
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'NEEDS_JERRY' }), 'JERRY')
})

test('resolutionOwner: blocker task WAITING -> EXTERNAL', () => {
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'WAITING' }), 'EXTERNAL')
})

test('resolutionOwner: no linked blocker task -> UNKNOWN (never guessed from note text)', () => {
  assert.equal(computeResolutionOwner(null), 'UNKNOWN')
})

test('resolutionOwner: blocker task BACKLOG/BLOCKED/DONE/CANCELED -> UNKNOWN, not a weak guess', () => {
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'BACKLOG' }), 'UNKNOWN')
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'BLOCKED' }), 'UNKNOWN')
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'DONE' }), 'UNKNOWN')
  assert.equal(computeResolutionOwner({ id: 'x', title: 't', status: 'CANCELED' }), 'UNKNOWN')
})

test('blocked item: a blocker note mentioning "Jerry" does NOT change resolutionOwner away from UNKNOWN when there is no linked blocker task', () => {
  const brief = computeChiefBrief(
    emptyInputs({ blockedTasks: [blockedTask(null, { blockerNote: 'Waiting on Jerry to decide the vendor' })] }),
    NOW,
    null
  )
  assert.equal(brief.blocked[0].resolutionOwner, 'UNKNOWN', 'free-text mention of Jerry must never be treated as structured evidence')
  assert.equal(brief.blocked[0].blockerReason, 'Waiting on Jerry to decide the vendor')
})

// ---------------------------------------------------------------------------
// Interaction classification — conservative, schema-supported only
// ---------------------------------------------------------------------------

test('interactions: requires_action=true is surfaced in needsYou at P1, never auto-classified as waiting/external', () => {
  const brief = computeChiefBrief(emptyInputs({ interactionsRequiringAction: [interaction({ direction: 'OUTBOUND' })] }), NOW, null)
  assert.equal(brief.needsYou.length, 1)
  assert.equal(brief.needsYou[0].kind, 'interaction')
  assert.equal(brief.needsYou[0].tier, 'P1')
  assert.match(brief.needsYou[0].reason, /needs triage/i)
})

// ---------------------------------------------------------------------------
// First-brief since=null enforcement — enforced by computeChiefBrief itself
// ---------------------------------------------------------------------------

test('recentChanges: since=null produces an empty recentChanges section even if change inputs are non-empty', () => {
  const recentTaskEvents: TaskEventSummary[] = [
    { id: 'e1', task: { id: 't1', title: 'T' }, project: PROJECT, eventType: 'CREATED', fromStatus: null, toStatus: 'READY', changedBy: null, changedAt: NOW, note: null },
  ]
  const recentDecisionEvents: DecisionEventSummary[] = [
    { id: 'de1', decision: { id: 'd1', decisionKey: 'k' }, eventType: 'CREATED', actor: null, occurredAt: NOW, note: null },
  ]
  const brief = computeChiefBrief(emptyInputs({ recentTaskEvents, recentDecisionEvents, recentInteractions: [interaction()] }), NOW, null)
  assert.deepEqual(brief.recentChanges, [])
  assert.equal(brief.since, null)
})

test('recentChanges: since set surfaces the passed-in changes, all at P3', () => {
  const recentTaskEvents: TaskEventSummary[] = [
    { id: 'e1', task: { id: 't1', title: 'T' }, project: PROJECT, eventType: 'STATUS_CHANGED', fromStatus: 'READY', toStatus: 'IN_PROGRESS', changedBy: null, changedAt: NOW, note: null },
  ]
  const since = new Date('2026-09-01T00:00:00.000Z')
  const brief = computeChiefBrief(emptyInputs({ recentTaskEvents }), NOW, since)
  assert.equal(brief.since, since)
  assert.equal(brief.recentChanges.length, 1)
  assert.equal(brief.recentChanges[0].tier, 'P3')
  assert.match(brief.recentChanges[0].reason, /STATUS_CHANGED/)
})

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

test('ordering: within a section, P0 sorts before P1, then by relevantAt ascending', () => {
  const brief = computeChiefBrief(
    emptyInputs({
      blockedTasks: [
        blockedTask(null, { id: 'later-p1', dueAt: null, updatedAt: new Date('2026-09-01T00:00:00.000Z') }),
        blockedTask(null, { id: 'overdue-p0', dueAt: new Date('2026-08-01T00:00:00.000Z') }),
        blockedTask(null, { id: 'earlier-p1', dueAt: null, updatedAt: new Date('2026-08-15T00:00:00.000Z') }),
      ],
    }),
    NOW,
    null
  )
  assert.deepEqual(brief.blocked.map((b) => b.id), ['overdue-p0', 'earlier-p1', 'later-p1'])
})

test('ordering is stable across repeated calls with the same input (deterministic, no hidden randomness)', () => {
  const inputs = emptyInputs({
    needsJerryTasks: [jerryTask({ id: 'a' }), jerryTask({ id: 'b', dueAt: new Date('2026-08-01T00:00:00.000Z') })],
  })
  const first = computeChiefBrief(inputs, NOW, null)
  const second = computeChiefBrief(inputs, NOW, null)
  assert.deepEqual(
    first.needsYou.map((i) => i.id),
    second.needsYou.map((i) => i.id)
  )
})

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

test('summary counts match each section length exactly', () => {
  const brief = computeChiefBrief(
    emptyInputs({
      needsJerryTasks: [jerryTask()],
      waitingTasks: [waitingTask(true)],
      readyTasks: [baseTask()],
      blockedTasks: [blockedTask(null)],
    }),
    NOW,
    null
  )
  assert.deepEqual(brief.summary, {
    needsYouCount: 1,
    waitingCount: 1,
    chiefCanHandleCount: 1,
    blockedCount: 1,
    recentChangesCount: 0,
  })
})
