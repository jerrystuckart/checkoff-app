// CheckOff Chief operational layer — public surface.
//
// READ (Phase 0C): every function below `queries`/`projectState` is
// read-only, backed by the pooled `query()` helper whose session default
// is `SET default_transaction_read_only = on` (db.ts) — there is no code
// path from these functions that can write.
//
// WRITE (Phase 0D): exactly three explicitly designed mutations —
// createTask, transitionTask, updateTaskPlan — and nothing else. No
// generic updateTask(arbitraryFields), no raw SQL exposed to callers. Each
// runs inside db.ts's withWriteTransaction(), the ONLY place a writable
// transaction can be obtained; nothing else in this module can turn
// writes on.

export * from './types'

export {
  getActiveProjects,
  getProjects,
  getOnHoldProjects,
  getOverdueTasks,
  getTasksDueForCheck,
  getWaitingTasks,
  getBlockedTasks,
  getNeedsJerryTasks,
  getTasksNeedingAction,
  getRecentTaskChanges,
  getRecentlyCompletedTasks,
  getProjectTasks,
  getCurrentDecisions,
  getAllTasks,
  DEFAULT_RECENT_CHANGES_WINDOW_MS,
  getPendingDurableMemoryRecommendations,
  getDecisionsAwaitingOpenBrainSync,
  getInteractionsRequiringAction,
  getRecentInteractions,
  getRecentDecisionEvents,
} from './queries'
export type { WaitingTaskOptions, NeedsActionOptions, DecisionPromotionSummary } from './queries'

export { getProjectState, DEFAULT_PROJECT_STATE_COMPLETED_WINDOW_MS } from './projectState'
export type { ProjectStateOptions } from './projectState'

// Phase 0E — Chief Audit / Exception Report. Fully read-only: computes
// findings from current state, never persists them, never mutates
// anything (see auditRules.ts's module doc for why each check exists and
// audit.ts for confirmation this only ever reads).
export { getChiefAuditReport } from './audit'
export {
  computeChiefAuditReport,
  computeAttentionFindings,
  computeExceptionFindings,
  computeBlockerCycles,
  computeProjectHealth,
  compareFindings,
} from './auditRules'
export {
  DEFAULT_STALE_IN_PROGRESS_DAYS,
  DEFAULT_STALE_READY_DAYS,
} from './auditTypes'
export type {
  FindingSeverity,
  AttentionCode,
  ExceptionCode,
  FindingCode,
  FindingRef,
  AuditFinding,
  ProjectHealthCounts,
  ProjectHealth,
  ChiefAuditReportSummary,
  ChiefAuditReport,
  ChiefAuditOptions,
} from './auditTypes'
export { renderChiefAuditReport } from './renderAudit'

export { createTask, transitionTask, updateTaskPlan } from './mutations'
export type {
  CreateTaskInput,
  CreateTaskResult,
  TransitionTaskInput,
  TransitionTaskResult,
  UpdateTaskPlanInput,
  UpdateTaskPlanResult,
} from './mutations'

export { ALLOWED_TRANSITIONS, assertTransitionAllowed } from './transitions'

// Phase 0F — controlled Open Brain write-back. Only agent.decisions,
// only these three functions. See openBrainTypes.ts's module doc for the
// real (narrower-than-ideal) Open Brain MCP capabilities this works
// within, and openBrainClient.ts for why getDefaultOpenBrainClient()
// throws by default (no confirmed transport from a standalone process).
export { previewDecisionOpenBrainWrite, writeDecisionToOpenBrain, reconcileDecisionOpenBrainWrite } from './openBrainDecisions'
export type {
  DecisionOpenBrainPreview,
  DecisionOpenBrainContent,
  DecisionOpenBrainProvenance,
  DecisionOpenBrainSyncState,
  DecisionOpenBrainWriteResult,
  DecisionOpenBrainReconcileResult,
  WriteDecisionToOpenBrainInput,
  RemoteVerificationState,
} from './openBrainTypes'
export { decisionSourceIdentity } from './openBrainTypes'
export { formatDecisionForOpenBrain } from './openBrainFormat'
export type { DecisionContentSource } from './openBrainFormat'
export type { OpenBrainClient, OpenBrainCreateResult, OpenBrainThought, OpenBrainSearchResult } from './openBrainClient'
export { getDefaultOpenBrainClient } from './openBrainClient'

// Phase 1A — decision creation and durable-memory recommendation. Note
// what's absent: approveDecisionForOpenBrain/rejectDecisionForOpenBrain/
// reconsiderDecisionForOpenBrain do not exist here and never will in this
// module — agent_service has no EXECUTE grant on those three DB functions
// (agent_approver-only; see the Phase 1A promotion-workflow migration), so
// a wrapper for them in agent-service would be dead code. For Phase 1A
// those are invoked directly against the database by Jerry.
export { createDecision } from './decisions'
export type { CreateDecisionInput, CreatedDecision } from './decisions'
export { recommendDecisionForOpenBrain, syncDecisionToOpenBrain } from './decisionPromotion'
export type { RecommendDecisionForOpenBrainResult } from './decisionPromotion'

// Phase 1B — Chief Brief. getChiefBrief() is the ONE exception to "every
// get* function is purely read-only": it also writes exactly one
// agent.runs row per call (its own RUNNING -> SUCCEEDED/FAILED lifecycle
// record — see chiefBrief.ts's module doc). It performs no other
// mutation: no task/decision/interaction write of any kind, regardless of
// what the computed brief contains. See readonly.test.ts for the explicit
// test covering this exception.
export { getChiefBrief, getDefaultChiefBriefDataSource, getDefaultChiefRunRepository } from './chiefBrief'
export type { ChiefBriefDataSource, ChiefRunRepository, GetChiefBriefOptions } from './chiefBrief'
export { computeChiefBrief, computeResolutionOwner } from './chiefBriefRules'
export type { ChiefBriefInputs } from './chiefBriefRules'
export type {
  ChiefBriefTier,
  ResolutionOwner,
  StaleSignal,
  ChiefBriefItem,
  ChiefBriefBlockedItem,
  ChiefBriefSummaryCounts,
  ChiefBrief,
} from './chiefBriefTypes'

// Phase 1C — operational state reconciliation. assessReconciliation is
// read-only; applyReconciliationFinding is the ONLY function anywhere in
// agent-service that can turn a reconciliation finding into a real
// transition (via transitionTask() — never a parallel mechanism), and it
// throws rather than silently no-op-ing a finding that isn't actually
// autoApplicable. RECONCILIATION_RULES starts empty by design — see
// reconciliationRules.ts's module doc.
export { assessReconciliation, applyReconciliationFinding, applyAutoApplicableFindings, getDefaultReconciliationReader } from './reconciliation'
export { RECONCILIATION_RULES, assessTask, assessTasks } from './reconciliationRules'
export type { ReconciliationRule, ReconciliationRuleResult, ReconciliationReader } from './reconciliationRules'
export type { EvidenceCategory, ReconciliationConfidence, ReconciliationFinding } from './reconciliationTypes'

// Phase 1D — Chief action policy + execution loop. ACTION_REGISTRY is the
// trust boundary (see actionHandlers.ts's module doc): policy is a fixed
// property of a registered ActionHandler, never something the planning
// layer chooses. selectApplicablePlan is read-only planning; it is what
// getChiefBrief() calls to populate each item's proposedAction.
// executeAutonomousAction is the ONLY function in this module that can
// autonomously transition a task, and only ever: READY->IN_PROGRESS
// (claim), a handler-reported operational condition ->
// WAITING/BLOCKED/NEEDS_JERRY, or ->DONE after that handler's own
// verifyCompletion() independently confirms it. It is write-capable (calls
// transitionTask() internally) — see readonly.test.ts's APPROVED_MUTATIONS.
export {
  ACTION_REGISTRY,
  internalDesignDefinitionHandler,
  outboundCommunicationHandler,
  selectApplicablePlan,
  findHandler,
} from './actionHandlers'
export type { ActionHandler, ActionExecuteOutcome } from './actionHandlers'
export { executeAutonomousAction, getDefaultActionExecutionDataSource } from './actionExecution'
export type { ActionExecutionDataSource } from './actionExecution'
export type {
  ActionType,
  ActionPolicy,
  ActionExpectedEffect,
  ActionPlan,
  ActionExecutionStatus,
  ActionExecutionResult,
} from './actionPolicyTypes'

// Phase 1E — the bounded filesystem-write capability (docs/whats-good-widget/
// ONLY — see artifactWriter.ts's module doc for the hardened containment)
// and the fixed, reviewed product-discovery artifact content it's used to
// write for the What's Good / What to Get widget's first autonomous
// action. writeArtifact is write-capable (filesystem, not the database) —
// see readonly.test.ts's APPROVED_MUTATIONS.
export { writeArtifact, readArtifact, artifactExists, ArtifactPathViolationError } from './artifactWriter'
export {
  ARTIFACT_FILENAME,
  ARTIFACT_PATH,
  DECISION_AREAS,
  WIDGET_CORE_MEANING_DECISION,
  WIDGET_FIRST_PLATFORM_FORM_DECISION,
  WIDGET_GEOFENCE_STATE_DECISION,
  WIDGET_NEARBY_DISCOVERY_DECISION,
  WIDGET_REFRESH_STABILITY_DECISION,
  APP_WIDE_SAVED_EXPERIENCES_DECISION,
  SAVED_ITEMS_LISTS_TAB_DECISION,
  WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION,
  WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION,
  WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION,
  WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION,
  WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION,
  buildDiscoveryArtifact,
  verifyDiscoveryArtifact,
} from './whatsGoodWidgetDiscoveryArtifact'
export type { DecisionArea, DecisionClassification } from './whatsGoodWidgetDiscoveryArtifact'

export {
  AgentServiceError,
  TaskNotFoundError,
  ProjectNotFoundError,
  OwnerNotFoundError,
  InvalidTransitionError,
  InvalidStateFieldsError,
  ConcurrencyConflictError,
  IdempotencyConflictError,
  DecisionNotFoundError,
  DecisionNotEligibleError,
  DecisionSyncStateMismatchError,
  OpenBrainUnavailableError,
  OpenBrainWriteFailedError,
  OpenBrainSourceIdentityConflictError,
  DecisionOpenBrainConflictError,
  OpenBrainReconciliationError,
  AmbiguousSyncOutcomeError,
  DecisionKeyConflictError,
  DecisionAlreadyEligibleError,
  DecisionRejectedForDurableMemoryError,
} from './errors'

export { closePool } from './db'
