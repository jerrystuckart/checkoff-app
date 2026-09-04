// Chief Phase 2E — the production ExecutionStore. Backed entirely by the
// existing agent.tasks/agent.task_events primitives (createTask,
// transitionTask, recordPlaybookStage from mutations.ts;
// getTaskBySource/getTaskEventsForTask/getTasksBySourceType/
// findTaskIdByRegistrationIdempotencyKey from queries.ts) — no new table,
// no new migration, per the explicit "do not duplicate existing agent.runs
// functionality unnecessarily" instruction. agent.runs itself (a bare
// RUNNING/SUCCEEDED/FAILED lifecycle row with no task/project/metadata
// linkage — see chiefBrief.ts for the only existing user of it) is too
// thin to carry a SpecialistExecutionRequest's identity, so this store
// does not use it; agent.tasks already has exactly the right shape
// (status lifecycle, project scoping, source_type/source_ref idempotency,
// a JSONB metadata column via task_events) and IS "the existing agent.*
// architecture" the instruction points at.
//
// ONE TASK PER EXECUTION. source_type='specialist_execution',
// source_ref=executionId — the same (source_type, source_ref) unique
// index createTask already relies on for idempotent creation. Every
// state change (including ones that don't move the coarse TaskStatus —
// e.g. FAILED -> NEEDS_MORE_EVIDENCE both map to BLOCKED) is recorded as
// a PLAYBOOK_STAGE task_events row via recordPlaybookStage, carrying the
// FULL current ExecutionRecord as JSON in metadata.evidence.snapshot —
// this is the actual source of truth this store reads back (get()),
// not a lossy reconstruction from agent.tasks' own columns. The coarse
// agent.tasks.status is kept in sync via transitionTask whenever it
// actually changes, purely so this execution shows up correctly in
// every EXISTING Chief surface (work queue, audit, daily brief,
// NEEDS_JERRY) without any of those modules needing to know executions
// exist as a concept — exactly the "reuse existing task/task_event
// structures" instruction.
//
// Every dependency is injected with a real default (same DI pattern as
// chiefBrief.ts/openBrainDecisions.ts) so this module's own tests never
// touch a live database — they exercise the real mapping/idempotency-key
// logic against fully deterministic mocks. There is no live-DB test here
// (this environment has no AGENT_SERVICE_DATABASE_URL configured, same
// situation as every other DB-writing module in this repo) — see
// mutations.test.ts's AGENT_SERVICE_ALLOW_MUTATION_TESTS gate for the
// existing precedent this store follows for when a real integration test
// becomes possible.

import { createTask, transitionTask, recordPlaybookStage } from '../mutations'
import { getTaskBySource, getTaskEventsForTask, getTasksBySourceType, findTaskIdByRegistrationIdempotencyKey } from '../queries'
import { ownerKeyFor } from './delegation'
import type { ExecutionStore, ExecutionRecord, ExecutionStatus } from './executor'
import type { TaskStatus } from '../types'

export const SPECIALIST_EXECUTION_SOURCE_TYPE = 'specialist_execution'

/**
 * The coarse TaskStatus a given fine-grained ExecutionStatus maps to.
 * Several ExecutionStatus values intentionally collapse to the same
 * TaskStatus (FAILED/NEEDS_MORE_EVIDENCE/EXECUTOR_UNAVAILABLE -> BLOCKED)
 * — the fine distinction always survives in the PLAYBOOK_STAGE snapshot
 * even when the coarse status doesn't change, so nothing is lost.
 */
export function taskStatusForExecutionStatus(status: ExecutionStatus): TaskStatus {
  switch (status) {
    case 'PENDING':
      return 'READY'
    case 'IN_PROGRESS':
      return 'IN_PROGRESS'
    case 'COMPLETE':
      return 'DONE'
    case 'FAILED':
    case 'NEEDS_MORE_EVIDENCE':
    case 'BLOCKED':
    case 'EXECUTOR_UNAVAILABLE':
      return 'BLOCKED'
  }
}

function blockerNoteFor(record: ExecutionRecord): string {
  return record.errorReason ?? `execution status ${record.status}`
}

interface SnapshotEvidence {
  snapshot: ExecutionRecord
}

function isSnapshotEvidence(evidence: unknown): evidence is SnapshotEvidence {
  return typeof evidence === 'object' && evidence !== null && 'snapshot' in evidence
}

export interface DbExecutionStoreDeps {
  createTask: typeof createTask
  transitionTask: typeof transitionTask
  recordPlaybookStage: typeof recordPlaybookStage
  getTaskBySource: typeof getTaskBySource
  getTaskEventsForTask: typeof getTaskEventsForTask
  getTasksBySourceType: typeof getTasksBySourceType
  findTaskIdByRegistrationIdempotencyKey: typeof findTaskIdByRegistrationIdempotencyKey
}

const REAL_DEPS: DbExecutionStoreDeps = {
  createTask,
  transitionTask,
  recordPlaybookStage,
  getTaskBySource,
  getTaskEventsForTask,
  getTasksBySourceType,
  findTaskIdByRegistrationIdempotencyKey,
}

export class DbExecutionStore implements ExecutionStore {
  constructor(private readonly deps: DbExecutionStoreDeps = REAL_DEPS) {}

  private async reconstructFromTaskId(taskId: string): Promise<ExecutionRecord | undefined> {
    const events = await this.deps.getTaskEventsForTask(taskId)
    // Latest PLAYBOOK_STAGE event carrying a snapshot IS the current
    // ExecutionRecord — see module doc. events is ordered ASC, so the
    // last matching one is the newest.
    for (let i = events.length - 1; i >= 0; i--) {
      const evidence = events[i].metadata?.evidence
      if (isSnapshotEvidence(evidence)) return evidence.snapshot
    }
    return undefined
  }

  async get(executionId: string): Promise<ExecutionRecord | undefined> {
    const task = await this.deps.getTaskBySource(SPECIALIST_EXECUTION_SOURCE_TYPE, executionId)
    if (!task) return undefined
    return this.reconstructFromTaskId(task.id)
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<ExecutionRecord | undefined> {
    const taskId = await this.deps.findTaskIdByRegistrationIdempotencyKey(`register:${idempotencyKey}`)
    if (!taskId) return undefined
    return this.reconstructFromTaskId(taskId)
  }

  async all(): Promise<ExecutionRecord[]> {
    const tasks = await this.deps.getTasksBySourceType(SPECIALIST_EXECUTION_SOURCE_TYPE)
    const records = await Promise.all(tasks.map((t) => this.reconstructFromTaskId(t.id)))
    return records.filter((r): r is ExecutionRecord => r !== undefined)
  }

  async put(record: ExecutionRecord): Promise<void> {
    const executionId = record.request.executionId
    const ownerKey = ownerKeyFor(record.request.specialist)
    const targetStatus = taskStatusForExecutionStatus(record.status)
    const existing = await this.deps.getTaskBySource(SPECIALIST_EXECUTION_SOURCE_TYPE, executionId)
    const snapshotKeySuffix = `${record.status}:${record.attempts}:${record.retriedAt.length}`

    if (!existing) {
      const created = await this.deps.createTask({
        title: `[${record.request.specialist}] ${record.request.stage}: ${record.request.objective}`.slice(0, 500),
        projectKey: record.request.projectId,
        status: targetStatus,
        changedByOwnerKey: ownerKey,
        ownerKey,
        description: `Specialist execution — methodology ${record.request.methodologyId}/${record.request.methodologyVersion}, playbook ${record.request.playbookKey}.`,
        nextAction: record.request.objective,
        blockerNote: targetStatus === 'BLOCKED' ? blockerNoteFor(record) : undefined,
        sourceType: SPECIALIST_EXECUTION_SOURCE_TYPE,
        sourceRef: executionId,
      })
      await this.deps.recordPlaybookStage({
        taskId: created.task.id,
        playbookKey: record.request.playbookKey,
        stage: record.request.stage,
        actorOwnerKey: ownerKey,
        idempotencyKey: `register:${record.request.idempotencyKey}`,
        evidence: { snapshot: record, executionStatus: record.status },
        note: `execution ${executionId} registered`,
      })
      // First registration can itself already need a snapshot event if
      // its status differs from what createTask alone establishes (it
      // never does today — registerExecution only ever creates PENDING
      // or BLOCKED — but recorded unconditionally below for correctness
      // if that ever changes) — same idempotencyKey-scoped recordPlaybookStage
      // call, deliberately distinct from the 'register:' key above.
      await this.deps.recordPlaybookStage({
        taskId: created.task.id,
        playbookKey: record.request.playbookKey,
        stage: record.request.stage,
        actorOwnerKey: ownerKey,
        idempotencyKey: `snapshot:${executionId}:${snapshotKeySuffix}`,
        evidence: { snapshot: record, executionStatus: record.status },
      })
      return
    }

    if (existing.status !== targetStatus) {
      await this.deps.transitionTask({
        taskId: existing.id,
        toStatus: targetStatus,
        actorOwnerKey: ownerKey,
        expectedUpdatedAt: existing.updatedAt,
        ownerKey,
        nextAction: record.request.objective,
        blockerNote: targetStatus === 'BLOCKED' ? blockerNoteFor(record) : undefined,
        idempotencyKey: `status:${executionId}:${snapshotKeySuffix}`,
        playbookStage: { playbookKey: record.request.playbookKey, stage: record.request.stage },
      })
    }

    // Always record the fine-grained snapshot, even when the coarse
    // status didn't change (e.g. FAILED -> NEEDS_MORE_EVIDENCE, both
    // BLOCKED) — this is the actual source of truth get() reads back.
    await this.deps.recordPlaybookStage({
      taskId: existing.id,
      playbookKey: record.request.playbookKey,
      stage: record.request.stage,
      actorOwnerKey: ownerKey,
      idempotencyKey: `snapshot:${executionId}:${snapshotKeySuffix}`,
      evidence: { snapshot: record, executionStatus: record.status },
    })
  }
}
