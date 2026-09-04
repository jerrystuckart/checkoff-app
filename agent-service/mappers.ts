// Raw pg row shapes (snake_case, as columns come back from Postgres) and
// the functions that turn them into the domain types in types.ts. Kept
// separate from queries.ts so the SQL and the shaping logic can each be
// read on their own.

import type {
  OwnerRef,
  ProjectRef,
  ContactRef,
  ProjectSummary,
  ProjectStatus,
  ProjectType,
  TaskSummary,
  TaskStatus,
  BlockerRef,
  TaskEventSummary,
  DecisionSummary,
  InteractionSummary,
  DecisionEventSummary,
} from './types'

interface OwnerCols {
  owner_id: string | null
  owner_key: string | null
  owner_display_name: string | null
}

interface ProjectRefCols {
  project_id: string | null
  project_key: string | null
  project_name: string | null
}

interface ContactRefCols {
  contact_id: string | null
  contact_organization_name: string | null
  contact_person_name: string | null
}

export function mapOwner(row: OwnerCols): OwnerRef | null {
  if (row.owner_id === null || row.owner_key === null || row.owner_display_name === null) return null
  return { id: row.owner_id, ownerKey: row.owner_key, displayName: row.owner_display_name }
}

export function mapProjectRef(row: ProjectRefCols): ProjectRef | null {
  if (row.project_id === null || row.project_key === null || row.project_name === null) return null
  return { id: row.project_id, projectKey: row.project_key, name: row.project_name }
}

export function mapContactRef(row: ContactRefCols): ContactRef | null {
  if (row.contact_id === null) return null
  return {
    id: row.contact_id,
    organizationName: row.contact_organization_name,
    personName: row.contact_person_name,
  }
}

export interface ProjectRow extends OwnerCols {
  id: string
  project_key: string
  name: string
  project_type: ProjectType
  status: ProjectStatus
  priority: string | null
  target_at: Date | null
  last_activity_at: Date | null
  summary: string | null
}

export function mapProjectRow(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    projectKey: row.project_key,
    name: row.name,
    projectType: row.project_type,
    status: row.status,
    priority: row.priority,
    owner: mapOwner(row),
    targetAt: row.target_at,
    lastActivityAt: row.last_activity_at,
    summary: row.summary,
  }
}

export interface TaskRow extends OwnerCols, ProjectRefCols, ContactRefCols {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: string | null
  due_at: Date | null
  next_check_at: Date | null
  next_action: string | null
  requires_jerry: boolean
  jerry_request: string | null
  blocked_by_task_id: string | null
  blocker_note: string | null
  blocker_title: string | null
  blocker_status: TaskStatus | null
  started_at: Date | null
  completed_at: Date | null
  created_at: Date
  updated_at: Date
  source_type: string | null
  source_ref: string | null
  project_type: ProjectType | null
}

export function mapTaskRow(row: TaskRow): TaskSummary {
  let blockedBy: BlockerRef | null = null
  if (row.blocked_by_task_id !== null && row.blocker_title !== null && row.blocker_status !== null) {
    blockedBy = { id: row.blocked_by_task_id, title: row.blocker_title, status: row.blocker_status }
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    project: mapProjectRef(row),
    owner: mapOwner(row),
    dueAt: row.due_at,
    nextCheckAt: row.next_check_at,
    nextAction: row.next_action,
    requiresJerry: row.requires_jerry,
    jerryRequest: row.jerry_request,
    blockedBy,
    blockerNote: row.blocker_note,
    contact: mapContactRef(row),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    projectType: row.project_type,
  }
}

export interface TaskEventRow extends OwnerCols, ProjectRefCols {
  id: string
  event_type: string
  from_status: TaskStatus | null
  to_status: TaskStatus | null
  changed_at: Date
  note: string | null
  task_id: string
  task_title: string
}

export function mapTaskEventRow(row: TaskEventRow): TaskEventSummary {
  return {
    id: row.id,
    task: { id: row.task_id, title: row.task_title },
    project: mapProjectRef(row),
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    changedBy: mapOwner(row),
    changedAt: row.changed_at,
    note: row.note,
  }
}

export interface DecisionRow extends OwnerCols, ProjectRefCols {
  id: string
  decision_key: string
  decision: string
  decided_at: Date
  supersedes_decision_id: string | null
}

export interface InteractionRow extends ContactRefCols, ProjectRefCols {
  id: string
  channel: string
  direction: 'INBOUND' | 'OUTBOUND' | null
  occurred_at: Date
  subject: string | null
  summary: string | null
  outcome: string | null
  requires_action: boolean
  task_id: string | null
}

export function mapInteractionRow(row: InteractionRow): InteractionSummary {
  return {
    id: row.id,
    channel: row.channel,
    direction: row.direction,
    occurredAt: row.occurred_at,
    subject: row.subject,
    summary: row.summary,
    outcome: row.outcome,
    requiresAction: row.requires_action,
    contact: mapContactRef(row),
    project: mapProjectRef(row),
    taskId: row.task_id,
  }
}

export interface DecisionEventRow extends OwnerCols {
  id: string
  decision_id: string
  decision_key: string
  event_type: DecisionEventSummary['eventType']
  occurred_at: Date
  note: string | null
}

export function mapDecisionEventRow(row: DecisionEventRow): DecisionEventSummary {
  return {
    id: row.id,
    decision: { id: row.decision_id, decisionKey: row.decision_key },
    eventType: row.event_type,
    actor: mapOwner(row),
    occurredAt: row.occurred_at,
    note: row.note,
  }
}

export function mapDecisionRow(row: DecisionRow): DecisionSummary {
  return {
    id: row.id,
    decisionKey: row.decision_key,
    decision: row.decision,
    decidedAt: row.decided_at,
    decidedBy: mapOwner(row),
    project: mapProjectRef(row),
    supersedesDecisionId: row.supersedes_decision_id,
  }
}
