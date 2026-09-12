// agent-service/playbooks/metroFinisherIntegration.ts
//
// Chief Phase 3C — METRO_FINISHER_INTEGRATION. A pure function (no AI, no
// I/O) that converts an already-validated MetroFinisherReport into bounded
// Winston work packets. Packets are plain data describing follow-up work —
// NEVER production items, lists, or neighborhoods. Every candidate named in
// a packet must still flow through certifyLateAddItem() and the rest of the
// real certification pipeline before it can become a real item; this module
// makes no certification decision of its own.

import type { CandidateFinding, DuplicateConcern, MetroFinisherReport, NeighborhoodAddProposal, NeighborhoodSplitProposal, ThemedListOpportunity } from './metroFinisherReport'

// ---------------------------------------------------------------------------
// Packet shapes
// ---------------------------------------------------------------------------

export interface EnrichmentPacket {
  kind: 'ENRICHMENT_PACKET'
  /** Every enrichment lead the report surfaced, still just a candidate — none of these are certified items. Superset of venueResolvedCandidates + researchOnlyCandidates. */
  candidates: CandidateFinding[]
  /**
   * Subset of `candidates` with a real, named venue (`venueName` is a
   * non-empty string). These are the only candidates that may ever be
   * carried forward toward certifyLateAddItem()/LateAddItemInput, which
   * still requires a real, resolvable venue — this partition is what a
   * caller should check before ever building a LateAddItemInput from a
   * Finisher candidate.
   */
  venueResolvedCandidates: (CandidateFinding & { venueName: string })[]
  /**
   * Subset of `candidates` that are legitimate research findings with no
   * single resolvable venue (a civic/seasonal phenomenon, a multi-venue
   * crawl, a neighborhood ritual, a themed-list research concept, etc.).
   * Real information worth surfacing to Jerry/downstream research, but
   * MUST NOT be passed toward certifyLateAddItem() as-is — a human or a
   * later research pass would need to first identify a real venue, if one
   * even exists, before any of these could become a LateAddItemInput.
   */
  researchOnlyCandidates: CandidateFinding[]
}

export type NeighborhoodWorkItem =
  | { kind: 'MIGRATION_REVIEW'; parentNeighborhood: string; proposedChildren: string[]; rationale: string; affectedExistingItemIds: string[] }
  | { kind: 'ADD_CANDIDATE'; name: string; rationale: string }
  | { kind: 'GAP_FLAG'; area: string; evidence: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; recommendation: string }

export interface NeighborhoodPacket {
  kind: 'NEIGHBORHOOD_PACKET'
  keep: string[]
  rejected: { name: string; reason: string }[]
  workItems: NeighborhoodWorkItem[]
}

export type ThemedListWorkItem =
  | { kind: 'CREATE_NOW'; title: string; rationale: string; existingItemIds: string[] }
  | { kind: 'ENRICHMENT_NEEDED'; title: string; rationale: string; existingItemIds: string[]; missingExperiences: CandidateFinding[] }
  | { kind: 'DO_NOT_CREATE'; title: string; rationale: string }

export interface ThemedListPacket {
  kind: 'THEMED_LIST_PACKET'
  workItems: ThemedListWorkItem[]
}

export type DuplicateReviewWorkItem =
  | { kind: 'MERGE_REVIEW'; venueName: string; placeId: string | null; itemIds: string[]; rationale: string }
  | { kind: 'HUMAN_REVIEW'; venueName: string; placeId: string | null; itemIds: string[]; rationale: string }
  | { kind: 'CONFIRMED_DISTINCT'; venueName: string; placeId: string | null; itemIds: string[]; rationale: string }

export interface DuplicateReviewPacket {
  kind: 'DUPLICATE_REVIEW_PACKET'
  workItems: DuplicateReviewWorkItem[]
}

export interface CatalogCompletenessPacket {
  kind: 'CATALOG_COMPLETENESS_PACKET'
  currentItemCount: number
  strengths: string[]
  weaknesses: string[]
  categoryGapCount: number
  neighborhoodGapCount: number
  mustHaveMissingExperienceCount: number
  readyToFinish: boolean
  recommendedAdditionalItemRange: { min: number; max: number }
  highestPriorityNextActions: string[]
}

export interface MetroFinisherWorkPackets {
  enrichment: EnrichmentPacket
  neighborhood: NeighborhoodPacket
  themedList: ThemedListPacket
  duplicateReview: DuplicateReviewPacket
  catalogCompleteness: CatalogCompletenessPacket
}

// ---------------------------------------------------------------------------
// Builders — each pure, each operating on one section of the report.
// ---------------------------------------------------------------------------

function buildEnrichmentPacket(report: MetroFinisherReport): EnrichmentPacket {
  const candidates = [...report.mustHaveMissingExperiences, ...report.enrichmentCandidates]
  const venueResolvedCandidates = candidates.filter((c): c is CandidateFinding & { venueName: string } => c.venueName !== null)
  const researchOnlyCandidates = candidates.filter((c) => c.venueName === null)
  return { kind: 'ENRICHMENT_PACKET', candidates, venueResolvedCandidates, researchOnlyCandidates }
}

function splitToWorkItem(split: NeighborhoodSplitProposal): NeighborhoodWorkItem {
  return {
    kind: 'MIGRATION_REVIEW',
    parentNeighborhood: split.parentNeighborhood,
    proposedChildren: split.proposedChildren,
    rationale: split.rationale,
    affectedExistingItemIds: split.affectedExistingItemIds,
  }
}

function addToWorkItem(add: NeighborhoodAddProposal): NeighborhoodWorkItem {
  return { kind: 'ADD_CANDIDATE', name: add.name, rationale: add.rationale }
}

function buildNeighborhoodPacket(report: MetroFinisherReport): NeighborhoodPacket {
  const nr = report.neighborhoodRecommendations
  // Task requirement: a NeighborhoodSplitProposal ALWAYS produces a
  // migration-review work item — never silently dropped, and only ever
  // included when affectedExistingItemIds is non-empty (an empty array
  // should already have failed validateMetroFinisherReport upstream; this
  // is defense-in-depth, not a second place that "fixes" a bad proposal).
  const validSplits = nr.split.filter((s) => s.affectedExistingItemIds.length > 0)
  const workItems: NeighborhoodWorkItem[] = [
    ...validSplits.map(splitToWorkItem),
    ...nr.add.map(addToWorkItem),
    ...report.catalogAssessment.neighborhoodGaps.map((g): NeighborhoodWorkItem => ({ kind: 'GAP_FLAG', area: g.area, evidence: g.evidence, severity: g.severity, recommendation: g.recommendation })),
  ]
  return {
    kind: 'NEIGHBORHOOD_PACKET',
    keep: nr.keep,
    rejected: nr.reject.map((r) => ({ name: r.name, reason: r.reason })),
    workItems,
  }
}

function themedListToWorkItem(opportunity: ThemedListOpportunity): ThemedListWorkItem {
  if (opportunity.recommendation === 'CREATE_NOW') {
    return { kind: 'CREATE_NOW', title: opportunity.title, rationale: opportunity.rationale, existingItemIds: opportunity.existingItemIds }
  }
  if (opportunity.recommendation === 'ENRICH_THEN_CREATE') {
    // Task requirement: an ENRICH_THEN_CREATE verdict must produce an
    // explicit enrichment work item — never silently vanish, even when
    // the report itself listed no missingExperiences (a possible, if
    // sloppy, report — this packet still surfaces the intent so a human
    // sees the gap rather than losing the recommendation entirely).
    return { kind: 'ENRICHMENT_NEEDED', title: opportunity.title, rationale: opportunity.rationale, existingItemIds: opportunity.existingItemIds, missingExperiences: opportunity.missingExperiences }
  }
  return { kind: 'DO_NOT_CREATE', title: opportunity.title, rationale: opportunity.rationale }
}

function buildThemedListPacket(report: MetroFinisherReport): ThemedListPacket {
  return { kind: 'THEMED_LIST_PACKET', workItems: report.themedListOpportunities.map(themedListToWorkItem) }
}

function duplicateConcernToWorkItem(concern: DuplicateConcern): DuplicateReviewWorkItem {
  if (concern.verdict === 'MERGE_RECOMMENDED') {
    return { kind: 'MERGE_REVIEW', venueName: concern.venueName, placeId: concern.placeId, itemIds: concern.itemIds, rationale: concern.rationale }
  }
  if (concern.verdict === 'NEEDS_HUMAN_REVIEW') {
    return { kind: 'HUMAN_REVIEW', venueName: concern.venueName, placeId: concern.placeId, itemIds: concern.itemIds, rationale: concern.rationale }
  }
  // DISTINCT — same venue, materially different experiences: both/all
  // items proceed, never auto-rejected. Reported for visibility only.
  return { kind: 'CONFIRMED_DISTINCT', venueName: concern.venueName, placeId: concern.placeId, itemIds: concern.itemIds, rationale: concern.rationale }
}

function buildDuplicateReviewPacket(report: MetroFinisherReport): DuplicateReviewPacket {
  return { kind: 'DUPLICATE_REVIEW_PACKET', workItems: report.duplicateOrIdentityConcerns.map(duplicateConcernToWorkItem) }
}

function buildCatalogCompletenessPacket(report: MetroFinisherReport): CatalogCompletenessPacket {
  return {
    kind: 'CATALOG_COMPLETENESS_PACKET',
    currentItemCount: report.catalogAssessment.currentItemCount,
    strengths: report.catalogAssessment.strengths,
    weaknesses: report.catalogAssessment.weaknesses,
    categoryGapCount: report.catalogAssessment.categoryGaps.length,
    neighborhoodGapCount: report.catalogAssessment.neighborhoodGaps.length,
    mustHaveMissingExperienceCount: report.mustHaveMissingExperiences.length,
    readyToFinish: report.finalAssessment.readyToFinish,
    recommendedAdditionalItemRange: report.finalAssessment.recommendedAdditionalItemRange,
    highestPriorityNextActions: report.finalAssessment.highestPriorityNextActions,
  }
}

/**
 * The single entry point: report in, all five packets out. Pure synthesis
 * — never calls AI, never touches a DB, never itself decides an item is
 * certified. Every packet is bounded follow-up work, describing what to
 * look into next, not what already exists in production.
 */
export function buildMetroFinisherWorkPackets(report: MetroFinisherReport): MetroFinisherWorkPackets {
  return {
    enrichment: buildEnrichmentPacket(report),
    neighborhood: buildNeighborhoodPacket(report),
    themedList: buildThemedListPacket(report),
    duplicateReview: buildDuplicateReviewPacket(report),
    catalogCompleteness: buildCatalogCompletenessPacket(report),
  }
}
