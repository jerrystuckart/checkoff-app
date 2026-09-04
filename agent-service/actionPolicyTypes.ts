// Phase 1D — Chief action policy. Types only, no logic here (mirrors
// auditTypes.ts / chiefBriefTypes.ts / reconciliationTypes.ts).
//
// TRUST BOUNDARY (the point of this whole module): ActionType is a closed
// union, and ActionPolicy is never read from a plan, a task, or anything
// the reasoning/planning layer produces — it is a fixed property of the
// registered ActionHandler that owns that exact ActionType (see
// actionHandlers.ts). A plan's `actionType` field always equals the
// handler that produced it; nothing in this codebase constructs an
// ActionPlan except a handler's own plan() method, and nothing looks up
// policy from anywhere except ACTION_REGISTRY. This is what makes it
// structurally impossible for a planning error to mislabel e.g. an
// outbound send as internal_research: there is no code path where a
// string chosen by planning logic is trusted as the policy key.

import type { TaskStatus } from './types'

/**
 * The full Phase 1D action taxonomy. Closed union — adding a new action
 * type is a deliberate code change, never a free-form string a caller can
 * introduce. NOT every value here has a registered handler yet (see
 * actionHandlers.ts's ACTION_REGISTRY, deliberately small for the initial
 * implementation) — an ActionType with no registered handler simply can
 * never be planned or executed; it exists here only to document the full
 * taxonomy this design covers.
 */
export type ActionType =
  | 'internal_research'
  | 'internal_design_definition'
  | 'code_change_local_reversible'
  | 'run_tests_locally'
  | 'contact_record_create'
  | 'outbound_communication'
  | 'code_merge_to_main'
  | 'schema_migration_apply'
  | 'app_deployment'
  | 'durable_memory_approve_reject'
  | 'reconciliation_supersession'
  | 'reconciliation_ambiguous'

export type ActionPolicy = 'AUTO_ALLOWED' | 'APPROVAL_REQUIRED' | 'HUMAN_ONLY' | 'NOT_EXECUTABLE'

export type ActionExpectedEffect = 'internal_reversible' | 'external' | 'production'

export interface ActionPlan {
  taskId: string
  /** Always the producing handler's own actionType — never independently settable. */
  actionType: ActionType
  description: string
  reason: string
  expectedEffect: ActionExpectedEffect
  /** Always the producing handler's own policy — surfaced here for display/audit only, never re-consulted as the authority (the handler registry entry is the authority). */
  policy: ActionPolicy
}

export type ActionExecutionStatus = 'CLAIMED' | 'RETURNED_TO_NONTERMINAL' | 'COMPLETED' | 'NOT_YET_VERIFIABLE' | 'PLAN_UPDATED'

export interface ActionExecutionResult {
  status: ActionExecutionStatus
  taskStatusAfter: TaskStatus
  note: string
}
