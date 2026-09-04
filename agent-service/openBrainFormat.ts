// Phase 0F — deterministic Open Brain content formatting. No LLM, no
// free-form generation: every field is template-built from the decision's
// own already-stored data. Pure function, fully unit-testable without a
// database or any Open Brain access.

import { decisionSourceIdentity, type DecisionOpenBrainContent, type DecisionOpenBrainProvenance } from './openBrainTypes'
import { humanReadableDecisionTitle } from './openBrainTitles'

/**
 * Deliberately NOT Phase 0C's shared DecisionSummary type — that type has
 * no open_brain_* fields (Phase 0F introduces open_brain_eligible via
 * supabase/migrations/20260901_agent_decisions_open_brain_sync.sql, which
 * is applied) and this module has no reason to depend on the broader read
 * API's contract just to format a decision's content. This is exactly the
 * minimal shape formatting actually needs.
 */
export interface DecisionContentSource {
  id: string
  decisionKey: string
  decision: string
  decidedAt: Date
  project: { id: string; projectKey: string; name: string } | null
  decidedBy: { displayName: string } | null
  /**
   * Phase 1A. From metadata.rationale when present as a non-blank string —
   * callers are responsible for that extraction/validation (see
   * openBrainDecisions.ts's toContentSource), this module just renders
   * whatever it's given. Preserving the "why" is one of the main reasons a
   * decision is worth making durable, so this is included in the body
   * whenever available; omitted entirely (not even a blank line) when null,
   * so bodies formatted before this field existed remain byte-identical.
   */
  rationale?: string | null
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Title stays human-readable — never a bare UUID, and never the raw
 * decision_key either (a stable internal snake_case slug is fine as an
 * identifier, wrong to expose verbatim in memory a human reads later).
 * humanReadableDecisionTitle() (see openBrainTitles.ts) is the sole
 * deterministic source for this: an explicit, authored override where one
 * exists, otherwise a humanized ("snake_case" -> "Title Case") version of
 * decision_key. decision_key/id/sourceIdentity remain untouched elsewhere
 * in provenance — only the human-facing title changes.
 */
function buildTitle(decision: DecisionContentSource): string {
  return `CheckOff decision: ${humanReadableDecisionTitle(decision.decisionKey)}`
}

/**
 * Body preserves the actual decision content verbatim, plus decision
 * metadata (date/decider), plus a compact, machine-readable Chief ->
 * Durable Memory provenance block — required because capture_thought has
 * no metadata field to carry this separately (see openBrainTypes.ts's
 * module doc). The provenance block's exact field order/labels
 * ("Source system" / "Memory type" / "Source identity" / "Project") are
 * deliberately general across future Chief memory-producing domains, not
 * CheckOff-decision-specific — decisions are just the first domain to use
 * this shape. The source identity line is what later best-effort
 * corroboration searches for.
 */
function buildBody(decision: DecisionContentSource, provenance: DecisionOpenBrainProvenance): string {
  const lines: string[] = []
  lines.push(decision.decision)
  if (decision.rationale) {
    lines.push('')
    lines.push(`Rationale: ${decision.rationale}`)
  }
  lines.push('')
  lines.push(`Decided: ${formatDate(provenance.decidedAt)}`)
  if (decision.decidedBy) {
    lines.push(`Decided by: ${decision.decidedBy.displayName}`)
  }
  lines.push('')
  lines.push(`Source system: ${provenance.sourceSystem}`)
  lines.push(`Memory type: ${provenance.memoryType}`)
  lines.push(`Source identity: ${provenance.sourceIdentity}`)
  if (provenance.projectKey) {
    lines.push(`Project: ${provenance.projectKey}`)
  }
  return lines.join('\n')
}

export function formatDecisionForOpenBrain(decision: DecisionContentSource): DecisionOpenBrainContent {
  const provenance: DecisionOpenBrainProvenance = {
    decisionId: decision.id,
    decisionKey: decision.decisionKey,
    projectId: decision.project?.id ?? null,
    projectKey: decision.project?.projectKey ?? null,
    decidedAt: decision.decidedAt,
    sourceSystem: 'CheckOff Chief',
    memoryType: 'decision',
    sourceIdentity: decisionSourceIdentity(decision.id),
  }

  return {
    title: buildTitle(decision),
    body: buildBody(decision, provenance),
    provenance,
  }
}
