// Chief Phase 2A — the DB-touching half of the Business Photo Outreach
// playbook. Mirrors the pure-rules/DB-wiring split used everywhere else
// in this codebase (reconciliationRules.ts/reconciliation.ts,
// chiefBriefRules.ts/chiefBrief.ts). Reuses the existing write surface
// (createTask, transitionTask, updateTaskPlan, recordPlaybookStage) and
// the existing reconciliation apply path — no new schema, no new engine.

import { query } from '../db'
import { createTask, transitionTask, updateTaskPlan, recordPlaybookStage } from '../mutations'
import { getAllTasks } from '../queries'
import type { TaskSummary } from '../types'
import {
  BUSINESS_PHOTO_OUTREACH_SOURCE_TYPE,
  BUSINESS_PHOTO_OUTREACH_PLAYBOOK,
  SECRET_BUSINESS_OUTREACH_PLAYBOOK,
  deriveNextStage,
  coarseStatusForStage,
  isSecretBranch,
  type BusinessPhotoOutreachStage,
  type BusinessOutreachEvidence,
} from './businessPhotoOutreach'
import { evaluateAuthority } from './standingAuthority'

const CHIEF_OWNER_KEY = 'chief'
const BUSINESS_PHOTO_OUTREACH_PROJECT_KEY = 'business_photo_campaign' // already live — see agent.projects audit, Phase 2A
const DEFAULT_FOLLOW_UP_WAIT_DAYS = 5

// ---------------------------------------------------------------------------
// Evidence reading (read-only)
// ---------------------------------------------------------------------------

interface TokenRow {
  status: 'unopened' | 'opened' | 'submitted'
  opened_at: string | null
  submitted_at: string | null
  item_id: string
  is_secret: boolean
}
interface SubmissionRow {
  item_confirmed: boolean | null
  correction_status: 'not_applicable' | 'pending_review' | 'applied' | 'rejected' | null
  proposed_correction: string | null
  photo_candidate_id: string | null
  cling_requested: boolean | null
}
interface CandidateRow {
  id: string
  source: 'community' | 'business_submission'
  status: string
  display_eligible: boolean
  is_primary: boolean
}

/**
 * Reads every structured signal this playbook can act on for one
 * outreach token (agent.tasks.source_ref). Read-only, safe to call any
 * number of times — same guarantee as reconciliationRules.ts's
 * ReconciliationReader.
 */
export async function readEvidence(tokenId: string): Promise<BusinessOutreachEvidence> {
  const tokenRows = await query<TokenRow>(
    `select t.status, t.opened_at, t.submitted_at, t.item_id, i.is_secret
     from public.business_outreach_tokens t
     join public.items i on i.id = t.item_id
     where t.id = $1`,
    [tokenId]
  )
  if (tokenRows.length === 0) throw new Error(`readEvidence: no business_outreach_tokens row for id ${tokenId}`)
  const t = tokenRows[0]

  const submissionRows = await query<SubmissionRow>(
    `select item_confirmed, correction_status, proposed_correction, photo_candidate_id, cling_requested
     from public.business_confirmation_submissions where token_id = $1
     order by submitted_at desc limit 1`,
    [tokenId]
  )
  const submission = submissionRows[0] ?? null

  let candidate: CandidateRow | null = null
  if (submission?.photo_candidate_id) {
    const candidateRows = await query<CandidateRow>(
      `select id, source, status, display_eligible, is_primary from public.item_cover_candidates where id = $1`,
      [submission.photo_candidate_id]
    )
    candidate = candidateRows[0] ?? null
  }

  return {
    token: { tokenStatus: t.status, openedAt: t.opened_at ? new Date(t.opened_at) : null, submittedAt: t.submitted_at ? new Date(t.submitted_at) : null, isSecretItem: t.is_secret },
    submission: submission
      ? {
          itemConfirmed: submission.item_confirmed,
          correctionStatus: submission.correction_status,
          proposedCorrection: submission.proposed_correction,
          photoCandidateId: submission.photo_candidate_id,
          clingRequested: submission.cling_requested,
        }
      : null,
    candidate: candidate
      ? { id: candidate.id, source: candidate.source, status: candidate.status, displayEligible: candidate.display_eligible, isPrimary: candidate.is_primary }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Seeding — one agent.tasks row per outreach token, idempotent via
// (source_type, source_ref) — createTask's existing DB-enforced identity.
// ---------------------------------------------------------------------------

export interface OutreachTokenSeed {
  tokenId: string
  businessName: string
  itemBody: string
  isSecretItem: boolean
}

export interface SeedResult {
  created: number
  alreadyExisted: number
}

/**
 * Idempotent: safe to call repeatedly with the same 140 rows (or a
 * superset) — createTask's ON CONFLICT (source_type, source_ref) DO
 * NOTHING means re-running this never creates duplicates, never
 * re-triggers CREATED events. Standing authority: operational.create_task
 * (AUTO).
 */
export async function seedBusinessPhotoOutreachTasks(rows: OutreachTokenSeed[]): Promise<SeedResult> {
  evaluateAuthority('operational.create_task')
  let created = 0
  let alreadyExisted = 0
  for (const row of rows) {
    const playbook = row.isSecretItem ? SECRET_BUSINESS_OUTREACH_PLAYBOOK : BUSINESS_PHOTO_OUTREACH_PLAYBOOK
    const result = await createTask({
      title: `${playbook.name}: ${row.businessName}`,
      projectKey: BUSINESS_PHOTO_OUTREACH_PROJECT_KEY,
      status: 'READY',
      changedByOwnerKey: CHIEF_OWNER_KEY,
      ownerKey: CHIEF_OWNER_KEY,
      description: row.itemBody,
      nextAction: row.isSecretItem
        ? 'Ready for secret-safe outreach (no generic item confirmation) — sending is handled separately.'
        : 'Ready for outreach — sending is handled separately.',
      sourceType: BUSINESS_PHOTO_OUTREACH_SOURCE_TYPE,
      sourceRef: row.tokenId,
    })
    if (result.created) created++
    else alreadyExisted++
  }
  return { created, alreadyExisted }
}

// ---------------------------------------------------------------------------
// Recording "sent" — a deterministic, structured recording of outreach
// having been sent (by the separate sending process), never the send
// itself. Standing authority: business_outreach.record_sent (AUTO).
// ---------------------------------------------------------------------------

export interface RecordSentInput {
  taskId: string
  tokenId: string
  recipient: string
  sentAt: Date
  templateVersion: string
  confirmationUrl: string
  followUpWaitDays?: number
}

export async function recordOutreachSent(input: RecordSentInput, task: TaskSummary): Promise<void> {
  evaluateAuthority('business_outreach.record_sent')
  if (task.status !== 'READY') {
    throw new Error(`recordOutreachSent: task ${input.taskId} is ${task.status}, expected READY`)
  }
  const followUpDue = new Date(input.sentAt.getTime() + (input.followUpWaitDays ?? DEFAULT_FOLLOW_UP_WAIT_DAYS) * 24 * 60 * 60 * 1000)

  await transitionTask({
    taskId: input.taskId,
    toStatus: 'WAITING',
    actorOwnerKey: CHIEF_OWNER_KEY,
    expectedUpdatedAt: task.updatedAt,
    nextAction: 'Waiting for the business to respond via the confirmation page.',
    nextCheckAt: followUpDue,
    note: `Outreach sent to ${input.recipient} (template ${input.templateVersion}).`,
    idempotencyKey: `business-outreach-sent:${input.tokenId}`,
    playbookStage: { playbookKey: BUSINESS_PHOTO_OUTREACH_PLAYBOOK.key, stage: 'SENT' satisfies BusinessPhotoOutreachStage },
  })

  await recordPlaybookStage({
    taskId: input.taskId,
    playbookKey: BUSINESS_PHOTO_OUTREACH_PLAYBOOK.key,
    stage: 'WAITING_FOR_BUSINESS' satisfies BusinessPhotoOutreachStage,
    actorOwnerKey: CHIEF_OWNER_KEY,
    evidence: { recipient: input.recipient, sentAt: input.sentAt.toISOString(), templateVersion: input.templateVersion, confirmationUrl: input.confirmationUrl },
    idempotencyKey: `business-outreach-waiting:${input.tokenId}`,
  })
}

// ---------------------------------------------------------------------------
// Reconciliation — the WAITING -> resume mechanism. Safe to run
// repeatedly (idempotent via recordPlaybookStage/transitionTask's own
// idempotency keys, both derived from stable evidence identity, never a
// timestamp). Standing authority: business_outreach.classify_response /
// record_evidence (AUTO) for the read+classify; escalating to
// NEEDS_JERRY is itself an AUTO operation (deciding TO escalate is
// deterministic), the escalated decision itself is APPROVAL_REQUIRED.
// ---------------------------------------------------------------------------

export interface ReconcileOneResult {
  taskId: string
  tokenId: string
  fromStage: BusinessPhotoOutreachStage | null
  toStage: BusinessPhotoOutreachStage
  statusChanged: boolean
  reason: string
}

async function currentStageFor(taskId: string): Promise<BusinessPhotoOutreachStage | null> {
  const rows = await query<{ stage: string }>(
    `select coalesce(metadata ->> 'stage', metadata #>> '{playbookStage,stage}') as stage
     from agent.task_events
     where task_id = $1
       and event_type in ('PLAYBOOK_STAGE', 'STATUS_CHANGED')
       and (metadata ? 'stage' or metadata -> 'playbookStage' ? 'stage')
     order by changed_at desc limit 1`,
    [taskId]
  )
  // PLAYBOOK_STAGE events store stage at metadata.stage; STATUS_CHANGED
  // events (via transitionTask's playbookStage field) store it nested at
  // metadata.playbookStage.stage — normalize both shapes here, the only
  // place that needs to know about it.
  if (rows.length === 0) return null
  const raw = rows[0].stage
  return (raw ?? null) as BusinessPhotoOutreachStage | null
}

/**
 * Runs one reconciliation pass over every business-photo-outreach task
 * that is not already terminal (DONE/CANCELED). Reads fresh evidence,
 * derives the next stage via the pure reducer, and — ONLY when the
 * derived stage actually differs from the task's current recorded stage
 * — applies it (a coarse-status transition via transitionTask, or a
 * same-status recordPlaybookStage event). Re-running this with no new
 * evidence is a true no-op: every apply path is keyed by evidence
 * identity, not by "reconciliation ran," so a second pass over unchanged
 * evidence records nothing new.
 */
export async function reconcileBusinessPhotoOutreach(): Promise<ReconcileOneResult[]> {
  const allTasks = await getAllTasks()
  const candidates = allTasks.filter((t) => t.sourceType === BUSINESS_PHOTO_OUTREACH_SOURCE_TYPE && t.status !== 'DONE' && t.status !== 'CANCELED')

  const results: ReconcileOneResult[] = []
  for (const task of candidates) {
    if (!task.sourceRef) continue
    const tokenId = task.sourceRef
    const evidence = await readEvidence(tokenId)
    const currentStage = (await currentStageFor(task.id)) ?? 'READY_FOR_OUTREACH'

    // A task already at READY_FOR_OUTREACH has not been sent yet — never
    // evidence-advanced (sending is a separate, human/process-driven step
    // via recordOutreachSent), so skip it here rather than deriving a
    // no-op stage.
    if (currentStage === 'READY_FOR_OUTREACH') continue

    const advance = deriveNextStage(currentStage, evidence)
    if (advance.nextStage === currentStage) continue // genuinely nothing new

    const targetCoarseStatus = coarseStatusForStage(advance.nextStage)
    const evidenceKey = JSON.stringify({ submission: evidence.submission, candidate: evidence.candidate })
    const idempotencyKey = `business-outreach-stage:${tokenId}:${advance.nextStage}:${evidenceKey}`

    let statusChanged = false
    if (targetCoarseStatus !== task.status) {
      await transitionTask({
        taskId: task.id,
        toStatus: targetCoarseStatus,
        actorOwnerKey: CHIEF_OWNER_KEY,
        expectedUpdatedAt: task.updatedAt,
        note: advance.reason,
        nextAction: nextActionForStage(advance.nextStage, isSecretBranch(evidence)),
        nextCheckAt: targetCoarseStatus === 'WAITING' ? new Date(Date.now() + DEFAULT_FOLLOW_UP_WAIT_DAYS * 24 * 60 * 60 * 1000) : undefined,
        jerryRequest: targetCoarseStatus === 'NEEDS_JERRY' ? jerryRequestForStage(advance.nextStage, evidence) : undefined,
        idempotencyKey,
        playbookStage: { playbookKey: (isSecretBranch(evidence) ? SECRET_BUSINESS_OUTREACH_PLAYBOOK : BUSINESS_PHOTO_OUTREACH_PLAYBOOK).key, stage: advance.nextStage },
      })
      statusChanged = true
    } else {
      await recordPlaybookStage({
        taskId: task.id,
        playbookKey: (isSecretBranch(evidence) ? SECRET_BUSINESS_OUTREACH_PLAYBOOK : BUSINESS_PHOTO_OUTREACH_PLAYBOOK).key,
        stage: advance.nextStage,
        actorOwnerKey: CHIEF_OWNER_KEY,
        evidence: { classifications: [...advance.classifications] },
        note: advance.reason,
        idempotencyKey,
      })
    }

    results.push({ taskId: task.id, tokenId, fromStage: currentStage, toStage: advance.nextStage, statusChanged, reason: advance.reason })
  }
  return results
}

function nextActionForStage(stage: BusinessPhotoOutreachStage, secret: boolean): string {
  switch (stage) {
    case 'WAITING_FOR_BUSINESS':
      return 'Waiting for the business to respond.'
    case 'RESPONSE_CLASSIFICATION':
      return 'Classify the business response.'
    case 'ITEM_CONFIRMATION':
      return secret ? 'Needs Jerry: response could not be classified for a secret-item business.' : 'Needs Jerry: business proposed a correction (or response is ambiguous).'
    case 'PHOTO_SUBMITTED':
      return 'Connect the submitted photo candidate for review.'
    case 'PHOTO_REVIEW':
      return 'Needs Jerry: approve/reject/rotate/primary the submitted photo.'
    case 'CLING_REQUEST':
      return 'Create/advance the cling fulfillment task.'
    case 'FOLLOW_UP':
      return 'Follow-up window reached with no response — queue a follow-up (never auto-sent).'
    case 'COMPLETE':
      return 'Complete — no further action needed.'
    default:
      return 'Awaiting outreach.'
  }
}

function jerryRequestForStage(stage: BusinessPhotoOutreachStage, evidence: BusinessOutreachEvidence): string {
  if (stage === 'ITEM_CONFIRMATION') {
    return evidence.submission?.proposedCorrection
      ? `Business proposed a correction: "${evidence.submission.proposedCorrection}" — review and resolve.`
      : 'Business response needs human interpretation — could not be deterministically classified.'
  }
  if (stage === 'PHOTO_REVIEW') {
    return `Business-submitted photo candidate ${evidence.candidate?.id ?? evidence.submission?.photoCandidateId ?? '(unknown)'} is ready for review — approve/reject/rotation/primary.`
  }
  return 'Needs Jerry.'
}

// ---------------------------------------------------------------------------
// Cling fulfillment — a real child unit of work, linked back to the
// parent outreach task via source identity (agent.tasks has no exposed
// parent_task_id write path in mutations.ts today — see mutations.ts's
// own "no generic updateTask" note; source_type/source_ref is the
// existing, already-idempotent linking mechanism, reused here rather
// than adding a new field to createTask for this one case).
// ---------------------------------------------------------------------------

export interface ClingFulfillmentInput {
  tokenId: string
  businessName: string
  mailingInfo: string
}

export async function createClingFulfillmentTask(input: ClingFulfillmentInput): Promise<{ created: boolean; taskId: string }> {
  evaluateAuthority('business_outreach.create_cling_fulfillment_task')
  const result = await createTask({
    title: `Fulfill CheckOff window cling: ${input.businessName}`,
    projectKey: BUSINESS_PHOTO_OUTREACH_PROJECT_KEY,
    status: 'READY',
    changedByOwnerKey: CHIEF_OWNER_KEY,
    ownerKey: CHIEF_OWNER_KEY,
    description: `Mailing info: ${input.mailingInfo}`,
    nextAction: 'Mail the window cling.',
    sourceType: 'cling_fulfillment',
    sourceRef: input.tokenId,
  })
  return { created: result.created, taskId: result.task.id }
}
