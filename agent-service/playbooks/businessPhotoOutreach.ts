// Chief Phase 2A — the Business Photo Outreach playbook. Pure logic only
// (no I/O) — see businessPhotoOutreachEngine.ts for the DB-touching half
// (mirrors the pure-rules/DB-wiring split used everywhere else in this
// codebase: reconciliationRules.ts/reconciliation.ts, chiefBriefRules.ts/
// chiefBrief.ts, auditRules.ts/audit.ts).
//
// Chosen because the whole workflow already exists end-to-end (outreach
// queue -> getcheckoff.com/confirm/<token> -> business response -> item
// confirmation/correction -> photo submission -> admin moderation ->
// rotation/primary selection -> cling request -> follow-up) and every
// step already has real, verified, structured evidence somewhere in the
// database — this playbook does not invent new evidence sources, it
// reads business_outreach_tokens / business_confirmation_submissions /
// item_cover_candidates (the exact tables verified end-to-end in the
// prior task) and agent.tasks/task_events for its own state.
//
// TWO BRANCHES:
//   businessPhotoOutreach — the ordinary flow, full item-confirmation +
//     photo + cling support.
//   secretBusinessOutreach — a business tied to a secret/spoiler item.
//     The business is NOT excluded from outreach; the SECRET CONTENT is
//     protected. No generic item-confirmation stage (that would either
//     ask the business to confirm/correct the literal spoiler text, or
//     silently skip confirmation — neither is offered); photo and cling
//     stages are unchanged (a venue/business photo does not reveal what
//     the secret checkoff actually is). Chief routes to this branch
//     purely from items.is_secret (structured data), never a guess.
//     This does not touch or weaken the DB-level Secret Item Protection
//     trigger from the prior release-candidate task — that trigger still
//     independently refuses any item_cover_candidates write for the
//     secret item's OWN checkoff photo; this playbook governs the
//     business's outreach *task* lifecycle, not photo eligibility.

import { evaluateAuthority } from './standingAuthority'
import type { PlaybookDefinition, PlaybookStageDefinition } from './types'

export const BUSINESS_PHOTO_OUTREACH_SOURCE_TYPE = 'business_outreach_token'

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type BusinessPhotoOutreachStage =
  | 'READY_FOR_OUTREACH'
  | 'SENT'
  | 'WAITING_FOR_BUSINESS'
  | 'RESPONSE_CLASSIFICATION'
  | 'ITEM_CONFIRMATION'
  | 'PHOTO_SUBMITTED'
  | 'PHOTO_REVIEW'
  | 'CLING_REQUEST'
  | 'FOLLOW_UP'
  | 'COMPLETE'

/** The secret-business branch — a genuine subset of the ordinary stages, never a superset. */
export type SecretBusinessOutreachStage = Extract<
  BusinessPhotoOutreachStage,
  'READY_FOR_OUTREACH' | 'SENT' | 'WAITING_FOR_BUSINESS' | 'PHOTO_SUBMITTED' | 'PHOTO_REVIEW' | 'CLING_REQUEST' | 'FOLLOW_UP' | 'COMPLETE'
>

const ORDINARY_STAGES: readonly PlaybookStageDefinition<BusinessPhotoOutreachStage>[] = [
  {
    stage: 'READY_FOR_OUTREACH',
    purpose: 'A valid, safe outreach path exists for this business/item — eligible to be sent.',
    expectedEvidence: ['valid business/contact', 'valid business_confirmation_url', 'non-secret-safe outreach path (or routed to the secret branch)'],
    authorityOperations: ['business_outreach.record_sent'],
  },
  {
    stage: 'SENT',
    purpose: 'Outreach was sent (or handed to the separate sending process) — recorded, not performed, by this playbook.',
    expectedEvidence: ['recipient', 'sent timestamp', 'subject/template version', 'confirmation URL'],
    authorityOperations: ['business_outreach.record_sent'],
  },
  {
    stage: 'WAITING_FOR_BUSINESS',
    purpose: 'Waiting on the business to respond via the confirmation page.',
    expectedEvidence: ['business_outreach_tokens.status'],
    authorityOperations: ['business_outreach.record_evidence'],
  },
  {
    stage: 'RESPONSE_CLASSIFICATION',
    purpose: 'A response arrived — classify it deterministically from structured submission data.',
    expectedEvidence: ['business_confirmation_submissions row'],
    authorityOperations: ['business_outreach.classify_response'],
  },
  {
    stage: 'ITEM_CONFIRMATION',
    purpose: 'Business confirmed the item as-is, or proposed a correction.',
    expectedEvidence: ['business_confirmation_submissions.item_confirmed', 'business_confirmation_submissions.proposed_correction'],
    requiresJerry: true, // corrections always escalate in Phase 2A — no standing authority to apply one automatically yet
    authorityOperations: ['business_outreach.record_item_confirmed', 'business_outreach.resolve_item_correction'],
  },
  {
    stage: 'PHOTO_SUBMITTED',
    purpose: 'A business photo landed in item_cover_candidates — connect it, do not act on it.',
    expectedEvidence: ['item_cover_candidates.id', 'source=business_submission', 'status'],
    authorityOperations: ['business_outreach.record_photo_submitted'],
  },
  {
    stage: 'PHOTO_REVIEW',
    purpose: 'Chief surfaces the candidate + a recommendation; Jerry approves/rejects/rotates/primaries.',
    expectedEvidence: ['candidate business/item summary', 'candidate source', 'current cover status'],
    requiresJerry: true,
    authorityOperations: ['business_outreach.recommend_photo_action', 'business_outreach.approve_reject_photo', 'business_outreach.select_primary_photo'],
  },
  {
    stage: 'CLING_REQUEST',
    purpose: 'A window cling was requested — record it and create/advance a fulfillment task.',
    expectedEvidence: ['cling_requested', 'mailing information', 'fulfillment task'],
    authorityOperations: ['business_outreach.create_cling_fulfillment_task'],
  },
  {
    stage: 'FOLLOW_UP',
    purpose: 'No response after the wait window — a follow-up step is queued, never auto-sent.',
    expectedEvidence: ['elapsed wait period', 'no submission'],
    authorityOperations: ['business_outreach.schedule_followup'],
  },
  {
    stage: 'COMPLETE',
    purpose: 'The applicable subset of (item confirmed/correction resolved, photo reviewed, cling fulfilled) is satisfied.',
    expectedEvidence: ['stage history'],
    isCompletion: true,
    authorityOperations: ['business_outreach.mark_complete'],
  },
]

const SECRET_STAGE_KEYS: readonly SecretBusinessOutreachStage[] = [
  'READY_FOR_OUTREACH',
  'SENT',
  'WAITING_FOR_BUSINESS',
  'PHOTO_SUBMITTED',
  'PHOTO_REVIEW',
  'CLING_REQUEST',
  'FOLLOW_UP',
  'COMPLETE',
]
const SECRET_STAGES: readonly PlaybookStageDefinition<SecretBusinessOutreachStage>[] = ORDINARY_STAGES.filter((s): s is PlaybookStageDefinition<SecretBusinessOutreachStage> =>
  (SECRET_STAGE_KEYS as readonly string[]).includes(s.stage)
)

export const BUSINESS_PHOTO_OUTREACH_PLAYBOOK: PlaybookDefinition<BusinessPhotoOutreachStage> = {
  key: 'business_photo_outreach',
  name: 'Business Photo Outreach',
  purpose: 'Turn a featured-business outreach contact into a confirmed item, a real photo, and/or a fulfilled cling request — with Jerry as the approver for anything public-facing or ambiguous.',
  entryConditions: ['a live business_outreach_tokens row exists', 'the row has a valid item_id and token', 'sending itself happens outside this playbook'],
  stages: ORDINARY_STAGES,
  successCriteria: [
    'item confirmed OR correction resolved by Jerry (if a correction was proposed)',
    'photo reviewed by Jerry (if one was submitted)',
    'cling fulfilled (if one was requested)',
    'no further action needed',
  ],
  escalationConditions: [
    'a correction was proposed (ITEM_CONFIRMATION)',
    'a photo is ready for approve/reject/rotation/primary decision (PHOTO_REVIEW)',
    'a monetization/partner question was raised (RESPONSE_CLASSIFICATION -> needs_human_interpretation)',
    'the response could not be deterministically classified',
  ],
  defaultOwnerKey: 'chief',
}

export const SECRET_BUSINESS_OUTREACH_PLAYBOOK: PlaybookDefinition<SecretBusinessOutreachStage> = {
  key: 'secret_business_outreach',
  name: 'Secret Business Outreach',
  purpose:
    'Contact a business tied to a secret/spoiler item without exposing the secret text — the business may still submit a venue/business photo, request a cling, or download the Featured Kit; there is no generic item-confirmation step for a secret item.',
  entryConditions: ['a live business_outreach_tokens row exists for a secret item (items.is_secret = true)', 'the DB-level Secret Item Protection trigger remains in force unchanged'],
  stages: SECRET_STAGES,
  successCriteria: ['photo reviewed by Jerry (if one was submitted)', 'cling fulfilled (if one was requested)', 'no further action needed'],
  escalationConditions: [
    'a photo is ready for approve/reject/rotation/primary decision (PHOTO_REVIEW)',
    'anything that would require exposing the secret item text (APPROVAL_REQUIRED — see standingAuthority.ts secret_item_exception)',
  ],
  defaultOwnerKey: 'chief',
}

// ---------------------------------------------------------------------------
// Evidence + classification (pure)
// ---------------------------------------------------------------------------

export interface BusinessOutreachTokenEvidence {
  tokenStatus: 'unopened' | 'opened' | 'submitted'
  openedAt: Date | null
  submittedAt: Date | null
  isSecretItem: boolean
}

export interface BusinessOutreachSubmissionEvidence {
  itemConfirmed: boolean | null
  correctionStatus: 'not_applicable' | 'pending_review' | 'applied' | 'rejected' | null
  proposedCorrection: string | null
  photoCandidateId: string | null
  clingRequested: boolean | null
}

export interface BusinessOutreachCandidateEvidence {
  id: string
  source: 'community' | 'business_submission'
  status: string
  displayEligible: boolean
  isPrimary: boolean
}

export interface BusinessOutreachEvidence {
  token: BusinessOutreachTokenEvidence
  submission: BusinessOutreachSubmissionEvidence | null
  candidate: BusinessOutreachCandidateEvidence | null
}

/**
 * Deterministic classification tags — a single real submission can carry
 * SEVERAL of these at once (confirmed the item AND submitted a photo AND
 * requested a cling, all in one page visit — the exact shape verified
 * live against the production endpoint). Never a single-value enum; a
 * caller that needs "the one thing to do next" uses deriveNextStage,
 * which resolves priority explicitly (see its own doc).
 */
export type ResponseClassification =
  | 'no_response'
  | 'confirmed'
  | 'correction_requested'
  | 'photo_submitted'
  | 'cling_requested'
  | 'declined'
  | 'needs_human_interpretation'
  | 'partner_monetization_question'

export function classifyResponse(evidence: BusinessOutreachEvidence): Set<ResponseClassification> {
  const tags = new Set<ResponseClassification>()
  const { submission } = evidence

  if (!submission) {
    tags.add('no_response')
    return tags
  }
  if (submission.itemConfirmed === true) tags.add('confirmed')
  if (submission.itemConfirmed === false && submission.correctionStatus === 'pending_review') tags.add('correction_requested')
  if (submission.photoCandidateId) tags.add('photo_submitted')
  if (submission.clingRequested === true) tags.add('cling_requested')

  // A submission with none of the above structured signals set (e.g. a
  // future free-text "question" field, not modeled yet) cannot be
  // deterministically classified — never guessed.
  if (tags.size === 0) tags.add('needs_human_interpretation')

  return tags
}

export function isSecretBranch(evidence: Pick<BusinessOutreachEvidence, 'token'>): boolean {
  return evidence.token.isSecretItem
}

// ---------------------------------------------------------------------------
// Stage advancement (pure)
// ---------------------------------------------------------------------------

export interface StageAdvanceResult {
  nextStage: BusinessPhotoOutreachStage
  /** True when this advance requires Jerry (mirrors the matched stage's own requiresJerry, computed here so callers never re-derive it from a stage lookup themselves). */
  requiresJerry: boolean
  reason: string
  classifications: Set<ResponseClassification>
}

/**
 * The single reducer this playbook's engine calls on every reconciliation
 * pass. Deliberately conservative: given ambiguous/multi-tag evidence, it
 * picks the HIGHEST-priority actionable item — correction > photo review
 * > cling > confirmed-only-complete — since a correction and a photo can
 * arrive in the same submission (verified live) and only one of them can
 * be "the next stage." The others are not lost: PHOTO_SUBMITTED/
 * CLING_REQUEST evidence stays queryable from the submission/candidate
 * rows themselves at any time, and COMPLETE is only reached once every
 * applicable branch (checked by isComplete, not this function alone) is
 * actually resolved.
 */
export function deriveNextStage(currentStage: BusinessPhotoOutreachStage, evidence: BusinessOutreachEvidence): StageAdvanceResult {
  const secret = isSecretBranch(evidence)
  const tags = classifyResponse(evidence)

  if (currentStage === 'READY_FOR_OUTREACH') {
    return { nextStage: 'READY_FOR_OUTREACH', requiresJerry: false, reason: 'Outreach not yet sent — no evidence-driven advance from this stage.', classifications: tags }
  }

  if (currentStage === 'SENT' || currentStage === 'WAITING_FOR_BUSINESS') {
    if (tags.has('no_response')) {
      return { nextStage: 'WAITING_FOR_BUSINESS', requiresJerry: false, reason: 'No submission yet.', classifications: tags }
    }
    return { nextStage: 'RESPONSE_CLASSIFICATION', requiresJerry: false, reason: 'A submission arrived — classify it.', classifications: tags }
  }

  if (currentStage === 'RESPONSE_CLASSIFICATION' || currentStage === 'FOLLOW_UP') {
    if (tags.has('needs_human_interpretation') || tags.has('partner_monetization_question')) {
      return { nextStage: 'ITEM_CONFIRMATION', requiresJerry: true, reason: 'Response could not be deterministically classified — needs Jerry.', classifications: tags }
    }
    if (!secret && tags.has('correction_requested')) {
      return { nextStage: 'ITEM_CONFIRMATION', requiresJerry: true, reason: 'Business proposed a correction — queued for Jerry review.', classifications: tags }
    }
    if (tags.has('photo_submitted')) {
      return { nextStage: 'PHOTO_SUBMITTED', requiresJerry: false, reason: 'A photo candidate was submitted — connect it.', classifications: tags }
    }
    if (tags.has('cling_requested')) {
      return { nextStage: 'CLING_REQUEST', requiresJerry: false, reason: 'A cling was requested — create the fulfillment task.', classifications: tags }
    }
    if (!secret && tags.has('confirmed')) {
      return { nextStage: 'COMPLETE', requiresJerry: false, reason: 'Item confirmed as-is, nothing else submitted — done.', classifications: tags }
    }
    return { nextStage: 'ITEM_CONFIRMATION', requiresJerry: true, reason: 'Ambiguous response — needs Jerry.', classifications: tags }
  }

  if (currentStage === 'ITEM_CONFIRMATION') {
    // Correction resolution is APPROVAL_REQUIRED (standingAuthority.ts) —
    // this playbook never auto-resolves a correction, so there is no
    // evidence-driven advance out of this stage. A human action elsewhere
    // (Jerry resolving the correction) is what moves the task forward;
    // that resolution is out of this reducer's scope by design.
    return { nextStage: 'ITEM_CONFIRMATION', requiresJerry: true, reason: 'Awaiting Jerry\'s resolution of the proposed correction.', classifications: tags }
  }

  if (currentStage === 'PHOTO_SUBMITTED') {
    if (evidence.candidate && (evidence.candidate.displayEligible || evidence.candidate.status === 'rejected')) {
      // Admin already acted (via the existing Cover Candidate moderation
      // UI) before Chief got to surface a recommendation — still route
      // through PHOTO_REVIEW so the outcome is recorded on this task's
      // own timeline, then fall through toward completion on the next pass.
      return { nextStage: 'PHOTO_REVIEW', requiresJerry: false, reason: 'Candidate already moderated — recording the outcome.', classifications: tags }
    }
    return { nextStage: 'PHOTO_REVIEW', requiresJerry: true, reason: 'Photo candidate ready for Jerry: approve/reject/rotation/primary.', classifications: tags }
  }

  if (currentStage === 'PHOTO_REVIEW') {
    if (evidence.candidate && (evidence.candidate.status === 'rejected' || evidence.candidate.displayEligible)) {
      if (!secret && tags.has('cling_requested')) {
        return { nextStage: 'CLING_REQUEST', requiresJerry: false, reason: 'Photo resolved; a cling was also requested.', classifications: tags }
      }
      return { nextStage: 'COMPLETE', requiresJerry: false, reason: 'Photo reviewed and resolved.', classifications: tags }
    }
    return { nextStage: 'PHOTO_REVIEW', requiresJerry: true, reason: 'Still awaiting Jerry\'s photo decision.', classifications: tags }
  }

  if (currentStage === 'CLING_REQUEST') {
    return { nextStage: 'COMPLETE', requiresJerry: false, reason: 'Cling fulfillment task created — cling stage resolved for this outreach task.', classifications: tags }
  }

  return { nextStage: 'COMPLETE', requiresJerry: false, reason: 'Already complete.', classifications: tags }
}

/** Coarse agent.tasks status this stage maps to — the ONLY function anything should consult for this mapping (never duplicate it inline). */
export function coarseStatusForStage(stage: BusinessPhotoOutreachStage): 'READY' | 'IN_PROGRESS' | 'WAITING' | 'NEEDS_JERRY' | 'DONE' {
  switch (stage) {
    case 'READY_FOR_OUTREACH':
      return 'READY'
    case 'SENT':
    case 'WAITING_FOR_BUSINESS':
    case 'FOLLOW_UP':
      return 'WAITING'
    case 'RESPONSE_CLASSIFICATION':
    case 'PHOTO_SUBMITTED':
    case 'CLING_REQUEST':
      return 'IN_PROGRESS'
    case 'ITEM_CONFIRMATION':
    case 'PHOTO_REVIEW':
      return 'NEEDS_JERRY'
    case 'COMPLETE':
      return 'DONE'
  }
}

/** Verifies every registered operation this playbook can perform actually has a standing-authority entry — throws at import/test time otherwise, not silently at runtime. */
export function verifyAuthorityCoverage(playbook: PlaybookDefinition<string>): void {
  for (const stage of playbook.stages) {
    for (const op of stage.authorityOperations) {
      evaluateAuthority(op) // throws UnknownAuthorityOperationError if missing
    }
  }
}
