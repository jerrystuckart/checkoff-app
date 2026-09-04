// Phase 1B — Chief Brief. Types only, no logic here (mirrors auditTypes.ts).

import type { ProjectRef } from './types'
import type { ActionPlan } from './actionPolicyTypes'

export type ChiefBriefTier = 'P0' | 'P1' | 'P2' | 'P3'

/**
 * Who can actually move a blocked task forward, derived ONLY from
 * structured evidence (the blocking task's own status) — never from
 * free-text blocker-note content. UNKNOWN is the correct, honest answer
 * when there's no reliable structured signal (no linked blocker task, or
 * the blocker task's own status doesn't map cleanly to an owner) — see
 * computeResolutionOwner() in chiefBriefRules.ts for the exact mapping.
 */
export type ResolutionOwner = 'CHIEF' | 'JERRY' | 'EXTERNAL' | 'UNKNOWN'

/**
 * Phase 1C. Derived from a ReconciliationFinding (reconciliationTypes.ts),
 * never set independently — see chiefBriefRules.ts's staleSignalFor().
 *   - null: no finding, or NO_CHANGE_EVIDENCE (nothing stale).
 *   - POSSIBLY_STALE: an AMBIGUOUS finding — evidence exists but doesn't
 *     cleanly prove completion or supersession. Human review, not action.
 *   - PROVABLY_COMPLETE: a COMPLETION_PROOF finding that was NOT
 *     auto-applied (e.g. no rule exists yet, or the resulting transition
 *     isn't currently permitted) — surfaced so it's visible rather than
 *     silently dropped. An auto-applied COMPLETION_PROOF finding never
 *     reaches this state: the task is already transitioned and excluded
 *     from its old section entirely by the time the brief is computed.
 *   - SUPERSEDED_REVIEW: a SUPERSESSION_PROOF finding — always
 *     recommend-only, permanently, by design (see reconciliationTypes.ts).
 */
export type StaleSignal = null | 'POSSIBLY_STALE' | 'PROVABLY_COMPLETE' | 'SUPERSEDED_REVIEW'

export interface ChiefBriefItem {
  /** The real row id — task id, decision id, or interaction id. Always sufficient to look the thing up again. */
  id: string
  kind: 'task' | 'decision' | 'interaction'
  tier: ChiefBriefTier
  title: string
  project: ProjectRef | null
  /** Deterministic, template-generated — never free-form/AI-authored text. Same convention as AuditFinding.message. */
  reason: string
  relevantAt: Date | null
  sourceRef: { table: 'agent.tasks' | 'agent.decisions' | 'agent.interactions'; id: string }
  /** Only ever set for kind: 'task' — reconciliation (Phase 1C) assesses tasks only. Always null for decisions/interactions. */
  staleSignal: StaleSignal
  /**
   * Phase 1D. Populated by calling ONLY selectApplicablePlan() (read-only
   * planning — see actionHandlers.ts) against this item's task, never
   * execute(). getChiefBrief() never calls execute() for anything — this
   * field shows what Chief WOULD propose, not something already acted on.
   * null when no registered capability applies to this task (see
   * actionHandlers.ts's selectApplicablePlan — zero or ambiguous matches
   * both produce null, honestly, rather than a guess) or for non-task items.
   */
  proposedAction: ActionPlan | null
}

export interface ChiefBriefBlockedItem extends ChiefBriefItem {
  blockerReason: string
  resolutionOwner: ResolutionOwner
}

export interface ChiefBriefSummaryCounts {
  needsYouCount: number
  waitingCount: number
  chiefCanHandleCount: number
  blockedCount: number
  recentChangesCount: number
}

export interface ChiefBrief {
  generatedAt: Date
  /** null on the first-ever brief (no prior SUCCEEDED chief_brief run exists) — recentChanges is always empty in that case, deliberately, to avoid an everything-since-epoch backlog dump. */
  since: Date | null
  needsYou: ChiefBriefItem[]
  waiting: ChiefBriefItem[]
  chiefCanHandle: ChiefBriefItem[]
  blocked: ChiefBriefBlockedItem[]
  recentChanges: ChiefBriefItem[]
  summary: ChiefBriefSummaryCounts
}
