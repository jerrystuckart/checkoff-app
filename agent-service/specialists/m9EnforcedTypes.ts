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
// Deterministic identity — Session 3 PREREQUISITE 1 hardening, extended
// after a live confirmed-collision report (same session, follow-up):
//
// "Same metro, same listKind, same normalized seedTags, different
// editorial promises, different proposed memberships" — under the
// original v2 scheme (metro + listKind + tags only), this DID collide:
// editorialPromise and membership were both excluded from identity on
// the theory that editorialPromise is purely tag-derived in THIS
// codebase's one real discovery path (discoverListConcepts), so "same
// tags" already implied "same promise" for every concept that path can
// actually produce. That theory is true for discoverListConcepts today,
// but conceptId is a durable identity contract, not a promise about one
// call site — a hand-constructed input, an alternate/future discovery
// source, or a caller composing two independently-proposed concepts
// under one tag combination must not be forced to collide just because
// this one function happens not to exercise that path yet. Fixed by
// promoting editorialPromise into identity (v3) — moved OUT of
// conceptFingerprint, where v2 previously (redundantly, given the old
// theory) also hashed it.
//
// Why this doesn't break "membership changes preserve conceptId": in
// EVERY real call this codebase makes, editorialPromise
// (listConceptDiscovery.ts) is generated from seed.tags ALONE — never
// from member count or composition — so a pure membership change never
// touches it, and conceptId is unaffected. Only a GENUINE promise
// rewrite (a materially different proposal, whatever produced it) now
// changes identity — which is exactly the required behavior: "materially
// redefining the editorial promise either produces a new concept
// identity or explicitly routes through REPLACE_CONCEPT." This module
// chooses the "new identity" branch of that OR — a promise rewrite always
// gets a fresh conceptId, and if an operator wants that fresh concept to
// inherit an EXISTING production list's UUID (rather than needing a new
// list), that is m9CompletedListResolution.ts's own, already-built job
// (list resolution is keyed by the caller's real list lookup, never by
// conceptId) — REPLACE_CONCEPT is the operator's explicit signal for
// exactly that case, composing cleanly with this change rather than
// requiring new plumbing.
// ---------------------------------------------------------------------------

function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function normalizeIdentityToken(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * A durable, human-readable slug for a concept's tag-territory alone —
 * e.g. `beer_garden+brewery` — never the sole identity (see
 * computeM9ConceptId, which also scopes by metro/listKind/editorialPromise)
 * but exposed on M9EnforcedConceptVerdict.conceptKey so a human/log can
 * recognize "this is the beer-gardens-and-breweries territory" without
 * decoding a hash. Deliberately NOT snake_cased into a single token like
 * `beer_gardens_breweries_rituals` — this codebase's real seed tags are
 * already hyphenated, lowercase, and specific (e.g. 'beer-garden',
 * 'brewery'), and reformatting them into a fabricated combined slug would
 * invent editorial wording this module has no authority to author; the
 * `+`-joined, sorted, normalized tag list is the honest, real key.
 */
export function computeM9ConceptKey(seedTags: readonly string[]): string {
  return [...seedTags].map(normalizeIdentityToken).sort().join('+')
}

export interface M9ConceptIdentityInput {
  /** The metro this concept was discovered within — REQUIRED, never optional, so conceptId can never be computed without metro scope (the whole point of this hardening: a concept from one metro can never collide with a concept from another, even if a future caller compares identities across runs). Use the same real, established slug convention as deps.metroAreaSlug (metroLaunchDriver.ts) — never the CLI/task-tracking projectId alone if a distinct real slug exists. */
  metroSlug: string
  /** The ListMembershipKind (listFitScoring.ts) this concept is evaluated as — part of durable identity because the SAME seed tags evaluated under a DIFFERENT kind (e.g. a future re-classification) are a materially different proposal with a different evidence bar, not "the same concept with new membership." */
  listKind: string
  seedTags: readonly string[]
  /**
   * The concept's own generated evidence text (listConceptDiscovery.ts's
   * ListConceptCandidate.editorialPromise) — part of identity (v3, see
   * this file's module doc above for why). In every real discovery call
   * this codebase makes today it is a pure function of seedTags alone, so
   * for real concepts this field never actually distinguishes anything
   * seedTags didn't already — it exists so a genuinely different proposal
   * sharing the same tags is never forced to collide.
   */
  editorialPromise: string
}

/**
 * A concept's durable IDENTITY — stable across reruns as long as its
 * metro, list kind, normalized seed-tag set, AND editorial promise are
 * unchanged, regardless of which specific items currently cluster under
 * it (that's `computeM9ConceptFingerprint`'s job) and regardless of title
 * punctuation/capitalization (title is never an input here at all —
 * `proposedTitle`, draftTitleFromTags' output in listConceptDiscovery.ts,
 * plays no role in identity, deliberately, per the task's own "do not use
 * display title alone" instruction — in this design it is not used AT
 * ALL, not even partially, which is stricter than the instruction
 * requires and avoids any title-normalization edge case entirely).
 */
export function computeM9ConceptId(input: M9ConceptIdentityInput): string {
  const conceptKey = computeM9ConceptKey(input.seedTags)
  return stableHash(['m9-concept-id', 'v3', normalizeIdentityToken(input.metroSlug), normalizeIdentityToken(input.listKind), conceptKey, normalizeIdentityToken(input.editorialPromise)].join('|'))
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
  /** Hash of the exact ListConceptDiscoveryConfig used to produce this concept (computeM9DiscoveryConfigFingerprint) — a caller-side config change (different minViableItems/minStrongFitRatio/etc) changes what a CREATE verdict even means, so it must invalidate a prior approval too. */
  discoveryConfigFingerprint: string
}

/**
 * A concept's CONTENT fingerprint — changes whenever its actual member
 * set, per-member metadata, or discovery configuration changes, even
 * though its identity (conceptId) stays the same. editorialPromise is
 * deliberately NOT hashed here anymore (v3) — it moved into conceptId
 * itself (see this file's module doc), so a promise change now produces
 * a genuinely new conceptId rather than merely a new fingerprint under
 * the old one. An operator decision recorded against one fingerprint is
 * stale, and must be treated as unresolved again, once the concept's
 * real fingerprint no longer matches (see runM9EnforcedCuration's own
 * stale-approval check).
 */
export function computeM9ConceptFingerprint(input: M9ConceptFingerprintInput): string {
  const memberSignature = [...input.members]
    .map((m) => `${m.candidateName}::${m.dbCategory}::${[...m.finalTags].sort().join(',')}::${m.neighborhoodName}`)
    .sort()
    .join('|')
  return stableHash(['m9-concept-fingerprint', 'v3', input.conceptId, memberSignature, input.discoveryConfigFingerprint].join('|'))
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
// Session 4 (follow-up correction) — deterministic list identity. A genuinely
// NEW public.lists row created from an approved concept must be identified
// by something durable, never by its display title (title is mutable
// presentation text an operator can rename at will, and two unrelated
// concepts can legitimately propose the same title — see
// m9SafeSqlIntegration.ts's own module doc for the full incident this
// corrects: the first cut of new-list creation used a `(metro_id, title)`
// natural-key lookup as its idempotency/identity mechanism, which a title
// rename would have silently duplicated).
//
// Deliberately keyed by conceptId ALONE, never conceptFingerprint — a
// concept's fingerprint changes on every membership/metadata drift
// (computeM9ConceptFingerprint's own doc), so deriving the list id from it
// would mint a NEW list identity on every ordinary membership change, which
// is exactly backwards: "membership changes must retain the UUID."
// conceptId already carries real, durable scope (metro + listKind +
// normalized seedTags + editorialPromise — see computeM9ConceptId's own
// doc) and is stable across membership/metadata/title changes by
// construction, so it is the correct and only correct input here.
// ---------------------------------------------------------------------------

/**
 * A fixed, arbitrary application namespace UUID for RFC 4122 UUIDv5
 * derivation — never reused for any other deterministic-UUID purpose in
 * this codebase, and never changed once real production list ids have been
 * derived from it (changing it would silently re-identity every existing
 * ENFORCED-created list). Versioned explicitly via the "v1" component
 * hashed into the NAME below, not via this namespace constant itself — a
 * genuine future v2 algorithm gets a new name prefix, not a new namespace,
 * so this constant's own stability is the one thing that must never change.
 */
const M9_LIST_ID_NAMESPACE_V1 = 'b9c1c9a0-6b1e-4b7a-9c1a-2f7e6a1d4b21'

/**
 * RFC 4122 UUIDv5 (namespace + SHA-1), implemented directly (Node has no
 * built-in uuidv5) — deterministic and portable: the same
 * (namespace, name) pair always produces the same UUID, on any machine,
 * forever, which is the exact property a stable list identity needs.
 */
function uuidv5(name: string, namespaceUuid: string): string {
  const namespaceBytes = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex')
  const nameBytes = Buffer.from(name, 'utf8')
  const hash = createHash('sha1').update(Buffer.concat([namespaceBytes, nameBytes])).digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The deterministic identity a genuinely NEW public.lists row created from
 * an approved M9 concept must use — versioned explicitly ("v1" hashed into
 * the UUIDv5 name, alongside M9_LIST_ID_NAMESPACE_V1). Pure function of
 * conceptId alone:
 *   - the SAME conceptId always resolves to the SAME list UUID (idempotent
 *     creation, safe to call on every rerun).
 *   - a title change never changes this (title plays no role in the input
 *     at all — the concept's PROPOSED TITLE is not even a parameter here).
 *   - a membership/metadata change never changes this (conceptFingerprint,
 *     which DOES change on those, is deliberately NOT an input — see this
 *     section's own module doc above).
 *   - two DIFFERENT conceptIds — even proposing the identical title —
 *     receive different UUIDs, because conceptId (not title) is the only
 *     input.
 */
export function computeM9ListId(conceptId: string): string {
  return uuidv5(`m9-list-id:v1:${conceptId}`, M9_LIST_ID_NAMESPACE_V1)
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
// ---------------------------------------------------------------------------
// Session 3 PREREQUISITE 2 — the structured operator resolution contract.
//
// Session 2's contract had a real loophole: ANY non-empty decisionText
// (e.g. "looks fine to me") could resolve ANY outstanding decision,
// including an EVIDENCE_REQUIRED/RESEARCH_REQUIRED one — decisionText
// being mandatory prevented a bare BOOLEAN force-approval, but never
// verified the TEXT actually addressed the real issue. This section
// replaces that with a typed resolution action plus, for evidence-class
// resolutions, a real structured evidence record — see
// m9ListCurationAdapter.ts's validateM9OperatorResolution for the
// enforcement (APPROVE can never resolve EVIDENCE_REQUIRED/RESEARCH_REQUIRED;
// SUPPLY_EVIDENCE requires a complete M9StructuredEvidence whose
// issueResolved matches the actual outstanding reasonCode; ACCEPT_EXCEPTION
// is refused for any reasonCode not deliberately whitelisted).
// ---------------------------------------------------------------------------

export type M9OperatorResolutionAction = 'APPROVE' | 'REJECT' | 'SUPPLY_EVIDENCE' | 'REQUEST_RESEARCH' | 'ACCEPT_EXCEPTION' | 'REPLACE_CONCEPT' | 'REOPEN'

export type M9EvidenceConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

/** Real, structured evidence — never a substitute for arbitrary prose in decisionText, and never accepted as a resolution unless `issueResolved` matches the concept's actual outstanding M9RequiredDecision.reasonCode (an unrelated URL or fact, however real, does not resolve a DIFFERENT issue). */
export interface M9StructuredEvidence {
  /** A real citation — a URL, a document id, a specific field/record reference. Never a placeholder. */
  sourceOrEvidenceId: string
  evidenceSummary: string
  /** ISO date the evidence was actually verified/checked — not merely when it was written. */
  dateVerified: string
  confidence: M9EvidenceConfidence
  affectedConceptId: string
  affectedItemId?: string
  /** Must equal the M9RequiredDecision.reasonCode this evidence claims to resolve. */
  issueResolved: string
}

export interface M9OperatorDecisionRecord {
  conceptId: string
  /** The concept CONTENT fingerprint this decision was made against — a later run whose concept fingerprint no longer matches this treats the decision as stale (see computeM9ConceptFingerprint's own doc). */
  decidedForFingerprint: string
  action: OperatorReviewAction
  /** HOW this was resolved — see M9OperatorResolutionAction's own doc. REJECT always maps to `decision: 'REJECTED'`; every other resolving action maps to `decision: 'APPROVED'` (REQUEST_RESEARCH never resolves anything and can never reach this record type — see the adapter's own validation). */
  resolutionAction: M9OperatorResolutionAction
  decision: 'APPROVED' | 'REJECTED'
  decisionText: string
  /** Present only for a SUPPLY_EVIDENCE resolution — validated complete and on-issue before this record is ever constructed. */
  evidence?: M9StructuredEvidence
  decidedBy: string
  decidedAt: string
}

/** The caller-supplied input for ONE decision this invocation — validated (against the real outstanding requirement for `conceptId`, not just structurally) and, if valid, turned into an M9OperatorDecisionRecord and persisted. */
export interface M9OperatorDecisionInput {
  conceptId: string
  action: OperatorReviewAction
  resolutionAction: M9OperatorResolutionAction
  /** Mandatory, non-empty on every resolution regardless of resolutionAction — an attributable human explanation is always required, even alongside structured evidence. Never sufficient BY ITSELF to resolve an EVIDENCE_REQUIRED/RESEARCH_REQUIRED decision — see `evidence`. */
  decisionText: string
  /** Required (and validated complete + on-issue) when resolutionAction === 'SUPPLY_EVIDENCE'; ignored for every other resolutionAction. */
  evidence?: M9StructuredEvidence
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
  /** The human-readable, tag-only territory key (computeM9ConceptKey) — NOT the full identity (conceptId also scopes by metro/listKind/editorialPromise) but useful for a human/log to recognize "this is the same tag-territory" at a glance. */
  conceptKey: string
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

/** Bumped to 3 in Session 3 (follow-up): conceptId now also scopes by editorialPromise (previously fingerprint-only) — any artifact persisted under an earlier version must be treated as needing fresh discovery, never compared directly against a version-3 artifact's ids/fingerprints. */
export const M9_ENFORCED_ARTIFACT_VERSION = 3

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
