// Phase 0D — the ONLY write surface into agent.*. Three explicitly
// designed operations, nothing generic: createTask, transitionTask,
// updateTaskPlan. No generic updateTask(arbitraryFields), no raw SQL
// exposed to callers.
//
// Every mutation runs inside withWriteTransaction (db.ts) — the task
// update and its task_events row are always in the same transaction, so
// they can never be separated by a partial failure: either both commit or
// neither does.

import type { PoolClient } from 'pg'
import { withWriteTransaction } from './db'
import { TASK_SELECT, TASK_FROM } from './queries'
import { mapTaskRow, type TaskRow } from './mappers'
import type { TaskSummary, TaskStatus } from './types'
import {
  TaskNotFoundError,
  ProjectNotFoundError,
  OwnerNotFoundError,
  ConcurrencyConflictError,
  InvalidStateFieldsError,
  IdempotencyConflictError,
} from './errors'
import { assertTransitionAllowed, validateStateRequirements, computeResultingFields, isMeaningful } from './transitions'

// ---------------------------------------------------------------------------
// Shared helpers (all operate on the SAME client as the surrounding
// transaction, never the pooled read-only `query()` from db.ts — these
// lookups and the writes they gate must see the transaction's own
// uncommitted state and must run under the SAME READ WRITE override).
// ---------------------------------------------------------------------------

async function resolveProjectId(client: PoolClient, projectKey: string): Promise<string> {
  const result = await client.query<{ id: string }>('SELECT id FROM agent.projects WHERE project_key = $1', [projectKey])
  if (result.rows.length === 0) throw new ProjectNotFoundError(projectKey)
  return result.rows[0].id
}

async function resolveOwnerId(client: PoolClient, ownerKey: string): Promise<string> {
  const result = await client.query<{ id: string }>('SELECT id FROM agent.owners WHERE owner_key = $1', [ownerKey])
  if (result.rows.length === 0) throw new OwnerNotFoundError(ownerKey)
  return result.rows[0].id
}

async function assertTaskExists(client: PoolClient, taskId: string): Promise<void> {
  const result = await client.query('SELECT 1 FROM agent.tasks WHERE id = $1', [taskId])
  if (result.rows.length === 0) throw new TaskNotFoundError(taskId)
}

async function fetchTaskById(client: PoolClient, taskId: string): Promise<TaskSummary> {
  const result = await client.query<TaskRow>(`SELECT ${TASK_SELECT} ${TASK_FROM} WHERE t.id = $1`, [taskId])
  if (result.rows.length === 0) throw new TaskNotFoundError(taskId)
  return mapTaskRow(result.rows[0])
}

/** Locks the task row (FOR UPDATE OF t only — the joined project/owner/contact/blocker rows are not locked). */
async function lockTaskById(client: PoolClient, taskId: string): Promise<{ task: TaskSummary; updatedAt: Date }> {
  const result = await client.query<TaskRow & { updated_at: Date }>(
    `SELECT ${TASK_SELECT}, t.updated_at ${TASK_FROM} WHERE t.id = $1 FOR UPDATE OF t`,
    [taskId]
  )
  if (result.rows.length === 0) throw new TaskNotFoundError(taskId)
  return { task: mapTaskRow(result.rows[0]), updatedAt: result.rows[0].updated_at }
}

function assertConcurrency(taskId: string, expected: Date, actual: Date): void {
  if (expected.getTime() !== actual.getTime()) {
    throw new ConcurrencyConflictError(taskId, expected, actual)
  }
}

async function fetchExistingBySource(client: PoolClient, sourceType: string, sourceRef: string): Promise<TaskSummary | null> {
  const result = await client.query<TaskRow>(`SELECT ${TASK_SELECT} ${TASK_FROM} WHERE t.source_type = $1 AND t.source_ref = $2`, [
    sourceType,
    sourceRef,
  ])
  return result.rows.length > 0 ? mapTaskRow(result.rows[0]) : null
}

/**
 * True when a Postgres error is "no unique or exclusion constraint
 * matching the ON CONFLICT specification" (SQLSTATE 42P10) — the error
 * `ON CONFLICT (source_type, source_ref) WHERE source_ref IS NOT NULL`
 * raises if tasks_source_type_source_ref_idx doesn't exist yet. Used to
 * turn that into a clear, actionable message instead of a bare Postgres
 * error, per the Phase 0D requirement to fail loudly and understandably
 * if this now-required schema is missing, rather than silently degrading.
 */
function isMissingConflictTargetError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '42P10'
}

/**
 * "Materially incompatible" for createTask's idempotency check — a
 * deliberately narrow comparison, not a full field-by-field diff. title,
 * project, and status are the core identity of "what task is this
 * supposed to be"; description/priority/dueAt/etc. are allowed to differ
 * across retries (e.g. a retry that enriches the request slightly) without
 * being treated as a conflict. Returns a human-readable reason string, or
 * null if compatible.
 */
function findSourceIdentityIncompatibility(existing: TaskSummary, input: CreateTaskInput, resolvedProjectId: string): string | null {
  if (existing.title !== input.title) {
    return `title differs ('${existing.title}' vs '${input.title}')`
  }
  if (existing.project?.id !== resolvedProjectId) {
    return `projectKey differs (existing project id ${existing.project?.id ?? 'null'} vs resolved ${resolvedProjectId})`
  }
  if (existing.status !== input.status) {
    return `status differs (${existing.status} vs ${input.status})`
  }
  return null
}

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string
  projectKey: string
  status: TaskStatus
  /** Actor recorded on the CREATED task_events row. Required — never defaulted. */
  changedByOwnerKey: string
  ownerKey?: string
  description?: string
  priority?: string
  dueAt?: Date
  nextCheckAt?: Date
  nextAction?: string
  blockedByTaskId?: string
  blockerNote?: string
  jerryRequest?: string
  contactId?: string
  sourceType?: string
  sourceRef?: string
}

export interface CreateTaskResult {
  task: TaskSummary
  /** false when an existing (sourceType, sourceRef) match was returned instead of inserting — see idempotency note below. */
  created: boolean
}

export async function createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  if (!isMeaningful(input.title)) {
    throw new InvalidStateFieldsError('title is required')
  }

  // CONTRACT: sourceType/sourceRef identify a task for idempotency and
  // must be provided together or not at all. Accepting a half-set pair
  // (e.g. sourceRef with no sourceType) would silently disable the
  // idempotency check the caller almost certainly intended to get, without
  // any error telling them so.
  const sourceTypeGiven = isMeaningful(input.sourceType)
  const sourceRefGiven = isMeaningful(input.sourceRef)
  if (sourceTypeGiven !== sourceRefGiven) {
    throw new InvalidStateFieldsError('sourceType and sourceRef must be provided together (both or neither)')
  }
  const hasSourceIdentity = sourceTypeGiven && sourceRefGiven

  return withWriteTransaction(async (client) => {
    const changedByOwnerId = await resolveOwnerId(client, input.changedByOwnerKey)
    const projectId = await resolveProjectId(client, input.projectKey)
    const ownerId = input.ownerKey ? await resolveOwnerId(client, input.ownerKey) : null
    if (input.blockedByTaskId) {
      await assertTaskExists(client, input.blockedByTaskId)
    }

    const now = new Date()
    const resulting = computeResultingFields(
      {
        status: input.status,
        nextAction: input.nextAction,
        nextCheckAt: input.nextCheckAt,
        blockedByTaskId: input.blockedByTaskId,
        blockerNote: input.blockerNote,
        jerryRequest: input.jerryRequest,
        ownerId,
      },
      { ownerId: null, startedAt: null, completedAt: null, nextAction: null },
      now
    )
    validateStateRequirements(resulting)

    const insertValues = [
      projectId,
      input.title,
      input.description ?? null,
      resulting.status,
      input.priority ?? null,
      resulting.ownerId,
      input.dueAt ?? null,
      resulting.nextCheckAt,
      resulting.nextAction,
      resulting.status === 'NEEDS_JERRY',
      resulting.jerryRequest,
      resulting.blockedByTaskId,
      resulting.blockerNote,
      input.contactId ?? null,
      resulting.startedAt,
      resulting.completedAt,
      input.sourceType ?? null,
      input.sourceRef ?? null,
    ]

    // Phase 0D contract: source identity supplied -> DB-enforced
    // idempotency via ON CONFLICT, full stop. tasks_source_type_source_ref_idx
    // (supabase/migrations/20260831_agent_tasks_source_ref_unique.sql) is a
    // required part of the Phase 0D schema, not an optional fast path — if
    // it's missing, this fails loudly (see the catch below) rather than
    // silently falling back to a race-prone check-then-insert. Source
    // identity absent -> plain insert, intentionally non-idempotent (there
    // is nothing to be idempotent about without an identity to key on).
    const conflictClause = hasSourceIdentity ? 'ON CONFLICT (source_type, source_ref) WHERE source_ref IS NOT NULL DO NOTHING' : ''

    let inserted: { rows: Array<{ id: string }> }
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO agent.tasks (
           project_id, title, description, status, priority, owner_id,
           due_at, next_check_at, next_action, requires_jerry, jerry_request,
           blocked_by_task_id, blocker_note, contact_id, started_at, completed_at,
           source_type, source_ref
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ${conflictClause}
         RETURNING id`,
        insertValues
      )
    } catch (err) {
      if (hasSourceIdentity && isMissingConflictTargetError(err)) {
        throw new Error(
          'createTask: agent.tasks is missing the required (source_type, source_ref) unique index ' +
            '(tasks_source_type_source_ref_idx). Apply ' +
            'supabase/migrations/20260831_agent_tasks_source_ref_unique.sql before creating tasks with source identity.'
        )
      }
      throw err
    }

    if (inserted.rows.length === 0) {
      // Only reachable with source identity supplied: this transaction
      // lost the race to another concurrent createTask call with the same
      // source identity (or the row already existed). Fetch the winner
      // and decide compatible vs. conflicting.
      const existing = await fetchExistingBySource(client, input.sourceType as string, input.sourceRef as string)
      if (!existing) {
        // Should be unreachable — ON CONFLICT DO NOTHING firing means a
        // conflicting row exists. Surfacing loudly is safer than silently
        // returning something incorrect if this invariant is ever wrong.
        throw new Error(
          `createTask: ON CONFLICT fired for source ${input.sourceType}/${input.sourceRef} but no matching row was found afterward`
        )
      }
      const incompatibility = findSourceIdentityIncompatibility(existing, input, projectId)
      if (incompatibility) {
        throw new IdempotencyConflictError(`source ${input.sourceType}/${input.sourceRef}`, `existing task ${existing.id}: ${incompatibility}`)
      }
      return { task: existing, created: false }
    }

    const taskId = inserted.rows[0].id

    await client.query(
      `INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
       VALUES ($1, 'CREATED', $2, $3, $4)`,
      [taskId, resulting.status, changedByOwnerId, 'Created via agent-service']
    )

    return { task: await fetchTaskById(client, taskId), created: true }
  })
}

// ---------------------------------------------------------------------------
// transitionTask — the authoritative way to move a task between statuses.
// ---------------------------------------------------------------------------

export interface TransitionTaskInput {
  taskId: string
  toStatus: TaskStatus
  /** Actor recorded on the STATUS_CHANGED task_events row. Required — never defaulted. */
  actorOwnerKey: string
  /** Optimistic-concurrency precondition — must match the task's current updatedAt or the mutation is rejected. */
  expectedUpdatedAt: Date
  nextAction?: string
  nextCheckAt?: Date
  blockedByTaskId?: string
  blockerNote?: string
  jerryRequest?: string
  /** Re-assign owner, e.g. for IN_PROGRESS when not already owned. Leaves the existing owner untouched if omitted. */
  ownerKey?: string
  /** Required when toStatus === 'CANCELED' — stored in task_events.note, never as a task column (Phase 0A invariant). */
  cancellationReason?: string
  /** Optional additional context for any other transition's event note. */
  note?: string
  /**
   * Caller-supplied stable identifier for THIS logical transition request
   * (e.g. a UUID generated once by the caller and reused verbatim on
   * retry). Used ONLY to distinguish "my own previous call already
   * succeeded" from "the task happens to already be at toStatus for an
   * unrelated reason" — see the no-op handling below. Optional, but
   * without it, a same-status call is never treated as a safe no-op: it
   * is validated as an ordinary transition attempt, which correctly fails
   * (no self-loop exists in the transition map) unless the caller can
   * prove via this key that it's their own prior success being replayed.
   */
  idempotencyKey?: string
  /**
   * Phase 1C — set ONLY by the reconciliation apply path
   * (reconciliation.ts's applyReconciliationFinding), never by an ordinary
   * caller. Merged into the same STATUS_CHANGED event's metadata
   * alongside idempotencyKey (never replacing it) — see the merge below.
   * Recording this here, not a parallel history table, keeps
   * reconciliation-driven transitions in the exact same audit trail as
   * every other transition (Phase 1C requirement: no parallel task-history
   * mechanism).
   */
  reconciliation?: {
    evidenceCategory: 'COMPLETION_PROOF' | 'SUPERSESSION_PROOF' | 'NO_CHANGE_EVIDENCE' | 'AMBIGUOUS'
    evidenceSources: string[]
    evidenceSummary?: string
  }
}

export interface TransitionTaskResult {
  task: TaskSummary
  /** false when the task was already in toStatus — idempotent no-op, no event inserted. */
  changed: boolean
}

export async function transitionTask(input: TransitionTaskInput): Promise<TransitionTaskResult> {
  return withWriteTransaction(async (client) => {
    const actorOwnerId = await resolveOwnerId(client, input.actorOwnerKey)
    // FOR UPDATE OF t below fully serializes concurrent transitionTask
    // calls on the SAME task: a second call blocks here until this
    // transaction commits or rolls back. That means the idempotency-key
    // lookup and everything after it is race-free for this task without
    // needing any additional DB constraint — the row lock already
    // provides it. (Cross-task key reuse isn't a race concern either: the
    // lookup below is scoped to this taskId, so it can't observe or be
    // raced by activity on a different task.)
    const { task: current, updatedAt: currentUpdatedAt } = await lockTaskById(client, input.taskId)

    // IDEMPOTENCY KEY — scoped to (this task, this key). Distinguishes
    // "my own previous request already succeeded" from "the task happens
    // to be at toStatus for an unrelated reason," which a blanket
    // "status already matches -> success" cannot: a caller that reads the
    // task as READY at version A, watches a DIFFERENT actor independently
    // drive it through WAITING to IN_PROGRESS (version B), and then
    // retries its own stale READY -> IN_PROGRESS command with
    // expectedUpdatedAt = A would get a coincidental status match with no
    // idempotencyKey to prove it was ever their own request — that case
    // must fall through to the normal checks below and be rejected.
    if (isMeaningful(input.idempotencyKey)) {
      const priorUse = await client.query<{ to_status: TaskStatus }>(
        `SELECT to_status FROM agent.task_events
         WHERE task_id = $1 AND event_type = 'STATUS_CHANGED' AND metadata ->> 'idempotencyKey' = $2
         ORDER BY changed_at DESC LIMIT 1`,
        [input.taskId, input.idempotencyKey]
      )
      if (priorUse.rows.length > 0) {
        const priorToStatus = priorUse.rows[0].to_status
        if (priorToStatus !== input.toStatus) {
          // Same key, different destination — a request identity is being
          // reused for what is, by definition, a different logical
          // request. Never silently reinterpreted as either the old or
          // the new request.
          throw new IdempotencyConflictError(
            `task ${input.taskId} idempotencyKey ${input.idempotencyKey}`,
            `previously used for transition to ${priorToStatus}, now requested for ${input.toStatus}`
          )
        }
        // Same key, same destination. Safe no-op ONLY if the task is
        // still actually at that destination right now — if something
        // has since moved it elsewhere, this key's original effect has
        // already been superseded, and replaying it as a bare "unchanged"
        // success would misrepresent the task's real current state (which
        // is not toStatus). In that case, fall through to the normal
        // path below and let concurrency/transition-map validation decide
        // this as an ordinary (and likely stale) request.
        if (current.status === input.toStatus) {
          return { task: current, changed: false }
        }
      }
      // No prior use of this key for this task: fall through and treat
      // this as a fresh transition attempt, same as if no key were
      // supplied at all.
    }

    assertConcurrency(input.taskId, input.expectedUpdatedAt, currentUpdatedAt)
    assertTransitionAllowed(current.status, input.toStatus)

    if (input.toStatus === 'CANCELED' && !isMeaningful(input.cancellationReason)) {
      throw new InvalidStateFieldsError('CANCELED requires a meaningful cancellationReason')
    }

    const ownerId = input.ownerKey ? await resolveOwnerId(client, input.ownerKey) : (current.owner?.id ?? null)
    if (input.blockedByTaskId) {
      if (input.blockedByTaskId === input.taskId) {
        throw new InvalidStateFieldsError('a task cannot block itself')
      }
      await assertTaskExists(client, input.blockedByTaskId)
    }

    const now = new Date()
    const resulting = computeResultingFields(
      {
        status: input.toStatus,
        nextAction: input.nextAction,
        nextCheckAt: input.nextCheckAt,
        blockedByTaskId: input.blockedByTaskId,
        blockerNote: input.blockerNote,
        jerryRequest: input.jerryRequest,
        ownerId,
      },
      {
        ownerId: current.owner?.id ?? null,
        startedAt: current.startedAt,
        completedAt: current.completedAt,
        nextAction: current.nextAction,
      },
      now
    )
    validateStateRequirements(resulting)

    await client.query(
      `UPDATE agent.tasks SET
         status = $1, owner_id = $2, next_action = $3, next_check_at = $4,
         requires_jerry = $5, jerry_request = $6, blocked_by_task_id = $7, blocker_note = $8,
         started_at = $9, completed_at = $10
       WHERE id = $11`,
      [
        resulting.status,
        resulting.ownerId,
        resulting.nextAction,
        resulting.nextCheckAt,
        resulting.status === 'NEEDS_JERRY',
        resulting.jerryRequest,
        resulting.blockedByTaskId,
        resulting.blockerNote,
        resulting.startedAt,
        resulting.completedAt,
        input.taskId,
      ]
    )

    const eventNote = input.toStatus === 'CANCELED' ? (input.cancellationReason as string) : (input.note ?? null)
    // Merge, never replace: idempotencyKey and reconciliation are
    // independent, orthogonal pieces of metadata on the same event — an
    // ordinary (non-reconciliation) call with only idempotencyKey behaves
    // exactly as before this field existed.
    const eventMetadata = {
      ...(isMeaningful(input.idempotencyKey) ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.reconciliation ? { reconciliation: input.reconciliation } : {}),
    }
    await client.query(
      `INSERT INTO agent.task_events (task_id, event_type, from_status, to_status, changed_by_owner_id, note, metadata)
       VALUES ($1, 'STATUS_CHANGED', $2, $3, $4, $5, $6)`,
      [input.taskId, current.status, resulting.status, actorOwnerId, eventNote, JSON.stringify(eventMetadata)]
    )

    return { task: await fetchTaskById(client, input.taskId), changed: true }
  })
}

// ---------------------------------------------------------------------------
// updateTaskPlan — narrowly scoped: nextAction, dueAt, nextCheckAt,
// priority ONLY. No status, owner, Jerry fields, blocker fields,
// completion state, project, or source identity.
// ---------------------------------------------------------------------------

export interface UpdateTaskPlanInput {
  taskId: string
  actorOwnerKey: string
  expectedUpdatedAt: Date
  nextAction?: string
  dueAt?: Date | null
  nextCheckAt?: Date | null
  priority?: string | null
}

export interface UpdateTaskPlanResult {
  task: TaskSummary
  /** false when none of the supplied fields actually differed from the current row — no PLAN_UPDATED event inserted. */
  changed: boolean
}

function datesDiffer(a: Date | null, b: Date | null): boolean {
  if (a === null && b === null) return false
  if (a === null || b === null) return true
  return a.getTime() !== b.getTime()
}

function formatPlanValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function updateTaskPlan(input: UpdateTaskPlanInput): Promise<UpdateTaskPlanResult> {
  return withWriteTransaction(async (client) => {
    const actorOwnerId = await resolveOwnerId(client, input.actorOwnerKey)
    const { task: current, updatedAt: currentUpdatedAt } = await lockTaskById(client, input.taskId)

    assertConcurrency(input.taskId, input.expectedUpdatedAt, currentUpdatedAt)

    const nextNextAction = input.nextAction !== undefined ? input.nextAction : current.nextAction
    const nextDueAt = input.dueAt !== undefined ? input.dueAt : current.dueAt
    const nextNextCheckAt = input.nextCheckAt !== undefined ? input.nextCheckAt : current.nextCheckAt
    const nextPriority = input.priority !== undefined ? input.priority : current.priority

    const changes: Array<{ field: string; from: unknown; to: unknown }> = []
    if (nextNextAction !== current.nextAction) changes.push({ field: 'nextAction', from: current.nextAction, to: nextNextAction })
    if (datesDiffer(nextDueAt, current.dueAt)) changes.push({ field: 'dueAt', from: current.dueAt, to: nextDueAt })
    if (datesDiffer(nextNextCheckAt, current.nextCheckAt)) {
      changes.push({ field: 'nextCheckAt', from: current.nextCheckAt, to: nextNextCheckAt })
    }
    if (nextPriority !== current.priority) changes.push({ field: 'priority', from: current.priority, to: nextPriority })

    if (changes.length === 0) {
      return { task: current, changed: false }
    }

    // Status itself never changes here, but a plan edit could still make
    // an otherwise-valid row invalid under the CURRENT status (e.g.
    // clearing nextAction or nextCheckAt on a WAITING task) — the same
    // invariants apply to a plan-only edit as to any other write.
    validateStateRequirements({
      status: current.status,
      nextAction: nextNextAction,
      nextCheckAt: nextNextCheckAt,
      blockedByTaskId: current.blockedBy?.id ?? null,
      blockerNote: current.blockerNote,
      jerryRequest: current.jerryRequest,
      ownerId: current.owner?.id ?? null,
      startedAt: current.startedAt,
      completedAt: current.completedAt,
    })

    await client.query(`UPDATE agent.tasks SET next_action = $1, due_at = $2, next_check_at = $3, priority = $4 WHERE id = $5`, [
      nextNextAction,
      nextDueAt,
      nextNextCheckAt,
      nextPriority,
      input.taskId,
    ])

    const note = changes.map((c) => `${c.field}: ${formatPlanValue(c.from)} -> ${formatPlanValue(c.to)}`).join('; ')
    await client.query(
      `INSERT INTO agent.task_events (task_id, event_type, changed_by_owner_id, note) VALUES ($1, 'PLAN_UPDATED', $2, $3)`,
      [input.taskId, actorOwnerId, note]
    )

    return { task: await fetchTaskById(client, input.taskId), changed: true }
  })
}
