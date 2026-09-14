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
//   - ENFORCED mode (the new system actually gating production SQL) is
//     explicitly out of scope for this session — see the handoff doc's
//     "Behaviors expected to change once wiring lands" section for what
//     that will require (real HOLD/NEEDS_JERRY exits, a genuine mode
//     precedent on MetroDriverDeps, etc).

import { discoverListConcepts, DEFAULT_LIST_CONCEPT_DISCOVERY_CONFIG, type ListConceptCandidate, type ListConceptCandidateItem, type ListConceptDiscoveryConfig, type ListConceptVerdict } from '../playbooks/listConceptDiscovery'
import { evaluateItemForListMembership, type ItemListFitDecision, type ItemListMembershipVerdict, type ListFitCandidate, type ListMembershipListContext } from '../playbooks/listFitScoring'
import type { RealDbCategory } from '../playbooks/metroCatalog'
import type { CommercialOwnershipType } from '../playbooks/categoryPolicy'

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
    const alreadyAccepted = input.legacyPlan.map((p) => ({ title: p.title, candidateNames: p.itemCandidateNames }))
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

  const conceptDifferences: M9ConceptDifference[] = conceptDiscovery.map((concept) => {
    const match = findBestLegacyMatch(concept.candidateNames, input.legacyPlan)
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
    const match = findBestLegacyMatch(concept.candidateNames, input.legacyPlan)
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
