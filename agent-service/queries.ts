// Phase 0C read/query layer — deterministic functions answering the core
// operational questions from agent.*. No writes anywhere in this file
// (see db.ts for the session-level read-only enforcement this relies on
// as a second layer of defense, not the only one).
//
// LOCKED QUERY SEMANTICS (do not redefine these — see the Phase 0C spec):
//   ACTIVE PROJECT   := project.status = 'ACTIVE'
//   OVERDUE          := task.due_at < now AND task.status NOT IN (DONE, CANCELED)
//   DUE FOR CHECK    := task.next_check_at <= now AND task.status NOT IN (DONE, CANCELED)
//   WAITING          := task.status = 'WAITING'
//   BLOCKED          := task.status = 'BLOCKED'
//   NEEDS JERRY      := task.status = 'NEEDS_JERRY'
//   RECENT CHANGE    := task_events.changed_at within the caller-supplied window
//   COMPLETED        := task.status = 'DONE' (completed_at is then guaranteed
//                       non-null by Phase 0A's tasks_done_requires_completed_at
//                       CHECK constraint)
// due_at and next_check_at are never conflated. NEEDS_JERRY is read from
// status alone, never re-derived from requires_jerry (Phase 0A's
// tasks_requires_jerry_matches_status CHECK guarantees they already agree).
//
// "now" is accepted as an optional parameter on every time-sensitive
// function (defaulting to `new Date()`), rather than always trusting
// Postgres's own now() — this makes the exact instant used for filtering
// available to the caller for reason-flagging (getTasksNeedingAction) and
// makes tests deterministic without mocking global Date.

import { query } from './db'
import {
  mapProjectRow,
  mapTaskRow,
  mapTaskEventRow,
  mapTaskEventDetailRow,
  mapDecisionRow,
  mapInteractionRow,
  mapDecisionEventRow,
  mapOwner,
  mapProjectRef,
  type ProjectRow,
  type TaskRow,
  type TaskEventRow,
  type TaskEventDetailRow,
  type DecisionRow,
  type InteractionRow,
  type DecisionEventRow,
} from './mappers'
import type {
  ProjectSummary,
  ProjectFilters,
  TaskSummary,
  TaskFilters,
  WaitingTaskSummary,
  BlockedTaskSummary,
  JerryTaskSummary,
  NeedsActionTaskSummary,
  NeedsActionReason,
  TaskEventSummary,
  TaskEventDetail,
  DecisionSummary,
  InteractionSummary,
  DecisionEventSummary,
  OwnerRef,
  ProjectRef,
} from './types'

// Shared SELECT fragments so every task-shaped query stays consistent
// (same columns, same join shape) without copy-pasting the join logic.
const PROJECT_SELECT = `
  p.id, p.project_key, p.name, p.project_type, p.status, p.priority,
  p.target_at, p.last_activity_at, p.summary,
  o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name
`
const PROJECT_FROM = `
  FROM agent.projects p
  LEFT JOIN agent.owners o ON o.id = p.owner_id
`

export const TASK_SELECT = `
  t.id, t.title, t.description, t.status, t.priority,
  t.due_at, t.next_check_at, t.next_action, t.requires_jerry, t.jerry_request,
  t.blocked_by_task_id, t.blocker_note,
  t.started_at, t.completed_at, t.created_at, t.updated_at, t.source_type, t.source_ref,
  p.id AS project_id, p.project_key AS project_key, p.name AS project_name, p.project_type AS project_type,
  o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name,
  c.id AS contact_id, c.organization_name AS contact_organization_name, c.person_name AS contact_person_name,
  blocker.title AS blocker_title, blocker.status AS blocker_status
`
export const TASK_FROM = `
  FROM agent.tasks t
  LEFT JOIN agent.projects p ON p.id = t.project_id
  LEFT JOIN agent.owners o ON o.id = t.owner_id
  LEFT JOIN agent.contacts c ON c.id = t.contact_id
  LEFT JOIN agent.tasks blocker ON blocker.id = t.blocked_by_task_id
`

const NOT_TERMINAL = `t.status NOT IN ('DONE', 'CANCELED')`

// ---------------------------------------------------------------------------
// 1. Active projects
// ---------------------------------------------------------------------------

export async function getActiveProjects(): Promise<ProjectSummary[]> {
  const rows = await query<ProjectRow>(
    `SELECT ${PROJECT_SELECT} ${PROJECT_FROM} WHERE p.status = 'ACTIVE' ORDER BY p.project_key`
  )
  return rows.map(mapProjectRow)
}

// ---------------------------------------------------------------------------
// 2. All projects, optionally filtered
// ---------------------------------------------------------------------------

export async function getProjects(filters: ProjectFilters = {}): Promise<ProjectSummary[]> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.status) {
    params.push(filters.status)
    conditions.push(`p.status = $${params.length}`)
  }
  if (filters.projectType) {
    params.push(filters.projectType)
    conditions.push(`p.project_type = $${params.length}`)
  }
  if (filters.ownerKey) {
    params.push(filters.ownerKey)
    conditions.push(`o.owner_key = $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = await query<ProjectRow>(
    `SELECT ${PROJECT_SELECT} ${PROJECT_FROM} ${where} ORDER BY p.project_key`,
    params
  )
  return rows.map(mapProjectRow)
}

/** Optional helper — trivial filter of getProjects(), kept for readability at call sites. */
export async function getOnHoldProjects(): Promise<ProjectSummary[]> {
  return getProjects({ status: 'ON_HOLD' })
}

// ---------------------------------------------------------------------------
// 4. Overdue tasks
// ---------------------------------------------------------------------------

export async function getOverdueTasks(now: Date = new Date()): Promise<TaskSummary[]> {
  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM}
     WHERE t.due_at IS NOT NULL AND t.due_at < $1 AND ${NOT_TERMINAL}
     ORDER BY t.due_at ASC`,
    [now]
  )
  return rows.map(mapTaskRow)
}

// ---------------------------------------------------------------------------
// Due-for-check tasks (general — not limited to WAITING; see getWaitingTasks
// for the WAITING-scoped variant used by acceptance test #3).
// ---------------------------------------------------------------------------

export async function getTasksDueForCheck(now: Date = new Date()): Promise<TaskSummary[]> {
  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM}
     WHERE t.next_check_at IS NOT NULL AND t.next_check_at <= $1 AND ${NOT_TERMINAL}
     ORDER BY t.next_check_at ASC`,
    [now]
  )
  return rows.map(mapTaskRow)
}

// ---------------------------------------------------------------------------
// 5. Waiting tasks
// ---------------------------------------------------------------------------

export interface WaitingTaskOptions {
  dueForCheckOnly?: boolean
  now?: Date
}

export async function getWaitingTasks(opts: WaitingTaskOptions = {}): Promise<WaitingTaskSummary[]> {
  const now = opts.now ?? new Date()
  const conditions = [`t.status = 'WAITING'`]
  const params: unknown[] = []
  if (opts.dueForCheckOnly) {
    params.push(now)
    conditions.push(`t.next_check_at IS NOT NULL AND t.next_check_at <= $${params.length}`)
  }
  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM} WHERE ${conditions.join(' AND ')} ORDER BY t.next_check_at ASC NULLS LAST`,
    params
  )
  return rows.map((row) => {
    const task = mapTaskRow(row)
    const isDueForCheck = task.nextCheckAt !== null && task.nextCheckAt.getTime() <= now.getTime()
    return { ...task, status: 'WAITING' as const, isDueForCheck }
  })
}

// ---------------------------------------------------------------------------
// 6. Blocked tasks
// ---------------------------------------------------------------------------

export async function getBlockedTasks(): Promise<BlockedTaskSummary[]> {
  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM} WHERE t.status = 'BLOCKED' ORDER BY p.project_key, t.title`
  )
  return rows.map((row) => ({ ...mapTaskRow(row), status: 'BLOCKED' as const }))
}

// ---------------------------------------------------------------------------
// 7. NEEDS_JERRY tasks
// ---------------------------------------------------------------------------

export async function getNeedsJerryTasks(): Promise<JerryTaskSummary[]> {
  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM} WHERE t.status = 'NEEDS_JERRY' ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC`
  )
  return rows.map((row) => ({ ...mapTaskRow(row), status: 'NEEDS_JERRY' as const }))
}

// ---------------------------------------------------------------------------
// 3. Tasks needing action now — the core operational query. Combines the
// locked semantics for OVERDUE and DUE FOR CHECK with the two statuses
// that always mean "actionable" (NEEDS_JERRY, READY). IN_PROGRESS is
// intentionally NOT included by default — an in-progress task that is
// neither overdue nor due for check isn't "needing action" beyond normal
// ongoing work, and the spec explicitly left this case open rather than
// documented — so it's opt-in via includeInProgress rather than assumed.
// ---------------------------------------------------------------------------

export interface NeedsActionOptions {
  includeInProgress?: boolean
  now?: Date
}

export async function getTasksNeedingAction(opts: NeedsActionOptions = {}): Promise<NeedsActionTaskSummary[]> {
  const now = opts.now ?? new Date()
  const statusList = opts.includeInProgress ? ['NEEDS_JERRY', 'READY', 'IN_PROGRESS'] : ['NEEDS_JERRY', 'READY']

  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM}
     WHERE ${NOT_TERMINAL} AND (
       t.status = ANY($1)
       OR (t.due_at IS NOT NULL AND t.due_at < $2)
       OR (t.next_check_at IS NOT NULL AND t.next_check_at <= $2)
     )
     ORDER BY t.due_at ASC NULLS LAST, t.next_check_at ASC NULLS LAST`,
    [statusList, now]
  )

  return rows.map((row) => {
    const task = mapTaskRow(row)
    const reasons: NeedsActionReason[] = []
    if (task.status === 'NEEDS_JERRY') reasons.push('NEEDS_JERRY')
    if (task.status === 'READY') reasons.push('READY')
    if (opts.includeInProgress && task.status === 'IN_PROGRESS') reasons.push('IN_PROGRESS')
    if (task.dueAt !== null && task.dueAt.getTime() < now.getTime()) reasons.push('OVERDUE')
    if (task.nextCheckAt !== null && task.nextCheckAt.getTime() <= now.getTime()) reasons.push('DUE_FOR_CHECK')
    return { ...task, reasons }
  })
}

// ---------------------------------------------------------------------------
// 8. Recent task events ("what changed recently")
// ---------------------------------------------------------------------------

// Proposed default only — deliberately NOT used inside getRecentTaskChanges
// itself (which requires an explicit `since`), so the low-level query never
// silently hardcodes a window. Call sites (verify.ts, tests, a future
// Chief) can use this or supply their own.
export const DEFAULT_RECENT_CHANGES_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h

export async function getRecentTaskChanges(since: Date): Promise<TaskEventSummary[]> {
  const rows = await query<TaskEventRow>(
    `SELECT
       te.id, te.event_type, te.from_status, te.to_status, te.changed_at, te.note,
       t.id AS task_id, t.title AS task_title,
       p.id AS project_id, p.project_key AS project_key, p.name AS project_name,
       o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name
     FROM agent.task_events te
     JOIN agent.tasks t ON t.id = te.task_id
     LEFT JOIN agent.projects p ON p.id = t.project_id
     LEFT JOIN agent.owners o ON o.id = te.changed_by_owner_id
     WHERE te.changed_at >= $1
     ORDER BY te.changed_at DESC`,
    [since]
  )
  return rows.map(mapTaskEventRow)
}

// ---------------------------------------------------------------------------
// 9. Recently completed tasks. Authoritative source: agent.tasks.status =
// 'DONE' (+ completed_at, guaranteed non-null by Phase 0A's
// tasks_done_requires_completed_at CHECK constraint whenever status =
// DONE). NOT task_events: Phase 0A deliberately left automatic
// STATUS_CHANGED event creation to the future transition_task() service
// primitive rather than a DB trigger, so task_events is not guaranteed to
// contain a completion record for every DONE task (e.g. a task marked
// DONE by a direct/manual update before that primitive exists). The
// current-state table with its DB-enforced invariant is the reliable
// source; task_events is corroborating history, not authoritative here.
// updated_at is not used — it changes on any field edit, not just
// completion.
// ---------------------------------------------------------------------------

export async function getRecentlyCompletedTasks(since: Date): Promise<TaskSummary[]> {
  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM}
     WHERE t.status = 'DONE' AND t.completed_at IS NOT NULL AND t.completed_at >= $1
     ORDER BY t.completed_at DESC`,
    [since]
  )
  return rows.map(mapTaskRow)
}

// ---------------------------------------------------------------------------
// 11. Tasks for a specific project, with optional filters.
// ---------------------------------------------------------------------------

export async function getProjectTasks(projectKey: string, filters: TaskFilters = {}, now: Date = new Date()): Promise<TaskSummary[]> {
  const conditions = ['p.project_key = $1']
  const params: unknown[] = [projectKey]

  if (filters.status) {
    params.push(filters.status)
    conditions.push(`t.status = $${params.length}`)
  }
  if (filters.ownerKey) {
    params.push(filters.ownerKey)
    conditions.push(`o.owner_key = $${params.length}`)
  }
  if (filters.contactId) {
    params.push(filters.contactId)
    conditions.push(`c.id = $${params.length}`)
  }
  if (filters.overdue) {
    params.push(now)
    conditions.push(`t.due_at IS NOT NULL AND t.due_at < $${params.length} AND ${NOT_TERMINAL}`)
  }
  if (filters.dueForCheck) {
    params.push(now)
    conditions.push(`t.next_check_at IS NOT NULL AND t.next_check_at <= $${params.length} AND ${NOT_TERMINAL}`)
  }

  const rows = await query<TaskRow>(
    `SELECT ${TASK_SELECT} ${TASK_FROM} WHERE ${conditions.join(' AND ')} ORDER BY t.created_at ASC`,
    params
  )
  return rows.map(mapTaskRow)
}

// ---------------------------------------------------------------------------
// Optional helper: current (non-superseded) decisions, all or for one
// project. "Current" := no other decision's supersedes_decision_id points
// at this row — a real schema-grounded concept (Phase 0A's
// supersedes_decision_id column), not an invented one.
// ---------------------------------------------------------------------------

export async function getCurrentDecisions(projectKey?: string): Promise<DecisionSummary[]> {
  const conditions = [
    `NOT EXISTS (SELECT 1 FROM agent.decisions newer WHERE newer.supersedes_decision_id = d.id)`,
  ]
  const params: unknown[] = []
  if (projectKey) {
    params.push(projectKey)
    conditions.push(`p.project_key = $${params.length}`)
  }
  const rows = await query<DecisionRow>(
    `SELECT
       d.id, d.decision_key, d.decision, d.decided_at, d.supersedes_decision_id,
       p.id AS project_id, p.project_key AS project_key, p.name AS project_name,
       o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name
     FROM agent.decisions d
     LEFT JOIN agent.projects p ON p.id = d.project_id
     LEFT JOIN agent.owners o ON o.id = d.decided_by_owner_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.decided_at DESC`,
    params
  )
  return rows.map(mapDecisionRow)
}

// ---------------------------------------------------------------------------
// Phase 1A — durable-memory promotion workflow reads. Deliberately a
// separate row/summary shape from DecisionRow/DecisionSummary/
// mapDecisionRow above rather than widening those (which getCurrentDecisions
// and its existing callers/tests depend on staying exactly as they are) —
// see openBrainDecisions.ts's own DecisionForOpenBrainRow for the same
// "separate shape, not a shared one" rationale.
// ---------------------------------------------------------------------------

interface DecisionPromotionRow {
  id: string
  decision_key: string
  decision: string
  decided_at: Date
  durable_memory_recommendation: 'RECOMMENDED' | 'REJECTED' | null
  open_brain_eligible: boolean
  open_brain_thought_id: string | null
  owner_id: string | null
  owner_key: string | null
  owner_display_name: string | null
  project_id: string | null
  project_key: string | null
  project_name: string | null
}

export interface DecisionPromotionSummary {
  id: string
  decisionKey: string
  decision: string
  decidedAt: Date
  decidedBy: OwnerRef | null
  project: ProjectRef | null
  durableMemoryRecommendation: 'RECOMMENDED' | 'REJECTED' | null
  openBrainEligible: boolean
  openBrainThoughtId: string | null
}

function mapDecisionPromotionRow(row: DecisionPromotionRow): DecisionPromotionSummary {
  return {
    id: row.id,
    decisionKey: row.decision_key,
    decision: row.decision,
    decidedAt: row.decided_at,
    decidedBy: mapOwner(row),
    project: mapProjectRef(row),
    durableMemoryRecommendation: row.durable_memory_recommendation,
    openBrainEligible: row.open_brain_eligible,
    openBrainThoughtId: row.open_brain_thought_id,
  }
}

const DECISION_PROMOTION_SELECT = `
  d.id, d.decision_key, d.decision, d.decided_at,
  d.durable_memory_recommendation, d.open_brain_eligible, d.open_brain_thought_id,
  p.id AS project_id, p.project_key AS project_key, p.name AS project_name,
  o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name
  FROM agent.decisions d
  LEFT JOIN agent.projects p ON p.id = d.project_id
  LEFT JOIN agent.owners o ON o.id = d.decided_by_owner_id
`

/**
 * Decisions Chief has recommended for durable memory, awaiting Jerry's
 * approve/reject/reconsider (via the separate agent_approver capability —
 * never agent_service). MUST also exclude open_brain_eligible = true:
 * durable_memory_recommendation is never reset after approval (it's a
 * recommendation-state cache, not the gate — see the Phase 1A migration),
 * so without this an approved-and-synced decision would show up here
 * forever. (Found live during the Phase 1B audit — a real bug in the
 * original Phase 1A version of this query, fixed here.)
 */
export async function getPendingDurableMemoryRecommendations(): Promise<DecisionPromotionSummary[]> {
  const rows = await query<DecisionPromotionRow>(
    `SELECT ${DECISION_PROMOTION_SELECT} WHERE d.durable_memory_recommendation = 'RECOMMENDED' AND d.open_brain_eligible = false ORDER BY d.decided_at ASC`
  )
  return rows.map(mapDecisionPromotionRow)
}

/** Decisions Jerry has approved (open_brain_eligible = true) but Chief has not yet synced to Open Brain — the set writeDecisionToOpenBrain() should process next. */
export async function getDecisionsAwaitingOpenBrainSync(): Promise<DecisionPromotionSummary[]> {
  const rows = await query<DecisionPromotionRow>(
    `SELECT ${DECISION_PROMOTION_SELECT} WHERE d.open_brain_eligible = true AND d.open_brain_thought_id IS NULL ORDER BY d.decided_at ASC`
  )
  return rows.map(mapDecisionPromotionRow)
}

const INTERACTION_SELECT = `
  i.id, i.channel, i.direction, i.occurred_at, i.subject, i.summary, i.outcome, i.requires_action, i.task_id,
  c.id AS contact_id, c.organization_name AS contact_organization_name, c.person_name AS contact_person_name,
  p.id AS project_id, p.project_key AS project_key, p.name AS project_name
  FROM agent.interactions i
  LEFT JOIN agent.contacts c ON c.id = i.contact_id
  LEFT JOIN agent.projects p ON p.id = i.project_id
`

/**
 * Interactions flagged requires_action = true — NOT pre-sorted into
 * "waiting on them" vs "needs our response": agent.interactions has no
 * live rows to validate a classification against, `direction` is
 * nullable, and requires_action's own Phase 0A intent ("if an interaction
 * requires future work, the future service layer creates a task for it")
 * describes an untriaged flag, not a durable ownership signal. Chief
 * Brief (chiefBriefRules.ts) surfaces every result here conservatively —
 * see that module's doc for the classification it applies (always
 * UNKNOWN today).
 */
export async function getInteractionsRequiringAction(): Promise<InteractionSummary[]> {
  const rows = await query<InteractionRow>(`SELECT ${INTERACTION_SELECT} WHERE i.requires_action = true ORDER BY i.occurred_at ASC`)
  return rows.map(mapInteractionRow)
}

/** Interactions logged since a given instant — for Chief Brief's "recent changes" section (chiefBrief.ts). */
export async function getRecentInteractions(since: Date): Promise<InteractionSummary[]> {
  const rows = await query<InteractionRow>(`SELECT ${INTERACTION_SELECT} WHERE i.created_at > $1 ORDER BY i.occurred_at ASC`, [since])
  return rows.map(mapInteractionRow)
}

export interface DestinationContactEmail {
  contactId: string
  email: string
  projectKey: string
}

/**
 * Phase 2L — pre-Phase-2I destination relationship evidence. agent.contacts
 * has no direct project/destination FK; the only link is via
 * agent.interactions.contact_id+project_id or agent.tasks.contact_id+
 * project_id (both already-existing operational data for real destinations
 * like Willcox/Grand Lake/Rim Country/Buena Vista that predate the
 * destination_relationship playbook driver). Used to extend
 * DbContactDirectory (dbGmailCheckpointStore.ts) so inbound-email
 * association can resolve a known contact even when no
 * destination_relationship run exists yet for that destination — never
 * manufactures a contact, only surfaces ones that already exist.
 */
export async function getDestinationContactEmails(): Promise<DestinationContactEmail[]> {
  const rows = await query<{ contact_id: string; email: string; project_key: string }>(
    `SELECT DISTINCT c.id AS contact_id, c.email, p.project_key
       FROM agent.contacts c
       JOIN agent.interactions i ON i.contact_id = c.id
       JOIN agent.projects p ON p.id = i.project_id
      WHERE p.project_type = 'DESTINATION_HUB' AND c.email IS NOT NULL
     UNION
     SELECT DISTINCT c.id AS contact_id, c.email, p.project_key
       FROM agent.contacts c
       JOIN agent.tasks t ON t.contact_id = c.id
       JOIN agent.projects p ON p.id = t.project_id
      WHERE p.project_type = 'DESTINATION_HUB' AND c.email IS NOT NULL`
  )
  return rows.map((r) => ({ contactId: r.contact_id, email: r.email, projectKey: r.project_key }))
}

/** agent.decision_events since a given instant — the decision-lifecycle half of Chief Brief's "recent changes" (chiefBrief.ts); mirrors getRecentTaskChanges. */
export async function getRecentDecisionEvents(since: Date): Promise<DecisionEventSummary[]> {
  const rows = await query<DecisionEventRow>(
    `SELECT
       de.id, de.event_type, de.occurred_at, de.note,
       d.id AS decision_id, d.decision_key AS decision_key,
       o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name
     FROM agent.decision_events de
     JOIN agent.decisions d ON d.id = de.decision_id
     LEFT JOIN agent.owners o ON o.id = de.actor_owner_id
     WHERE de.occurred_at > $1
     ORDER BY de.occurred_at ASC`,
    [since]
  )
  return rows.map(mapDecisionEventRow)
}

// ---------------------------------------------------------------------------
// Every task, any status, any project. None of the functions above return
// this — they're all scoped by status/project/time-window for a specific
// operational question. Phase 0E's audit layer is the first caller that
// genuinely needs the full set (e.g. to detect a terminal project with
// leftover open tasks, or a blocker chain running through tasks of any
// status) — added here rather than duplicated as ad hoc SQL inside the
// audit module.
// ---------------------------------------------------------------------------

export async function getAllTasks(): Promise<TaskSummary[]> {
  const rows = await query<TaskRow>(`SELECT ${TASK_SELECT} ${TASK_FROM} ORDER BY t.created_at`)
  return rows.map(mapTaskRow)
}

// ---------------------------------------------------------------------------
// Chief Phase 2E — the two read primitives dbExecutionStore.ts needs on
// top of everything above: look a task up by its (source_type, source_ref)
// idempotency identity (the same pair createTask's ON CONFLICT already
// enforces uniqueness on), and read one task's full event history WITH
// metadata (task_events.metadata is JSONB — every other query in this file
// drops it via mapTaskEventRow, since no caller before Phase 2E needed the
// structured payload back).
// ---------------------------------------------------------------------------

export async function getTaskBySource(sourceType: string, sourceRef: string): Promise<TaskSummary | null> {
  const rows = await query<TaskRow>(`SELECT ${TASK_SELECT} ${TASK_FROM} WHERE t.source_type = $1 AND t.source_ref = $2`, [sourceType, sourceRef])
  return rows.length > 0 ? mapTaskRow(rows[0]) : null
}

export async function getTasksBySourceType(sourceType: string): Promise<TaskSummary[]> {
  const rows = await query<TaskRow>(`SELECT ${TASK_SELECT} ${TASK_FROM} WHERE t.source_type = $1 ORDER BY t.created_at`, [sourceType])
  return rows.map(mapTaskRow)
}

/**
 * A registration-time idempotencyKey is written into a PLAYBOOK_STAGE
 * event's metadata (see recordPlaybookStage) but is not itself the
 * task's own (source_type, source_ref) identity — dbExecutionStore.ts's
 * findByIdempotencyKey needs to search ACROSS tasks for it, unlike every
 * other idempotency check in this file which is already scoped to one
 * known task_id.
 */
export async function findTaskIdByRegistrationIdempotencyKey(idempotencyKey: string): Promise<string | null> {
  const rows = await query<{ task_id: string }>(
    `SELECT task_id FROM agent.task_events WHERE event_type = 'PLAYBOOK_STAGE' AND metadata ->> 'idempotencyKey' = $1 ORDER BY changed_at ASC LIMIT 1`,
    [idempotencyKey]
  )
  return rows.length > 0 ? rows[0].task_id : null
}

export async function getTaskEventsForTask(taskId: string): Promise<TaskEventDetail[]> {
  const rows = await query<TaskEventDetailRow>(
    `SELECT
       te.id, te.event_type, te.from_status, te.to_status, te.changed_at, te.note, te.metadata,
       t.id AS task_id, t.title AS task_title,
       p.id AS project_id, p.project_key AS project_key, p.name AS project_name,
       o.id AS owner_id, o.owner_key AS owner_key, o.display_name AS owner_display_name
     FROM agent.task_events te
     JOIN agent.tasks t ON t.id = te.task_id
     LEFT JOIN agent.projects p ON p.id = t.project_id
     LEFT JOIN agent.owners o ON o.id = te.changed_by_owner_id
     WHERE te.task_id = $1
     ORDER BY te.changed_at ASC`,
    [taskId]
  )
  return rows.map(mapTaskEventDetailRow)
}
