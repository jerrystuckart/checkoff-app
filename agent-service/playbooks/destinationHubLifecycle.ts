// Chief Phase 2C — the Destination Hub Lifecycle playbook. Pure logic only.
//
// RECONSTRUCTED FROM Open Brain (not invented): the July 12, 2026 "CDIS
// progress" thought is the canonical source for DVA-1/DVA-2/DAP's
// purpose, inputs, and output structure (Jerry's own words, retrieved
// verbatim, quoted in the doc comments below); the August 8, 2026
// Willcox commercial-model and proposal-rules thoughts are the canonical
// source for D12's offer/pricing structure and D10's "don't hand
// partners the internal workbook" lesson; the June 2026 "Destination
// City Scorecard" (45 cities, V/S/G/B/A scoring) is the PRE-DVA-1
// precursor system Jerry used before DVA-1 existed in its current form
// — retained here as D0 discovery-pipeline seed data, explicitly NOT
// treated as DVA-1 itself (DVA-1 superseded it with a 100-point scale
// in July).
//
// REVISED 2026-09-04 (Phase 2C Destination Architecture Correction):
// DVA-1, DVA-2, and DAP are NOT reproduced or replaced here. Their
// canonical instructions/methodology live in three dedicated, mature
// Claude Projects Jerry already runs. This file models the ORCHESTRATION
// CONTRACT around them (artifact references, gate thresholds/routing,
// cross-destination validation) — never a competing question set or
// scoring rubric.
//
// REVISED AGAIN 2026-09-04 (Phase 2G — real methodology ingestion): the
// three Claude Projects' actual, verbatim instructions are now ingested
// at agent-service/specialists/methodologies/destination/{dva1,dva2,dap}/v2.md
// (see methodologies/destination/INGESTION_LOG.md for provenance/hashes).
// This corrected two real conflicts with the Phase 2C reconstruction,
// which had been built from an Open Brain PARAPHRASE, not the source text:
//
//   1. DVA-1: "DVA-2 never starts automatically; Jerry must approve every
//      time" was the paraphrase's framing of what the real instructions
//      describe as a manual multi-Claude-Project workflow (see
//      dva1/v2.legacy-operator-instructions.md), NOT a substantive rule.
//      The real substantive gate is Section 13 ("Current-Strategy Fit") —
//      a destination can score Elite yet be explicitly later-stage/
//      strategically premature, and THAT is what should hold for Jerry,
//      not routine qualified progression. See evaluateDVA1Gate() below.
//
//   2. DVA-2: the paraphrase's GREEN/YELLOW/RED vocabulary does not exist
//      anywhere in the real instructions. The actual decision fields are
//      "Recommended priority" (4 values) and "Recommended Next Step" (3
//      values, Section 24) — see routeDVA2Recommendation() below and
//      dva2/v2.legacy-operator-instructions.md for the full correction
//      record.
//
// The DAP-takes-a-completed-DVA-2-as-input rule, the DVA-1 90/80/65 score
// thresholds, and the Willcox commercial-model/proposal-rules retrievals
// were all CONFIRMED (not contradicted) by the real ingested text — see
// each v2.legacy-operator-instructions.md for the full audit.

import { evaluateAuthority } from './standingAuthority'

export type DestinationHubStage =
  | 'D0_DISCOVERY'
  | 'D1_PRE_DVA_SCREENING'
  | 'D2_DVA1'
  | 'D3_DVA2'
  | 'D4_DAP'
  | 'D5_PIPELINE_STATE'
  | 'D6_STAKEHOLDER_RESEARCH'
  | 'D7_RELATIONSHIP_OUTREACH'
  | 'D8_QUALIFICATION_CONVERSATION'
  | 'D9_CONTENT_BUILD'
  | 'D10_PARTNER_FRIENDLY_REVIEW'
  | 'D11_VISUAL_ASSETS'
  | 'D12_PROPOSAL_PITCH'
  | 'D13_RELATIONSHIP_FOLLOWUP'
  | 'D14_CLOSE_AGREEMENT'
  | 'D15_HUB_ACTIVATION'
  | 'D16_LOCAL_BUSINESS_ACTIVATION'
  | 'D17_ONGOING_RELATIONSHIP'

export const DESTINATION_HUB_PLAYBOOK_KEY = 'destination_hub_lifecycle'
export const DESTINATION_HUB_SOURCE_TYPE = 'destination_hub_stage'

export const DESTINATION_HUB_STAGE_ORDER: readonly DestinationHubStage[] = [
  'D0_DISCOVERY',
  'D1_PRE_DVA_SCREENING',
  'D2_DVA1',
  'D3_DVA2',
  'D4_DAP',
  'D5_PIPELINE_STATE',
  'D6_STAKEHOLDER_RESEARCH',
  'D7_RELATIONSHIP_OUTREACH',
  'D8_QUALIFICATION_CONVERSATION',
  'D9_CONTENT_BUILD',
  'D10_PARTNER_FRIENDLY_REVIEW',
  'D11_VISUAL_ASSETS',
  'D12_PROPOSAL_PITCH',
  'D13_RELATIONSHIP_FOLLOWUP',
  'D14_CLOSE_AGREEMENT', // APPROVAL_REQUIRED — destination_hub.commercial_offer / partner_commitment
  'D15_HUB_ACTIVATION', // APPROVAL_REQUIRED — destination_hub.hub_activation
  'D16_LOCAL_BUSINESS_ACTIVATION', // hands off to the existing Business Photo Outreach playbook (Phase 2A)
  'D17_ONGOING_RELATIONSHIP',
]

export type PipelineState = 'READY' | 'WAITING' | 'WAVE_2' | 'HOLD' | 'DECLINE'

// ---------------------------------------------------------------------------
// D0 — Discovery. The June 2026 Destination City Scorecard (V/S/G/B/A,
// max 25) is retained as REAL precursor seed data — 45 cities already
// scored — not as DVA-1 itself.
// ---------------------------------------------------------------------------

export interface DiscoveryCandidate {
  name: string
  state: string
  /** RETRIEVED: the June 2026 precursor scorecard's dimensions, kept only as discovery-pipeline seed input, never as a DVA-1 substitute. */
  precursorScore?: { visitorDraw: number; seasonalBalance: number; discoveryGap: number; cityBudget: number; pitchAccess: number }
  manageableGeography: boolean
  stakeholderComplexity: 'LOW' | 'MEDIUM' | 'HIGH'
  tourismIdentity: boolean
  sufficientThingsToDo: boolean
  localBusinessDensity: 'LOW' | 'MEDIUM' | 'HIGH'
  compellingStoryFit: boolean
  likelyDecisionMakerAccessible: boolean
}

/**
 * D0's own screen — never discards a large/complex opportunity, per
 * explicit instruction; a HIGH-complexity candidate routes to WAVE_2
 * rather than being dropped.
 */
export function screenDiscoveryCandidate(candidate: DiscoveryCandidate): { pipelineState: PipelineState; reason: string } {
  if (!candidate.tourismIdentity || !candidate.sufficientThingsToDo) {
    return { pipelineState: 'DECLINE', reason: 'No real tourism identity or insufficient things to do — not a fit for CheckOff at all.' }
  }
  if (candidate.stakeholderComplexity === 'HIGH' || !candidate.manageableGeography) {
    return { pipelineState: 'WAVE_2', reason: 'Real opportunity, but geography/stakeholder complexity is too high for the current wave — keep in pipeline, do not discard.' }
  }
  if (!candidate.likelyDecisionMakerAccessible) {
    return { pipelineState: 'HOLD', reason: 'No accessible decision-maker path identified yet — hold until stakeholder research finds one.' }
  }
  return { pipelineState: 'READY', reason: 'Manageable geography, real tourism identity, accessible decision-maker — ready for pre-DVA screening.' }
}

// ---------------------------------------------------------------------------
// DVA-1 / DVA-2 / DAP — EXTERNAL SPECIALIST PROVIDERS, revised per the
// explicit Phase 2C correction (2026-09-04): these are NOT reproduced or
// replaced inside agent-service. Their canonical methodology lives in
// three dedicated Claude Projects Jerry already runs. Chief's job is
// narrow and entirely orchestration-shaped: initiate the right stage
// with the right input, receive the resulting artifact, record a
// reference to it, extract the structured decision fields Chief needs
// to route the playbook, validate the artifact belongs to the correct
// destination, enforce the gate, and decide the next stage. The
// question sets, scoring methodology, and analytical judgment stay
// entirely inside those Claude Projects — nothing here reproduces them.
//
// EXECUTOR GAP, stated plainly (per explicit instruction — represent
// this honestly rather than pretend it's automated): there is currently
// no programmatic way for agent-service to invoke a Claude Project and
// retrieve its output. Every DVA-1/DVA-2/DAP run today is Jerry (or
// Jerry + a Claude session) manually working in that Project and then
// handing the resulting artifact to Chief. The types/functions below
// model the CONTRACT for when/if that becomes invocable — they do not
// assume it already is. See destinationExecutorGap.ts for the explicit
// capability-gap record.
//
// RETRIEVED (Open Brain, 2026-07-12, Jerry's own words) — kept as the
// threshold/gate SEMANTICS only, never as a competing rubric: DVA-1 is a
// "fast screener... 5-10 minutes... score thresholds: 90-100 Elite,
// 80-89 Excellent, 65-79 Borderline/Jerry decision, below 65 Archive...
// DVA-2 never starts automatically; Jerry must explicitly approve moving
// forward in every case." DVA-2 is a "Deep Opportunity Analysis...
// conducted only after Jerry approves a strong DVA-1 candidate." DAP
// "takes a completed DVA-2 as its input."

/**
 * A reference to an artifact produced by an EXTERNAL system (one of the
 * three Claude Projects) — never the artifact's full content duplicated
 * here. `artifactRef` is whatever pointer the storage mechanism uses
 * (a file path, an Open Brain thought id, a URL — deliberately not
 * constrained further, since no concrete storage integration exists
 * yet). `contentHash` lets a later step prove it's reading the exact
 * artifact recorded, not a re-paste that drifted.
 */
export interface ExternalArtifactRef {
  provider: 'dva1_claude_project' | 'dva2_claude_project' | 'dap_claude_project'
  destinationId: string
  destinationName: string
  artifactRef: string
  executedAt: string // ISO timestamp
  contentHash: string | null
  /**
   * Phase 2H — a real live DVA-1 proof exposed that the structured
   * decision fields alone (score/currentStrategyFit, etc.) were being
   * treated as THE artifact, discarding the full methodology-defined
   * report (Executive Summary, Destination Snapshot, weighted
   * Opportunity Scorecard, Why People Visit, Regional Integration
   * Opportunity, Complexity Profile, Opportunities/Risks, etc.) the
   * methodology actually requires producing. Matches the principle
   * already established for DAP ("the full artifact remains the
   * authoritative source; structured fields are only an operational
   * projection") — now applied uniformly to DVA-1/DVA-2/DAP. Optional
   * (not every historical/synthetic artifact needs to carry it) but
   * every REAL execution should populate it.
   */
  fullReportMarkdown?: string
}

export type DVA1Tier = 'ELITE' | 'EXCELLENT' | 'BORDERLINE' | 'ARCHIVE'

/**
 * Section 13 of the real DVA-1 instructions (methodologies/destination/
 * dva1/v2.md) — a classification SEPARATE from the numeric score. A
 * destination can score Elite (90-100) and still be
 * STRONG_BUT_LATER_STAGE: CheckOff is deliberately targeting smaller
 * weekend destinations for its first ~20-25 Hubs, so a large/complex/
 * distant/enterprise-level opportunity is real but operationally
 * premature today. This is the actual substantive gate the Phase 2C
 * "Jerry must always approve" paraphrase was standing in for — see
 * dva1/v2.legacy-operator-instructions.md for the full correction.
 */
export type CurrentStrategyFit = 'FITS_CURRENT_STRATEGY' | 'STRONG_BUT_LATER_STAGE' | 'WEAK_STRATEGIC_FIT'

/**
 * Structured fields Chief EXTRACTS from the DVA-1 markdown artifact —
 * Chief never computes `score`; it is read off the artifact the DVA-1
 * Claude Project produced.
 */
export interface DVA1Artifact extends ExternalArtifactRef {
  provider: 'dva1_claude_project'
  score: number
  recommendationText: string
  /** Section 13 — required. Never inferred from `score`; the methodology treats these as genuinely independent dimensions. */
  currentStrategyFit: CurrentStrategyFit
}

/** Gate semantics only (the 4 threshold bands are retrieved, exact — DVA-1 v2.md's own "Calculate" section, unchanged by ingestion) — not a scoring methodology. Chief interprets a score DVA-1 already produced; it never derives one. */
export function classifyDVA1Score(score: number): DVA1Tier {
  if (score >= 90) return 'ELITE'
  if (score >= 80) return 'EXCELLENT'
  if (score >= 65) return 'BORDERLINE'
  return 'ARCHIVE'
}

/**
 * REVISED (Phase 2G — real methodology): Jerry approval is required ONLY
 * when the destination is a qualified score tier but the methodology
 * itself flags it STRONG_BUT_LATER_STAGE — that is a genuine founder
 * timing/sequencing judgment call, not a routine hand-off. A
 * WEAK_STRATEGIC_FIT destination is routinely archived (no Jerry needed,
 * nothing to decide). A FITS_CURRENT_STRATEGY destination at a
 * qualifying score tier advances to DVA-2 automatically — "routine
 * qualified progression should not require Jerry just to move a file to
 * the next stage."
 */
export function dva1RequiresJerryApproval(artifact: DVA1Artifact): boolean {
  const tier = classifyDVA1Score(artifact.score)
  const qualifies = tier === 'ELITE' || tier === 'EXCELLENT' || tier === 'BORDERLINE'
  return qualifies && artifact.currentStrategyFit === 'STRONG_BUT_LATER_STAGE'
}

export interface DVA1GateDecision {
  tier: DVA1Tier
  currentStrategyFit: CurrentStrategyFit
  proposeDva2: boolean
  /** True only for the genuine founder-judgment case (qualified score + STRONG_BUT_LATER_STAGE). False for routine auto-advance AND for routine archive — see dva1RequiresJerryApproval's own doc. */
  requiresJerry: boolean
  reason: string
}

/**
 * Chief's own gate decision after receiving a DVA-1 artifact. Per the
 * real ingested methodology (not the Phase 2C paraphrase): a qualifying
 * score (Borderline or better) AND FITS_CURRENT_STRATEGY auto-advances to
 * DVA-2 without Jerry. The SAME qualifying score with
 * STRONG_BUT_LATER_STAGE holds for Jerry's judgment instead of advancing.
 * WEAK_STRATEGIC_FIT or a below-threshold (Archive) score routinely does
 * not propose DVA-2, and needs no Jerry decision either.
 */
export function evaluateDVA1Gate(artifact: DVA1Artifact): DVA1GateDecision {
  const tier = classifyDVA1Score(artifact.score)
  const qualifies = tier === 'ELITE' || tier === 'EXCELLENT' || tier === 'BORDERLINE'
  const fit = artifact.currentStrategyFit
  const requiresJerry = dva1RequiresJerryApproval(artifact)
  const proposeDva2 = qualifies && fit !== 'WEAK_STRATEGIC_FIT' && !requiresJerry

  let reason: string
  if (!qualifies) {
    reason = `Score ${artifact.score} (${tier}) — below the DVA-2 threshold, not proposed.`
  } else if (fit === 'WEAK_STRATEGIC_FIT') {
    reason = `Score ${artifact.score} (${tier}) qualifies, but Current-Strategy Fit is WEAK — archived, not proposed.`
  } else if (fit === 'STRONG_BUT_LATER_STAGE') {
    reason = `Score ${artifact.score} (${tier}) qualifies and Current-Strategy Fit is real, but this is explicitly a later-stage opportunity — holding for Jerry's timing/sequencing judgment rather than advancing automatically.`
  } else {
    reason = `Score ${artifact.score} (${tier}) qualifies and fits the current expansion strategy — routine progression, advancing to DVA-2 automatically.`
  }

  return { tier, currentStrategyFit: fit, proposeDva2, requiresJerry, reason }
}

// ---------------------------------------------------------------------------
// DVA-2 — Deep Opportunity Analysis. REVISED (Phase 2G): the real
// ingested methodology (methodologies/destination/dva2/v2.md) defines NO
// GREEN/YELLOW/RED vocabulary anywhere. Its actual decision fields are
// Section 23's "Recommended priority" (4 values) and Section 24's
// "Recommended Next Step" (3 values) — the latter is what Chief routes
// on, since it's the rubric's own explicit DAP hand-off instruction. See
// dva2/v2.legacy-operator-instructions.md for the full correction record.
// ---------------------------------------------------------------------------

/** Section 23 — "Recommended priority." */
export type DVA2RecommendedPriority = 'HIGH_PRIORITY_CREATE_DAP' | 'VIABLE_CREATE_DAP_WHEN_CAPACITY_ALLOWS' | 'PROMISING_BUT_PREMATURE_MONITOR' | 'DO_NOT_PURSUE_CURRENTLY'

/** Section 24 (DAP Handoff) — "Recommended Next Step." The field Chief actually gates on. */
export type DVA2RecommendedNextStep = 'BUILD_DAP_NOW' | 'HOLD_DAP_UNTIL_ISSUE_RESOLVED' | 'STOP_PURSUIT'

/** Section 23 — "Is this worth actively pursuing?" */
export type DVA2WorthPursuing = 'YES' | 'MAYBE' | 'NO'

export interface DVA2Artifact extends ExternalArtifactRef {
  provider: 'dva2_claude_project'
  worthPursuing: DVA2WorthPursuing
  recommendedPriority: DVA2RecommendedPriority
  recommendedNextStep: DVA2RecommendedNextStep
  rationale: string
  knownRisks: string[]
  /** Section 24 — "Questions DAP Must Resolve or Sequence Around," when `recommendedNextStep` is HOLD_DAP_UNTIL_ISSUE_RESOLVED. */
  evidenceGaps?: string[]
  /** Which DVA-1 artifact this DVA-2 run consumed — checked by validateDva2Input. */
  consumedDva1ArtifactRef: string
}

/**
 * HARD VALIDATION (explicit instruction): a DVA-2 artifact must consume
 * the DVA-1 artifact for the SAME destination — never allow Destination
 * A's DVA-1 to feed Destination B's DVA-2, and never accept a DVA-2 that
 * claims to have consumed a DVA-1 artifactRef that isn't the one Chief
 * actually has on file for this destination.
 */
export function validateDva2Input(dva1: DVA1Artifact, dva2: DVA2Artifact): { valid: boolean; reason: string } {
  if (dva1.destinationId !== dva2.destinationId) {
    return { valid: false, reason: `Destination mismatch: DVA-1 is for ${dva1.destinationId} (${dva1.destinationName}), DVA-2 claims ${dva2.destinationId} (${dva2.destinationName}).` }
  }
  if (dva1.artifactRef !== dva2.consumedDva1ArtifactRef) {
    return { valid: false, reason: `DVA-2 consumed a different DVA-1 artifact (${dva2.consumedDva1ArtifactRef}) than the one on file for this destination (${dva1.artifactRef}).` }
  }
  return { valid: true, reason: 'DVA-2 correctly consumed this destination\'s own DVA-1 artifact.' }
}

export interface DVA2GateDecision {
  pipelineState: PipelineState
  requiresJerry: boolean
  reason: string
}

/**
 * Routes on `recommendedNextStep` — the rubric's own explicit hand-off
 * field (Section 24), not a re-derived judgment.
 *
 * BUILD_DAP_NOW -> routine qualified progression, auto-advances to DAP
 * (same "do not require Jerry just to move a file to the next stage"
 * principle as DVA-1->DVA-2; destination_hub.draft_dap is already AUTO
 * in standingAuthority.ts).
 *
 * HOLD_DAP_UNTIL_ISSUE_RESOLVED -> if the artifact names evidence gaps
 * (Section 24's "Questions DAP Must Resolve"), more research first, not
 * necessarily Jerry; with no further gaps named, it needs Jerry's
 * judgment call.
 *
 * STOP_PURSUIT -> HOLD, never DECLINE — "do not permanently discard
 * potentially useful future destinations merely because timing is wrong
 * today" still holds; this is routine, no Jerry needed.
 */
export function routeDVA2Recommendation(artifact: DVA2Artifact): DVA2GateDecision {
  if (artifact.recommendedNextStep === 'BUILD_DAP_NOW') {
    return { pipelineState: 'READY', requiresJerry: false, reason: 'Recommended Next Step: Build DAP now — routine qualified progression, advancing to DAP automatically.' }
  }
  if (artifact.recommendedNextStep === 'HOLD_DAP_UNTIL_ISSUE_RESOLVED') {
    const gaps = artifact.evidenceGaps ?? []
    if (gaps.length > 0) {
      return { pipelineState: 'WAITING', requiresJerry: false, reason: `Hold until issue resolved — ${gaps.length} question(s) DAP must resolve first, research needed before Jerry review: ${gaps.join(', ')}` }
    }
    return { pipelineState: 'WAITING', requiresJerry: true, reason: 'Hold until issue resolved, with no further evidence gaps identified — needs Jerry\'s judgment call.' }
  }
  // STOP_PURSUIT
  return { pipelineState: 'HOLD', requiresJerry: false, reason: 'Recommended Next Step: Stop pursuit — held (never permanently discarded); routine, no Jerry decision needed.' }
}

// ---------------------------------------------------------------------------
// DAP — Destination Action Plan. Commercial + relationship deep dive.
// ---------------------------------------------------------------------------

/**
 * Section 21 ("RIGHT NOW") of the real DAP instructions
 * (methodologies/destination/dap/v2.md) — the single most operationally
 * important field in the whole artifact, by the rubric's own explicit
 * design ("Only ONE task should appear here... the purpose is to make
 * the next work session obvious"). Not present in the Phase 2D
 * gate-semantics-only placeholder; added by the Phase 2G ingestion.
 */
export interface DAPRightNowTask {
  currentStage: string
  currentGoal: string
  highestPriorityTask: string
  targetDate: string
  estimatedTime: string
  expectedResult: string
  whyItMatters: string
}

export interface DAPExtractedFields {
  recommendedChampion: string | null
  secondaryChampions: string[]
  decisionMakers: string[]
  stakeholderOrganizations: string[]
  fundingBudgetClues: string[]
  likelyBuyer: string | null
  estimatedSalesDifficulty: 'LOW' | 'MEDIUM' | 'HIGH' | null
  timingConsiderations: string[]
  politicalStakeholderComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | null
  objectionsHurdles: string[]
  destinationPainPoints: string[]
  checkoffValueProposition: string | null
  recommendedEntryStrategy: string | null
  relationshipSequence: string[]
  recommendedOfferDirection: string | null
  /** Section 21 — required. See DAPRightNowTask's own doc. */
  rightNowTask: DAPRightNowTask
}

export interface DAPArtifact extends ExternalArtifactRef {
  provider: 'dap_claude_project'
  extracted: DAPExtractedFields
  /** Which DVA-2 artifact this DAP run consumed — checked by validateDapInput, same discipline as DVA-2/DVA-1. */
  consumedDva2ArtifactRef: string
}

/** HARD VALIDATION, same shape as validateDva2Input — DAP must belong to the same destination and consume THIS destination's own DVA-2 artifact. */
export function validateDapInput(dva2: DVA2Artifact, dap: DAPArtifact): { valid: boolean; reason: string } {
  if (dva2.destinationId !== dap.destinationId) {
    return { valid: false, reason: `Destination mismatch: DVA-2 is for ${dva2.destinationId} (${dva2.destinationName}), DAP claims ${dap.destinationId} (${dap.destinationName}).` }
  }
  if (dva2.artifactRef !== dap.consumedDva2ArtifactRef) {
    return { valid: false, reason: `DAP consumed a different DVA-2 artifact (${dap.consumedDva2ArtifactRef}) than the one on file for this destination (${dva2.artifactRef}).` }
  }
  return { valid: true, reason: 'DAP correctly consumed this destination\'s own DVA-2 artifact.' }
}

/** RETRIEVED: DAP takes a completed DVA-2 as its input — never started independently. Gated on the real "Recommended Next Step" field (Section 24), not the old GREEN paraphrase. */
export function dapEntryConditionMet(dva2: DVA2Artifact): boolean {
  return dva2.recommendedNextStep === 'BUILD_DAP_NOW'
}

// ---------------------------------------------------------------------------
// D9 — Content build. RETRIEVED requirement (explicit in this task, and
// consistent with Willcox's own real content — birding/agritourism/wine
// trail already exist alongside businesses): destination content is
// NOT limited to commercial businesses.
// ---------------------------------------------------------------------------

export interface DestinationContentInventory {
  places: number
  businesses: number
  trails: number
  parks: number
  photoOps: number
  landmarks: number
  uniqueExperiences: number
}

export function contentInventoryIsCommercialOnly(inv: DestinationContentInventory): boolean {
  const nonCommercial = inv.places + inv.trails + inv.parks + inv.photoOps + inv.landmarks + inv.uniqueExperiences
  return nonCommercial === 0 && inv.businesses > 0
}

// ---------------------------------------------------------------------------
// D10 — Partner-friendly review (RETRIEVED lesson, restated from the
// Willcox thoughts: never hand a local partner the giant internal
// research workbook — same principle already proven in the 140-business
// outreach workbook's Email Ready/Web Follow-up split).
// ---------------------------------------------------------------------------

export interface PartnerReviewRow {
  name: string
  include: boolean
  verifiedBy: string | null
  comment: string | null
}

export function buildPartnerFriendlyReview(internalRows: PartnerReviewRow[]): PartnerReviewRow[] {
  // The pared-down artifact IS just this shape — the discipline is in
  // never exposing the internal research workbook's other columns
  // (source URLs, scoring notes, pricing math, competitor analysis),
  // not in any additional transformation here.
  return internalRows.map((r) => ({ name: r.name, include: r.include, verifiedBy: r.verifiedBy, comment: r.comment }))
}

// ---------------------------------------------------------------------------
// D12 — Proposal / pitch (RETRIEVED, Willcox 2026-08-08 thoughts):
// state the Champion price once near the beginning, explain optional
// Partner initiatives in detail later, never explain cancellation
// consequences in customer-facing copy, never claim "already live"
// before signature.
// ---------------------------------------------------------------------------

export interface DestinationOffer {
  championPriceUsd: number
  partnerInitiatives: Array<{ name: string; priceUsd: number }>
  /** RETRIEVED constraint: must never appear in proposal copy. */
  forbiddenPhrases: readonly string[]
}

export const WILLCOX_RETRIEVED_OFFER_PATTERN: DestinationOffer = Object.freeze({
  championPriceUsd: 5200,
  partnerInitiatives: [{ name: 'Destination Partner initiative', priceUsd: 1000 }],
  forbiddenPhrases: Object.freeze([
    'if the chamber does not renew',
    'lists disappear',
    'already live', // forbidden pre-signature
  ]),
})

export function proposalViolatesRetrievedRules(proposalText: string, offer: DestinationOffer = WILLCOX_RETRIEVED_OFFER_PATTERN): string[] {
  const lower = proposalText.toLowerCase()
  return offer.forbiddenPhrases.filter((phrase) => lower.includes(phrase))
}

/**
 * The real Founder pricing model (DVA-2 v2.md Section 17, restated in
 * DAP v2.md Section 2) surfaced by the Phase 2G ingestion — refines,
 * does not contradict, WILLCOX_RETRIEVED_OFFER_PATTERN above. IMPORTANT:
 * the renewal benefit is a PERCENTAGE discount against the then-current
 * standard price, never a permanently frozen dollar amount — the
 * methodology is explicit about this distinction.
 */
export const FOUNDER_PRICING_MODEL = Object.freeze({
  year1DiscountPct: 0.35,
  renewalDiscountPct: 0.25,
  renewalConditionedOn: 'continuously active Founding Partner' as const,
  note: 'Percentage discount against the applicable standard price at the time — never a frozen dollar amount, even if standard pricing later changes.',
})

export function founderYear1Price(standardChampionPriceUsd: number): number {
  return Math.round(standardChampionPriceUsd * (1 - FOUNDER_PRICING_MODEL.year1DiscountPct))
}

export function founderRenewalPrice(currentStandardChampionPriceUsd: number): number {
  return Math.round(currentStandardChampionPriceUsd * (1 - FOUNDER_PRICING_MODEL.renewalDiscountPct))
}

// ---------------------------------------------------------------------------
// Evidence gap -> research loop (spec section 13's "Example Destination
// loop": discovery -> DVA-1 -> evidence gap -> research -> DVA-2 ->
// stakeholder uncertainty -> research -> DAP).
// ---------------------------------------------------------------------------

export type DestinationLoopAction = 'RESEARCH_NEEDED' | 'PROCEED'

export function deriveDestinationLoopAction(stage: DestinationHubStage, missingEvidenceKeys: string[]): { action: DestinationLoopAction; note: string } {
  if (missingEvidenceKeys.length > 0) {
    return { action: 'RESEARCH_NEEDED', note: `${stage}: missing evidence (${missingEvidenceKeys.join(', ')}) — research before proceeding, do not guess.` }
  }
  return { action: 'PROCEED', note: `${stage}: evidence complete.` }
}

export function coarseStatusForStage(stage: DestinationHubStage): 'READY' | 'IN_PROGRESS' | 'WAITING' | 'NEEDS_JERRY' | 'DONE' {
  if (stage === 'D0_DISCOVERY') return 'READY'
  // D2_DVA1's real coarse status depends on the received artifact
  // (evaluateDVA1Gate's requiresJerry — only true for a qualified score
  // paired with STRONG_BUT_LATER_STAGE, per the Phase 2G ingestion) and
  // can no longer be determined from the stage name alone; this
  // stage-only helper falls through to the general IN_PROGRESS case.
  if (stage === 'D14_CLOSE_AGREEMENT' || stage === 'D15_HUB_ACTIVATION') return 'NEEDS_JERRY'
  if (stage === 'D13_RELATIONSHIP_FOLLOWUP' || stage === 'D7_RELATIONSHIP_OUTREACH') return 'WAITING'
  if (stage === 'D16_LOCAL_BUSINESS_ACTIVATION') return 'WAITING' // hands off to Business Photo Outreach
  if (stage === 'D17_ONGOING_RELATIONSHIP') return 'DONE'
  return 'IN_PROGRESS'
}

export function verifyAuthorityCoverage(): void {
  for (const op of [
    'destination_hub.research',
    'destination_hub.dva1_screen',
    'destination_hub.draft_dva2',
    'destination_hub.draft_dap',
    'destination_hub.build_internal_artifact',
    'destination_hub.stakeholder_research',
    'destination_hub.content_inventory',
    'destination_hub.public_launch',
    'destination_hub.commercial_offer',
    'destination_hub.pricing_change',
    'destination_hub.partner_commitment',
    'destination_hub.relationship_sensitive_communication',
    'destination_hub.hub_activation',
  ]) {
    evaluateAuthority(op)
  }
}
