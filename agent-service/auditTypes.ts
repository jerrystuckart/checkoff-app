// Phase 0E — Chief Audit / Exception Report. Types only, no logic here.

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

// Valid operational work someone should look at now — not anomalies.
export type AttentionCode =
  | 'TASK_NEEDS_JERRY'
  | 'TASK_OVERDUE'
  | 'WAITING_DUE_FOR_CHECK'
  | 'TASK_READY'
  | 'TASK_BLOCKED'

// Operationally stale or inconsistent state — NOT a reimplementation of
// Phase 0A's CHECK constraints. Every code here checks something the
// schema cannot and does not prevent (see the module doc comment in
// auditRules.ts for the one-line reason per check).
export type ExceptionCode =
  | 'IN_PROGRESS_STALE'
  | 'READY_STALE'
  | 'ACTIVE_PROJECT_NO_OPEN_TASKS'
  | 'ON_HOLD_PROJECT_HAS_ACTIVE_WORK'
  | 'TERMINAL_PROJECT_HAS_OPEN_TASKS'
  | 'BLOCKER_IS_TERMINAL'
  | 'TASK_BLOCKS_ITSELF'
  | 'BLOCKER_CYCLE'

export type FindingCode = AttentionCode | ExceptionCode

/** Minimal stable reference to a task or project — enough to identify and act on it, never the full row. */
export interface FindingRef {
  id: string
  key: string | null // project_key, or null for a task ref (tasks have no stable business key)
  title: string
}

export interface AuditFinding {
  code: FindingCode
  severity: FindingSeverity
  entityType: 'task' | 'project'
  entityId: string
  project: FindingRef | null
  task: FindingRef | null
  /** Deterministic, template-generated — never free-form/AI-authored text. */
  message: string
  /** The timestamp this finding is "about" (due_at, next_check_at, updated_at, etc.) — null when not applicable (e.g. TASK_READY has no natural timestamp). */
  relevantAt: Date | null
  metadata: Record<string, unknown>
}

export interface ProjectHealthCounts {
  open: number
  ready: number
  inProgress: number
  waiting: number
  blocked: number
  needsJerry: number
  overdue: number
  dueForCheck: number
}

export interface ProjectHealth {
  project: FindingRef
  counts: ProjectHealthCounts
  flags: ExceptionCode[]
}

export interface ChiefAuditReportSummary {
  generatedAt: Date
  /** Total findings in `attention` — a task with 2 reasons counts as 2 here. */
  attentionFindingCount: number
  /** Distinct task ids across `attention` — the number the spec calls out explicitly: never double-count a task just because it has multiple attention reasons. */
  uniqueTasksNeedingAttention: number
  attentionByCode: Partial<Record<AttentionCode, number>>
  exceptionFindingCount: number
  exceptionByCode: Partial<Record<ExceptionCode, number>>
}

export interface ChiefAuditReport {
  generatedAt: Date
  summary: ChiefAuditReportSummary
  attention: AuditFinding[]
  exceptions: AuditFinding[]
  projectHealth: ProjectHealth[]
}

export interface ChiefAuditOptions {
  now?: Date
  staleInProgressDays?: number
  staleReadyDays?: number
}

export const DEFAULT_STALE_IN_PROGRESS_DAYS = 7
export const DEFAULT_STALE_READY_DAYS = 14
