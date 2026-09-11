// agent-service/playbooks/metroFinisherReport.ts
//
// Chief Phase 3C — the Metro Finisher Deep Research stage (Phase A). This
// module defines the report shape the METRO_FINISHER_DEEP_RESEARCH AI
// specialist produces, plus the pure validation/parsing helpers that
// accept (or reject) a raw AI-returned object as a real MetroFinisherReport.
//
// SCOPE DISCIPLINE (do not lose this while reading the rest of the file):
// this report is RESEARCH AND RECOMMENDATION ONLY. Nothing in this module
// creates a production item, a list, or a neighborhood. Every candidate
// named here (mustHaveMissingExperiences, enrichmentCandidates, any
// themed-list "missingExperiences") must still flow through the full
// existing certification pipeline — certifyLateAddItem(), Places
// verification, canonical neighborhood assignment, category/tag/metadata
// certification, duplicate review, venue-quoting and distinctiveness
// gates — before it can ever become a real item. See
// metroFinisherIntegration.ts for the deterministic (no-AI) step that
// turns an accepted report into bounded work packets, never items.
//
// This module is pure — no I/O, no AI calls. It is deliberately generic:
// it must never hardcode a specific metro's neighborhoods, themes,
// category counts, or venue names (Florence is a regression TEST CASE
// for the surrounding pipeline, never a constant baked into this module).

import type { StagingGateResult } from './metroCatalog'
import type { VenueCluster } from './venueDuplicateDetection'

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface GapFinding {
  area: string
  evidence: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  recommendation: string
}

export interface ResearchFinding {
  title: string
  description: string
  sourceNote: string
}

export interface CandidateFinding {
  candidateName: string
  venueName: string
  category: string
  neighborhoodName: string | null
  rationale: string
  distinctivenessNote: string
}

export interface NeighborhoodSplitProposal {
  parentNeighborhood: string
  proposedChildren: string[]
  rationale: string
  /** Never empty — a split with no affected existing items is a validation failure (see validateMetroFinisherReport): a floating new label must never leave existing items stranded under the old parent. */
  affectedExistingItemIds: string[]
}

export interface NeighborhoodAddProposal {
  name: string
  rationale: string
}

export interface NeighborhoodProposal {
  name: string
  reason: string
}

export type DuplicateConcernVerdict = 'DISTINCT' | 'MERGE_RECOMMENDED' | 'NEEDS_HUMAN_REVIEW'

export interface DuplicateConcern {
  venueName: string
  placeId: string | null
  itemIds: string[]
  verdict: DuplicateConcernVerdict
  rationale: string
}

export type ThemedListRecommendation = 'CREATE_NOW' | 'ENRICH_THEN_CREATE' | 'DO_NOT_CREATE'

export interface ThemedListOpportunity {
  title: string
  rationale: string
  existingItemIds: string[]
  missingExperiences: CandidateFinding[]
  strengthScore: number
  recommendation: ThemedListRecommendation
}

export interface MetroFinisherReport {
  metro: string
  generatedAt: string
  catalogAssessment: {
    currentItemCount: number
    strengths: string[]
    weaknesses: string[]
    categoryGaps: GapFinding[]
    neighborhoodGaps: GapFinding[]
  }
  cityIdentity: {
    signatureFoodAndDrink: ResearchFinding[]
    ritualsAndTraditions: ResearchFinding[]
    artisanAndMakerCulture: ResearchFinding[]
    localOnlyExperiences: ResearchFinding[]
    unusualOrHidden: ResearchFinding[]
    sportsAndCivicCulture: ResearchFinding[]
  }
  mustHaveMissingExperiences: CandidateFinding[]
  enrichmentCandidates: CandidateFinding[]
  neighborhoodRecommendations: {
    keep: string[]
    split: NeighborhoodSplitProposal[]
    add: NeighborhoodAddProposal[]
    reject: NeighborhoodProposal[]
  }
  themedListOpportunities: ThemedListOpportunity[]
  duplicateOrIdentityConcerns: DuplicateConcern[]
  finalAssessment: {
    readyToFinish: boolean
    recommendedAdditionalItemRange: { min: number; max: number }
    highestPriorityNextActions: string[]
  }
}

// ---------------------------------------------------------------------------
// Budget/stopping rules — enforced here, not just documented in a prompt.
// ---------------------------------------------------------------------------

/** Combined cap on mustHaveMissingExperiences + enrichmentCandidates — bounds how much follow-up work one Finisher run can generate. */
export const MAX_CANDIDATE_LEADS = 60
export const MIN_CANDIDATE_LEADS_WARNING_THRESHOLD = 0 // no floor — zero leads is a legitimate finding for a genuinely complete catalog.

export interface MetroFinisherReportValidationResult {
  ok: boolean
  /** The report, truncated to the candidate cap when necessary — always returned when ok is true. */
  report: MetroFinisherReport | null
  errors: string[]
  /** Non-fatal notes, e.g. "truncated candidate leads from 74 to 60". */
  warnings: string[]
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function isSeverity(v: unknown): v is GapFinding['severity'] {
  return v === 'LOW' || v === 'MEDIUM' || v === 'HIGH'
}

function validateGapFinding(v: unknown, path: string, errors: string[]): GapFinding | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.area)) errors.push(`${path}.area: required non-empty string`)
  if (!isNonEmptyString(o.evidence)) errors.push(`${path}.evidence: required non-empty string`)
  if (!isSeverity(o.severity)) errors.push(`${path}.severity: must be LOW|MEDIUM|HIGH`)
  if (!isNonEmptyString(o.recommendation)) errors.push(`${path}.recommendation: required non-empty string`)
  return {
    area: isNonEmptyString(o.area) ? o.area : '',
    evidence: isNonEmptyString(o.evidence) ? o.evidence : '',
    severity: isSeverity(o.severity) ? o.severity : 'LOW',
    recommendation: isNonEmptyString(o.recommendation) ? o.recommendation : '',
  }
}

function validateResearchFinding(v: unknown, path: string, errors: string[]): ResearchFinding | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.title)) errors.push(`${path}.title: required non-empty string`)
  if (!isNonEmptyString(o.description)) errors.push(`${path}.description: required non-empty string`)
  // sourceNote may legitimately be a brief/general note rather than a URL — only required to be present.
  if (typeof o.sourceNote !== 'string') errors.push(`${path}.sourceNote: required string`)
  return {
    title: isNonEmptyString(o.title) ? o.title : '',
    description: isNonEmptyString(o.description) ? o.description : '',
    sourceNote: typeof o.sourceNote === 'string' ? o.sourceNote : '',
  }
}

/**
 * Never mangles international names/aliases — this is a structural
 * pass-through (no normalization, no ASCII-folding, no language
 * assumptions). A metro/venue name written with local-language
 * characters or an alias in parentheses must survive unchanged; the
 * only requirement is "present and non-empty", exactly like any other
 * required string field.
 */
function validateCandidateFinding(v: unknown, path: string, errors: string[]): CandidateFinding | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.candidateName)) errors.push(`${path}.candidateName: required non-empty string`)
  if (!isNonEmptyString(o.venueName)) errors.push(`${path}.venueName: required non-empty string`)
  if (!isNonEmptyString(o.category)) errors.push(`${path}.category: required non-empty string`)
  if (o.neighborhoodName !== null && !isNonEmptyString(o.neighborhoodName)) errors.push(`${path}.neighborhoodName: must be a non-empty string or null`)
  if (!isNonEmptyString(o.rationale)) errors.push(`${path}.rationale: required non-empty string`)
  if (!isNonEmptyString(o.distinctivenessNote)) errors.push(`${path}.distinctivenessNote: required non-empty string`)
  return {
    candidateName: isNonEmptyString(o.candidateName) ? o.candidateName : '',
    venueName: isNonEmptyString(o.venueName) ? o.venueName : '',
    category: isNonEmptyString(o.category) ? o.category : '',
    neighborhoodName: isNonEmptyString(o.neighborhoodName) ? o.neighborhoodName : null,
    rationale: isNonEmptyString(o.rationale) ? o.rationale : '',
    distinctivenessNote: isNonEmptyString(o.distinctivenessNote) ? o.distinctivenessNote : '',
  }
}

function validateNeighborhoodSplitProposal(v: unknown, path: string, errors: string[]): NeighborhoodSplitProposal | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.parentNeighborhood)) errors.push(`${path}.parentNeighborhood: required non-empty string`)
  const proposedChildren = asStringArray(o.proposedChildren)
  if (proposedChildren.length === 0) errors.push(`${path}.proposedChildren: required non-empty array`)
  if (!isNonEmptyString(o.rationale)) errors.push(`${path}.rationale: required non-empty string`)
  const affectedExistingItemIds = asStringArray(o.affectedExistingItemIds)
  // The hard rule (task spec): a split proposal must never leave existing
  // items floating under a new label with nothing tying them to it.
  if (affectedExistingItemIds.length === 0) {
    errors.push(`${path}.affectedExistingItemIds: must be non-empty — a neighborhood split may never leave existing items unaccounted for.`)
  }
  return {
    parentNeighborhood: isNonEmptyString(o.parentNeighborhood) ? o.parentNeighborhood : '',
    proposedChildren,
    rationale: isNonEmptyString(o.rationale) ? o.rationale : '',
    affectedExistingItemIds,
  }
}

function validateNeighborhoodAddProposal(v: unknown, path: string, errors: string[]): NeighborhoodAddProposal | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.name)) errors.push(`${path}.name: required non-empty string`)
  if (!isNonEmptyString(o.rationale)) errors.push(`${path}.rationale: required non-empty string`)
  return { name: isNonEmptyString(o.name) ? o.name : '', rationale: isNonEmptyString(o.rationale) ? o.rationale : '' }
}

function validateNeighborhoodProposal(v: unknown, path: string, errors: string[]): NeighborhoodProposal | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.name)) errors.push(`${path}.name: required non-empty string`)
  if (!isNonEmptyString(o.reason)) errors.push(`${path}.reason: required non-empty string`)
  return { name: isNonEmptyString(o.name) ? o.name : '', reason: isNonEmptyString(o.reason) ? o.reason : '' }
}

function isDuplicateVerdict(v: unknown): v is DuplicateConcernVerdict {
  return v === 'DISTINCT' || v === 'MERGE_RECOMMENDED' || v === 'NEEDS_HUMAN_REVIEW'
}

function validateDuplicateConcern(v: unknown, path: string, errors: string[]): DuplicateConcern | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.venueName)) errors.push(`${path}.venueName: required non-empty string`)
  if (o.placeId !== null && !isNonEmptyString(o.placeId)) errors.push(`${path}.placeId: must be a non-empty string or null`)
  const itemIds = asStringArray(o.itemIds)
  if (itemIds.length === 0) errors.push(`${path}.itemIds: required non-empty array`)
  if (!isDuplicateVerdict(o.verdict)) errors.push(`${path}.verdict: must be DISTINCT|MERGE_RECOMMENDED|NEEDS_HUMAN_REVIEW`)
  if (!isNonEmptyString(o.rationale)) errors.push(`${path}.rationale: required non-empty string`)
  return {
    venueName: isNonEmptyString(o.venueName) ? o.venueName : '',
    placeId: isNonEmptyString(o.placeId) ? o.placeId : null,
    itemIds,
    verdict: isDuplicateVerdict(o.verdict) ? o.verdict : 'NEEDS_HUMAN_REVIEW',
    rationale: isNonEmptyString(o.rationale) ? o.rationale : '',
  }
}

function isThemedListRecommendation(v: unknown): v is ThemedListRecommendation {
  return v === 'CREATE_NOW' || v === 'ENRICH_THEN_CREATE' || v === 'DO_NOT_CREATE'
}

function validateThemedListOpportunity(v: unknown, path: string, errors: string[], candidateBudget: { remaining: number }, warnings: string[]): ThemedListOpportunity | null {
  if (typeof v !== 'object' || v === null) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const o = v as Record<string, unknown>
  // Deliberately NO allowlist of theme titles here — any novel, city-specific
  // title must pass through untouched (see task's "no hardcoded theme list").
  if (!isNonEmptyString(o.title)) errors.push(`${path}.title: required non-empty string`)
  if (!isNonEmptyString(o.rationale)) errors.push(`${path}.rationale: required non-empty string`)
  const existingItemIds = asStringArray(o.existingItemIds)
  const rawMissing = Array.isArray(o.missingExperiences) ? o.missingExperiences : []
  const missingExperiences: CandidateFinding[] = []
  rawMissing.forEach((m, i) => {
    const finding = validateCandidateFinding(m, `${path}.missingExperiences[${i}]`, errors)
    if (finding) missingExperiences.push(finding)
  })
  const strengthScore = typeof o.strengthScore === 'number' && Number.isFinite(o.strengthScore) ? o.strengthScore : NaN
  if (Number.isNaN(strengthScore)) errors.push(`${path}.strengthScore: required finite number`)
  if (!isThemedListRecommendation(o.recommendation)) errors.push(`${path}.recommendation: must be CREATE_NOW|ENRICH_THEN_CREATE|DO_NOT_CREATE`)
  if (o.recommendation === 'ENRICH_THEN_CREATE' && missingExperiences.length === 0) {
    warnings.push(`${path}: recommendation is ENRICH_THEN_CREATE but missingExperiences is empty — the integration stage cannot produce an enrichment work item without at least one named gap.`)
  }
  return {
    title: isNonEmptyString(o.title) ? o.title : '',
    rationale: isNonEmptyString(o.rationale) ? o.rationale : '',
    existingItemIds,
    missingExperiences,
    strengthScore: Number.isNaN(strengthScore) ? 0 : strengthScore,
    recommendation: isThemedListRecommendation(o.recommendation) ? o.recommendation : 'DO_NOT_CREATE',
  }
}

/**
 * Parses and validates a raw, untrusted AI-returned object into a real
 * MetroFinisherReport. Never a silent best-effort guess: every structural
 * problem is collected into `errors` and `ok` is false when any exist.
 * Truncates mustHaveMissingExperiences + enrichmentCandidates (combined)
 * to MAX_CANDIDATE_LEADS when the model returns more — a real enforcement
 * of the bounded-candidate-cap rule, not just a prompt instruction.
 */
export function validateMetroFinisherReport(raw: unknown): MetroFinisherReportValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, report: null, errors: ['report: expected an object'], warnings }
  }
  const o = raw as Record<string, unknown>

  if (!isNonEmptyString(o.metro)) errors.push('metro: required non-empty string')
  if (!isNonEmptyString(o.generatedAt)) errors.push('generatedAt: required non-empty string')

  const ca = (typeof o.catalogAssessment === 'object' && o.catalogAssessment !== null ? o.catalogAssessment : {}) as Record<string, unknown>
  const currentItemCount = typeof ca.currentItemCount === 'number' && Number.isFinite(ca.currentItemCount) ? ca.currentItemCount : NaN
  if (Number.isNaN(currentItemCount)) errors.push('catalogAssessment.currentItemCount: required finite number')
  const categoryGaps = (Array.isArray(ca.categoryGaps) ? ca.categoryGaps : []).map((g, i) => validateGapFinding(g, `catalogAssessment.categoryGaps[${i}]`, errors)).filter((g): g is GapFinding => g !== null)
  const neighborhoodGaps = (Array.isArray(ca.neighborhoodGaps) ? ca.neighborhoodGaps : []).map((g, i) => validateGapFinding(g, `catalogAssessment.neighborhoodGaps[${i}]`, errors)).filter((g): g is GapFinding => g !== null)

  const ci = (typeof o.cityIdentity === 'object' && o.cityIdentity !== null ? o.cityIdentity : {}) as Record<string, unknown>
  const findingsList = (key: string): ResearchFinding[] =>
    (Array.isArray(ci[key]) ? (ci[key] as unknown[]) : []).map((f, i) => validateResearchFinding(f, `cityIdentity.${key}[${i}]`, errors)).filter((f): f is ResearchFinding => f !== null)

  const rawMustHave = Array.isArray(o.mustHaveMissingExperiences) ? o.mustHaveMissingExperiences : []
  const rawEnrichment = Array.isArray(o.enrichmentCandidates) ? o.enrichmentCandidates : []
  let mustHaveMissingExperiences: CandidateFinding[] = rawMustHave.map((c, i) => validateCandidateFinding(c, `mustHaveMissingExperiences[${i}]`, errors)).filter((c): c is CandidateFinding => c !== null)
  let enrichmentCandidates: CandidateFinding[] = rawEnrichment.map((c, i) => validateCandidateFinding(c, `enrichmentCandidates[${i}]`, errors)).filter((c): c is CandidateFinding => c !== null)

  const totalLeads = mustHaveMissingExperiences.length + enrichmentCandidates.length
  if (totalLeads > MAX_CANDIDATE_LEADS) {
    // Truncate deterministically: keep mustHaveMissingExperiences first
    // (higher-priority per the report's own semantics), then fill the
    // remaining budget from enrichmentCandidates.
    const keptMustHave = mustHaveMissingExperiences.slice(0, MAX_CANDIDATE_LEADS)
    const remaining = MAX_CANDIDATE_LEADS - keptMustHave.length
    const keptEnrichment = enrichmentCandidates.slice(0, Math.max(0, remaining))
    warnings.push(`Candidate leads truncated from ${totalLeads} to ${MAX_CANDIDATE_LEADS} (mustHaveMissingExperiences: ${mustHaveMissingExperiences.length}->${keptMustHave.length}, enrichmentCandidates: ${enrichmentCandidates.length}->${keptEnrichment.length}).`)
    mustHaveMissingExperiences = keptMustHave
    enrichmentCandidates = keptEnrichment
  }

  const nr = (typeof o.neighborhoodRecommendations === 'object' && o.neighborhoodRecommendations !== null ? o.neighborhoodRecommendations : {}) as Record<string, unknown>
  const keep = asStringArray(nr.keep)
  const split = (Array.isArray(nr.split) ? nr.split : []).map((s, i) => validateNeighborhoodSplitProposal(s, `neighborhoodRecommendations.split[${i}]`, errors)).filter((s): s is NeighborhoodSplitProposal => s !== null)
  const add = (Array.isArray(nr.add) ? nr.add : []).map((a, i) => validateNeighborhoodAddProposal(a, `neighborhoodRecommendations.add[${i}]`, errors)).filter((a): a is NeighborhoodAddProposal => a !== null)
  const reject = (Array.isArray(nr.reject) ? nr.reject : []).map((r, i) => validateNeighborhoodProposal(r, `neighborhoodRecommendations.reject[${i}]`, errors)).filter((r): r is NeighborhoodProposal => r !== null)

  const candidateBudget = { remaining: MAX_CANDIDATE_LEADS }
  const themedListOpportunities = (Array.isArray(o.themedListOpportunities) ? o.themedListOpportunities : [])
    .map((t, i) => validateThemedListOpportunity(t, `themedListOpportunities[${i}]`, errors, candidateBudget, warnings))
    .filter((t): t is ThemedListOpportunity => t !== null)

  const duplicateOrIdentityConcerns = (Array.isArray(o.duplicateOrIdentityConcerns) ? o.duplicateOrIdentityConcerns : [])
    .map((d, i) => validateDuplicateConcern(d, `duplicateOrIdentityConcerns[${i}]`, errors))
    .filter((d): d is DuplicateConcern => d !== null)

  const fa = (typeof o.finalAssessment === 'object' && o.finalAssessment !== null ? o.finalAssessment : {}) as Record<string, unknown>
  if (typeof fa.readyToFinish !== 'boolean') errors.push('finalAssessment.readyToFinish: required boolean')
  const range = (typeof fa.recommendedAdditionalItemRange === 'object' && fa.recommendedAdditionalItemRange !== null ? fa.recommendedAdditionalItemRange : {}) as Record<string, unknown>
  const min = typeof range.min === 'number' && Number.isFinite(range.min) ? range.min : NaN
  const max = typeof range.max === 'number' && Number.isFinite(range.max) ? range.max : NaN
  if (Number.isNaN(min)) errors.push('finalAssessment.recommendedAdditionalItemRange.min: required finite number')
  if (Number.isNaN(max)) errors.push('finalAssessment.recommendedAdditionalItemRange.max: required finite number')
  const highestPriorityNextActions = asStringArray(fa.highestPriorityNextActions)
  if (!isNonEmptyString(fa.highestPriorityNextActions) && highestPriorityNextActions.length === 0 && fa.readyToFinish === false) {
    warnings.push('finalAssessment.highestPriorityNextActions is empty while readyToFinish is false — a not-ready verdict should usually name at least one next action.')
  }

  if (errors.length > 0) {
    return { ok: false, report: null, errors, warnings }
  }

  const report: MetroFinisherReport = {
    metro: isNonEmptyString(o.metro) ? o.metro : '',
    generatedAt: isNonEmptyString(o.generatedAt) ? o.generatedAt : '',
    catalogAssessment: {
      currentItemCount,
      strengths: asStringArray(ca.strengths),
      weaknesses: asStringArray(ca.weaknesses),
      categoryGaps,
      neighborhoodGaps,
    },
    cityIdentity: {
      signatureFoodAndDrink: findingsList('signatureFoodAndDrink'),
      ritualsAndTraditions: findingsList('ritualsAndTraditions'),
      artisanAndMakerCulture: findingsList('artisanAndMakerCulture'),
      localOnlyExperiences: findingsList('localOnlyExperiences'),
      unusualOrHidden: findingsList('unusualOrHidden'),
      sportsAndCivicCulture: findingsList('sportsAndCivicCulture'),
    },
    mustHaveMissingExperiences,
    enrichmentCandidates,
    neighborhoodRecommendations: { keep, split, add, reject },
    themedListOpportunities,
    duplicateOrIdentityConcerns,
    finalAssessment: {
      readyToFinish: fa.readyToFinish === true,
      recommendedAdditionalItemRange: { min: Number.isNaN(min) ? 0 : min, max: Number.isNaN(max) ? 0 : max },
      highestPriorityNextActions,
    },
  }

  return { ok: true, report, errors: [], warnings }
}

// ---------------------------------------------------------------------------
// "Don't gate readiness on item count alone" — a real, testable helper, not
// just prose. mission is "have gaps been explored," not "did we hit N
// items." A report is flagged when its ONLY signal for readyToFinish:false
// is a raw item-count target: every category/neighborhood gap list is
// empty, there are no must-have missing experiences, and the only content
// in highestPriorityNextActions reads like a bare count target (e.g. "get
// to 150 items") rather than naming an actual explored gap.
// ---------------------------------------------------------------------------

const BARE_COUNT_TARGET_PATTERN = /\b(reach|get to|hit|add)\b.{0,40}\b\d+\b.{0,20}\bitems?\b/i

export interface ReadinessCountOnlyCheckResult {
  /** true when the report's not-ready verdict appears to rest on a raw item-count target alone, with no explored-gap evidence behind it — this is a FAILURE of the "explored gaps, not just counted items" mission. */
  flaggedAsCountOnly: boolean
  reason: string
}

/**
 * Real, testable enforcement of the stopping-rule mission: "have gaps been
 * explored," never "did we hit N items." Only ever flags a report whose
 * `finalAssessment.readyToFinish` is false — a true/ready report has
 * nothing to flag here.
 */
export function checkReadinessNotGatedOnCountAlone(report: MetroFinisherReport): ReadinessCountOnlyCheckResult {
  if (report.finalAssessment.readyToFinish) {
    return { flaggedAsCountOnly: false, reason: 'readyToFinish is true — no not-ready justification to evaluate.' }
  }

  const hasExploredGapEvidence =
    report.catalogAssessment.categoryGaps.length > 0 ||
    report.catalogAssessment.neighborhoodGaps.length > 0 ||
    report.mustHaveMissingExperiences.length > 0 ||
    report.duplicateOrIdentityConcerns.length > 0 ||
    report.neighborhoodRecommendations.split.length > 0 ||
    report.neighborhoodRecommendations.add.length > 0

  const actionsAreBareCountTargets =
    report.finalAssessment.highestPriorityNextActions.length > 0 && report.finalAssessment.highestPriorityNextActions.every((a) => BARE_COUNT_TARGET_PATTERN.test(a) && !hasExploredGapEvidence)

  if (!hasExploredGapEvidence && (report.finalAssessment.highestPriorityNextActions.length === 0 || actionsAreBareCountTargets)) {
    return {
      flaggedAsCountOnly: true,
      reason:
        'finalAssessment.readyToFinish is false, but the report names no category gap, neighborhood gap, must-have missing experience, duplicate concern, or neighborhood split/add proposal to justify it — the only content present is a bare item-count target, which this stage must never treat as sufficient justification on its own.',
    }
  }

  return { flaggedAsCountOnly: false, reason: 'Not-ready verdict is backed by at least one explored-gap finding.' }
}

// ---------------------------------------------------------------------------
// Aggregate gate — composes with the rest of this codebase's StagingGateResult
// convention, so the Finisher stage's own outcome can sit alongside every
// other gate in a report without inventing a parallel shape.
// ---------------------------------------------------------------------------

export function evaluateMetroFinisherReportGate(validation: MetroFinisherReportValidationResult): StagingGateResult {
  if (!validation.ok || !validation.report) {
    return { key: 'METRO_FINISHER_REPORT_GATE', verdict: 'FAIL', reason: `Metro Finisher report failed validation: ${validation.errors.join('; ')}` }
  }
  const countOnly = checkReadinessNotGatedOnCountAlone(validation.report)
  if (countOnly.flaggedAsCountOnly) {
    return { key: 'METRO_FINISHER_REPORT_GATE', verdict: 'FAIL', reason: countOnly.reason }
  }
  return { key: 'METRO_FINISHER_REPORT_GATE', verdict: 'PASS', reason: 'Metro Finisher report structurally valid and its readiness verdict (if not-ready) is backed by real explored-gap findings.' }
}

// Re-exported for callers that only need the cluster type name alongside
// this module's own types (e.g. metroFinisherIntegration.ts's duplicate
// packet construction reusing VenueCluster where it fits).
export type { VenueCluster }
