// Domain types for the Phase 0C Chief operational read/query layer.
// These are the ONLY shapes this module hands back to callers — no raw
// pg row objects, no snake_case column names, ever escape agent-service/.

export type ProjectStatus = 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELED'
export type ProjectType = 'METRO' | 'DESTINATION_HUB' | 'PRODUCT' | 'INTERNAL'
export type TaskStatus =
  | 'BACKLOG'
  | 'READY'
  | 'IN_PROGRESS'
  | 'WAITING'
  | 'BLOCKED'
  | 'NEEDS_JERRY'
  | 'DONE'
  | 'CANCELED'

export interface OwnerRef {
  id: string
  ownerKey: string
  displayName: string
}

export interface ProjectRef {
  id: string
  projectKey: string
  name: string
}

/** agent.contacts has no stable business key yet (Phase 0A) — id is all there is. */
export interface ContactRef {
  id: string
  organizationName: string | null
  personName: string | null
}

export interface ProjectSummary {
  id: string
  projectKey: string
  name: string
  projectType: ProjectType
  status: ProjectStatus
  priority: string | null
  owner: OwnerRef | null
  targetAt: Date | null
  lastActivityAt: Date | null
  summary: string | null
}

export interface ProjectFilters {
  status?: ProjectStatus
  projectType?: ProjectType
  ownerKey?: string
}

/** The primary blocker task's own identity/status — NOT a dependency graph. */
export interface BlockerRef {
  id: string
  title: string
  status: TaskStatus
}

export interface TaskSummary {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: string | null
  project: ProjectRef | null
  owner: OwnerRef | null
  dueAt: Date | null
  nextCheckAt: Date | null
  nextAction: string | null
  requiresJerry: boolean
  jerryRequest: string | null
  blockedBy: BlockerRef | null
  blockerNote: string | null
  contact: ContactRef | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** Stable business-key pair for bootstrap/ingested tasks — tasks have no other durable key. Phase 1C's reconciliation rule registry matches rules against sourceRef (never the raw UUID, which isn't stable across environments). */
  sourceType: string | null
  sourceRef: string | null
  /**
   * Phase 1D. The owning project's type (PRODUCT/INTERNAL/DESTINATION_HUB/
   * METRO), duplicated here directly on TaskSummary rather than added to
   * the shared, minimal ProjectRef (used by decisions/interactions/brief
   * items too, where it isn't needed) — same "extend TaskSummary itself"
   * pattern as sourceType/sourceRef above. actionHandlers.ts's structured
   * capability-selection signal; never inferred from title/description text.
   */
  projectType: ProjectType | null
}

/** Which locked-semantics criteria matched, for getTasksNeedingAction(). */
export type NeedsActionReason = 'NEEDS_JERRY' | 'READY' | 'OVERDUE' | 'DUE_FOR_CHECK' | 'IN_PROGRESS'

export interface NeedsActionTaskSummary extends TaskSummary {
  reasons: NeedsActionReason[]
}

export interface WaitingTaskSummary extends TaskSummary {
  status: 'WAITING'
  isDueForCheck: boolean
}

export interface BlockedTaskSummary extends TaskSummary {
  status: 'BLOCKED'
}

export interface JerryTaskSummary extends TaskSummary {
  status: 'NEEDS_JERRY'
}

export interface TaskFilters {
  status?: TaskStatus
  ownerKey?: string
  contactId?: string
  overdue?: boolean
  dueForCheck?: boolean
}

export interface TaskEventSummary {
  id: string
  task: { id: string; title: string }
  project: ProjectRef | null
  eventType: string
  fromStatus: TaskStatus | null
  toStatus: TaskStatus | null
  changedBy: OwnerRef | null
  changedAt: Date
  note: string | null
}

/**
 * Chief Phase 2E. Same shape as TaskEventSummary plus `metadata` — kept as
 * a SEPARATE type rather than adding metadata to TaskEventSummary itself,
 * so every existing caller of getRecentTaskChanges/mapTaskEventRow is
 * unaffected. Used by dbExecutionStore.ts to reconstruct a full
 * ExecutionRecord (identity snapshot + result envelope) from the
 * task_events.metadata JSONB already written by recordPlaybookStage.
 */
export interface TaskEventDetail extends TaskEventSummary {
  metadata: Record<string, unknown>
}

/**
 * Phase 1B. See chiefBrief.ts's module doc / the Phase 1B design audit for
 * why this is intentionally NOT classified further here (no WAITING/
 * NEEDS_RESPONSE/INFORMATIONAL split): agent.interactions has zero live
 * rows to inspect, `direction` is nullable, and `requires_action`'s own
 * Phase 0A doc comment ("if an interaction requires future work, the
 * future service layer creates a task for it") describes an untriaged
 * flag, not a durable "who is waiting on whom" signal. Classification
 * happens (conservatively, as UNKNOWN) in chiefBriefRules.ts, not here.
 */
export interface InteractionSummary {
  id: string
  channel: string
  direction: 'INBOUND' | 'OUTBOUND' | null
  occurredAt: Date
  subject: string | null
  summary: string | null
  outcome: string | null
  requiresAction: boolean
  contact: ContactRef | null
  project: ProjectRef | null
  taskId: string | null
}

export interface DecisionSummary {
  id: string
  decisionKey: string
  decision: string
  decidedAt: Date
  decidedBy: OwnerRef | null
  project: ProjectRef | null
  supersedesDecisionId: string | null
}

export interface DecisionEventSummary {
  id: string
  decision: { id: string; decisionKey: string }
  eventType: 'CREATED' | 'DURABLE_MEMORY_RECOMMENDED' | 'DURABLE_MEMORY_APPROVED' | 'DURABLE_MEMORY_REJECTED' | 'OPEN_BRAIN_SYNC_SUCCEEDED' | 'OPEN_BRAIN_SYNC_FAILED' | 'SUPERSEDED'
  actor: OwnerRef | null
  occurredAt: Date
  note: string | null
}

export interface ProjectState {
  project: ProjectSummary
  tasksByStatus: Partial<Record<TaskStatus, TaskSummary[]>>
  waitingTasks: WaitingTaskSummary[]
  blockedTasks: BlockedTaskSummary[]
  needsJerryTasks: JerryTaskSummary[]
  recentlyCompletedTasks: TaskSummary[]
  decisions: DecisionSummary[]
}

// No "not found" exception is thrown for a missing project — the schema
// itself doesn't distinguish "doesn't exist" from any other business
// condition, and this repo has no established typed-error convention to
// match, so this discriminated union is Phase 0C's own new convention:
// deliberate, explicit, and meant to be followed by later phases rather
// than each call site re-deciding how to signal "not found."
export type ProjectStateResult =
  | { found: true; state: ProjectState }
  | { found: false; projectKey: string }
