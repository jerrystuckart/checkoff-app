// Chief Phase 2B — the Photo Moderation playbook. Pure logic only (no
// I/O) — see photoModerationEngine.ts for the DB-touching half (same
// split as businessPhotoOutreach.ts/businessPhotoOutreachEngine.ts).
//
// REUSES the existing moderation system entirely — this file never
// mutates item_cover_candidates itself; every actual state change routes
// through agent-service/coverCandidateModeration.ts's already-reviewed
// operations (approveCandidate/rejectCandidate/markCoverEligible/
// addToRotation/removeFromRotation/setPrimaryImage/listItemImagePool).
// This module only decides WHAT to recommend and WHEN to escalate.
//
// HONEST LIMITATION, BY DESIGN: nothing in this codebase performs real
// image-content analysis (see lib/coverModeration/moderationAdapter.js's
// own doc: "no real content-safety/quality vendor is integrated
// anywhere in this project"). Chief therefore cannot itself determine
// whether a photo is safe/relevant/truthful/sharp by looking at pixels
// — it assesses every dimension it CAN determine from structured,
// queryable evidence (moderation_metadata's basic sanity check, whether
// the item's rotation pool is empty, secret-item status) and is
// explicit, per-dimension, about which ones are UNKNOWN and therefore
// Jerry's to judge from the actual photo in the decision packet.
// Candidate SOURCE (community vs. business_submission) is recorded and
// shown to Jerry but never used to rank one over the other — there is no
// product policy today that a business-submitted photo outranks or
// replaces a community one (business photos are valuable/trusted
// candidates, community photos can be excellent too, ordinary featured
// businesses do not control the primary image, Jerry currently chooses
// primary). A future paying Partner may eventually get explicit
// primary-image control — that is not implemented policy today, and
// this module must not anticipate it. This is the same "deterministic
// evidence only, never guessed" discipline already used throughout
// reconciliationRules.ts — never invented here, extended to a new
// domain. Section 11's "future authority readiness" is exactly this: if
// a real vision check is ever added, it only needs to fill in
// the safety/relevance/truthfulness/visualQuality verdicts below with
// real values — the recommendation/escalation logic does not change.

import { evaluateAuthority } from './standingAuthority'

export type PhotoModerationStage = 'NEW_CANDIDATE' | 'GATHER_CONTEXT' | 'ASSESS' | 'NEEDS_JERRY' | 'APPLY_DECISION' | 'COMPLETE' | 'BLOCKED' | 'NEEDS_MORE_CONTEXT'

export const PHOTO_MODERATION_SOURCE_TYPE = 'item_cover_candidate'
export const PHOTO_MODERATION_PLAYBOOK_KEY = 'photo_moderation'

// ---------------------------------------------------------------------------
// Context (GATHER_CONTEXT's output — the ONLY input ASSESS reads)
// ---------------------------------------------------------------------------

export interface PoolEntry {
  id: string
  source: 'community' | 'business_submission'
  isPrimary: boolean
  displayWeight: number
}

export interface PhotoCandidateContext {
  candidateId: string
  itemId: string
  itemBody: string
  venueName: string | null
  metroName: string | null
  source: 'community' | 'business_submission'
  status: string
  submittedAt: string
  /** From item_cover_candidates.moderation_metadata — the one real structured signal that exists today (basic sanity, not true quality). */
  passesBasicSanity: boolean | null
  malformed: boolean
  isSecretItem: boolean
  activeCoverCandidateId: string | null
  pool: PoolEntry[]
}

// ---------------------------------------------------------------------------
// Assessment (pure, deterministic, never mutates)
// ---------------------------------------------------------------------------

export type Verdict = 'PASS' | 'FAIL' | 'UNKNOWN'

export interface AssessmentDimension {
  verdict: Verdict
  reason: string
}

export type ModerationRecommendation = 'REJECT' | 'APPROVE_ONLY' | 'ADD_TO_ROTATION' | 'SET_PRIMARY' | 'NEEDS_JERRY_CONTEXT'

export interface PhotoAssessment {
  safety: AssessmentDimension
  relevance: AssessmentDimension
  truthfulness: AssessmentDimension
  visualQuality: AssessmentDimension
  coverWorthiness: AssessmentDimension
  recommendation: ModerationRecommendation
  /** One concise line, per the decision-packet format — never long prose. */
  why: string
  /** Deliberately coarse today (no real confidence scoring exists) — see section 11: kept as a distinct field so a future real assessment can populate it without changing this shape. */
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
}

const UNKNOWN_VISUAL = (dimension: string): AssessmentDimension => ({
  verdict: 'UNKNOWN',
  reason: `No automated ${dimension} check exists — Jerry judges this from the actual photo.`,
})

/**
 * Never mutates anything — pure function of context only. Called during
 * ASSESS; the caller (photoModerationEngine.ts) is responsible for never
 * calling this from within a write transaction or treating its result as
 * anything but a recommendation.
 */
export function assessCandidate(context: PhotoCandidateContext): PhotoAssessment {
  // Safety/visual quality: the ONLY dimension with a real structured
  // signal today is the malformed-upload sanity check.
  const safety: AssessmentDimension = context.malformed
    ? { verdict: 'FAIL', reason: 'Failed the automated malformed-upload check.' }
    : { verdict: 'UNKNOWN', reason: 'No automated safety/content check exists — Jerry judges this from the actual photo.' }
  const visualQuality: AssessmentDimension = context.malformed
    ? { verdict: 'FAIL', reason: 'Failed the automated malformed-upload check (zero/invalid dimensions or byte size).' }
    : UNKNOWN_VISUAL('sharpness/composition')
  const relevance = UNKNOWN_VISUAL('subject-matching')
  const truthfulness = UNKNOWN_VISUAL('truthfulness')

  // COVER-WORTHINESS — deliberately does NOT consider source
  // (community vs. business_submission) at all. There is no product
  // policy today that a business-submitted photo outranks or replaces a
  // community one: business photos are valuable/trusted candidates,
  // community photos can be excellent too, ordinary featured businesses
  // do not control the primary image, and Jerry currently chooses
  // primary. (A future paying Partner may eventually get explicit
  // primary-image control — that is not implemented policy today, and
  // this function must not anticipate it.) The only non-visual
  // structural signal available is whether the item has ANY image in
  // rotation yet at all.
  const existingPrimary = context.pool.find((p) => p.isPrimary) ?? null
  let coverWorthiness: AssessmentDimension
  if (context.pool.length === 0) {
    coverWorthiness = { verdict: 'PASS', reason: 'Item currently has no images in its rotation pool at all.' }
  } else if (existingPrimary?.id === context.candidateId) {
    coverWorthiness = { verdict: 'PASS', reason: 'This candidate is already the primary.' }
  } else {
    coverWorthiness = {
      verdict: 'UNKNOWN',
      reason: 'This item already has at least one image — whether to add/rotate/replace requires visual judgment Chief cannot supply. No source-priority policy exists today.',
    }
  }

  // Secret items never get an ordinary recommendation — escalate, full stop.
  if (context.isSecretItem) {
    return {
      safety,
      relevance,
      truthfulness,
      visualQuality,
      coverWorthiness,
      recommendation: 'NEEDS_JERRY_CONTEXT',
      why: 'Secret/spoiler item — Chief does not process this through the ordinary cover workflow. Needs Jerry.',
      confidence: 'HIGH',
    }
  }

  if (safety.verdict === 'FAIL') {
    return {
      safety,
      relevance,
      truthfulness,
      visualQuality,
      coverWorthiness,
      recommendation: 'REJECT',
      why: 'Failed the automated malformed-upload check — recommend reject.',
      confidence: 'HIGH',
    }
  }

  // No real image-content analysis exists anywhere in this codebase, so
  // structural metadata alone must never produce a confident SET_PRIMARY
  // recommendation — that requires either real visual assessment or an
  // explicit human/business-control policy, neither of which exists
  // today. Chief's role here is narrow: flag the one case supported by
  // genuine non-visual evidence (the item has zero images at all, so
  // adding this one to rotation is a structural improvement regardless
  // of whether it eventually becomes primary), and defer everything else
  // to Jerry rather than guess.
  let recommendation: ModerationRecommendation
  let why: string
  if (context.pool.length === 0) {
    recommendation = 'ADD_TO_ROTATION'
    why = 'Item currently has no images in rotation — if the photo checks out, recommend adding it to rotation. Primary selection still needs Jerry\'s visual judgment.'
  } else {
    recommendation = 'NEEDS_JERRY_CONTEXT'
    why = 'An image already exists for this item — Jerry should judge visually whether to add/rotate/replace. No automated basis to recommend further.'
  }

  return { safety, relevance, truthfulness, visualQuality, coverWorthiness, recommendation, why, confidence: 'MEDIUM' }
}

// ---------------------------------------------------------------------------
// Jerry decision packet — concise, per the spec's own example format.
// ---------------------------------------------------------------------------

export interface DecisionPacket {
  candidateId: string
  itemId: string
  venueName: string | null
  thing: string
  source: 'community' | 'business_submission'
  currentCoverCandidateId: string | null
  recommendation: ModerationRecommendation
  why: string
  lines: string[]
}

export function buildDecisionPacket(context: PhotoCandidateContext, assessment: PhotoAssessment): DecisionPacket {
  const lines = [
    `Business/place: ${context.venueName ?? '(no venue name on file)'}`,
    `Thing: ${context.itemBody}`,
    `Source: ${context.source}`,
    `Current cover: ${context.activeCoverCandidateId ?? '(none)'}`,
    `Recommendation: ${assessment.recommendation.replace(/_/g, ' ')}`,
    assessment.why,
  ]
  return {
    candidateId: context.candidateId,
    itemId: context.itemId,
    venueName: context.venueName,
    thing: context.itemBody,
    source: context.source,
    currentCoverCandidateId: context.activeCoverCandidateId,
    recommendation: assessment.recommendation,
    why: assessment.why,
    lines,
  }
}

// ---------------------------------------------------------------------------
// Jerry's decision -> which reusable moderation operation to call. This
// mapping is the ONLY place a decision string is translated into an
// operation — never duplicated, never inline elsewhere.
// ---------------------------------------------------------------------------

export type JerryPhotoDecision = 'approve' | 'reject' | 'add_to_rotation' | 'remove_from_rotation' | 'set_primary'

const DECISION_AUTHORITY_OPERATION: Record<JerryPhotoDecision, string> = {
  approve: 'photo_moderation.approve',
  reject: 'photo_moderation.reject',
  add_to_rotation: 'photo_moderation.add_to_rotation',
  remove_from_rotation: 'photo_moderation.remove_from_rotation',
  set_primary: 'photo_moderation.set_primary',
}

/** Throws if the decision has no standing-authority entry — never silently allowed. */
export function verifyDecisionAuthority(decision: JerryPhotoDecision): void {
  evaluateAuthority(DECISION_AUTHORITY_OPERATION[decision])
}

export function coarseStatusForStage(stage: PhotoModerationStage): 'READY' | 'IN_PROGRESS' | 'WAITING' | 'BLOCKED' | 'NEEDS_JERRY' | 'DONE' {
  switch (stage) {
    case 'NEW_CANDIDATE':
      return 'READY'
    case 'GATHER_CONTEXT':
    case 'ASSESS':
    case 'APPLY_DECISION':
      return 'IN_PROGRESS'
    case 'NEEDS_JERRY':
      return 'NEEDS_JERRY'
    case 'NEEDS_MORE_CONTEXT':
      return 'WAITING'
    case 'BLOCKED':
      return 'BLOCKED'
    case 'COMPLETE':
      return 'DONE'
  }
}
