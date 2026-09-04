// Chief Phase 2E — dbExecutionStore tests. Fully mocked (no live
// database — this environment has no AGENT_SERVICE_DATABASE_URL, same as
// every other DB-writing module in this repo; see mutations.test.ts's
// AGENT_SERVICE_ALLOW_MUTATION_TESTS gate for the existing precedent).
//
// FakeAgentDb below is a faithful-enough in-memory reimplementation of
// the exact agent.tasks/agent.task_events contract mutations.ts/queries.ts
// expose (source_type/source_ref idempotent creation, optimistic
// concurrency via updatedAt, task_events accumulation with JSONB
// metadata) — NOT a mock that just records calls. This lets these tests
// prove the real thing dbExecutionStore.ts needs to prove: a record
// written by one store instance is correctly read back by a SECOND,
// independently constructed store instance sharing the same backing
// "database" — i.e. genuine reload-after-restart behavior — without
// needing Postgres running in this environment.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DbExecutionStore, taskStatusForExecutionStatus, type DbExecutionStoreDeps } from './dbExecutionStore'
import type { ExecutionRecord, SpecialistExecutionRequest } from './executor'
import type { TaskSummary, TaskEventDetail, TaskStatus } from '../types'
import type { CreateTaskInput, CreateTaskResult, TransitionTaskInput, TransitionTaskResult, RecordPlaybookStageInput, RecordPlaybookStageResult } from '../mutations'

// ---------------------------------------------------------------------------
// FakeAgentDb — shared backing store two independent DbExecutionStore
// instances can both point at, to prove cross-instance persistence.
// ---------------------------------------------------------------------------

interface FakeTaskRow {
  id: string
  title: string
  status: TaskStatus
  sourceType: string | null
  sourceRef: string | null
  blockerNote: string | null
  updatedAt: Date
}

interface FakeEventRow {
  id: string
  taskId: string
  eventType: string
  metadata: Record<string, unknown>
  changedAt: Date
}

class FakeAgentDb {
  tasks: FakeTaskRow[] = []
  events: FakeEventRow[] = []
  private seq = 0

  private nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}-${this.seq}`
  }

  toTaskSummary(row: FakeTaskRow): TaskSummary {
    return {
      id: row.id,
      title: row.title,
      description: null,
      status: row.status,
      priority: null,
      project: { id: 'project-1', projectKey: 'project-1', name: 'Project' },
      owner: null,
      dueAt: null,
      nextCheckAt: null,
      nextAction: null,
      requiresJerry: row.status === 'NEEDS_JERRY',
      jerryRequest: null,
      blockedBy: null,
      blockerNote: row.blockerNote,
      contact: null,
      startedAt: null,
      completedAt: null,
      createdAt: row.updatedAt,
      updatedAt: row.updatedAt,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      projectType: null,
    }
  }

  deps(): DbExecutionStoreDeps {
    return {
      createTask: async (input: CreateTaskInput): Promise<CreateTaskResult> => {
        if (input.sourceType && input.sourceRef) {
          const existing = this.tasks.find((t) => t.sourceType === input.sourceType && t.sourceRef === input.sourceRef)
          if (existing) return { task: this.toTaskSummary(existing), created: false }
        }
        const row: FakeTaskRow = {
          id: this.nextId('task'),
          title: input.title,
          status: input.status,
          sourceType: input.sourceType ?? null,
          sourceRef: input.sourceRef ?? null,
          blockerNote: input.blockerNote ?? null,
          updatedAt: new Date(),
        }
        this.tasks.push(row)
        return { task: this.toTaskSummary(row), created: true }
      },

      transitionTask: async (input: TransitionTaskInput): Promise<TransitionTaskResult> => {
        const row = this.tasks.find((t) => t.id === input.taskId)
        if (!row) throw new Error(`fake: no task ${input.taskId}`)
        if (row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          throw new Error(`fake: concurrency conflict on ${input.taskId}`)
        }
        row.status = input.toStatus
        row.blockerNote = input.blockerNote ?? null
        row.updatedAt = new Date(row.updatedAt.getTime() + 1)
        this.events.push({
          id: this.nextId('event'),
          taskId: row.id,
          eventType: 'STATUS_CHANGED',
          metadata: input.playbookStage ? { playbookStage: input.playbookStage } : {},
          changedAt: new Date(),
        })
        return { task: this.toTaskSummary(row), changed: true }
      },

      recordPlaybookStage: async (input: RecordPlaybookStageInput): Promise<RecordPlaybookStageResult> => {
        const priorUse = this.events.find((e) => e.taskId === input.taskId && e.eventType === 'PLAYBOOK_STAGE' && e.metadata.idempotencyKey === input.idempotencyKey)
        if (priorUse) return { recorded: false }
        this.events.push({
          id: this.nextId('event'),
          taskId: input.taskId,
          eventType: 'PLAYBOOK_STAGE',
          metadata: { idempotencyKey: input.idempotencyKey, playbookKey: input.playbookKey, stage: input.stage, ...(input.evidence ? { evidence: input.evidence } : {}) },
          changedAt: new Date(),
        })
        return { recorded: true }
      },

      getTaskBySource: async (sourceType: string, sourceRef: string) => {
        const row = this.tasks.find((t) => t.sourceType === sourceType && t.sourceRef === sourceRef)
        return row ? this.toTaskSummary(row) : null
      },

      getTasksBySourceType: async (sourceType: string) => this.tasks.filter((t) => t.sourceType === sourceType).map((t) => this.toTaskSummary(t)),

      findTaskIdByRegistrationIdempotencyKey: async (idempotencyKey: string) => {
        const event = this.events.find((e) => e.eventType === 'PLAYBOOK_STAGE' && e.metadata.idempotencyKey === idempotencyKey)
        return event ? event.taskId : null
      },

      getTaskEventsForTask: async (taskId: string): Promise<TaskEventDetail[]> =>
        this.events
          .filter((e) => e.taskId === taskId)
          .map((e) => ({
            id: e.id,
            task: { id: taskId, title: '' },
            project: null,
            eventType: e.eventType,
            fromStatus: null,
            toStatus: null,
            changedBy: null,
            changedAt: e.changedAt,
            note: null,
            metadata: e.metadata,
          })),
    }
  }
}

function req(overrides: Partial<SpecialistExecutionRequest> = {}): SpecialistExecutionRequest {
  return {
    specialist: 'metro_builder',
    playbookKey: 'metro_launch',
    stage: 'M1_GEOGRAPHY_MAP',
    objective: 'research San Diego neighborhoods',
    inputs: {},
    requiredEvidenceKeys: ['neighborhoods'],
    methodologyId: 'metro_launch',
    methodologyVersion: 'v1',
    executionId: 'db-exec-1',
    projectId: 'project-1',
    destinationId: null,
    metroId: 'metro-san-diego',
    allowedCapabilities: ['live_web_research'],
    authorityOperations: ['metro_launch.research'],
    idempotencyKey: 'db-idem-1',
    ...overrides,
  }
}

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const request = overrides.request ?? req()
  return {
    request,
    status: 'PENDING',
    executorType: 'REMOTE_AI_EXECUTOR',
    startedAt: '2026-09-05T00:00:00Z',
    completedAt: null,
    envelope: null,
    attempts: 0,
    retriedAt: [],
    errorReason: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// taskStatusForExecutionStatus — the pure mapping table
// ---------------------------------------------------------------------------

test('taskStatusForExecutionStatus: PENDING/IN_PROGRESS/COMPLETE map directly; every failure-shaped status maps to BLOCKED', () => {
  assert.equal(taskStatusForExecutionStatus('PENDING'), 'READY')
  assert.equal(taskStatusForExecutionStatus('IN_PROGRESS'), 'IN_PROGRESS')
  assert.equal(taskStatusForExecutionStatus('COMPLETE'), 'DONE')
  assert.equal(taskStatusForExecutionStatus('FAILED'), 'BLOCKED')
  assert.equal(taskStatusForExecutionStatus('NEEDS_MORE_EVIDENCE'), 'BLOCKED')
  assert.equal(taskStatusForExecutionStatus('EXECUTOR_UNAVAILABLE'), 'BLOCKED')
  assert.equal(taskStatusForExecutionStatus('BLOCKED'), 'BLOCKED')
})

// ---------------------------------------------------------------------------
// Basic put/get round-trip
// ---------------------------------------------------------------------------

test('put then get on the SAME store instance round-trips the full ExecutionRecord', async () => {
  const db = new FakeAgentDb()
  const store = new DbExecutionStore(db.deps())
  const rec = record()

  await store.put(rec)
  const back = await store.get(rec.request.executionId)

  assert.ok(back)
  assert.equal(back!.request.executionId, rec.request.executionId)
  assert.equal(back!.status, 'PENDING')
})

test('a task row is actually created in the fake backing store with source_type=specialist_execution', async () => {
  const db = new FakeAgentDb()
  const store = new DbExecutionStore(db.deps())
  await store.put(record())

  assert.equal(db.tasks.length, 1)
  assert.equal(db.tasks[0].sourceType, 'specialist_execution')
  assert.equal(db.tasks[0].sourceRef, 'db-exec-1')
  assert.equal(db.tasks[0].status, 'READY')
})

// ---------------------------------------------------------------------------
// Durability across a NEW store instance — the actual "survives restart" proof
// ---------------------------------------------------------------------------

test('RELOAD/RESUME: a fresh DbExecutionStore instance pointed at the SAME backing db reads back the exact record a prior instance wrote', async () => {
  const db = new FakeAgentDb()
  const firstProcessStore = new DbExecutionStore(db.deps())
  const rec = record({ status: 'IN_PROGRESS' })
  await firstProcessStore.put(rec)

  // Simulates a service/CLI restart: brand-new store instance, no shared
  // in-memory state with the one above — only the backing "database" (db)
  // persists, exactly like a real process restart against real Postgres.
  const secondProcessStore = new DbExecutionStore(db.deps())
  const resumed = await secondProcessStore.get(rec.request.executionId)

  assert.ok(resumed)
  assert.equal(resumed!.status, 'IN_PROGRESS')
  assert.equal(resumed!.request.objective, rec.request.objective)
})

test('RELOAD/RESUME: findByIdempotencyKey also survives a fresh store instance', async () => {
  const db = new FakeAgentDb()
  const rec = record({ request: req({ idempotencyKey: 'resume-idem' }) })
  await new DbExecutionStore(db.deps()).put(rec)

  const resumed = await new DbExecutionStore(db.deps()).findByIdempotencyKey('resume-idem')
  assert.ok(resumed)
  assert.equal(resumed!.request.executionId, rec.request.executionId)
})

// ---------------------------------------------------------------------------
// Fine-grained status survives even when coarse TaskStatus doesn't change
// (FAILED -> NEEDS_MORE_EVIDENCE both map to BLOCKED)
// ---------------------------------------------------------------------------

test('a status change that keeps the SAME coarse TaskStatus (FAILED -> NEEDS_MORE_EVIDENCE, both BLOCKED) is still recorded and read back correctly', async () => {
  const db = new FakeAgentDb()
  const store = new DbExecutionStore(db.deps())

  await store.put(record({ status: 'FAILED', attempts: 1, errorReason: 'evidence validation failed' }))
  const afterFailed = await store.get('db-exec-1')
  assert.equal(afterFailed!.status, 'FAILED')

  await store.put(record({ status: 'NEEDS_MORE_EVIDENCE', attempts: 2, errorReason: 'missing neighborhoods' }))
  const afterNeedsMore = await store.get('db-exec-1')
  assert.equal(afterNeedsMore!.status, 'NEEDS_MORE_EVIDENCE')

  // Coarse task status was BLOCKED from creation onward (both FAILED and
  // NEEDS_MORE_EVIDENCE map to it) — it never actually CHANGES, so zero
  // STATUS_CHANGED events fire; the coarse status is right, just never
  // transitioned a second time.
  assert.equal(db.tasks[0].status, 'BLOCKED')
  const statusChanges = db.events.filter((e) => e.eventType === 'STATUS_CHANGED')
  assert.equal(statusChanges.length, 0)
  // But TWO distinct snapshots exist, each individually retrievable in history.
  const snapshots = db.events.filter((e) => e.eventType === 'PLAYBOOK_STAGE' && (e.metadata.evidence as { executionStatus?: string } | undefined)?.executionStatus)
  assert.ok(snapshots.length >= 2)
})

// ---------------------------------------------------------------------------
// Retry lineage read back correctly
// ---------------------------------------------------------------------------

test('retry lineage (retriedAt) is preserved across put/get', async () => {
  const db = new FakeAgentDb()
  const store = new DbExecutionStore(db.deps())
  await store.put(record({ status: 'EXECUTOR_UNAVAILABLE', errorReason: 'provider outage' }))
  await store.put(record({ status: 'PENDING', retriedAt: ['2026-09-05T01:00:00Z'], errorReason: null }))

  const back = await store.get('db-exec-1')
  assert.deepEqual(back!.retriedAt, ['2026-09-05T01:00:00Z'])
  assert.equal(back!.status, 'PENDING')
})

// ---------------------------------------------------------------------------
// Project/metro/destination isolation at the store layer — two distinct
// executionIds never collide in the fake db.
// ---------------------------------------------------------------------------

test('two executions for different metros never collide — distinct source_ref, distinct task rows', async () => {
  const db = new FakeAgentDb()
  const store = new DbExecutionStore(db.deps())
  await store.put(record({ request: req({ executionId: 'exec-san-diego', metroId: 'metro-san-diego', idempotencyKey: 'idem-sd' }) }))
  await store.put(record({ request: req({ executionId: 'exec-denver', metroId: 'metro-denver', idempotencyKey: 'idem-denver' }) }))

  const all = await store.all()
  assert.equal(all.length, 2)
  const byExecId = new Map(all.map((r) => [r.request.executionId, r]))
  assert.equal(byExecId.get('exec-san-diego')?.request.metroId, 'metro-san-diego')
  assert.equal(byExecId.get('exec-denver')?.request.metroId, 'metro-denver')
})

// ---------------------------------------------------------------------------
// get() on an unknown executionId returns undefined, never throws
// ---------------------------------------------------------------------------

test('get() returns undefined for an executionId that was never registered', async () => {
  const db = new FakeAgentDb()
  const store = new DbExecutionStore(db.deps())
  assert.equal(await store.get('never-existed'), undefined)
})
