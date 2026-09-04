// Phase 1C — Operational state reconciliation. Types only, no logic here
// (mirrors auditTypes.ts / chiefBriefTypes.ts).

import type { TaskStatus } from './types'

/**
 * COMPLETION_PROOF — positive, schema-queryable evidence that THIS task's
 *   own literal, stated acceptance condition happened. Never inferred from
 *   a merely related/correlated downstream capability (see mutations.ts
 *   and this module's own doc — the "repair ChatGPT Open Brain auth" case
 *   is the canonical counter-example: a working standalone Open Brain
 *   transport does NOT prove that literal task's own condition).
 * SUPERSESSION_PROOF — positive evidence that a later architecture/
 *   decision made the task's intended outcome unnecessary. NEVER
 *   auto-applicable, regardless of how strong the evidence looks — this is
 *   an intent judgment, not a fact a query can prove, and always requires
 *   a human decision (recommend-only, permanently, by design).
 * NO_CHANGE_EVIDENCE — no evidence of execution found. Default outcome.
 *   Performs no transition.
 * AMBIGUOUS — evidence exists but proves neither completion nor
 *   supersession cleanly. Recommend-only, flagged for human review.
 */
export type EvidenceCategory = 'COMPLETION_PROOF' | 'SUPERSESSION_PROOF' | 'NO_CHANGE_EVIDENCE' | 'AMBIGUOUS'

export type ReconciliationConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface ReconciliationFinding {
  taskId: string
  currentStatus: TaskStatus
  /** null when no transition is recommended (NO_CHANGE_EVIDENCE, or AMBIGUOUS with nothing concrete to propose). */
  recommendedStatus: TaskStatus | null
  evidenceCategory: EvidenceCategory
  confidence: ReconciliationConfidence
  evidenceSources: string[]
  reason: string
  /**
   * True ONLY when ALL of: category is COMPLETION_PROOF; the evidence is
   * deterministic/structured (never free-text/narrative); an explicit
   * rule exists for this task; and the resulting transition is permitted
   * by ALLOWED_TRANSITIONS (transitions.ts). Computed centrally by the
   * assessment engine (reconciliationRules.ts) from the rule's own
   * declared category/recommendedStatus — a rule never sets this
   * directly, so it can't accidentally mark itself auto-applicable.
   */
  autoApplicable: boolean
}
