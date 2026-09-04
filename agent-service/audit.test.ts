// Phase 0E — pure unit tests for the audit anomaly logic. NO DATABASE
// NEEDED ANYWHERE IN THIS FILE: every test builds fixture
// ProjectSummary/TaskSummary objects by hand and calls the pure functions
// in auditRules.ts directly. This is exactly what the Phase 0D safety
// lesson calls for — anomaly logic tested without touching a live
// database at all, so these run unconditionally as part of routine
// `npm run agent:test`, no gate needed, zero risk of writing anything
// (there is no write path here to accidentally trigger).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeAttentionFindings,
  computeExceptionFindings,
  computeBlockerCycles,
  computeProjectHealth,
  compareFindings,
  computeChiefAuditReport,
} from './auditRules'
import { renderChiefAuditReport } from './renderAudit'
import { DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS } from './auditTypes'
import type { AuditFinding, FindingSeverity } from './auditTypes'
import type { ProjectSummary, TaskSummary, TaskStatus, ProjectStatus, BlockerRef } from './types'

const NOW = new Date('2026-08-31T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

let projectSeq = 0
function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  projectSeq += 1
  return {
    id: `proj-${projectSeq}`,
    projectKey: `test_project_${projectSeq}`,
    name: `Test Project ${projectSeq}`,
    projectType: 'INTERNAL',
    status: 'ACTIVE',
    priority: null,
    owner: null,
    targetAt: null,
    lastActivityAt: null,
    summary: null,
    ...overrides,
  }
}

const DEFAULT_PROJECT_REF = { id: 'proj-default', projectKey: 'default_project', name: 'Default Project' }

let taskSeq = 0
function makeTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  taskSeq += 1
  return {
    id: `task-${taskSeq}`,
    title: `Test Task ${taskSeq}`,
    description: null,
    status: 'READY',
    priority: null,
    project: DEFAULT_PROJECT_REF,
    owner: null,
    dueAt: null,
    nextCheckAt: null,
    nextAction: 'do something',
    requiresJerry: false,
    jerryRequest: null,
    blockedBy: null,
    blockerNote: null,
    contact: null,
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    sourceType: null,
    sourceRef: null,
    projectType: null,
    ...overrides,
  }
}

function codesOf(findings: AuditFinding[]): string[] {
  return findings.map((f) => f.code)
}

// ---------------------------------------------------------------------------
// Attention
// ---------------------------------------------------------------------------

test('attention: NEEDS_JERRY task produces TASK_NEEDS_JERRY', () => {
  const task = makeTask({ status: 'NEEDS_JERRY', requiresJerry: true, jerryRequest: 'approve budget' })
  const findings = computeAttentionFindings([task], NOW)
  assert.deepEqual(codesOf(findings), ['TASK_NEEDS_JERRY'])
  assert.equal(findings[0].severity, 'HIGH')
  assert.match(findings[0].message, /approve budget/)
})

test('attention: task with due_at in the past and non-terminal status produces TASK_OVERDUE', () => {
  const task = makeTask({ status: 'READY', dueAt: new Date(NOW.getTime() - DAY) })
  const findings = computeAttentionFindings([task], NOW)
  assert.ok(codesOf(findings).includes('TASK_OVERDUE'))
  const overdue = findings.find((f) => f.code === 'TASK_OVERDUE')!
  assert.equal(overdue.severity, 'HIGH')
})

test('attention: a DONE task with a past due_at does NOT produce TASK_OVERDUE (terminal excluded)', () => {
  const task = makeTask({ status: 'DONE', dueAt: new Date(NOW.getTime() - DAY), completedAt: NOW })
  const findings = computeAttentionFindings([task], NOW)
  assert.ok(!codesOf(findings).includes('TASK_OVERDUE'))
})

test('attention: WAITING task with next_check_at <= now produces WAITING_DUE_FOR_CHECK', () => {
  const task = makeTask({ status: 'WAITING', nextCheckAt: new Date(NOW.getTime() - DAY) })
  const findings = computeAttentionFindings([task], NOW)
  assert.deepEqual(codesOf(findings), ['WAITING_DUE_FOR_CHECK'])
})

test('attention: WAITING task with next_check_at in the future produces no finding yet', () => {
  const task = makeTask({ status: 'WAITING', nextCheckAt: new Date(NOW.getTime() + DAY) })
  const findings = computeAttentionFindings([task], NOW)
  assert.equal(findings.length, 0)
})

test('attention: READY task produces TASK_READY (legitimate work, not an anomaly)', () => {
  const task = makeTask({ status: 'READY' })
  const findings = computeAttentionFindings([task], NOW)
  assert.deepEqual(codesOf(findings), ['TASK_READY'])
  assert.equal(findings[0].severity, 'LOW')
})

test('attention: BLOCKED task produces TASK_BLOCKED including blocker task title/status', () => {
  const blocker: BlockerRef = { id: 'blocker-1', title: 'The blocker task', status: 'IN_PROGRESS' }
  const task = makeTask({ status: 'BLOCKED', blockedBy: blocker, blockerNote: null })
  const findings = computeAttentionFindings([task], NOW)
  assert.deepEqual(codesOf(findings), ['TASK_BLOCKED'])
  assert.match(findings[0].message, /The blocker task/)
  assert.equal(findings[0].metadata.blockedByTaskId, 'blocker-1')
})

test('attention: a task can produce multiple findings, but summary counts unique tasks separately', () => {
  // BLOCKED + overdue at once.
  const task = makeTask({ status: 'BLOCKED', blockerNote: 'waiting on vendor', dueAt: new Date(NOW.getTime() - DAY) })
  const report = computeChiefAuditReport([], [task], { now: NOW })
  assert.equal(report.summary.attentionFindingCount, 2, 'two findings: TASK_BLOCKED + TASK_OVERDUE')
  assert.equal(report.summary.uniqueTasksNeedingAttention, 1, 'but only one distinct task')
})

// ---------------------------------------------------------------------------
// Stale IN_PROGRESS / READY
// ---------------------------------------------------------------------------

test('exceptions: IN_PROGRESS task past the default threshold is flagged, one just under is not', () => {
  const stale = makeTask({ status: 'IN_PROGRESS', updatedAt: new Date(NOW.getTime() - (DEFAULT_STALE_IN_PROGRESS_DAYS + 1) * DAY) })
  const fresh = makeTask({ status: 'IN_PROGRESS', updatedAt: new Date(NOW.getTime() - (DEFAULT_STALE_IN_PROGRESS_DAYS - 1) * DAY) })
  const findings = computeExceptionFindings([], [stale, fresh], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  const flaggedIds = findings.filter((f) => f.code === 'IN_PROGRESS_STALE').map((f) => f.entityId)
  assert.deepEqual(flaggedIds, [stale.id])
})

test('exceptions: READY task past the default threshold is flagged as a LOW-severity warning, one just under is not', () => {
  const stale = makeTask({ status: 'READY', updatedAt: new Date(NOW.getTime() - (DEFAULT_STALE_READY_DAYS + 1) * DAY) })
  const fresh = makeTask({ status: 'READY', updatedAt: new Date(NOW.getTime() - (DEFAULT_STALE_READY_DAYS - 1) * DAY) })
  const findings = computeExceptionFindings([], [stale, fresh], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  const readyStale = findings.filter((f) => f.code === 'READY_STALE')
  assert.equal(readyStale.length, 1)
  assert.equal(readyStale[0].entityId, stale.id)
  assert.equal(readyStale[0].severity, 'LOW')
})

test('exceptions: custom staleInProgressDays/staleReadyDays thresholds are honored', () => {
  const task = makeTask({ status: 'IN_PROGRESS', updatedAt: new Date(NOW.getTime() - 3 * DAY) })
  const withDefault = computeExceptionFindings([], [task], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.equal(withDefault.filter((f) => f.code === 'IN_PROGRESS_STALE').length, 0, 'not stale under the default 7-day threshold')

  const withTightThreshold = computeExceptionFindings([], [task], NOW, 2, DEFAULT_STALE_READY_DAYS)
  assert.equal(withTightThreshold.filter((f) => f.code === 'IN_PROGRESS_STALE').length, 1, 'stale under a tighter 2-day threshold')
})

// ---------------------------------------------------------------------------
// Project-level exceptions
// ---------------------------------------------------------------------------

test('exceptions: ACTIVE project with zero open tasks produces ACTIVE_PROJECT_NO_OPEN_TASKS (INFO)', () => {
  const project = makeProject({ status: 'ACTIVE' })
  const doneTask = makeTask({ status: 'DONE', project: { id: project.id, projectKey: project.projectKey, name: project.name }, completedAt: NOW })
  const findings = computeExceptionFindings([project], [doneTask], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.deepEqual(
    findings.filter((f) => f.entityType === 'project').map((f) => f.code),
    ['ACTIVE_PROJECT_NO_OPEN_TASKS']
  )
  assert.equal(findings.find((f) => f.code === 'ACTIVE_PROJECT_NO_OPEN_TASKS')!.severity, 'INFO')
})

test('exceptions: ACTIVE project WITH an open task produces no ACTIVE_PROJECT_NO_OPEN_TASKS finding', () => {
  const project = makeProject({ status: 'ACTIVE' })
  const openTask = makeTask({ status: 'READY', project: { id: project.id, projectKey: project.projectKey, name: project.name } })
  const findings = computeExceptionFindings([project], [openTask], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.equal(findings.filter((f) => f.code === 'ACTIVE_PROJECT_NO_OPEN_TASKS').length, 0)
})

test('exceptions: ON_HOLD project with a task in an active-work status produces ON_HOLD_PROJECT_HAS_ACTIVE_WORK', () => {
  const project = makeProject({ status: 'ON_HOLD' })
  const readyTask = makeTask({ status: 'READY', project: { id: project.id, projectKey: project.projectKey, name: project.name } })
  const findings = computeExceptionFindings([project], [readyTask], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.deepEqual(
    findings.filter((f) => f.entityType === 'project').map((f) => f.code),
    ['ON_HOLD_PROJECT_HAS_ACTIVE_WORK']
  )
})

test('exceptions: ON_HOLD project with only BACKLOG tasks does NOT flag ON_HOLD_PROJECT_HAS_ACTIVE_WORK', () => {
  const project = makeProject({ status: 'ON_HOLD' })
  const backlogTask = makeTask({ status: 'BACKLOG', project: { id: project.id, projectKey: project.projectKey, name: project.name } })
  const findings = computeExceptionFindings([project], [backlogTask], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.equal(findings.filter((f) => f.code === 'ON_HOLD_PROJECT_HAS_ACTIVE_WORK').length, 0)
})

test('exceptions: terminal (COMPLETED) project with a non-terminal task produces high-severity TERMINAL_PROJECT_HAS_OPEN_TASKS', () => {
  const project = makeProject({ status: 'COMPLETED' })
  const openTask = makeTask({ status: 'IN_PROGRESS', project: { id: project.id, projectKey: project.projectKey, name: project.name } })
  const findings = computeExceptionFindings([project], [openTask], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  const finding = findings.find((f) => f.code === 'TERMINAL_PROJECT_HAS_OPEN_TASKS')
  assert.ok(finding)
  assert.equal(finding!.severity, 'HIGH')
})

// ---------------------------------------------------------------------------
// Blocker anomalies
// ---------------------------------------------------------------------------

test('exceptions: BLOCKED task whose blocker is now DONE produces BLOCKER_IS_TERMINAL', () => {
  const blocker: BlockerRef = { id: 'blocker-done', title: 'Finished blocker', status: 'DONE' }
  const task = makeTask({ status: 'BLOCKED', blockedBy: blocker })
  const findings = computeExceptionFindings([], [task], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.ok(codesOf(findings).includes('BLOCKER_IS_TERMINAL'))
})

test('exceptions: a task blocking itself produces high-severity TASK_BLOCKS_ITSELF and no BLOCKER_CYCLE', () => {
  const task = makeTask({ status: 'BLOCKED' })
  task.blockedBy = { id: task.id, title: task.title, status: 'BLOCKED' } // self-reference after construction so id matches
  const findings = computeExceptionFindings([], [task], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.deepEqual(
    findings.map((f) => f.code).filter((c) => c === 'TASK_BLOCKS_ITSELF' || c === 'BLOCKER_CYCLE'),
    ['TASK_BLOCKS_ITSELF']
  )
  assert.equal(findings.find((f) => f.code === 'TASK_BLOCKS_ITSELF')!.severity, 'HIGH')
})

test('blocker cycle: a 3-task cycle produces exactly ONE BLOCKER_CYCLE finding naming all 3 tasks', () => {
  const t1 = makeTask({ id: 'cycle-a', title: 'Cycle A', status: 'BLOCKED' })
  const t2 = makeTask({ id: 'cycle-b', title: 'Cycle B', status: 'BLOCKED' })
  const t3 = makeTask({ id: 'cycle-c', title: 'Cycle C', status: 'BLOCKED' })
  t1.blockedBy = { id: t2.id, title: t2.title, status: t2.status }
  t2.blockedBy = { id: t3.id, title: t3.title, status: t3.status }
  t3.blockedBy = { id: t1.id, title: t1.title, status: t1.status }

  const findings = computeBlockerCycles([t1, t2, t3])
  assert.equal(findings.length, 1, 'exactly one finding for the whole cycle, not one per task')
  assert.equal(findings[0].code, 'BLOCKER_CYCLE')
  const cycleIds = (findings[0].metadata.cycle as Array<{ id: string }>).map((c) => c.id).sort()
  assert.deepEqual(cycleIds, ['cycle-a', 'cycle-b', 'cycle-c'])
})

test('blocker cycle: deduplicated even with an extra task pointing INTO the cycle from outside', () => {
  const t1 = makeTask({ id: 'cyc2-a', status: 'BLOCKED' })
  const t2 = makeTask({ id: 'cyc2-b', status: 'BLOCKED' })
  const tail = makeTask({ id: 'cyc2-tail', status: 'BLOCKED' })
  t1.blockedBy = { id: t2.id, title: t2.title, status: t2.status }
  t2.blockedBy = { id: t1.id, title: t1.title, status: t1.status }
  tail.blockedBy = { id: t1.id, title: t1.title, status: t1.status } // points into the cycle, not part of it

  const findings = computeBlockerCycles([t1, t2, tail])
  assert.equal(findings.length, 1)
  const cycleIds = (findings[0].metadata.cycle as Array<{ id: string }>).map((c) => c.id).sort()
  assert.deepEqual(cycleIds, ['cyc2-a', 'cyc2-b'], 'the tail task must not be reported as part of the cycle')
})

test('blocker cycle: two independent cycles each produce their own single finding', () => {
  const a1 = makeTask({ id: 'grpA-1', status: 'BLOCKED' })
  const a2 = makeTask({ id: 'grpA-2', status: 'BLOCKED' })
  a1.blockedBy = { id: a2.id, title: a2.title, status: a2.status }
  a2.blockedBy = { id: a1.id, title: a1.title, status: a1.status }

  const b1 = makeTask({ id: 'grpB-1', status: 'BLOCKED' })
  const b2 = makeTask({ id: 'grpB-2', status: 'BLOCKED' })
  b1.blockedBy = { id: b2.id, title: b2.title, status: b2.status }
  b2.blockedBy = { id: b1.id, title: b1.title, status: b1.status }

  const findings = computeBlockerCycles([a1, a2, b1, b2])
  assert.equal(findings.length, 2)
})

// ---------------------------------------------------------------------------
// Project health
// ---------------------------------------------------------------------------

test('project health: counts match the tasks under that project, ACTIVE and ON_HOLD are both included', () => {
  const active = makeProject({ status: 'ACTIVE' })
  const onHold = makeProject({ status: 'ON_HOLD' })
  const activeRef = { id: active.id, projectKey: active.projectKey, name: active.name }
  const tasks = [
    makeTask({ status: 'READY', project: activeRef }),
    makeTask({ status: 'IN_PROGRESS', project: activeRef }),
    makeTask({ status: 'WAITING', project: activeRef, nextCheckAt: new Date(NOW.getTime() - DAY) }),
    makeTask({ status: 'DONE', project: activeRef, completedAt: NOW }),
  ]
  const health = computeProjectHealth([active, onHold], tasks, NOW, [])
  const activeHealth = health.find((h) => h.project.id === active.id)!
  assert.equal(activeHealth.counts.open, 3)
  assert.equal(activeHealth.counts.ready, 1)
  assert.equal(activeHealth.counts.inProgress, 1)
  assert.equal(activeHealth.counts.waiting, 1)
  assert.equal(activeHealth.counts.dueForCheck, 1)
  assert.ok(health.some((h) => h.project.id === onHold.id), 'ON_HOLD project must still appear in project health')
})

test('project health: a COMPLETED project is excluded from projectHealth output', () => {
  const completed = makeProject({ status: 'COMPLETED' })
  const health = computeProjectHealth([completed], [], NOW, [])
  assert.equal(health.length, 0)
})

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

function bareFinding(overrides: Partial<AuditFinding>): AuditFinding {
  return {
    code: 'TASK_READY',
    severity: 'LOW',
    entityType: 'task',
    entityId: 'x',
    project: null,
    task: null,
    message: 'x',
    relevantAt: null,
    metadata: {},
    ...overrides,
  }
}

test('sorting: severities sort CRITICAL, HIGH, MEDIUM, LOW, INFO regardless of input order', () => {
  const order: FindingSeverity[] = ['LOW', 'CRITICAL', 'INFO', 'HIGH', 'MEDIUM']
  const findings = order.map((severity) => bareFinding({ severity, entityId: severity }))
  const sorted = [...findings].sort(compareFindings)
  assert.deepEqual(
    sorted.map((f) => f.severity),
    ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
  )
})

test('sorting within severity: relevantAt ascending, then project key, then task title, then code', () => {
  const late = bareFinding({ severity: 'HIGH', relevantAt: new Date('2026-09-02'), entityId: '1' })
  const early = bareFinding({ severity: 'HIGH', relevantAt: new Date('2026-09-01'), entityId: '2' })
  const noTime = bareFinding({ severity: 'HIGH', relevantAt: null, entityId: '3' })
  const sorted = [late, noTime, early].sort(compareFindings)
  assert.deepEqual(
    sorted.map((f) => f.entityId),
    ['2', '1', '3'],
    'earliest timestamp first, then later timestamp, nulls last'
  )

  const projB = bareFinding({ severity: 'HIGH', project: { id: 'p', key: 'b_project', title: 'B' }, entityId: 'projB' })
  const projA = bareFinding({ severity: 'HIGH', project: { id: 'p', key: 'a_project', title: 'A' }, entityId: 'projA' })
  const byProject = [projB, projA].sort(compareFindings)
  assert.deepEqual(byProject.map((f) => f.entityId), ['projA', 'projB'])

  const codeB = bareFinding({ severity: 'HIGH', code: 'TASK_OVERDUE', entityId: 'codeB' })
  const codeA = bareFinding({ severity: 'HIGH', code: 'BLOCKER_CYCLE', entityId: 'codeA' })
  const byCode = [codeB, codeA].sort(compareFindings)
  assert.deepEqual(byCode.map((f) => f.entityId), ['codeA', 'codeB'])
})

// ---------------------------------------------------------------------------
// Explicit `now`
// ---------------------------------------------------------------------------

test('explicit now: the same task is overdue under one `now` and not overdue under an earlier `now`', () => {
  const task = makeTask({ status: 'READY', dueAt: new Date('2026-08-15T00:00:00.000Z') })
  const before = computeChiefAuditReport([], [task], { now: new Date('2026-08-01T00:00:00.000Z') })
  const after = computeChiefAuditReport([], [task], { now: new Date('2026-08-20T00:00:00.000Z') })
  assert.equal(before.summary.attentionByCode.TASK_OVERDUE ?? 0, 0)
  assert.equal(after.summary.attentionByCode.TASK_OVERDUE ?? 0, 1)
})

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

test('renderer: known report produces exact expected output (snapshot)', () => {
  const project = makeProject({ id: 'proj-snap', projectKey: 'denver_metro', name: 'Denver Metro', status: 'ACTIVE' })
  const waitingTask = makeTask({
    id: 'task-snap-1',
    title: 'Denver Featured outreach — track replies',
    status: 'WAITING',
    project: { id: project.id, projectKey: project.projectKey, name: project.name },
    nextCheckAt: new Date('2026-08-30T00:00:00.000Z'),
    nextAction: 'check replies',
  })
  const report = computeChiefAuditReport([project], [waitingTask], { now: NOW })
  const rendered = renderChiefAuditReport(report)

  const expected = [
    'CHIEF AUDIT — 2026-08-31',
    '',
    'ATTENTION',
    '1 follow-up(s) due for check',
    '0 ready task(s)',
    '0 blocked task(s)',
    '0 needs Jerry',
    '0 overdue',
    '(1 unique task(s), 1 finding(s) total)',
    '',
    'EXCEPTIONS',
    '  none',
    '',
    'PROJECT HEALTH',
    '  denver_metro: open=1 ready=0 inProgress=0 waiting=1 blocked=0 needsJerry=0 overdue=0 dueForCheck=1',
  ].join('\n')

  assert.equal(rendered, expected)
})

test('renderer: empty report renders "none" sections without throwing', () => {
  const report = computeChiefAuditReport([], [], { now: NOW })
  const rendered = renderChiefAuditReport(report)
  assert.match(rendered, /EXCEPTIONS\n {2}none/)
  assert.match(rendered, /PROJECT HEALTH\n {2}none/)
})

// ---------------------------------------------------------------------------
// Cross-cutting: does not reimplement Phase 0A CHECK constraints as noise
// ---------------------------------------------------------------------------

test('exceptions: a normally-shaped WAITING task (has next_action, per the DB CHECK constraint) produces no integrity-style noise finding', () => {
  const task = makeTask({ status: 'WAITING', nextCheckAt: new Date(NOW.getTime() + DAY), nextAction: 'follow up' })
  const findings = computeExceptionFindings([], [task], NOW, DEFAULT_STALE_IN_PROGRESS_DAYS, DEFAULT_STALE_READY_DAYS)
  assert.equal(findings.length, 0, 'a valid WAITING task should produce zero exception findings')
})
