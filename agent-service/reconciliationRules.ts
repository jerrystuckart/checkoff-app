// Phase 1C — the reconciliation rule registry and assessment engine.
// Deliberately NOT free-form/LLM inference: a "rule" here is a plain,
// reviewed TypeScript function that queries already-structured state and
// returns a fixed result — there is no "does this look done" heuristic
// anywhere in this file, by construction, because nothing here calls an
// LLM at all. That is also what makes COMPLETION_PROOF evidence
// "deterministic/structured": it can only ever come from a rule's own
// query result, never from narrative text.
//
// THE REGISTRY STARTS EMPTY. This is deliberate, not a placeholder to be
// filled reflexively — see the Phase 1C audit: the one live example found
// (open-brain-chatgpt-reconnect) was SUPERSESSION_PROOF, which can never
// be an auto-applicable rule (see reconciliationTypes.ts). The framework
// existing correctly, with zero rules, is the actual deliverable here —
// add a rule only once a real task has a literal acceptance condition
// that is provable from schema state, tied to THAT task's own words, not
// a correlated capability.

import type { TaskSummary, TaskStatus } from './types'
import type { ReconciliationFinding, EvidenceCategory, ReconciliationConfidence } from './reconciliationTypes'
import { ALLOWED_TRANSITIONS } from './transitions'

/**
 * Read-only query access for a rule's own evidence check — the same
 * underlying guarantee as db.ts's query() (session-level
 * `default_transaction_read_only = on`). A rule can never write; there is
 * no write-capable variant of this interface anywhere in this module.
 */
export interface ReconciliationReader {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface ReconciliationRuleResult {
  recommendedStatus: TaskStatus | null
  evidenceCategory: EvidenceCategory
  confidence: ReconciliationConfidence
  /** Structured references (table/column/row, or a specific file path for documentary evidence) — never a vague description. */
  evidenceSources: string[]
  reason: string
}

export interface ReconciliationRule {
  id: string
  description: string
  /**
   * Matches agent.tasks.source_ref exactly — the stable business key.
   * Never matched against the raw task UUID, which isn't a meaningful or
   * stable identifier across environments/re-bootstraps.
   */
  sourceRef: string
  /**
   * Must derive its result from a deterministic, structured check (a DB
   * query against already-committed state) — never from free-form
   * reasoning about the task's title/description. Only a rule whose
   * result is EvidenceCategory 'COMPLETION_PROOF' can ever become
   * autoApplicable (see assessTask below) — a rule is free to return
   * SUPERSESSION_PROOF/AMBIGUOUS/NO_CHANGE_EVIDENCE too, but those are
   * always recommend-only regardless of what the rule itself claims.
   */
  assess(task: TaskSummary, reader: ReconciliationReader): Promise<ReconciliationRuleResult>
}

/**
 * Empty by design — see this module's header doc. Add a rule here only
 * once a specific task's literal acceptance condition can be proven by a
 * schema query tied to that exact task, not a related capability.
 */
export const RECONCILIATION_RULES: ReconciliationRule[] = []

const DEFAULT_NO_CHANGE_RESULT: ReconciliationRuleResult = {
  recommendedStatus: null,
  evidenceCategory: 'NO_CHANGE_EVIDENCE',
  confidence: 'HIGH',
  evidenceSources: [],
  reason: 'No reconciliation rule is registered for this task — default is to preserve current state.',
}

function findRule(task: TaskSummary): ReconciliationRule | undefined {
  if (!task.sourceRef) return undefined
  return RECONCILIATION_RULES.find((r) => r.sourceRef === task.sourceRef)
}

/**
 * Assesses ONE task. Pure with respect to the task/rule inputs — the only
 * I/O is whatever the matched rule's own `assess()` performs via the
 * injected reader (read-only). Never writes anything.
 */
export async function assessTask(task: TaskSummary, reader: ReconciliationReader): Promise<ReconciliationFinding> {
  if (task.status === 'DONE' || task.status === 'CANCELED') {
    return {
      taskId: task.id,
      currentStatus: task.status,
      recommendedStatus: null,
      evidenceCategory: 'NO_CHANGE_EVIDENCE',
      confidence: 'HIGH',
      evidenceSources: [],
      reason: 'Task is already in a terminal state — nothing to reconcile.',
      autoApplicable: false,
    }
  }

  const rule = findRule(task)
  const result = rule ? await rule.assess(task, reader) : DEFAULT_NO_CHANGE_RESULT

  // Computed centrally, never trusted from the rule itself — see
  // reconciliationTypes.ts's doc on ReconciliationFinding.autoApplicable
  // for why. All four conditions from the Phase 1C spec collapse to these
  // three checks: "deterministic/structured evidence" is automatically
  // true for anything reaching this line, because a rule IS a
  // deterministic function (no LLM call exists anywhere in this module).
  const autoApplicable =
    result.evidenceCategory === 'COMPLETION_PROOF' &&
    result.recommendedStatus !== null &&
    rule !== undefined &&
    (ALLOWED_TRANSITIONS[task.status]?.includes(result.recommendedStatus) ?? false)

  return {
    taskId: task.id,
    currentStatus: task.status,
    recommendedStatus: result.recommendedStatus,
    evidenceCategory: result.evidenceCategory,
    confidence: result.confidence,
    evidenceSources: result.evidenceSources,
    reason: result.reason,
    autoApplicable,
  }
}

export async function assessTasks(tasks: TaskSummary[], reader: ReconciliationReader): Promise<ReconciliationFinding[]> {
  return Promise.all(tasks.map((t) => assessTask(t, reader)))
}
