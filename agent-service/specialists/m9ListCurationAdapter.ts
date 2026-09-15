// agent-service/specialists/m9ListCurationAdapter.ts
//
// M9 wiring, Session 1 (2026-09-14) — the adapter that lets
// metroLaunchDriver.ts's stepM9HomeListMirror run the new two-pass list
// curation system (listConceptDiscovery.ts PASS A + listFitScoring.ts's
// evaluateItemForListMembership PASS B) ALONGSIDE the existing legacy
// buildHomeListPlan path, without ever making the new system authoritative.
// See docs/metro-launch-audit/munich/calibration-analysis/16-m9-wiring-handoff.md
// for the full trace of the current live M9 call path this sits next to.
//
// Deliberately kept OUTSIDE metroLaunchDriver.ts (a 4,200+ line file) —
// the driver only ever calls `runM9ShadowCuration` and stores its result;
// it never embeds any of PASS A/B's own logic.
//
// SESSION 1 SCOPE — SHADOW ONLY:
//   - This module never produces SQL and is never consulted by
//     buildHomeListSqlPatch or M10. `state.homeListPlan`/
//     `state.homeListSqlPatch` remain exclusively the legacy path's own
//     output, regardless of which mode is active.
//   - A SHADOW run's own failure (a thrown error from either pass) is
//     captured as a `validationFailures` entry on the returned artifact —
//     it is NEVER allowed to raise, block, or otherwise influence the
//     caller's control flow. See runM9ShadowCuration's own try/catch.
//
// SESSION 2 (2026-09-14) adds ENFORCED mode — see runM9EnforcedCuration
// below and m9EnforcedTypes.ts for the full result/artifact contract. Its
// own CRITICAL DESIGN RULE: expected curation outcomes (a concept needing
// review, a HOLD, invalid input) are always a typed M9EnforcedResult value,
// never an exception — but unlike SHADOW's diagnostics-only artifact,
// ENFORCED's result genuinely gates the driver (see metroLaunchDriver.ts's
// stepM9HomeListMirror). SQL generation from the new plan is still
// explicitly out of scope — that is Session 3.

import { discoverListConcepts, DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG, type ListConceptCandidate, type ListConceptCandidateItem, type ListConceptDiscoveryConfig, type ListConceptVerdict } from '../playbooks/listConceptDiscovery'
import { evaluateItemForListMembership, detectPortfolioRepetition, type ItemListFitDecision, type ItemListMembershipVerdict, type ListFitCandidate, type ListMembershipListContext, type ListMembershipKind, type PortfolioReviewItem } from '../playbooks/listFitScoring'
import { evaluateOperatorReviewBoundary, type OperatorReviewAction } from '../playbooks/operatorReviewBoundaries'
import { reopenHoldCandidate, verifyReopenStageCompleteness, verifyHoldNotBypassed, type HoldReasonKind, type HoldRecord } from '../playbooks/holdRecovery'
import type { RealDbCategory } from '../playbooks/metroCatalog'
import type { CommercialOwnershipType } from '../playbooks/categoryPolicy'
import {
  computeM9ConceptId,
  computeM9ConceptFingerprint,
  computeM9CatalogFingerprint,
  computeM9DiscoveryConfigFingerprint,
  M9_ENFORCED_ARTIFACT_VERSION,
  type M9ApprovalSufficiency,
  type M9EnforcedCurationArtifact,
  type M9EnforcedConceptVerdict,
  type M9EnforcedResult,
  type M9RequiredDecision,
  type M9OperatorDecisionInput,
  type M9OperatorDecisionRecord,
  type M9OperatorResolutionAction,
  type M9DuplicateFinding,
  type M9ItemMembershipRecord,
} from './m9EnforcedTypes'

// ---------------------------------------------------------------------------
// Session 3, PREREQUISITE 1 — list-kind classification, now a durable
// IDENTITY input (see m9EnforcedTypes.ts's own doc on why listKind is part
// of conceptId). Reuses listConceptDiscovery.ts's own already-computed
// ListConceptCandidate.type (never re-derives a second classification from
// scratch) plus a lightweight seed-tag check for Hidden-Gems-shaped
// clusters (inferConceptType, listConceptDiscovery.ts, has no Hidden-Gems
// branch at all today — it only distinguishes NIGHTLIFE/FOOD_AND_DRINK/
// ADVENTURE/CULTURAL/SEASONAL/EVERGREEN/OTHER). Exported so Phase 2's
// evidence-gated membership curation (this file, later in Session 3) and
// this file's own identity computation always agree on exactly one
// classification per concept — never two independent guesses that could
// disagree.
// ---------------------------------------------------------------------------

const HIDDEN_GEMS_SEED_TAG_PATTERN = /hidden|secret|gem|discovery|overlooked/i

/**
 * Maps a discovered concept onto listFitScoring.ts's existing
 * ListMembershipKind vocabulary — never invents a new kind. ADVENTURE maps
 * to DAY_TRIP (the closest real evidence-gated kind for a travel/adventure
 * cluster; ListMembershipKind has no generic "adventure" kind of its own).
 * CULTURAL/EVERGREEN/OTHER map to THEMED — this codebase has no
 * established stricter evidence contract for arts/culture today (the real
 * "Imperial & Grand Landmarks"/"Classical & Performing Arts" legacy
 * THEMED_LIST_DEFINITIONS entries are themselves ordinary THEMED lists),
 * so THEMED is the honest mapping, not a fabricated one.
 */
const HIDDEN_GEMS_SECRET_SHARE_THRESHOLD = 0.5

export function classifyM9ListKind(concept: { type: string; seedTags: readonly string[] }, members: readonly { isSecretClaimed?: boolean }[] = []): ListMembershipKind {
  if (concept.seedTags.some((t) => HIDDEN_GEMS_SEED_TAG_PATTERN.test(t))) return 'HIDDEN_GEMS'
  if (members.length > 0) {
    const secretShare = members.filter((m) => m.isSecretClaimed).length / members.length
    if (secretShare >= HIDDEN_GEMS_SECRET_SHARE_THRESHOLD) return 'HIDDEN_GEMS'
  }
  switch (concept.type) {
    case 'SEASONAL':
      return 'SEASONAL'
    case 'NIGHTLIFE':
      return 'AFTER_DARK'
    case 'FOOD_AND_DRINK':
      return 'FOOD_LOCAL_FLAVOR'
    case 'ADVENTURE':
      return 'DAY_TRIP'
    default:
      return 'THEMED'
  }
}

/**
 * The three-way mode this adapter (and, once wired, MetroDriverDeps) is
 * evaluated under. Session 1 only ever exercises LEGACY (the adapter is
 * simply never invoked) and SHADOW (invoked, additive, non-authoritative).
 * ENFORCED is named here only so the type is already shaped for the next
 * session's work — nothing in this module implements ENFORCED behavior,
 * and no caller in this codebase may set it yet.
 */
export type M9CurationMode = 'LEGACY' | 'SHADOW' | 'ENFORCED'

/** The subset of a certified M9 candidate the new two-pass system needs — deliberately independent of DriverItemCertificationRecord's full shape, so this module never depends on metroLaunchDriver.ts's internal types (avoids a circular import; the driver adapts its own state into this shape). */
export interface M9AdapterCertifiedItem {
  candidateName: string
  venueName: string
  dbCategory: RealDbCategory
  finalTags: readonly string[]
  finalBody: string
  neighborhoodName: string
  /** Mirrors listConceptDiscovery.ts's own duck-typed default — omit when the driver has no real evaluated ownership signal for this item (today: always omitted: the live driver never persists this per-item; see metroLaunchDriver.ts's own doc on candidate.ownershipType). */
  ownershipType?: CommercialOwnershipType
  /** Real, already-evaluated METADATA_COMPLETENESS_GATE is_secret value (metadataEnrichmentResults[].isSecret.value, metroLaunchDriver.ts) — used only by classifyM9ListKind's Hidden-Gems-shaped-cluster check, never as a substitute for a real discoveryBasis (a secret CLAIM alone does not clear categoryPolicy.ts's own evaluateSecretEvidence bar). Omit when unknown. */
  isSecretClaimed?: boolean
}

/** A minimal, adapter-owned summary of one legacy HomeListPlanEntry — just enough to diff against, without importing metroLaunchDriver.ts's own HomeListPlanEntry type (keeps this module genuinely standalone, per the handoff's "adapter outside metroLaunchDriver.ts" instruction). */
export interface M9AdapterLegacyListSummary {
  title: string
  kind: string
  itemCandidateNames: readonly string[]
}

export interface M9ConceptDifference {
  proposedTitle: string
  verdict: ListConceptVerdict
  candidateItemCount: number
  reasoning: string
  /** The legacy plan's own list title this concept's members overlap with most, when any legacy list shares at least one member — null when the two-pass system discovered a concept the legacy plan has no analogue for at all (the exact gap this whole task exists to surface — see listConceptDiscovery.ts's own doc on the real Munich "Beer Gardens"/"Day Trips" case). */
  matchedLegacyListTitle: string | null
  matchedLegacySharedCount: number
}

export interface M9MembershipDifference {
  /** The discovered concept's own proposedTitle (SHADOW never renames a legacy list — this is purely a reporting-side match). */
  conceptTitle: string
  matchedLegacyListTitle: string
  /** Certified candidate names the legacy list includes that the shadow membership curation pass would NOT (curation's own diff — a schema-shape only, no SQL implication in Session 1). */
  onlyInLegacy: string[]
  /** Certified candidate names the shadow membership curation pass would include that the legacy list does not. */
  onlyInShadow: string[]
  sharedCount: number
}

export interface M9HoldFinding {
  kind: 'CONCEPT_HOLD' | 'CONCEPT_REQUIRES_JERRY' | 'MEMBERSHIP_HOLD'
  subjectTitle: string
  itemCandidateName?: string
  reason: string
}

export interface M9ShadowComparisonArtifact {
  mode: 'SHADOW'
  computedAt: string
  /** Full PASS A output — every discovered concept candidate, regardless of verdict. */
  conceptDiscovery: ListConceptCandidate[]
  /** Full PASS B output for every CREATE-verdict concept, keyed by that concept's proposedTitle. */
  membershipDecisionsByConcept: Record<string, ItemListFitDecision[]>
  conceptDifferences: M9ConceptDifference[]
  membershipDifferences: M9MembershipDifference[]
  holdFindings: M9HoldFinding[]
  /** Non-empty only when PASS A or PASS B threw — the shadow run's own failure, captured rather than propagated. An empty array does not itself mean every concept/decision succeeded cleanly; it means nothing THREW. */
  validationFailures: string[]
}

export interface RunM9ShadowCurationInput {
  certifiedItems: readonly M9AdapterCertifiedItem[]
  legacyPlan: readonly M9AdapterLegacyListSummary[]
  conceptDiscoveryConfig?: ListConceptDiscoveryConfig
  now?: () => string
}

function toConceptItem(item: M9AdapterCertifiedItem): ListConceptCandidateItem {
  return {
    candidateName: item.candidateName,
    venueName: item.venueName,
    dbCategory: item.dbCategory,
    finalTags: item.finalTags,
    finalBody: item.finalBody,
    neighborhoodName: item.neighborhoodName,
    ownershipType: item.ownershipType,
  }
}

function toFitCandidate(item: M9AdapterCertifiedItem): ListFitCandidate {
  return { candidateName: item.candidateName, venueName: item.venueName, dbCategory: item.dbCategory, finalTags: item.finalTags, finalBody: item.finalBody }
}

/**
 * PASS B, run for one already-CREATE-verdict concept, against ONLY that
 * concept's own discovered members (Session 1 never widens membership
 * curation to the whole catalog — see listConceptDiscovery.ts's own doc:
 * PASS B "runs only on concepts/lists that already cleared PASS A").
 * Every list-kind-specific evidence input (discoveryBasis/nighttimeSpecific/
 * concreteLocalFlavorAction/travelEffort) is omitted: the live driver does
 * not yet persist any of that per-item evidence anywhere in
 * MetroDriverState, so this session evaluates every discovered concept as
 * generic 'THEMED' — never fabricating list-kind-specific evidence the
 * driver was never given. Refining per-kind classification is later,
 * ENFORCED-track work.
 */
function evaluateConceptMembership(concept: ListConceptCandidate, itemsByName: ReadonlyMap<string, M9AdapterCertifiedItem>): ItemListFitDecision[] {
  const list: ListMembershipListContext = {
    title: concept.proposedTitle,
    kind: 'THEMED',
    tags: concept.seedTags,
    proposedListIdentity: concept.proposedTitle,
    listId: null,
  }
  const decisions: ItemListFitDecision[] = []
  for (const candidateName of concept.candidateNames) {
    const item = itemsByName.get(candidateName)
    if (!item) continue // defensive only — every concept member came from the same certifiedItems pool passed to discoverListConcepts.
    decisions.push(evaluateItemForListMembership({ item: toFitCandidate(item), list }))
  }
  return decisions
}

/**
 * PASS B, ENFORCED-only variant (Session 3, Phase 2) — same base
 * mechanism as evaluateConceptMembership above, but evaluated against the
 * concept's REAL classifyM9ListKind() kind instead of a hardcoded
 * 'THEMED'. This is what actually closes the handoff's per-list-kind
 * evidence gap: evaluateItemForListMembership (listFitScoring.ts) already
 * HOLDs a HIDDEN_GEMS item with no discoveryBasis, HOLDs an AFTER_DARK
 * item with no nighttimeSpecific judgment, HOLDs a FOOD_LOCAL_FLAVOR item
 * with no concreteLocalFlavorAction, and EXCLUDEs a DAY_TRIP item with no
 * travelEffort — this function supplies every one of those per-kind
 * evidence inputs as `undefined`/`null` because the live driver does not
 * yet persist ANY of that real, evaluated per-item evidence anywhere in
 * MetroDriverState (no discoveryBasis, no nighttimeSpecific judgment, no
 * concreteLocalFlavorAction, no travelEffort field exists today). This is
 * the honest, correct behavior the task requires ("missing required
 * list-kind evidence must HOLD or exclude the membership... it cannot
 * silently pass") — NOT a workaround to avoid writing the check: a
 * concept classified into one of these four stricter kinds will
 * correctly produce zero INCLUDE members until a real per-item evidence
 * pipeline exists upstream of M9. SEASONAL/THEMED/OTHER-mapped concepts
 * (the switch's own default branch, listFitScoring.ts) have no
 * additional per-kind gate beyond base category/tag/pattern fit — exactly
 * as today's legacy THEMED_LIST_DEFINITIONS lists already work, so
 * "seasonal flagship prioritizes strength and variety" is satisfied by
 * the SAME independent fit-scoring every other concept already goes
 * through, not a fabricated extra rule.
 *
 * SHADOW's own evaluateConceptMembership (above) is deliberately left
 * untouched — SHADOW's diagnostic output must not change behavior
 * mid-session (Session 2's own "LEGACY and SHADOW must retain their
 * current M10 behavior" rule).
 */
function evaluateConceptMembershipForKind(concept: ListConceptCandidate, itemsByName: ReadonlyMap<string, M9AdapterCertifiedItem>, listKind: ListMembershipKind): ItemListFitDecision[] {
  const list: ListMembershipListContext = {
    title: concept.proposedTitle,
    kind: listKind,
    tags: concept.seedTags,
    proposedListIdentity: concept.proposedTitle,
    listId: null,
  }
  const decisions: ItemListFitDecision[] = []
  for (const candidateName of concept.candidateNames) {
    const item = itemsByName.get(candidateName)
    if (!item) continue // defensive only — every concept member came from the same certifiedItems pool passed to discoverListConcepts.
    decisions.push(
      evaluateItemForListMembership({
        item: toFitCandidate(item),
        list,
        // Every list-kind-specific evidence input below is real state this
        // session's driver has, or an honest `undefined`/`null` when it
        // doesn't — never fabricated. Only isSecret (metadataEnrichmentResults,
        // already threaded onto M9AdapterCertifiedItem.isSecretClaimed
        // below in this same commit) is real per-item evidence available
        // today, and it only ever feeds HIDDEN_GEMS classification
        // (classifyM9ListKind), not this per-item evaluation call — a
        // secret CLAIM alone is not itself a discoveryBasis (categoryPolicy.ts's
        // own evaluateSecretEvidence bar is stricter than a boolean flag),
        // so discoveryBasis stays honestly unset here too.
        discoveryBasis: undefined,
        nighttimeSpecific: undefined,
        concreteLocalFlavorAction: undefined,
        travelEffort: undefined,
      })
    )
  }
  return decisions
}

function findBestLegacyMatch(memberNames: readonly string[], legacyPlan: readonly M9AdapterLegacyListSummary[]): { list: M9AdapterLegacyListSummary; sharedCount: number } | null {
  const memberSet = new Set(memberNames)
  let best: { list: M9AdapterLegacyListSummary; sharedCount: number } | null = null
  for (const list of legacyPlan) {
    const sharedCount = list.itemCandidateNames.filter((n) => memberSet.has(n)).length
    if (sharedCount === 0) continue
    if (!best || sharedCount > best.sharedCount) best = { list, sharedCount }
  }
  return best
}

function emptyArtifact(now: () => string, validationFailures: string[]): M9ShadowComparisonArtifact {
  return {
    mode: 'SHADOW',
    computedAt: now(),
    conceptDiscovery: [],
    membershipDecisionsByConcept: {},
    conceptDifferences: [],
    membershipDifferences: [],
    holdFindings: [],
    validationFailures,
  }
}

/**
 * SHADOW entry point. Runs PASS A (discoverListConcepts) against the real
 * certified catalog handed in by the caller, then PASS B
 * (evaluateItemForListMembership) for every CREATE-verdict concept, and
 * builds a comparison artifact against the legacy plan supplied — never
 * mutating or reading anything beyond its own arguments, never touching
 * SQL generation. Failure-safe by construction: nothing this function does
 * can throw past its own boundary — a thrown error from either pass is
 * caught and recorded in the returned artifact's `validationFailures`
 * instead, so a caller invoking this in SHADOW mode can never have its own
 * control flow (HOLD/NEEDS_JERRY/M9->M10 transition) altered by a SHADOW
 * failure.
 */
export function runM9ShadowCuration(input: RunM9ShadowCurationInput): M9ShadowComparisonArtifact {
  const now = input.now ?? (() => new Date().toISOString())

  let conceptDiscovery: ListConceptCandidate[]
  try {
    const conceptItems = input.certifiedItems.map(toConceptItem)
    // CURATED_MIRROR is, by design, a full mirror of the entire certified
    // catalog (see metroLaunchDriver.ts's HomeListPlanEntry.kind doc) — every
    // discovered concept's members are trivially 100% "already in" it, which
    // would make discoverListConcepts's overlap check REQUIRES_JERRY every
    // single concept for a reason that carries no real editorial signal.
    // Excluded from the overlap check only; still eligible for the
    // best-legacy-match reporting below (a concept fully mirrored is still
    // worth reporting on).
    const alreadyAccepted = input.legacyPlan.filter((p) => p.kind !== 'CURATED_MIRROR').map((p) => ({ title: p.title, candidateNames: p.itemCandidateNames }))
    conceptDiscovery = discoverListConcepts(conceptItems, input.conceptDiscoveryConfig ?? DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG, alreadyAccepted)
  } catch (err) {
    return emptyArtifact(now, [`PASS A (discoverListConcepts) threw: ${err instanceof Error ? err.message : String(err)}`])
  }

  const itemsByName = new Map(input.certifiedItems.map((i) => [i.candidateName, i]))
  const membershipDecisionsByConcept: Record<string, ItemListFitDecision[]> = {}
  const validationFailures: string[] = []

  for (const concept of conceptDiscovery) {
    if (concept.verdict !== 'CREATE') continue
    try {
      membershipDecisionsByConcept[concept.proposedTitle] = evaluateConceptMembership(concept, itemsByName)
    } catch (err) {
      validationFailures.push(`PASS B (evaluateItemForListMembership) threw for concept "${concept.proposedTitle}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Same exclusion as the PASS A overlap check above, for the same reason:
  // CURATED_MIRROR trivially "matches" every concept's full membership, which
  // would make every conceptDifference/membershipDifference report against
  // it instead of against a real editorial list (or, correctly, no match at
  // all) — never a useful signal.
  const legacyPlanForMatching = input.legacyPlan.filter((p) => p.kind !== 'CURATED_MIRROR')

  const conceptDifferences: M9ConceptDifference[] = conceptDiscovery.map((concept) => {
    const match = findBestLegacyMatch(concept.candidateNames, legacyPlanForMatching)
    return {
      proposedTitle: concept.proposedTitle,
      verdict: concept.verdict,
      candidateItemCount: concept.candidateItemCount,
      reasoning: concept.reasoning,
      matchedLegacyListTitle: match?.list.title ?? null,
      matchedLegacySharedCount: match?.sharedCount ?? 0,
    }
  })

  const membershipDifferences: M9MembershipDifference[] = []
  for (const concept of conceptDiscovery) {
    if (concept.verdict !== 'CREATE') continue
    const decisions = membershipDecisionsByConcept[concept.proposedTitle]
    if (!decisions) continue // this concept's PASS B threw — already recorded in validationFailures, never silently diffed against nothing.
    const match = findBestLegacyMatch(concept.candidateNames, legacyPlanForMatching)
    if (!match) continue // no corresponding legacy list at all — already fully captured as a conceptDifference with matchedLegacyListTitle: null.
    const shadowIncluded = new Set(decisions.filter((d) => d.verdict === 'INCLUDE').map((d) => d.itemId))
    const legacyIncluded = new Set(match.list.itemCandidateNames)
    membershipDifferences.push({
      conceptTitle: concept.proposedTitle,
      matchedLegacyListTitle: match.list.title,
      onlyInLegacy: [...legacyIncluded].filter((n) => !shadowIncluded.has(n)),
      onlyInShadow: [...shadowIncluded].filter((n) => !legacyIncluded.has(n)),
      sharedCount: [...legacyIncluded].filter((n) => shadowIncluded.has(n)).length,
    })
  }

  const holdFindings: M9HoldFinding[] = []
  for (const concept of conceptDiscovery) {
    if (concept.verdict === 'HOLD') {
      holdFindings.push({ kind: 'CONCEPT_HOLD', subjectTitle: concept.proposedTitle, reason: concept.reasoning })
    } else if (concept.verdict === 'REQUIRES_JERRY') {
      holdFindings.push({ kind: 'CONCEPT_REQUIRES_JERRY', subjectTitle: concept.proposedTitle, reason: concept.reasoning })
    }
  }
  for (const [conceptTitle, decisions] of Object.entries(membershipDecisionsByConcept)) {
    for (const decision of decisions) {
      if (decision.verdict !== 'HOLD') continue
      holdFindings.push({ kind: 'MEMBERSHIP_HOLD', subjectTitle: conceptTitle, itemCandidateName: decision.itemId, reason: decision.fitReason })
    }
  }

  return {
    mode: 'SHADOW',
    computedAt: now(),
    conceptDiscovery,
    membershipDecisionsByConcept,
    conceptDifferences,
    membershipDifferences,
    holdFindings,
    validationFailures,
  }
}

export type { ItemListFitDecision, ItemListMembershipVerdict, ListConceptCandidate, ListConceptVerdict }

// ---------------------------------------------------------------------------
// ENFORCED mode (Session 2, Phase 2).
// ---------------------------------------------------------------------------

export interface RunM9EnforcedCurationInput {
  /** REQUIRED — the real, established metro slug (mirrors deps.metroAreaSlug, metroLaunchDriver.ts). Part of every discovered concept's durable identity (computeM9ConceptId) so an operator decision can never be confused across metros, even in a hypothetical future shared decision store. Never optional and never defaulted from something else here — the caller must supply the real value, the same discipline deps.metroAreaSlug already uses. */
  metroSlug: string
  certifiedItems: readonly M9AdapterCertifiedItem[]
  /** Comparison only — see m9EnforcedTypes.ts's own doc and the task's "may use legacy output only as a labeled comparison artifact" rule. Never read as authoritative input to concept discovery or membership curation. */
  legacyPlan: readonly M9AdapterLegacyListSummary[]
  /** Every operator decision already durably recorded for THIS run, keyed by conceptId — the driver's own persisted state.m9OperatorDecisions, carried in unchanged (never mutated by this function; see acceptedDecisions in the output for what the caller should merge back in). */
  storedOperatorDecisions: Readonly<Record<string, M9OperatorDecisionRecord>>
  /** New decisions the caller is submitting THIS invocation (e.g. a real Jerry approval/rejection) — validated and, if valid, folded into this call's own evaluation (though NOT into storedOperatorDecisions, which this function treats as read-only; the caller persists acceptedDecisions itself). */
  newOperatorDecisionInputs?: readonly M9OperatorDecisionInput[]
  /**
   * Phase 6 — the previous ENFORCED artifact for this run, when one
   * exists (the driver's own state.m9EnforcedCuration going into this
   * call). Used ONLY for the anti-bypass self-check below
   * (verifyHoldNotBypassed, holdRecovery.ts): when a concept still has NO
   * valid decision this call (no new evidence/decision was supplied for
   * it), its re-evaluated verdict/memberDecisions must be IDENTICAL to
   * what this previous artifact already recorded for the same
   * conceptId+fingerprint — never itself consulted to derive the new
   * result. Omit on a first-ever pass (nothing to compare against).
   */
  previousArtifact?: M9EnforcedCurationArtifact
  conceptDiscoveryConfig?: ListConceptDiscoveryConfig
  now?: () => string
}

export interface RunM9EnforcedCurationOutput {
  artifact: M9EnforcedCurationArtifact
  /** Decisions actually accepted and applied this call — the caller persists these into its own durable store (state.m9OperatorDecisions), keyed by conceptId. */
  acceptedDecisions: M9OperatorDecisionRecord[]
  /** Decisions submitted this call but refused (empty decisionText, empty decidedBy, or naming a conceptId this run's discovery pass never produced) — never silently dropped. */
  rejectedDecisionInputs: Array<{ input: M9OperatorDecisionInput; reason: string }>
}

/** A stable, metro-scoped pseudo-identity for a LEGACY list, used only to label overlap-finding cross-references — never a real conceptId (a legacy list never went through concept discovery, so it has no seedTags/listKind of its own). */
function legacyListPseudoId(metroSlug: string, title: string): string {
  return computeM9ConceptId({ metroSlug, listKind: 'LEGACY_LIST', seedTags: [`legacy-list-title:${normalizeForPseudoId(title)}`] })
}

function normalizeForPseudoId(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Maps this adapter's own reasonCode to holdRecovery.ts's existing
 * HoldReasonKind vocabulary — reused, never re-invented. Both of this
 * adapter's evidence-mandatory reasons already correspond to a kind whose
 * HOLD_REENTRY_STAGE entry is 'M9_HOME_LIST_MIRROR' (never an earlier
 * stage) — see holdRecovery.ts's own table. UNRESOLVED_VENUE_DUPLICATE
 * reuses LIST_MEMBERSHIP_MISSING_KIND_SPECIFIC_EVIDENCE (the closest
 * existing kind for "a real, membership-level finding discovered during
 * M9 curation") rather than SEED_DUPLICATE_CLUSTER, which — correctly —
 * maps to the EARLIER M5_75_SEED_PORTFOLIO_AUDIT stage and would be wrong
 * here: our duplicate is discovered during list-membership curation, not
 * seed research, so reopening at M5.75 would rerun unrelated, already-
 * completed work.
 */
function toHoldReasonKind(reasonCode: string): HoldReasonKind | null {
  if (reasonCode === 'CONCEPT_WEAK_STRONG_FIT_RATIO') return 'LIST_CONCEPT_WEAK_STRONG_FIT_RATIO'
  if (reasonCode === 'UNRESOLVED_VENUE_DUPLICATE') return 'LIST_MEMBERSHIP_MISSING_KIND_SPECIFIC_EVIDENCE'
  return null
}

function structuralValidationErrors(items: readonly M9AdapterCertifiedItem[]): string[] {
  const errors: string[] = []
  items.forEach((item, i) => {
    if (!item.candidateName || !item.candidateName.trim()) errors.push(`item[${i}]: missing candidateName`)
    if (!item.venueName || !item.venueName.trim()) errors.push(`item[${i}] (${item.candidateName}): missing venueName`)
    if (!item.dbCategory) errors.push(`item[${i}] (${item.candidateName}): missing dbCategory`)
    if (!item.neighborhoodName || !item.neighborhoodName.trim()) errors.push(`item[${i}] (${item.candidateName}): missing neighborhoodName`)
    if (!item.finalBody || !item.finalBody.trim()) errors.push(`item[${i}] (${item.candidateName}): missing finalBody`)
  })
  return errors
}

// ---------------------------------------------------------------------------
// Session 3 PREREQUISITE 2 — structured evidence-required resolution.
// See m9EnforcedTypes.ts's own doc on M9OperatorResolutionAction for why
// this replaces Session 2's "any non-empty decisionText resolves anything"
// rule.
// ---------------------------------------------------------------------------

/**
 * reasonCodes this session has deliberately reviewed and marked safe for
 * an ACCEPT_EXCEPTION resolution — EMPTY on purpose. No reasonCode this
 * codebase produces today (CONCEPT_WEAK_STRONG_FIT_RATIO,
 * UNRESOLVED_VENUE_DUPLICATE, CONCEPT_SUBSTANTIAL_OVERLAP,
 * CONCEPT_CREATE_PENDING_APPROVAL, or any MEMBERSHIP_MISSING_*_EVIDENCE
 * reason Phase 2 adds) has been reviewed as exception-eligible — a factual
 * duplicate or an unsupported evidence-required claim must always be
 * resolved by real evidence or an explicit rejection, never waved through.
 * Add an entry here ONLY as a deliberate, reviewed, documented policy
 * decision — never to unblock a specific test or run.
 */
export const M9_EXCEPTION_ELIGIBLE_REASON_CODES: ReadonlySet<string> = new Set()

interface M9ConceptRequirementContext {
  approvalSufficiency: M9ApprovalSufficiency
  reasonCode: string
}

function resolveDecisionOutcome(action: M9OperatorResolutionAction): 'APPROVED' | 'REJECTED' {
  return action === 'REJECT' ? 'REJECTED' : 'APPROVED'
}

/**
 * The real enforcement behind PREREQUISITE 2's required behaviors. Called
 * BEFORE a decision input is ever turned into a stored
 * M9OperatorDecisionRecord — an input that fails here is refused outright
 * (see rejectedDecisionInputs) and the underlying requirement stays
 * outstanding, exactly as if nothing had been submitted.
 */
function validateM9OperatorResolution(input: M9OperatorDecisionInput, requirement: M9ConceptRequirementContext | undefined): { ok: true } | { ok: false; reason: string } {
  switch (input.resolutionAction) {
    case 'REJECT':
      // "REJECT may resolve the issue by excluding the affected concept or
      // membership" — always permitted, regardless of approvalSufficiency;
      // excluding something is never less safe than including it.
      return { ok: true }
    case 'APPROVE':
      if (requirement && (requirement.approvalSufficiency === 'EVIDENCE_REQUIRED' || requirement.approvalSufficiency === 'RESEARCH_REQUIRED')) {
        return { ok: false, reason: `APPROVE cannot resolve an ${requirement.approvalSufficiency} decision (reasonCode "${requirement.reasonCode}") — use SUPPLY_EVIDENCE with structured evidence addressing this exact issue, or REJECT to exclude it.` }
      }
      return { ok: true }
    case 'SUPPLY_EVIDENCE': {
      if (!requirement || (requirement.approvalSufficiency !== 'EVIDENCE_REQUIRED' && requirement.approvalSufficiency !== 'RESEARCH_REQUIRED')) {
        return { ok: false, reason: 'SUPPLY_EVIDENCE is only a valid resolution for a decision whose approvalSufficiency is EVIDENCE_REQUIRED or RESEARCH_REQUIRED.' }
      }
      const e = input.evidence
      if (!e) return { ok: false, reason: 'SUPPLY_EVIDENCE requires structured evidence (sourceOrEvidenceId, evidenceSummary, dateVerified, confidence, issueResolved) — arbitrary prose in decisionText alone is never sufficient, however substantive it reads.' }
      const missingFields: string[] = []
      if (!e.sourceOrEvidenceId || !e.sourceOrEvidenceId.trim()) missingFields.push('sourceOrEvidenceId')
      if (!e.evidenceSummary || !e.evidenceSummary.trim()) missingFields.push('evidenceSummary')
      if (!e.dateVerified || !e.dateVerified.trim()) missingFields.push('dateVerified')
      if (!e.confidence) missingFields.push('confidence')
      if (!e.issueResolved || !e.issueResolved.trim()) missingFields.push('issueResolved')
      if (missingFields.length > 0) return { ok: false, reason: `Structured evidence is incomplete — missing: ${missingFields.join(', ')}.` }
      if (e.issueResolved !== requirement.reasonCode) {
        return { ok: false, reason: `Evidence issueResolved ("${e.issueResolved}") does not match this concept's actual outstanding issue ("${requirement.reasonCode}") — unrelated evidence (even if real) cannot resolve a different issue.` }
      }
      return { ok: true }
    }
    case 'ACCEPT_EXCEPTION': {
      if (!requirement) return { ok: false, reason: 'ACCEPT_EXCEPTION requires a real outstanding requirement to except.' }
      if (!M9_EXCEPTION_ELIGIBLE_REASON_CODES.has(requirement.reasonCode)) {
        return { ok: false, reason: `reasonCode "${requirement.reasonCode}" does not explicitly permit an exception — ACCEPT_EXCEPTION can never resolve a factual duplicate or any other evidence-required finding unless that specific issue has been deliberately, explicitly marked exception-eligible (none are, in this codebase, today). Use SUPPLY_EVIDENCE or REJECT instead.` }
      }
      return { ok: true }
    }
    case 'REPLACE_CONCEPT':
    case 'REOPEN':
      // Phase 4 wires the specific completed-list replace/reopen semantics
      // (metroLaunchDriver.ts / this file's own later additions) — these
      // two actions are structurally valid resolutions here; the
      // completed-list-specific policy check happens where that context
      // (an existing production list's status) is actually available.
      return { ok: true }
    case 'REQUEST_RESEARCH':
      return { ok: false, reason: 'REQUEST_RESEARCH records that research was requested but never itself resolves anything — RESEARCH_REQUIRED remains blocked until real research results are attached via SUPPLY_EVIDENCE.' }
    default:
      // Defensive only — every real M9OperatorResolutionAction is handled
      // above; a caller bypassing TypeScript (e.g. `as never`, a stale
      // pre-hardening payload) lands here rather than crashing on an
      // undefined result.
      return { ok: false, reason: `Unrecognized resolutionAction "${String(input.resolutionAction)}" — a decision must specify one of the real M9OperatorResolutionAction values (APPROVE/REJECT/SUPPLY_EVIDENCE/REQUEST_RESEARCH/ACCEPT_EXCEPTION/REPLACE_CONCEPT/REOPEN).` }
  }
}

function blockingResult(
  kind: 'NEEDS_JERRY' | 'HOLD' | 'INVALID' | 'ERROR',
  reasonCode: string,
  explanation: string,
  requiredDecisions: M9RequiredDecision[]
): M9EnforcedResult {
  const affectedConceptIds = [...new Set(requiredDecisions.flatMap((d) => d.affectedConceptIds))]
  const affectedItemIds = [...new Set(requiredDecisions.flatMap((d) => d.affectedItemIds))]
  const missingEvidence = [...new Set(requiredDecisions.flatMap((d) => d.missingEvidence ?? []))]
  return {
    kind,
    reasonCode,
    explanation,
    affectedConceptIds,
    affectedItemIds,
    missingEvidence,
    earliestSafeResumePoint: 'M9_HOME_LIST_MIRROR',
    approvalSufficient: requiredDecisions.length > 0 && requiredDecisions.every((d) => d.approvalSufficiency === 'APPROVAL_SUFFICIENT' || d.approvalSufficiency === 'REJECTION_REQUIRED' || d.approvalSufficiency === 'CONFIGURATION_REQUIRED'),
    evidenceMandatory: requiredDecisions.some((d) => d.evidenceMandatory),
    requiredDecisions,
  }
}

function emptyEnforcedArtifact(now: () => string, inputCatalogFingerprint: string, result: M9EnforcedResult, errors: string[] = []): M9EnforcedCurationArtifact {
  const nowIso = now()
  return {
    mode: 'ENFORCED',
    artifactVersion: M9_ENFORCED_ARTIFACT_VERSION,
    inputCatalogFingerprint,
    createdAt: nowIso,
    updatedAt: nowIso,
    conceptVerdicts: [],
    finalApprovedMemberships: {},
    requiredDecisions: result.kind === 'READY' ? [] : result.requiredDecisions,
    validation: { ok: errors.length === 0, errors },
    result,
  }
}

/**
 * ENFORCED entry point. Runs PASS A against the real certified catalog,
 * then — for every non-REJECT concept — speculatively runs PASS B and
 * duplicate-venue detection so a required decision's approvalSufficiency
 * is accurate from the FIRST time it's ever surfaced (never "APPROVAL_SUFFICIENT
 * at first, then upgraded to EVIDENCE_REQUIRED on a later call" — an
 * operator must see the real bar before deciding, not after).
 *
 * Never throws: PASS A/B exceptions become an 'ERROR' result; malformed
 * input becomes 'INVALID' before either pass ever runs. Every expected
 * curation outcome — a concept awaiting approval, a HOLD, a stale
 * fingerprint — is a plain returned value.
 */
export function runM9EnforcedCuration(input: RunM9EnforcedCurationInput): RunM9EnforcedCurationOutput {
  const now = input.now ?? (() => new Date().toISOString())
  const inputCatalogFingerprint = computeM9CatalogFingerprint(input.certifiedItems)

  const structuralErrors = structuralValidationErrors(input.certifiedItems)
  if (structuralErrors.length > 0) {
    const result = blockingResult('INVALID', 'MALFORMED_CERTIFIED_ITEM', `${structuralErrors.length} certified item(s) are missing required fields — refusing to run concept discovery against malformed input.`, [])
    return { artifact: emptyEnforcedArtifact(now, inputCatalogFingerprint, result, structuralErrors), acceptedDecisions: [], rejectedDecisionInputs: [] }
  }

  const discoveryConfig = input.conceptDiscoveryConfig ?? DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG
  const discoveryConfigFingerprint = computeM9DiscoveryConfigFingerprint(discoveryConfig)

  let conceptDiscovery: ListConceptCandidate[]
  try {
    const conceptItems = input.certifiedItems.map(toConceptItem)
    const alreadyAccepted = input.legacyPlan.filter((p) => p.kind !== 'CURATED_MIRROR').map((p) => ({ title: p.title, candidateNames: p.itemCandidateNames }))
    conceptDiscovery = discoverListConcepts(conceptItems, discoveryConfig, alreadyAccepted)
  } catch (err) {
    const result = blockingResult('ERROR', 'PASS_A_THREW', `PASS A (discoverListConcepts) threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`, [])
    return { artifact: emptyEnforcedArtifact(now, inputCatalogFingerprint, result), acceptedDecisions: [], rejectedDecisionInputs: [] }
  }

  const itemsByName = new Map(input.certifiedItems.map((i) => [i.candidateName, i]))

  // Session 3 identity hardening — conceptId is now metro+listKind+seedTags
  // scoped (m9EnforcedTypes.ts's own doc), so it must be computed the same
  // way everywhere this function needs it: once per concept here, and
  // reused (never recomputed with different inputs) below.
  function identityFor(concept: ListConceptCandidate): { conceptId: string; listKind: ListMembershipKind } {
    const members = concept.candidateNames.map((name) => itemsByName.get(name)).filter((i): i is M9AdapterCertifiedItem => Boolean(i))
    const listKind = classifyM9ListKind(concept, members)
    return { conceptId: computeM9ConceptId({ metroSlug: input.metroSlug, listKind, seedTags: concept.seedTags }), listKind }
  }
  function fingerprintFor(concept: ListConceptCandidate, conceptId: string): string {
    const members = concept.candidateNames.map((name) => {
      const item = itemsByName.get(name)
      return { candidateName: name, dbCategory: item?.dbCategory ?? 'UNKNOWN', finalTags: item?.finalTags ?? [], neighborhoodName: item?.neighborhoodName ?? 'UNKNOWN' }
    })
    return computeM9ConceptFingerprint({ conceptId, members, editorialPromise: concept.editorialPromise, discoveryConfigFingerprint })
  }

  // ---------------------------------------------------------------------
  // PASS 1 (Session 3, PREREQUISITE 2 restructure) — evaluate every
  // non-REJECT concept's real requirement context (memberDecisions,
  // duplicateFindings, action/approvalSufficiency/reasonCode) BEFORE
  // looking at any decision input. This is what makes context-aware
  // resolution validation possible at all: PREREQUISITE 2 requires
  // knowing whether a submitted APPROVE/SUPPLY_EVIDENCE actually matches
  // this concept's real outstanding issue, which is only known once PASS
  // B + duplicate detection have run. REJECT concepts are finalized
  // immediately here (nothing else to evaluate for them).
  // ---------------------------------------------------------------------
  interface ConceptEval {
    concept: ListConceptCandidate
    conceptId: string
    fingerprint: string
    listKind: ListMembershipKind
    overlapFindings: M9EnforcedConceptVerdict['overlapFindings']
    memberDecisions: M9ItemMembershipRecord[]
    duplicateFindings: M9DuplicateFinding[]
    includedItemIds: string[]
    action: OperatorReviewAction
    approvalSufficiency: M9ApprovalSufficiency
    reasonCode: string
    explanation: string
    tiesIntoExistingMechanism: string | null
    missingEvidence: string[]
  }

  const conceptVerdicts: M9EnforcedConceptVerdict[] = []
  const evalsByConceptId = new Map<string, ConceptEval>()

  for (const concept of conceptDiscovery) {
    const { conceptId, listKind } = identityFor(concept)
    const fingerprint = fingerprintFor(concept, conceptId)
    const overlapFindings = concept.overlapWithOtherConcepts.map((o) => ({ withConceptId: legacyListPseudoId(input.metroSlug, o.withTitle), withTitle: o.withTitle, sharedItemCount: o.sharedItemCount, sharedPercent: o.sharedPercent }))

    // REJECT is automatic and final — "insufficient depth blocks rather
    // than adding filler": never scored for membership, never offered for
    // approval, and never re-litigated (there is nothing an operator
    // decision could productively attach to here; the concept simply
    // doesn't have enough real items).
    if (concept.verdict === 'REJECT') {
      conceptVerdicts.push({
        conceptId,
        fingerprint,
        proposedTitle: concept.proposedTitle,
        seedTags: concept.seedTags,
        listKind,
        discoveryVerdict: concept.verdict,
        approvalState: 'AUTO_EXCLUDED',
        memberDecisions: [],
        exclusionReasons: concept.candidateNames.map((itemId) => ({ itemId, reason: concept.reasoning })),
        overlapFindings,
        duplicateFindings: [],
      })
      continue
    }

    // Speculative PASS B + duplicate detection — run for EVERY non-REJECT
    // concept regardless of approval state, so a required decision's
    // approvalSufficiency reflects the real evidence picture from the
    // moment it's first surfaced (see this function's own doc).
    let memberDecisions: M9ItemMembershipRecord[] = []
    try {
      const decisions = evaluateConceptMembershipForKind(concept, itemsByName, listKind)
      memberDecisions = decisions.map((d) => ({ itemId: d.itemId, verdict: d.verdict, fitScore: d.fitScore, fitReason: d.fitReason }))
    } catch (err) {
      const result = blockingResult('ERROR', 'PASS_B_THREW', `PASS B (evaluateItemForListMembership) threw unexpectedly for concept "${concept.proposedTitle}": ${err instanceof Error ? err.message : String(err)}`, [])
      return { artifact: emptyEnforcedArtifact(now, inputCatalogFingerprint, result), acceptedDecisions: [], rejectedDecisionInputs: [] }
    }

    const includedItemIds = memberDecisions.filter((d) => d.verdict === 'INCLUDE').map((d) => d.itemId)
    const portfolioMembers: PortfolioReviewItem[] = includedItemIds
      .map((id) => itemsByName.get(id))
      .filter((i): i is M9AdapterCertifiedItem => Boolean(i))
      .map((i) => ({ candidateName: i.candidateName, venueName: i.venueName, dbCategory: i.dbCategory, neighborhoodName: i.neighborhoodName, finalBody: i.finalBody }))
    const repetitionFindings = detectPortfolioRepetition(portfolioMembers)
    const duplicateFindings: M9DuplicateFinding[] = repetitionFindings.filter((f) => f.kind === 'DUPLICATE_VENUE').map((f) => ({ kind: 'DUPLICATE_VENUE', detail: f.detail, affectedItemIds: f.affectedCandidateNames }))

    // Base action/sufficiency by PASS A's own verdict — see this file's
    // module doc for why HOLD/REQUIRES_JERRY reuse CREATE_NEW_LIST_CONCEPT/
    // CONCEPT_WITH_SUBSTANTIAL_OVERLAP rather than inventing new
    // OperatorReviewAction values the existing boundary module doesn't
    // define. An unresolved duplicate ALWAYS escalates to EVIDENCE_REQUIRED
    // regardless of the base verdict — Phase 4's explicit "unresolved
    // venue duplicate" requirement.
    let action: OperatorReviewAction
    let approvalSufficiency: M9ApprovalSufficiency
    let reasonCode: string
    let explanation: string
    if (concept.verdict === 'REQUIRES_JERRY') {
      action = 'CONCEPT_WITH_SUBSTANTIAL_OVERLAP'
      approvalSufficiency = 'APPROVAL_SUFFICIENT'
      reasonCode = 'CONCEPT_SUBSTANTIAL_OVERLAP'
      explanation = `${concept.reasoning} ${evaluateOperatorReviewBoundary(action).reason}`
    } else if (concept.verdict === 'HOLD') {
      action = 'CREATE_NEW_LIST_CONCEPT'
      approvalSufficiency = 'RESEARCH_REQUIRED'
      reasonCode = 'CONCEPT_WEAK_STRONG_FIT_RATIO'
      explanation = concept.reasoning
    } else {
      action = 'CREATE_NEW_LIST_CONCEPT'
      approvalSufficiency = 'APPROVAL_SUFFICIENT'
      reasonCode = 'CONCEPT_CREATE_PENDING_APPROVAL'
      explanation = evaluateOperatorReviewBoundary(action).reason
    }
    // Phase 4 — "wire the existing operator-boundary module into the real
    // driver": every required decision's tiesIntoExistingMechanism is
    // ALWAYS sourced from evaluateOperatorReviewBoundary(action), never
    // hand-written here, so the connection to the existing boundary table
    // is a checkable fact on every M9RequiredDecision, not just an
    // implicit assumption.
    let tiesIntoExistingMechanism = evaluateOperatorReviewBoundary(action).tiesIntoExistingMechanism
    const missingEvidence: string[] = []
    if (duplicateFindings.length > 0) {
      approvalSufficiency = 'EVIDENCE_REQUIRED'
      reasonCode = 'UNRESOLVED_VENUE_DUPLICATE'
      explanation = `${duplicateFindings.map((d) => d.detail).join(' ')} Real, structured evidence (SUPPLY_EVIDENCE) or an explicit, substantiated decision is required — the same Kunst Oase/Vereinsheim precedent this codebase already recognizes at the seed-duplicate stage (holdRecovery.ts) applies here too: an explicit "these are genuinely distinct, keep both" decision is valid even without NEW evidence, but a bare APPROVE (or any decisionText with no matching structured evidence) is not.`
      missingEvidence.push('structured evidence (SUPPLY_EVIDENCE) whose issueResolved is UNRESOLVED_VENUE_DUPLICATE, or an explicit REJECT excluding the affected concept')
      tiesIntoExistingMechanism = 'holdRecovery.ts (Kunst Oase/Vereinsheim explicit-decision precedent) + NEEDS_JERRY / escalate() (metroLaunchDriver.ts)'
    }
    if (concept.verdict === 'HOLD') missingEvidence.push('additional strong-fit evidence, or an explicit operator judgment accepting the cluster as-is')

    evalsByConceptId.set(conceptId, { concept, conceptId, fingerprint, listKind, overlapFindings, memberDecisions, duplicateFindings, includedItemIds, action, approvalSufficiency, reasonCode, explanation, tiesIntoExistingMechanism, missingEvidence })
  }

  // ---------------------------------------------------------------------
  // PASS 2 — validate + accept/reject this call's own decision
  // submissions, now WITH real per-concept requirement context available
  // (PREREQUISITE 2's whole point: APPROVE cannot resolve an
  // EVIDENCE_REQUIRED/RESEARCH_REQUIRED decision, SUPPLY_EVIDENCE must be
  // structurally complete AND address the concept's actual reasonCode,
  // ACCEPT_EXCEPTION is refused unless that reasonCode is deliberately
  // whitelisted). Every concept sees the final, settled decision set
  // exactly once in PASS 3.
  // ---------------------------------------------------------------------
  const acceptedDecisions: M9OperatorDecisionRecord[] = []
  const rejectedDecisionInputs: RunM9EnforcedCurationOutput['rejectedDecisionInputs'] = []
  const workingDecisions: Record<string, M9OperatorDecisionRecord> = { ...input.storedOperatorDecisions }
  for (const decisionInput of input.newOperatorDecisionInputs ?? []) {
    if (!decisionInput.decisionText || !decisionInput.decisionText.trim()) {
      rejectedDecisionInputs.push({ input: decisionInput, reason: 'decisionText is required and must be non-empty on every resolution — an attributable human explanation is always required, even alongside structured evidence.' })
      continue
    }
    if (!decisionInput.decidedBy || !decisionInput.decidedBy.trim()) {
      rejectedDecisionInputs.push({ input: decisionInput, reason: 'decidedBy is required — a decision must be attributable to a real operator, never anonymous.' })
      continue
    }
    const evalEntry = evalsByConceptId.get(decisionInput.conceptId)
    if (!evalEntry) {
      rejectedDecisionInputs.push({ input: decisionInput, reason: `No concept with id "${decisionInput.conceptId}" is currently evaluable in this run (either never discovered, or auto-excluded as REJECT) — the decision may be stale (the concept's seed tags no longer cluster) or malformed.` })
      continue
    }
    const validation = validateM9OperatorResolution(decisionInput, { approvalSufficiency: evalEntry.approvalSufficiency, reasonCode: evalEntry.reasonCode })
    if (!validation.ok) {
      rejectedDecisionInputs.push({ input: decisionInput, reason: validation.reason })
      continue
    }
    const record: M9OperatorDecisionRecord = {
      conceptId: decisionInput.conceptId,
      decidedForFingerprint: evalEntry.fingerprint,
      action: decisionInput.action,
      resolutionAction: decisionInput.resolutionAction,
      decision: resolveDecisionOutcome(decisionInput.resolutionAction),
      decisionText: decisionInput.decisionText,
      evidence: decisionInput.evidence,
      decidedBy: decisionInput.decidedBy,
      decidedAt: now(),
    }
    workingDecisions[decisionInput.conceptId] = record
    acceptedDecisions.push(record)
  }

  // ---------------------------------------------------------------------
  // PASS 3 — finalize every non-REJECT concept using PASS 1's evaluation
  // and PASS 2's validated decisions. Identical control flow to Session
  // 2's original single-pass loop, just reading precomputed data instead
  // of recomputing it.
  // ---------------------------------------------------------------------
  const finalApprovedMemberships: Record<string, string[]> = {}
  const allRequiredDecisions: M9RequiredDecision[] = []
  const previousById = new Map((input.previousArtifact?.conceptVerdicts ?? []).map((v) => [v.conceptId, v]))

  for (const { concept, conceptId, fingerprint, listKind, overlapFindings, memberDecisions, duplicateFindings, includedItemIds, action, approvalSufficiency, reasonCode, explanation, tiesIntoExistingMechanism, missingEvidence } of evalsByConceptId.values()) {
    const stored = workingDecisions[conceptId]
    const decisionValid = stored && stored.decidedForFingerprint === fingerprint

    if (decisionValid && stored!.decision === 'REJECTED') {
      conceptVerdicts.push({
        conceptId,
        fingerprint,
        proposedTitle: concept.proposedTitle,
        seedTags: concept.seedTags,
        listKind,
        discoveryVerdict: concept.verdict,
        approvalState: 'REJECTED',
        operatorDecision: stored,
        memberDecisions,
        exclusionReasons: concept.candidateNames.map((itemId) => ({ itemId, reason: `Rejected by operator decision: ${stored!.decisionText}` })),
        overlapFindings,
        duplicateFindings,
      })
      continue
    }

    if (decisionValid && stored!.decision === 'APPROVED') {
      // Phase 6 — genuinely wiring holdRecovery.ts into the driver: when
      // this decision is resolving a real evidence-mandatory HOLD (not a
      // plain approval-sufficient NEEDS_JERRY), route it through the
      // existing reopenHoldCandidate/verifyReopenStageCompleteness pair
      // and assert their own invariant — reentry never lands earlier than
      // M9_HOME_LIST_MIRROR, and every stage from there through M10 is
      // present in order. This can only ever fail from a real bug in this
      // adapter (the mapping above is deliberately conservative and
      // always resolves to M9), never from anything an operator submits —
      // so a violation here becomes ERROR, not HOLD/NEEDS_JERRY.
      if (approvalSufficiency === 'EVIDENCE_REQUIRED' || approvalSufficiency === 'RESEARCH_REQUIRED') {
        const holdReasonKind = toHoldReasonKind(reasonCode) ?? 'LIST_CONCEPT_WEAK_STRONG_FIT_RATIO'
        const holdRecord: HoldRecord = { candidateName: conceptId, holdReasonKind, originalReasons: [explanation], originalHeldAt: stored!.decidedAt }
        const reopenResult = reopenHoldCandidate({ hold: holdRecord, newEvidence: stored!.evidence?.evidenceSummary, explicitDecision: stored!.decisionText, reopenedBy: stored!.decidedBy, reopenedAt: stored!.decidedAt })
        const completeness = verifyReopenStageCompleteness(reopenResult)
        if (!reopenResult.ok || !completeness.ok || reopenResult.reentryStage !== 'M9_HOME_LIST_MIRROR') {
          const result = blockingResult('ERROR', 'HOLD_REOPEN_INVARIANT_VIOLATED', `holdRecovery.ts's reopen invariants were violated resolving concept "${concept.proposedTitle}": ${!reopenResult.ok ? reopenResult.errors.join('; ') : completeness.reason}`, [])
          return { artifact: emptyEnforcedArtifact(now, inputCatalogFingerprint, result), acceptedDecisions: [], rejectedDecisionInputs: [] }
        }
      }
      finalApprovedMemberships[conceptId] = includedItemIds
      conceptVerdicts.push({
        conceptId,
        fingerprint,
        proposedTitle: concept.proposedTitle,
        seedTags: concept.seedTags,
        listKind,
        discoveryVerdict: concept.verdict,
        approvalState: 'APPROVED',
        operatorDecision: stored,
        memberDecisions,
        exclusionReasons: memberDecisions.filter((d) => d.verdict !== 'INCLUDE').map((d) => ({ itemId: d.itemId, reason: d.fitReason })),
        overlapFindings,
        duplicateFindings,
      })
      continue
    }

    // Phase 6 anti-bypass proof — genuinely exercising holdRecovery.ts's
    // own verifyHoldNotBypassed: when nothing changed for this concept
    // this call (same fingerprint as last time, and no fresh decision was
    // accepted for it), re-evaluating from scratch must reproduce the
    // IDENTICAL member decisions/approval posture as last time. A
    // mismatch here would mean a rerun with NO new evidence silently
    // changed the outcome — a real certification-bypass bug, never
    // something this function may paper over with ERROR-becomes-quietly-READY;
    // it becomes an explicit ERROR result instead.
    const previous = previousById.get(conceptId)
    const gotFreshDecisionThisCall = acceptedDecisions.some((d) => d.conceptId === conceptId)
    if (previous && previous.fingerprint === fingerprint && !gotFreshDecisionThisCall && previous.approvalState !== 'APPROVED' && previous.approvalState !== 'REJECTED') {
      const reEvaluatedApprovalState: 'HOLD' | 'PENDING' = concept.verdict === 'HOLD' || duplicateFindings.length > 0 ? 'HOLD' : 'PENDING'
      const bypassCheck = verifyHoldNotBypassed({
        hadNewEvidence: false,
        originalVerdict: { approvalState: previous.approvalState, memberDecisions: previous.memberDecisions },
        reEvaluatedVerdict: { approvalState: reEvaluatedApprovalState, memberDecisions },
      })
      if (!bypassCheck.ok) {
        const result = blockingResult('ERROR', 'HOLD_BYPASS_DETECTED', `verifyHoldNotBypassed (holdRecovery.ts) detected a certification bypass for concept "${concept.proposedTitle}": ${bypassCheck.reason}`, [])
        return { artifact: emptyEnforcedArtifact(now, inputCatalogFingerprint, result), acceptedDecisions: [], rejectedDecisionInputs: [] }
      }
    }

    // No valid (fresh-fingerprint) decision on record — outstanding.
    const decisionId = `${conceptId}:${action}`
    const requiredDecision: M9RequiredDecision = {
      decisionId,
      action,
      approvalSufficiency,
      reasonCode,
      explanation,
      affectedConceptIds: [conceptId],
      affectedItemIds: concept.candidateNames,
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : null,
      evidenceMandatory: approvalSufficiency === 'EVIDENCE_REQUIRED' || approvalSufficiency === 'RESEARCH_REQUIRED',
      tiesIntoExistingMechanism,
    }
    allRequiredDecisions.push(requiredDecision)
    conceptVerdicts.push({
      conceptId,
      fingerprint,
      proposedTitle: concept.proposedTitle,
      seedTags: concept.seedTags,
      listKind,
      discoveryVerdict: concept.verdict,
      approvalState: concept.verdict === 'HOLD' || duplicateFindings.length > 0 ? 'HOLD' : 'PENDING',
      memberDecisions,
      exclusionReasons: [],
      overlapFindings,
      duplicateFindings,
    })
  }

  const nowIso = now()
  let result: M9EnforcedResult
  if (allRequiredDecisions.length === 0) {
    result = { kind: 'READY', approvedConceptIds: Object.keys(finalApprovedMemberships), comparedAgainstLegacyListTitles: input.legacyPlan.map((p) => p.title) }
  } else {
    const anyEvidenceOrResearch = allRequiredDecisions.some((d) => d.approvalSufficiency === 'EVIDENCE_REQUIRED' || d.approvalSufficiency === 'RESEARCH_REQUIRED')
    result = blockingResult(
      anyEvidenceOrResearch ? 'HOLD' : 'NEEDS_JERRY',
      anyEvidenceOrResearch ? 'OUTSTANDING_EVIDENCE_OR_RESEARCH_REQUIRED' : 'OUTSTANDING_OPERATOR_APPROVAL_REQUIRED',
      `${allRequiredDecisions.length} concept-level decision(s) remain outstanding before this plan can become authoritative.`,
      allRequiredDecisions
    )
  }

  const artifact: M9EnforcedCurationArtifact = {
    mode: 'ENFORCED',
    artifactVersion: M9_ENFORCED_ARTIFACT_VERSION,
    inputCatalogFingerprint,
    createdAt: nowIso,
    updatedAt: nowIso,
    conceptVerdicts,
    finalApprovedMemberships,
    requiredDecisions: allRequiredDecisions,
    validation: { ok: true, errors: [] },
    result,
  }

  return { artifact, acceptedDecisions, rejectedDecisionInputs }
}
