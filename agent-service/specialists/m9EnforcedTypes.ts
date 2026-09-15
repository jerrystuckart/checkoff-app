// agent-service/specialists/m9EnforcedTypes.ts
//
// M9 wiring, Session 2 (2026-09-14) — PHASE 1: the ENFORCED result contract
// and authoritative curation artifact types. Pure types + deterministic
// fingerprint helpers only; no curation logic lives here (that's
// m9ListCurationAdapter.ts's runM9EnforcedCuration, Phase 2) and no driver
// wiring (metroLaunchDriver.ts, Phase 3).
//
// Continues Session 1 (see docs/metro-launch-audit/munich/calibration-analysis/
// 16-m9-wiring-handoff.md and 17-m9-shadow-wiring.md). SHADOW's own
// M9ShadowComparisonArtifact (m9ListCurationAdapter.ts) stays untouched —
// ENFORCED is a genuinely separate, stricter contract: SHADOW's artifact
// is diagnostic-only and may never block anything; ENFORCED's result IS
// the thing that gates the run.
//
// Design rule this whole file exists to satisfy (the task's own CRITICAL
// DESIGN RULE): "the adapter may retain a no-throw API, but ENFORCED
// failures must become explicit typed blocking results." Every expected
// curation outcome (a concept needing review, a HOLD, invalid input) is a
// plain, comparable value of M9EnforcedResult — never an exception. Only a
// genuinely unexpected internal error becomes the 'ERROR' kind, and even
// that is a returned value, never a thrown one (see
// m9ListCurationAdapter.ts's runM9EnforcedCuration for the try/catch
// boundary that guarantees this).

import { createHash } from 'node:crypto'
import type { OperatorReviewAction } from '../playbooks/operatorReviewBoundaries'
import type { ListConceptVerdict } from '../playbooks/listConceptDiscovery'
import type { ItemListMembershipVerdict } from '../playbooks/listFitScoring'

// ---------------------------------------------------------------------------
// Deterministic identity — "use deterministic concept identities or
// fingerprints so operator decisions remain attached to the same proposal
// across reruns... do not rely on list title text alone as identity."
// ---------------------------------------------------------------------------

function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

/**
 * A concept's IDENTITY — stable across reruns as long as its seed tags are
 * unchanged, regardless of which specific items currently cluster under
 * it (that's `computeM9ConceptFingerprint`'s job). Deliberately NOT
 * derived from `proposedTitle` (draftTitleFromTags' output, listConceptDiscovery.ts)
 * even though today the title is itself tag-derived — title text is
 * display/editorial and this task explicitly forbids using it as identity.
 */
export function computeM9ConceptId(seedTags: readonly string[]): string {
  return stableHash(['m9-concept', ...[...seedTags].sort()].join('|'))
}

/**
 * A concept's CONTENT fingerprint — changes whenever its actual member set
 * changes, even though its identity (conceptId) stays the same. An
 * operator decision recorded against one fingerprint is stale, and must be
 * treated as unresolved again, once the concept's real fingerprint no
 * longer matches (see runM9EnforcedCuration's own stale-approval check).
 */
export function computeM9ConceptFingerprint(conceptId: string, candidateNames: readonly string[]): string {
  return stableHash([conceptId, ...[...candidateNames].sort()].join('|'))
}

/** The whole certified catalog's own fingerprint — persisted on the artifact so a caller can tell, without diffing every item, whether the input catalog changed materially since the artifact was last computed. */
export function computeM9CatalogFingerprint(items: readonly { candidateName: string; dbCategory: string; finalTags: readonly string[]; neighborhoodName: string }[]): string {
  return stableHash(
    items
      .map((i) => `${i.candidateName}::${i.dbCategory}::${[...i.finalTags].sort().join(',')}::${i.neighborhoodName}`)
      .sort()
      .join('|')
  )
}

// ---------------------------------------------------------------------------
// PHASE 1 — the discriminated ENFORCED result contract.
// ---------------------------------------------------------------------------

export type M9EnforcedResultKind = 'READY' | 'NEEDS_JERRY' | 'HOLD' | 'INVALID' | 'ERROR'

/** Mirrors Phase 4's exact five-way distinction — never a bare boolean. A generic force-approval flag can only ever satisfy APPROVAL_SUFFICIENT; every other value here requires substantive content (see M9OperatorDecisionInput.decisionText's own enforced non-empty rule in the adapter). */
export type M9ApprovalSufficiency = 'APPROVAL_SUFFICIENT' | 'EVIDENCE_REQUIRED' | 'RESEARCH_REQUIRED' | 'REJECTION_REQUIRED' | 'CONFIGURATION_REQUIRED'

/**
 * One concrete, outstanding thing a human must decide before the run can
 * proceed — the atomic unit both `requiredDecisions` (outstanding) and
 * `operatorDecisions` (resolved) key off of. `decisionId` is deterministic
 * (conceptId, optionally + itemId, + action) so the SAME outstanding
 * decision is recognizable across reruns.
 */
export interface M9RequiredDecision {
  decisionId: string
  action: OperatorReviewAction
  approvalSufficiency: M9ApprovalSufficiency
  reasonCode: string
  explanation: string
  affectedConceptIds: string[]
  affectedItemIds: string[]
  /** Concrete evidence/decision content still missing — null (never an empty array standing in for "nothing needed") when this decision is a pure yes/no approval call with nothing further to supply. */
  missingEvidence: string[] | null
  /** True when new evidence (not just an operator's say-so) is REQUIRED — mirrors approvalSufficiency but kept as its own explicit boolean per the task's own field list, since a caller checking "can I just approve this?" shouldn't have to know the full M9ApprovalSufficiency enum. */
  evidenceMandatory: boolean
}

/** Shared shape for every non-READY result kind — see the module doc's CRITICAL DESIGN RULE for why every one of these fields is mandatory rather than optional-by-kind. */
export interface M9EnforcedBlockingResult {
  kind: 'NEEDS_JERRY' | 'HOLD' | 'INVALID' | 'ERROR'
  reasonCode: string
  explanation: string
  affectedConceptIds: string[]
  affectedItemIds: string[]
  missingEvidence: string[]
  /** The stage a reopen should resume at — always 'M9_HOME_LIST_MIRROR' in this session's scope (every ENFORCED HOLD/NEEDS_JERRY reason this codebase can produce today is list-concept/list-membership-shaped, which holdRecovery.ts's own HOLD_REENTRY_STAGE table already maps to M9 — see m9ListCurationAdapter.ts's own doc for why no earlier stage is ever implicated). */
  earliestSafeResumePoint: 'M9_HOME_LIST_MIRROR'
  /** True only when a plain operator approval (no new evidence) can resolve every outstanding requiredDecision below — false the moment even one requires EVIDENCE_REQUIRED/RESEARCH_REQUIRED. */
  approvalSufficient: boolean
  evidenceMandatory: boolean
  requiredDecisions: M9RequiredDecision[]
}

export interface M9EnforcedReadyResult {
  kind: 'READY'
  /** Every concept whose approved membership is now authoritative. */
  approvedConceptIds: string[]
  /** Non-empty only when Session 1's SHADOW-style diagnostic comparison was also computed alongside (see runM9EnforcedCuration) — purely a labeled comparison artifact, never authoritative input (per the task's own "may use legacy output only as a labeled comparison artifact" rule). */
  comparedAgainstLegacyListTitles: string[]
}

export type M9EnforcedResult = M9EnforcedReadyResult | M9EnforcedBlockingResult

// ---------------------------------------------------------------------------
// PHASE 3 — the authoritative curation artifact (persisted to
// MetroDriverState.m9EnforcedCuration by the driver, Phase 3's own file).
// ---------------------------------------------------------------------------

export type M9ConceptApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'HOLD' | 'AUTO_EXCLUDED'

/** One recorded, attributable operator decision — "operator decisions are recorded, not merely converted into booleans" (Phase 6). `decisionText` is mandatory and non-empty by construction (see the adapter's own validation) — a bare force-approval flag with no substantive text can never become one of these records. */
export interface M9OperatorDecisionRecord {
  conceptId: string
  /** The concept CONTENT fingerprint this decision was made against — a later run whose concept fingerprint no longer matches this treats the decision as stale (see computeM9ConceptFingerprint's own doc). */
  decidedForFingerprint: string
  action: OperatorReviewAction
  decision: 'APPROVED' | 'REJECTED'
  decisionText: string
  newEvidence?: string
  decidedBy: string
  decidedAt: string
}

/** The caller-supplied input for ONE decision this invocation — validated and, if valid, turned into an M9OperatorDecisionRecord and persisted. */
export interface M9OperatorDecisionInput {
  conceptId: string
  action: OperatorReviewAction
  decision: 'APPROVED' | 'REJECTED'
  /** Mandatory, non-empty. A caller submitting only `{decision: 'APPROVED'}` with no real text is exactly the "generic force flag" the task's CRITICAL DESIGN RULE forbids — rejected outright by the adapter, regardless of which approvalSufficiency this decision's action actually needs (see runM9EnforcedCuration's own validation: requiring real text unconditionally is a stricter, simpler, and more conservative rule than trying to infer whether THIS particular action would have tolerated a bare boolean). */
  decisionText: string
  newEvidence?: string
  decidedBy: string
}

export interface M9DuplicateFinding {
  kind: 'DUPLICATE_VENUE'
  detail: string
  affectedItemIds: string[]
}

export interface M9OverlapFinding {
  withConceptId: string
  withTitle: string
  sharedItemCount: number
  sharedPercent: number
}

export interface M9ItemMembershipRecord {
  itemId: string
  verdict: ItemListMembershipVerdict
  fitScore: number
  fitReason: string
}

/** One discovered concept's full ENFORCED disposition — identity, evidence, decision, and (if approved) final membership. */
export interface M9EnforcedConceptVerdict {
  conceptId: string
  fingerprint: string
  proposedTitle: string
  seedTags: string[]
  /** PASS A's own raw verdict (listConceptDiscovery.ts) — CREATE/HOLD/REJECT/REQUIRES_JERRY. Never itself authoritative on its own; `approvalState` below is what ENFORCED actually acts on. */
  discoveryVerdict: ListConceptVerdict
  approvalState: M9ConceptApprovalState
  operatorDecision?: M9OperatorDecisionRecord
  /** Set only once approvalState is 'APPROVED' and PASS B has run — every item independently evaluated against this concept. */
  memberDecisions: M9ItemMembershipRecord[]
  /** Candidate names PASS A discovered for this concept but PASS B (or the duplicate check) excluded from final membership — reported, never silently dropped. */
  exclusionReasons: Array<{ itemId: string; reason: string }>
  overlapFindings: M9OverlapFinding[]
  duplicateFindings: M9DuplicateFinding[]
}

export const M9_ENFORCED_ARTIFACT_VERSION = 1

export interface M9EnforcedCurationArtifact {
  mode: 'ENFORCED'
  artifactVersion: number
  inputCatalogFingerprint: string
  createdAt: string
  updatedAt: string
  conceptVerdicts: M9EnforcedConceptVerdict[]
  /** Final authoritative membership — ONLY for concepts at approvalState 'APPROVED' with zero outstanding requiredDecisions. Never partially populated for a concept still under review (see the module doc's "do not overwrite ... with partially approved or invalid output" rule — this field mirrors that at the per-concept granularity too). */
  finalApprovedMemberships: Record<string, string[]>
  /** Every currently-outstanding decision, across every concept — empty exactly when `result.kind === 'READY'`. */
  requiredDecisions: M9RequiredDecision[]
  validation: { ok: boolean; errors: string[] }
  result: M9EnforcedResult
}
