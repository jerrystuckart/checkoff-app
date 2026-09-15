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
// Deterministic identity — Session 3 PREREQUISITE 1 hardening.
//
// Session 2's original computeM9ConceptId(seedTags) hashed ONLY the seed
// tags. Within one discoverListConcepts() pass that's collision-free (a
// given tag combination forms at most one cluster — discoverClusterSeeds's
// own seenMemberKeys/pair-generation logic guarantees that), but the
// IDENTITY itself was under-specified: it carried no metro scope and no
// list-kind scope, so if this identity were ever compared, stored, or
// looked up OUTSIDE this one run's own state (a shared/cross-run decision
// store, a future centralized approval index — not how this codebase
// works today, but exactly the failure mode a "durable identity" must be
// safe against even if the CURRENT caller happens to avoid it by
// accident) two UNRELATED concepts that happen to share a seed tag
// combination (e.g. a generic tag like "coffee" recurring in two
// different metros, or the same tags meaning something different under a
// different discovery config) would collide under the SAME identity.
//
// Fixed by making conceptId a genuine durable identity — metro scope +
// list kind + normalized seed-tag key — and moving everything that is
// legitimately mutable (current membership, the evidence text describing
// it, the discovery config that shaped it) into conceptFingerprint
// instead, exactly mirroring the task's own instruction: "ordinary
// membership changes should update the fingerprint, not create an
// unrelated concept identity."
// ---------------------------------------------------------------------------

function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function normalizeIdentityToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface M9ConceptIdentityInput {
  /** The metro this concept was discovered within — REQUIRED, never optional, so conceptId can never be computed without metro scope (the whole point of this hardening: a concept from one metro can never collide with a concept from another, even if a future caller compares identities across runs). Use the same real, established slug convention as deps.metroAreaSlug (metroLaunchDriver.ts) — never the CLI/task-tracking projectId alone if a distinct real slug exists. */
  metroSlug: string
  /** The ListMembershipKind (listFitScoring.ts) this concept is evaluated as — part of durable identity because the SAME seed tags evaluated under a DIFFERENT kind (e.g. a future re-classification) are a materially different proposal with a different evidence bar, not "the same concept with new membership." */
  listKind: string
  seedTags: readonly string[]
}

/**
 * A concept's durable IDENTITY — stable across reruns as long as its
 * metro, list kind, and normalized seed-tag set are unchanged, regardless
 * of which specific items currently cluster under it (that's
 * `computeM9ConceptFingerprint`'s job) and regardless of title
 * punctuation/capitalization (title is never an input here at all —
 * `proposedTitle`, draftTitleFromTags' output in listConceptDiscovery.ts,
 * plays no role in identity, deliberately, per the task's own "do not use
 * display title alone" instruction — in this design it is not used AT
 * ALL, not even partially, which is stricter than the instruction
 * requires and avoids any title-normalization edge case entirely).
 */
export function computeM9ConceptId(input: M9ConceptIdentityInput): string {
  const normalizedTags = [...input.seedTags].map(normalizeIdentityToken).sort()
  return stableHash(['m9-concept-id', 'v2', normalizeIdentityToken(input.metroSlug), normalizeIdentityToken(input.listKind), normalizedTags.join('+')].join('|'))
}

export interface M9ConceptFingerprintMember {
  candidateName: string
  dbCategory: string
  finalTags: readonly string[]
  neighborhoodName: string
}

export interface M9ConceptFingerprintInput {
  conceptId: string
  /** Current proposed membership, WITH enough per-item detail that a metadata-only change (e.g. an item's dbCategory or tags changing without its candidateName changing) also invalidates a stale approval — bare candidateNames alone would miss that class of material change. */
  members: readonly M9ConceptFingerprintMember[]
  /**
   * The concept's own generated evidence text (listConceptDiscovery.ts's
   * ListConceptCandidate.editorialPromise) — deliberately fingerprint
   * content, not identity: it is entirely DERIVED from the seed tags and
   * current member composition (draftTitleFromTags-adjacent templating,
   * never independently authored in this codebase today), so a real
   * change to it only ever happens alongside a real change to the
   * evidence/composition it describes — exactly the kind of "material
   * configuration that would change the meaning of an approval" the task
   * asks fingerprint (not identity) to capture. Included here so the
   * task's own required test ("material change to the editorial promise
   * changes concept identity or explicitly invalidates approval") is
   * satisfied via invalidation, the more conservative and more correct of
   * the two named options — see this file's module doc.
   */
  editorialPromise: string
  /** Hash of the exact ListConceptDiscoveryConfig used to produce this concept (computeM9DiscoveryConfigFingerprint) — a caller-side config change (different minViableItems/minStrongFitRatio/etc) changes what a CREATE verdict even means, so it must invalidate a prior approval too. */
  discoveryConfigFingerprint: string
}

/**
 * A concept's CONTENT fingerprint — changes whenever its actual member
 * set, per-member metadata, generated evidence text, or discovery
 * configuration changes, even though its identity (conceptId) stays the
 * same. An operator decision recorded against one fingerprint is stale,
 * and must be treated as unresolved again, once the concept's real
 * fingerprint no longer matches (see runM9EnforcedCuration's own
 * stale-approval check).
 */
export function computeM9ConceptFingerprint(input: M9ConceptFingerprintInput): string {
  const memberSignature = [...input.members]
    .map((m) => `${m.candidateName}::${m.dbCategory}::${[...m.finalTags].sort().join(',')}::${m.neighborhoodName}`)
    .sort()
    .join('|')
  return stableHash(['m9-concept-fingerprint', 'v2', input.conceptId, memberSignature, normalizeIdentityToken(input.editorialPromise), input.discoveryConfigFingerprint].join('|'))
}

/** Hashes exactly the ListConceptDiscoveryConfig fields that change what a discovery verdict MEANS — a config change (e.g. a looser minViableItems) invalidates every prior approval computed under the old config, since "CREATE" no longer means the same thing. */
export function computeM9DiscoveryConfigFingerprint(config: { minViableItems: number; minStrongFitRatio: number; overlapRequiresJerryThreshold: number; maxTagPrevalenceToSeed: number; excludedTags: ReadonlySet<string> }): string {
  return stableHash(['m9-discovery-config', 'v1', config.minViableItems, config.minStrongFitRatio, config.overlapRequiresJerryThreshold, config.maxTagPrevalenceToSeed, [...config.excludedTags].sort().join(',')].join('|'))
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
  /** operatorReviewBoundaries.ts's own `tiesIntoExistingMechanism` for `action` — the existing driver-level mechanism (NEEDS_JERRY/escalate, reopen-stage, etc) this decision routes through, when one is already established. Always sourced from evaluateOperatorReviewBoundary(action), never invented here (Phase 4's "wire the existing operator-boundary module into the real driver" requirement, made an explicit, checkable field rather than an implicit assumption). */
  tiesIntoExistingMechanism: string | null
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
  /** The listFitScoring.ts ListMembershipKind this concept was evaluated as — part of this concept's durable identity (see computeM9ConceptId's own doc) and what determines which list-kind-specific evidence gate PASS B applied. */
  listKind: string
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

/** Bumped to 2 in Session 3: conceptId/fingerprint computation changed materially (metro+kind-scoped identity, richer fingerprint inputs) — any artifact persisted under version 1 must be treated as needing fresh discovery, never compared directly against a version-2 artifact's ids/fingerprints. */
export const M9_ENFORCED_ARTIFACT_VERSION = 2

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
