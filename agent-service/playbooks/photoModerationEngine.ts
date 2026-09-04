// Chief Phase 2B — the DB-touching half of the Photo Moderation
// playbook. Every actual state change routes through the existing,
// already-reviewed agent-service/coverCandidateModeration.ts operations
// — this file never writes to item_cover_candidates directly.

import { query } from '../db'
import { createTask, transitionTask, recordPlaybookStage } from '../mutations'
import { getAllTasks } from '../queries'
import type { TaskSummary } from '../types'
import {
  listCoverCandidates,
  approveCandidate,
  rejectCandidate,
  addToRotation,
  removeFromRotation,
  setPrimaryImage,
  listItemImagePool,
  type CoverCandidateSummary,
} from '../coverCandidateModeration'
import {
  PHOTO_MODERATION_SOURCE_TYPE,
  PHOTO_MODERATION_PLAYBOOK_KEY,
  assessCandidate,
  buildDecisionPacket,
  verifyDecisionAuthority,
  coarseStatusForStage,
  type PhotoCandidateContext,
  type PhotoAssessment,
  type DecisionPacket,
  type JerryPhotoDecision,
  type PoolEntry,
} from './photoModeration'
import { evaluateAuthority } from './standingAuthority'
import { reconcileBusinessPhotoOutreach } from './businessPhotoOutreachEngine'

const CHIEF_OWNER_KEY = 'chief'
// agent_platform (INTERNAL), not business_photo_campaign — a moderation
// task covers BOTH community and business_submission candidates, and
// conflating every community submission into the business outreach
// campaign's own project would misrepresent where it came from. No
// dedicated moderation project exists yet; agent_platform is the
// existing, honest, origin-agnostic home for this kind of Chief
// infrastructure/ops work (same reasoning already used for the App
// Release state-capture task in Phase 2A).
const PHOTO_MODERATION_PROJECT_KEY = 'agent_platform'

/**
 * Jerry's real public.users.id — approveCandidate/rejectCandidate record
 * this as reviewed_by_user_id. Same value, same "duplicated by
 * necessity" reasoning as checkoff_admin.html's CC_ADMIN_REVIEWER_USER_ID
 * constant (no shared config between this Node runtime and the admin
 * tool's static HTML). This function is only ever called in reaction to
 * an explicit Jerry decision (see applyJerryDecision's own doc) — this
 * constant records WHO made it, it does not grant Chief the authority to
 * decide on its own.
 */
const JERRY_USER_ID = '11275026-65be-4421-80a4-46c57195408b'

/**
 * Same duplicate-by-necessity pattern already used by the admin tool's
 * own ccExtractVenue and lib/itemDetailHeaderTitle.js's
 * extractQuotedVenueFromBody — this is a separate runtime (Node, not RN
 * or the admin's plain browser JS) with no shared module to import from.
 * Any future change to the quoting convention must be made in all three
 * places.
 */
function extractVenueFromBody(body: string): string | null {
  const patterns = [/'([^']+)'\s*$/, /"([^"]+)"\s*$/, /'([^']+)'/, /"([^"]+)"/]
  for (const pattern of patterns) {
    const match = pattern.exec(body)
    if (match) return match[1]
  }
  return null
}

// ---------------------------------------------------------------------------
// NEW_CANDIDATE — detection, idempotent task creation
// ---------------------------------------------------------------------------

export interface DetectResult {
  created: number
  alreadyExisted: number
}

/**
 * Scans for item_cover_candidates rows requiring review (pending/
 * needs_review) and creates one agent.tasks row per candidate.
 * Idempotent via createTask's existing (source_type, source_ref) unique
 * index — running this repeatedly (a new candidate arrived, or simply a
 * repeat pass) never creates a second task for the same candidate.
 * Standing authority: photo_moderation.detect_candidate /
 * create_moderation_task (both AUTO).
 */
export async function detectNewCandidates(): Promise<DetectResult> {
  evaluateAuthority('photo_moderation.detect_candidate')
  evaluateAuthority('photo_moderation.create_moderation_task')

  const pending = await listCoverCandidates({ status: 'needs_review' })
  const alsoPending = await listCoverCandidates({ status: 'pending' })
  const candidates = [...pending, ...alsoPending]

  let created = 0
  let alreadyExisted = 0
  for (const c of candidates) {
    const result = await createTask({
      title: `Review cover candidate: ${extractVenueFromBody(c.itemBody) ?? c.itemBody.slice(0, 60)}`,
      projectKey: PHOTO_MODERATION_PROJECT_KEY,
      status: 'READY',
      changedByOwnerKey: CHIEF_OWNER_KEY,
      ownerKey: CHIEF_OWNER_KEY,
      description: c.itemBody,
      nextAction: 'Gather context and assess.',
      sourceType: PHOTO_MODERATION_SOURCE_TYPE,
      sourceRef: c.id,
    })
    if (result.created) created++
    else alreadyExisted++
  }
  return { created, alreadyExisted }
}

// ---------------------------------------------------------------------------
// GATHER_CONTEXT
// ---------------------------------------------------------------------------

interface CandidateRow {
  moderation_metadata: { passesBasicSanity?: boolean; malformed?: boolean } | null
}

/** Standing authority: photo_moderation.gather_context (AUTO) — read-only. */
export async function gatherContext(candidateId: string): Promise<PhotoCandidateContext> {
  evaluateAuthority('photo_moderation.gather_context')

  // listCoverCandidates has no by-id filter (Phase 2 didn't need one) —
  // fetch the small unfiltered set and find the one candidate. Fine at
  // today's real-world scale (a handful of live candidates); a future
  // by-id query could be added to coverCandidateModeration.ts directly
  // if this ever needs to scale, without touching this file.
  const candidates = await listCoverCandidates({})
  const candidate = candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new Error(`gatherContext: candidate ${candidateId} not found`)

  const metaRows = await query<CandidateRow>(`select moderation_metadata from public.item_cover_candidates where id = $1`, [candidateId])
  const meta = metaRows[0]?.moderation_metadata ?? null

  const isSecretRows = await query<{ is_secret: boolean }>(`select is_secret from public.items where id = $1`, [candidate.itemId])
  const isSecretItem = Boolean(isSecretRows[0]?.is_secret)

  const pool = isSecretItem ? [] : await listItemImagePool(candidate.itemId)

  return {
    candidateId: candidate.id,
    itemId: candidate.itemId,
    itemBody: candidate.itemBody,
    venueName: extractVenueFromBody(candidate.itemBody),
    metroName: candidate.metroName,
    source: candidate.source,
    status: candidate.status,
    submittedAt: candidate.submittedAt,
    passesBasicSanity: meta?.passesBasicSanity ?? null,
    malformed: Boolean(meta?.malformed),
    isSecretItem,
    activeCoverCandidateId: candidate.activeCoverCandidateId,
    pool: pool.map((p): PoolEntry => ({ id: p.id, source: p.source, isPrimary: p.isPrimary, displayWeight: p.displayWeight })),
  }
}

// ---------------------------------------------------------------------------
// ASSESS + NEEDS_JERRY
// ---------------------------------------------------------------------------

export interface AssessResult {
  context: PhotoCandidateContext
  assessment: PhotoAssessment
  packet: DecisionPacket
}

/**
 * GATHER_CONTEXT + ASSESS + record NEEDS_JERRY, in one call (the two
 * stages are cheap enough not to warrant separate DB round-trips for a
 * caller that always wants both). NEVER mutates item_cover_candidates —
 * assessCandidate (photoModeration.ts) is pure, and this function's only
 * writes are the task_events stage record and the NEEDS_JERRY
 * transition. Standing authority: assess_recommend (AUTO) — producing a
 * recommendation is not the same as acting on it.
 */
export async function runAssessment(taskId: string, task: TaskSummary): Promise<AssessResult> {
  evaluateAuthority('photo_moderation.assess_recommend')
  if (!task.sourceRef) throw new Error(`runAssessment: task ${taskId} has no sourceRef`)
  const candidateId = task.sourceRef

  const context = await gatherContext(candidateId)

  await recordPlaybookStage({
    taskId,
    playbookKey: PHOTO_MODERATION_PLAYBOOK_KEY,
    stage: 'GATHER_CONTEXT',
    actorOwnerKey: CHIEF_OWNER_KEY,
    evidence: { context },
    idempotencyKey: `photo-mod-context:${candidateId}`,
  })

  const assessment = assessCandidate(context)
  const packet = buildDecisionPacket(context, assessment)

  await recordPlaybookStage({
    taskId,
    playbookKey: PHOTO_MODERATION_PLAYBOOK_KEY,
    stage: 'ASSESS',
    actorOwnerKey: CHIEF_OWNER_KEY,
    evidence: { assessment },
    idempotencyKey: `photo-mod-assess:${candidateId}`,
  })

  if (task.status !== 'NEEDS_JERRY') {
    await transitionTask({
      taskId,
      toStatus: 'NEEDS_JERRY',
      actorOwnerKey: CHIEF_OWNER_KEY,
      expectedUpdatedAt: task.updatedAt,
      jerryRequest: packet.lines.join(' | '),
      idempotencyKey: `photo-mod-needs-jerry:${candidateId}`,
      playbookStage: { playbookKey: PHOTO_MODERATION_PLAYBOOK_KEY, stage: 'NEEDS_JERRY' },
    })
  }

  return { context, assessment, packet }
}

// ---------------------------------------------------------------------------
// APPLY_DECISION — the ONLY place a Jerry decision becomes a real
// mutation. Every branch calls an EXISTING reusable moderation
// operation; nothing here duplicates their SQL or state logic.
// ---------------------------------------------------------------------------

export interface ApplyDecisionInput {
  taskId: string
  task: TaskSummary
  decision: JerryPhotoDecision
  /** Only meaningful for set_primary — mirrors setPrimaryImage's own allowReplace contract. */
  allowReplace?: boolean
  reason?: string | null
}

export interface ApplyDecisionResult {
  candidate: CoverCandidateSummary
  pool: PoolEntry[]
  parentOutreachAdvanced: boolean
}

async function callModerationOperation(decision: JerryPhotoDecision, candidateId: string, reviewerOwnerUserId: string, allowReplace: boolean, reason: string | null) {
  switch (decision) {
    case 'approve':
      return approveCandidate(candidateId, reviewerOwnerUserId)
    case 'reject':
      return rejectCandidate(candidateId, reviewerOwnerUserId, reason)
    case 'add_to_rotation':
      return addToRotation(candidateId)
    case 'remove_from_rotation':
      return removeFromRotation(candidateId)
    case 'set_primary':
      return (await setPrimaryImage(candidateId, { allowReplace })).candidate
  }
}

/**
 * Applies a decision Jerry has already made — this function is only ever
 * invoked in direct reaction to an explicit Jerry decision (via the
 * admin UI, or a future Chief-facing "apply this" action a human
 * triggers), never autonomously. verifyDecisionAuthority() re-checks the
 * standing-authority table before proceeding (defense in depth — the
 * table itself is the real gate, this is a second, redundant check that
 * throws rather than trusting the caller already checked).
 */
export async function applyJerryDecision(input: ApplyDecisionInput): Promise<ApplyDecisionResult> {
  verifyDecisionAuthority(input.decision)
  if (!input.task.sourceRef) throw new Error(`applyJerryDecision: task ${input.taskId} has no sourceRef`)
  const candidateId = input.task.sourceRef

  const candidate = await callModerationOperation(input.decision, candidateId, JERRY_USER_ID, Boolean(input.allowReplace), input.reason ?? null)
  const pool = candidate.status === 'rejected' ? [] : await listItemImagePool(candidate.itemId)

  await recordPlaybookStage({
    taskId: input.taskId,
    playbookKey: PHOTO_MODERATION_PLAYBOOK_KEY,
    stage: 'APPLY_DECISION',
    actorOwnerKey: CHIEF_OWNER_KEY,
    evidence: {
      decision: input.decision,
      resultingStatus: candidate.status,
      displayEligible: candidate.displayEligible,
      isPrimary: candidate.isPrimary,
      activeCoverCandidateId: candidate.activeCoverCandidateId,
      poolSize: pool.length,
    },
    idempotencyKey: `photo-mod-apply:${candidateId}:${input.decision}:${candidate.status}:${candidate.displayEligible}:${candidate.isPrimary}`,
  })

  await transitionTask({
    taskId: input.taskId,
    toStatus: 'DONE',
    actorOwnerKey: CHIEF_OWNER_KEY,
    expectedUpdatedAt: input.task.updatedAt, // NOTE: caller must pass the task snapshot as of just before this call; a stale snapshot fails the concurrency check rather than risk a double-apply
    note: `Applied Jerry's decision (${input.decision}). Candidate status=${candidate.status}, displayEligible=${candidate.displayEligible}, isPrimary=${candidate.isPrimary}.`,
    idempotencyKey: `photo-mod-complete:${candidateId}`,
    playbookStage: { playbookKey: PHOTO_MODERATION_PLAYBOOK_KEY, stage: 'COMPLETE' },
  })

  // Business Photo Outreach resume — if this candidate originated from
  // the outreach flow, its parent task is sitting in PHOTO_REVIEW
  // waiting for exactly this evidence (candidate.status /
  // displayEligible). Re-running the SAME reconciliation pass the
  // outreach playbook already uses (no new resume mechanism) picks it
  // up automatically: deriveNextStage's PHOTO_REVIEW branch reads this
  // candidate's live state and advances to COMPLETE once it's resolved.
  const before = await getAllTasks()
  const advanced = await reconcileBusinessPhotoOutreach()
  const parentOutreachAdvanced = advanced.some((r) => before.some((t) => t.id === r.taskId))

  return { candidate, pool: pool.map((p) => ({ id: p.id, source: p.source, isPrimary: p.isPrimary, displayWeight: p.displayWeight })), parentOutreachAdvanced }
}

// ---------------------------------------------------------------------------
// Dry-run — GATHER_CONTEXT + ASSESS ONLY, never writes anything at all
// (not even the task_events stage record). Used for the real-state dry
// run required before this playbook is trusted against live data.
// ---------------------------------------------------------------------------

export async function dryRunAssessment(candidateId: string): Promise<{ context: PhotoCandidateContext; assessment: PhotoAssessment; packet: DecisionPacket }> {
  const context = await gatherContext(candidateId)
  const assessment = assessCandidate(context)
  const packet = buildDecisionPacket(context, assessment)
  return { context, assessment, packet }
}

export { coarseStatusForStage }
