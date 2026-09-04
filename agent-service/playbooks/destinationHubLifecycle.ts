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
// scoring rubric. See the DVA-1/DVA-2/DAP section below for exactly what
// is retrieved-and-kept (gate semantics) vs. what stays entirely
// external (the actual analysis). See destinationExecutorGap.ts for the
// explicit, honest statement of what Chief cannot yet do (invoke a
// Claude Project programmatically) rather than pretending this is
// automated end-to-end.

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
}

export type DVA1Tier = 'ELITE' | 'EXCELLENT' | 'BORDERLINE' | 'ARCHIVE'

/**
 * Structured fields Chief EXTRACTS from the DVA-1 markdown artifact —
 * Chief never computes `score`; it is read off the artifact the DVA-1
 * Claude Project produced.
 */
export interface DVA1Artifact extends ExternalArtifactRef {
  provider: 'dva1_claude_project'
  score: number
  recommendationText: string
}

/** Gate semantics only (the 4 threshold bands are retrieved, exact) — not a scoring methodology. Chief interprets a score DVA-1 already produced; it never derives one. */
export function classifyDVA1Score(score: number): DVA1Tier {
  if (score >= 90) return 'ELITE'
  if (score >= 80) return 'EXCELLENT'
  if (score >= 65) return 'BORDERLINE'
  return 'ARCHIVE'
}

/**
 * RETRIEVED, exact: "DVA-2 never starts automatically; Jerry must
 * explicitly approve moving forward in every case" — zero exceptions,
 * including for an ELITE score. Chief may only PROPOSE progression.
 */
export function dva1RequiresJerryApproval(_artifact: DVA1Artifact): true {
  void _artifact
  return true
}

export interface DVA1GateDecision {
  tier: DVA1Tier
  proposeDva2: boolean
  reason: string
}

/** Chief's own gate decision after receiving a DVA-1 artifact — always requires Jerry before DVA-2 actually starts, regardless of tier. */
export function evaluateDVA1Gate(artifact: DVA1Artifact): DVA1GateDecision {
  const tier = classifyDVA1Score(artifact.score)
  const proposeDva2 = tier === 'ELITE' || tier === 'EXCELLENT' || tier === 'BORDERLINE'
  return {
    tier,
    proposeDva2,
    reason: proposeDva2
      ? `Score ${artifact.score} (${tier}) meets the threshold to propose DVA-2 — Jerry must still explicitly approve before it starts.`
      : `Score ${artifact.score} (${tier}) — below threshold, DVA-2 not proposed.`,
  }
}

// ---------------------------------------------------------------------------
// DVA-2 — Deep Opportunity Analysis. GREEN/YELLOW/RED is the retrieved
// output shape; Chief routes on it, never re-derives it.
// ---------------------------------------------------------------------------

export type DVA2Recommendation = 'GREEN' | 'YELLOW' | 'RED'

export interface DVA2Artifact extends ExternalArtifactRef {
  provider: 'dva2_claude_project'
  recommendation: DVA2Recommendation
  rationale: string
  knownRisks: string[]
  /** Only meaningful when recommendation is RED — which disposition the artifact's own analysis actually supports. Chief never invents this; absence defaults to the safest, most reversible option (see routeDVA2Recommendation). */
  suggestedDisposition?: 'HOLD' | 'WAVE_2' | 'DECLINE'
  /** Set by DVA-2 (or by Chief when the artifact leaves something unclear) when more research is needed before a YELLOW can resolve. */
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
 * GREEN -> eligible to advance toward DAP (still requires Jerry per the
 * DVA-2->DAP handoff, same "never auto-advance" discipline as DVA-1).
 * YELLOW -> if the artifact names evidence gaps, more research first
 * (not necessarily Jerry); once gaps are resolved (or none were named),
 * Jerry reviews. RED -> route by the artifact's OWN suggested
 * disposition; absent that, default to HOLD (the safest, reversible
 * choice) rather than ever auto-DECLINE — "do not permanently discard
 * potentially useful future destinations merely because timing is wrong
 * today."
 */
export function routeDVA2Recommendation(artifact: DVA2Artifact): DVA2GateDecision {
  if (artifact.recommendation === 'GREEN') {
    return { pipelineState: 'READY', requiresJerry: true, reason: 'GREEN — eligible to advance toward DAP; Jerry must still approve the DAP handoff.' }
  }
  if (artifact.recommendation === 'YELLOW') {
    const gaps = artifact.evidenceGaps ?? []
    if (gaps.length > 0) {
      return { pipelineState: 'WAITING', requiresJerry: false, reason: `YELLOW with ${gaps.length} evidence gap(s) — more research needed before Jerry review: ${gaps.join(', ')}` }
    }
    return { pipelineState: 'WAITING', requiresJerry: true, reason: 'YELLOW with no further evidence gaps identified — needs Jerry\'s judgment call.' }
  }
  // RED
  const disposition = artifact.suggestedDisposition ?? 'HOLD'
  if (disposition === 'DECLINE' && !artifact.suggestedDisposition) {
    // unreachable given the ?? above, kept as a defensive statement of intent
  }
  return {
    pipelineState: disposition,
    requiresJerry: disposition === 'DECLINE',
    reason: `RED — ${artifact.suggestedDisposition ? `artifact-supported disposition: ${disposition}` : `no disposition stated in the artifact; defaulting to the safest, reversible option (HOLD) rather than discarding`}.`,
  }
}

// ---------------------------------------------------------------------------
// DAP — Destination Action Plan. Commercial + relationship deep dive.
// ---------------------------------------------------------------------------

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

/** RETRIEVED: DAP takes a completed DVA-2 as its input — never started independently. */
export function dapEntryConditionMet(dva2: DVA2Artifact): boolean {
  return dva2.recommendation === 'GREEN'
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
  if (stage === 'D2_DVA1') return 'NEEDS_JERRY' // DVA-2 never auto-starts — retrieved, exact rule
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
