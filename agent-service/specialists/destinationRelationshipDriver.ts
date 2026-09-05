// Chief Phase 2I — the Destination Relationship Manager driver. Same
// architecture as destinationHubDriver.ts (Phase 2F/2G): a stage-machine
// driver over PlaybookRunRecord, reusing — never reimplementing — the
// pure logic already built for this playbook: destinationRelationship.ts
// (stage graph, asset levels, contact isolation), destinationExecutorGap.ts
// (deriveResumeAction — the exact event dispatcher a future Gmail/Calendar
// integration was designed to slot into, Phase 2D), gmailRelationshipLogic.ts
// (classification/association), followUpEngine.ts (bounded follow-up
// timing), salesAssets.ts (deterministic one-pager/deck), meetingPrepPacket.ts.
//
// Two entry points, matching how a real relationship actually moves:
//   driveDestinationRelationship() — the FORWARD path Chief drives on its
//     own: DAP complete -> validate contact -> draft first outreach ->
//     NEEDS_JERRY for send approval. Stops there every time — sending is
//     destination_relationship.send_email, APPROVAL_REQUIRED, no exception.
//   applyRelationshipResumeEvent() — the EVENT-DRIVEN path a real Gmail/
//     Calendar poller or webhook would call when something happens while
//     the run is WAITING (a reply arrives, a meeting is requested/
//     scheduled/completed). This is NOT a polling loop inside the driver —
//     Gmail has no push mechanism this codebase implements, so today this
//     is the same "hand Chief the event" shape destinationExecutorGap.ts
//     always intended, whether the event comes from a real integration
//     (once Gmail is configured) or a test/dry-run harness constructing
//     one directly.

import type { DVA1Artifact, DVA2Artifact, DAPArtifact } from '../playbooks/destinationHubLifecycle'
import { RELATIONSHIP_PLAYBOOK_KEY, requiredAssetLevel, assertRelationshipTransitionAllowed, isolateContactContext, type RelationshipStage, type DestinationContactContext, type SalesAssetLevel } from '../playbooks/destinationRelationship'
import { deriveResumeAction, type DestinationRelationshipResumeEvent } from '../playbooks/destinationExecutorGap'
import { classifyReply, associateInboundEmail, hasPriorCorrespondence, type InboundEmail, type KnownRelationshipContact, type ClassifiedReply, type MutableContactDirectory } from '../playbooks/gmailRelationshipLogic'
import { computeNextFollowUpAt, isFollowUpDue, shouldPark, parseRequestedWait, type FollowUpState } from '../playbooks/followUpEngine'
import { validateFollowUpWording, buildQuotedReplyBody } from '../playbooks/followUpQuoting'
import { buildOnePagerMarkdown, assetLevelReadyToGenerate } from '../playbooks/salesAssets'
import { buildMeetingPrepPacket, deriveMeetingFollowUp, type MeetingOutcome, type MeetingFollowUpResult } from '../playbooks/meetingPrepPacket'
import type { GmailAdapter } from './googleAdapters'
import type { GoogleCalendarAdapter, FreeBusyWindow } from './googleAdapters'
import type { GoogleContactsAdapter } from './googleAdapters'
import { runExecutionRouted } from './routing'
import type { ExecutionStore, SpecialistExecutor, SpecialistExecutionRequest, AcceptResultOutcome, ExecutionRecord } from './executor'
import { getOrCreateRun, type PlaybookRunStore, type PlaybookRunRecord } from './playbookRun'
import type { SpecialistResultEnvelope } from './types'

// ---------------------------------------------------------------------------
// runExecutionRouted outcome normalization — identical pattern to
// destinationHubDriver.ts's resolveOutcome(), duplicated rather than
// shared because the two drivers have no other coupling and a shared
// utility would be a premature abstraction over one function.
// ---------------------------------------------------------------------------

type ResolvedOutcome = { kind: 'ACCEPTED'; envelope: SpecialistResultEnvelope } | { kind: 'UNAVAILABLE'; reason: string } | { kind: 'FAILED'; reason: string }

function resolveOutcome(outcome: AcceptResultOutcome | ExecutionRecord): ResolvedOutcome {
  if ('status' in outcome) {
    if (outcome.status === 'EXECUTOR_UNAVAILABLE') return { kind: 'UNAVAILABLE', reason: outcome.errorReason ?? 'EXECUTOR_UNAVAILABLE' }
    if (outcome.status === 'COMPLETE' && outcome.envelope) return { kind: 'ACCEPTED', envelope: outcome.envelope }
    return { kind: 'FAILED', reason: outcome.errorReason ?? `execution status ${outcome.status}` }
  }
  if (outcome.accepted) return { kind: 'ACCEPTED', envelope: outcome.record.envelope! }
  return { kind: 'FAILED', reason: outcome.reasons.join('; ') || 'evidence validation failed' }
}

export const DESTINATION_RELATIONSHIP_DRIVER_PLAYBOOK_KEY = RELATIONSHIP_PLAYBOOK_KEY

export interface RelationshipContactInput {
  contactId: string
  name: string
  email: string
  role: string | null
}

interface OutreachDraft {
  subject: string
  bodyText: string
  channel: string
}

interface RelationshipDriverState {
  [key: string]: unknown
  destinationName?: string
  dva1?: DVA1Artifact | null
  dva2?: DVA2Artifact | null
  dap?: DAPArtifact
  primaryContact?: RelationshipContactInput
  contacts?: DestinationContactContext[]
  hasPriorCorrespondence?: boolean
  draftedOutreach?: OutreachDraft | null
  outreachApproved?: boolean
  outreachSentSimulated?: boolean
  outreachSentReal?: boolean
  /** The real Gmail thread/message id once the first outreach is actually sent — reused by every later send in this relationship (approved follow-ups included) so nothing starts a stray new thread. */
  outreachThreadId?: string
  outreachMessageId?: string
  /** A drafted follow-up awaiting Jerry's approval — distinct from draftedOutreach (the original first-touch content, which stays untouched as historical record once a follow-up is drafted). */
  followUpDraft?: OutreachDraft | null
  followUp?: FollowUpState
  onePagerMarkdown?: string | null
  lastClassification?: ClassifiedReply
  meetingWindows?: FreeBusyWindow[]
  meetingCheatSheet?: string | null
  meetingPrepPacket?: string | null
  relationshipHistory?: string[]
  followUpAttempts?: number
}

function readState(run: PlaybookRunRecord): RelationshipDriverState {
  return (run.state as RelationshipDriverState) ?? {}
}

export interface RelationshipDriverDeps {
  runStore: PlaybookRunStore
  execStore: ExecutionStore
  executors: readonly SpecialistExecutor[]
  gmail: GmailAdapter
  calendar: GoogleCalendarAdapter
  contacts: GoogleContactsAdapter
  /** Jerry's own calendar id for freeBusy lookups — a real production deployment would configure this once; tests inject a fixed value. */
  jerryCalendarId: string
  /** Optional — when supplied, the driver keeps it current itself (upserting on contact validation and on a referral) so a production Gmail poller (gmailInboundMonitor.ts) has a real, always-up-to-date directory to associate inbound mail against, without needing its own separate source of truth. */
  contactDirectory?: MutableContactDirectory
  now?: () => string
}

function nowIso(deps: RelationshipDriverDeps): string {
  return (deps.now ?? (() => new Date().toISOString()))()
}

function eid(runId: string, stage: string, suffix: string): string {
  return `${runId}::${stage}::${suffix}`
}

async function persist(run: PlaybookRunRecord, deps: RelationshipDriverDeps): Promise<PlaybookRunRecord> {
  run.updatedAt = nowIso(deps)
  await deps.runStore.put(run)
  return run
}

function escalate(run: PlaybookRunRecord, reason: string, packet: Record<string, unknown>): PlaybookRunRecord {
  run.status = 'NEEDS_JERRY'
  run.jerryReason = reason
  run.decisionPacket = packet
  return run
}

function wait(run: PlaybookRunRecord, reason: string): PlaybookRunRecord {
  run.status = 'WAITING'
  run.jerryReason = null
  run.decisionPacket = null
  const state = readState(run)
  state.lastWaitReason = reason
  run.state = state
  return run
}

function moveTo(run: PlaybookRunRecord, to: RelationshipStage): PlaybookRunRecord {
  assertRelationshipTransitionAllowed(run.currentStage as RelationshipStage, to)
  run.currentStage = to
  run.status = 'RUNNING'
  return run
}

function appendHistory(state: RelationshipDriverState, line: string): void {
  state.relationshipHistory = [...(state.relationshipHistory ?? []), line]
}

// ---------------------------------------------------------------------------
// Forward path — DAP complete -> RELATIONSHIP_READY -> ... -> NEEDS_JERRY
// (send approval). Never advances past sending without Jerry.
// ---------------------------------------------------------------------------

async function stepRelationshipReady(deps: RelationshipDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  if (!state.primaryContact?.email) {
    return escalate(run, `No validated contact email on file for ${state.destinationName} — cannot proceed to outreach without a real recipient.`, {
      decisionNeeded: 'Provide or confirm the champion/contact email for this destination.',
      why: 'destination_relationship.identify_contact requires a real recipient address; DAP named a champion organization but no verified email was supplied.',
    })
  }

  // AUTO — search for prior correspondence before treating this as cold.
  // Real capability, honestly gated: an unconfigured GmailAdapter (no
  // Google OAuth token) means this always returns "no prior
  // correspondence found," never a fabricated positive.
  let hasPrior = false
  if (deps.gmail.isConfigured()) {
    const results = await deps.gmail.searchMessages(`${state.destinationName} OR ${state.primaryContact.email}`)
    hasPrior = hasPriorCorrespondence(results)
  }
  state.hasPriorCorrespondence = hasPrior
  run.state = state
  await deps.contactDirectory?.upsertContact({ destinationId: run.projectId, contactId: state.primaryContact.contactId, email: state.primaryContact.email, threadId: (state.contactThreadIds as Record<string, string> | undefined)?.[state.primaryContact.contactId] ?? null })
  return moveTo(run, 'ASSETS_PREP')
}

async function stepAssetsPrep(deps: RelationshipDriverDeps, run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  const level: SalesAssetLevel = requiredAssetLevel('ASSETS_PREP', !!state.dap)

  const request: SpecialistExecutionRequest = {
    specialist: 'destination_relationship_manager',
    playbookKey: DESTINATION_RELATIONSHIP_DRIVER_PLAYBOOK_KEY,
    stage: 'ASSETS_PREP',
    objective: `${state.destinationName}: draft first outreach to ${state.primaryContact?.name}`,
    inputs: {
      destinationName: state.destinationName,
      contactName: state.primaryContact?.name,
      contactRole: state.primaryContact?.role,
      hasPriorCorrespondence: state.hasPriorCorrespondence,
      requestType: 'DRAFT_OUTREACH',
      assetLevel: level,
      checkoffValueProposition: state.dap?.extracted.checkoffValueProposition,
      destinationPainPoints: state.dap?.extracted.destinationPainPoints,
      recommendedEntryStrategy: state.dap?.extracted.recommendedEntryStrategy,
      timingConsiderations: state.dap?.extracted.timingConsiderations,
    },
    requiredEvidenceKeys: ['artifact'],
    methodologyId: 'destination_commercial',
    methodologyVersion: 'v1',
    executionId: eid(run.runId, 'ASSETS_PREP', String(run.loopIteration)),
    projectId: run.projectId,
    destinationId: run.projectId,
    metroId: null,
    allowedCapabilities: ['open_brain_read'],
    authorityOperations: ['destination_relationship.draft_outreach'],
    idempotencyKey: eid(run.runId, 'ASSETS_PREP', String(run.loopIteration)),
  }
  const resolved = resolveOutcome(await runExecutionRouted(deps.execStore, request, deps.executors, deps.now))
  if (resolved.kind === 'UNAVAILABLE') {
    run.status = 'BLOCKED'
    run.jerryReason = resolved.reason
    return run
  }
  if (resolved.kind === 'FAILED') return escalate(run, 'Outreach drafting did not produce valid evidence.', { decisionNeeded: 'Review outreach-drafting failure.', why: resolved.reason })

  // A real live proof caught this: the destination_commercial v1
  // methodology has no schema pinning evidence.artifact's exact shape
  // for a DRAFT_OUTREACH request, and the model naturally returns the
  // draft itself as evidence.artifact ({channel, subject, bodyText}) —
  // NOT nested under an extra .draft key. Reading only the nested shape
  // silently produced `state.draftedOutreach = undefined` on every real
  // run, which the driver then advanced past without noticing (nothing
  // downstream checked for a missing draft). Accept both shapes rather
  // than assuming one — never silently accept an artifact that has
  // neither.
  const rawArtifact = resolved.envelope.evidence.artifact as { draft?: OutreachDraft; subject?: string; bodyText?: string; channel?: string }
  const draft: OutreachDraft | undefined = rawArtifact.draft ?? (rawArtifact.subject && rawArtifact.bodyText ? { subject: rawArtifact.subject, bodyText: rawArtifact.bodyText, channel: rawArtifact.channel ?? 'email' } : undefined)
  if (!draft) return escalate(run, 'Outreach drafting produced evidence, but it did not contain a recognizable draft (subject/bodyText).', { decisionNeeded: 'Review the raw drafting evidence — it does not match either expected shape.', why: JSON.stringify(rawArtifact).slice(0, 500) })

  state.draftedOutreach = draft
  run.state = state
  return moveTo(run, 'INITIAL_OUTREACH')
}

async function stepInitialOutreach(run: PlaybookRunRecord): Promise<PlaybookRunRecord> {
  const state = readState(run)
  if (state.outreachApproved) {
    // Jerry already approved via recordJerryDecision — proceed past the
    // gate without re-asking (same override discipline as the hub driver's
    // dva2Approved/dapApproved).
    appendHistory(state, `Outreach approved and sent (or drafted-only if Gmail unconfigured) via ${state.draftedOutreach?.channel}.`)
    run.state = state
    return moveTo(run, 'WAITING_FOR_REPLY')
  }
  return escalate(run, `${state.destinationName} outreach is drafted and ready — sending requires Jerry.`, {
    decisionNeeded: 'Approve sending this first outreach message.',
    why: 'destination_relationship.send_email is APPROVAL_REQUIRED with no exception path — Chief drafts, Jerry sends.',
    to: state.primaryContact?.email,
    channel: state.draftedOutreach?.channel,
    subject: state.draftedOutreach?.subject,
    bodyPreview: state.draftedOutreach?.bodyText,
    hasPriorCorrespondence: state.hasPriorCorrespondence,
  })
}

export interface DriveDestinationRelationshipOptions {
  destinationName: string
  dap: DAPArtifact
  dva1?: DVA1Artifact | null
  dva2?: DVA2Artifact | null
  contact: RelationshipContactInput
  maxSteps?: number
}

/**
 * Phase 2J — a real live proof exposed that the OAuth mailbox Chief
 * authenticates as (Jerry's own inbox, jerrystuckart@gmail.com — chosen
 * because @getcheckoff.com mail delivers there) is NOT the identity
 * Destination outreach should send AS. Jerry manually selects
 * jerry@getcheckoff.com as the From identity when sending by hand; Chief
 * must do the same explicitly, never silently defaulting to whichever
 * mailbox the OAuth token happens to authenticate. Overridable via
 * CHIEF_OUTREACH_FROM_EMAIL for a future account change — never hardcoded
 * without an escape hatch, same discipline as the AI model-routing env
 * vars in modelRouting.ts.
 */
export const DEFAULT_OUTREACH_FROM_EMAIL = 'jerry@getcheckoff.com'

export function outreachFromEmail(): string {
  return process.env.CHIEF_OUTREACH_FROM_EMAIL || DEFAULT_OUTREACH_FROM_EMAIL
}

/** Actually calls the (real or fake) GmailAdapter to send — ONLY reached after Jerry's approval is on record, and only performs a real send if the adapter is actually configured (no Google OAuth token today, so this is always a no-op / simulated-only send in this codebase's current state). */
async function performApprovedSend(deps: RelationshipDriverDeps, run: PlaybookRunRecord): Promise<void> {
  const state = readState(run)
  if (!state.draftedOutreach || !state.primaryContact) return
  if (deps.gmail.isConfigured()) {
    // Preserve an existing thread if one already exists for this contact
    // (e.g. a re-send after a transient failure) — a genuinely fresh
    // first touch has none yet, which is correct: Gmail starts a new
    // thread exactly once, on the real first send.
    const sent = await deps.gmail.sendMessage({ to: state.primaryContact.email, from: outreachFromEmail(), subject: state.draftedOutreach.subject, bodyText: state.draftedOutreach.bodyText, threadId: state.outreachThreadId })
    state.outreachSentReal = true
    // Phase 2J — thread continuity: preserve the real Gmail thread id so
    // this contact's reply (and any future follow-up Chief sends) stays
    // in the SAME thread, and so the inbound poller can match it via
    // threadId (the strongest association signal) rather than only
    // sender email.
    state.outreachThreadId = sent.threadId
    state.outreachMessageId = sent.messageId
    const contactEmails: Record<string, string> = (state.contactEmails as Record<string, string> | undefined) ?? {}
    contactEmails[state.primaryContact.contactId] = state.primaryContact.email
    state.contactEmails = contactEmails
    state.contactThreadIds = { ...(state.contactThreadIds as Record<string, string> | undefined), [state.primaryContact.contactId]: sent.threadId }
    await deps.contactDirectory?.upsertContact({ destinationId: run.projectId, contactId: state.primaryContact.contactId, email: state.primaryContact.email, threadId: sent.threadId })
  } else {
    state.outreachSentSimulated = true
  }
  run.state = state
}

/**
 * Sends an already-Jerry-approved follow-up (state.followUpDraft) — the
 * one send path driveDestinationRelationship()'s own forward loop does
 * NOT cover, since that loop only advances RELATIONSHIP_READY ->
 * ASSETS_PREP -> INITIAL_OUTREACH (the FIRST touch); a follow-up is
 * drafted directly onto an already-WAITING_FOR_REPLY run (see
 * reconcileWilliamsRealOutreach.ts / draftElkhartLakeFollowUp.ts), which
 * the main loop's default case leaves untouched. Requires a real,
 * existing outreachThreadId (a follow-up only ever exists because a
 * first touch was already sent) and ALWAYS threads onto it — a follow-up
 * that started a stray new thread would defeat the entire point of
 * "preserve the existing thread." Never called unless
 * run.state.outreachApproved is true for THIS follow-up (the caller —
 * recordJerryDecision, same discipline as the first-touch approval gate
 * — sets it); this function itself performs no approval check beyond
 * requiring a follow-up draft and an existing thread to exist, exactly
 * mirroring performApprovedSend's own contract.
 */
export async function sendApprovedFollowUp(deps: RelationshipDriverDeps, projectId: string): Promise<PlaybookRunRecord> {
  const run = await deps.runStore.get(`${DESTINATION_RELATIONSHIP_DRIVER_PLAYBOOK_KEY}:${projectId}`)
  if (!run) throw new Error(`No destination_relationship run found for ${projectId} — cannot send a follow-up that was never drafted.`)
  const state = readState(run)
  if (!state.followUpDraft) throw new Error(`No approved follow-up draft on file for ${projectId}.`)
  if (!state.primaryContact) throw new Error(`No primaryContact on file for ${projectId} — cannot send.`)
  if (!state.outreachThreadId) throw new Error(`No existing outreachThreadId on file for ${projectId} — a follow-up must always reply in the original thread, never start a new one.`)

  const draft = state.followUpDraft

  // Phase 2T — a real live proof caught that reusing threadId alone
  // neither quotes the prior message nor sets real reply headers, so a
  // follow-up saying "the note below" left the recipient with no note
  // below at all. Best-effort: fetch the real prior message (by its real
  // Gmail message id, already on file from the first send) and quote it
  // with proper In-Reply-To/References headers when the adapter supports
  // it and the fetch succeeds. If it can't be fetched, this is NOT a
  // silent quoting failure — the wording guard below refuses to send
  // "below"-referencing language without an actual quote attached.
  let quotedBodyText = draft.bodyText
  let inReplyTo: string | null = null
  let references: string | null = null
  let quotesPriorContent = false
  if (deps.gmail.isConfigured() && state.outreachMessageId) {
    try {
      const prior = await deps.gmail.getFullMessage(state.outreachMessageId)
      quotedBodyText = buildQuotedReplyBody(draft.bodyText, { fromDisplay: prior.from, dateDisplay: prior.receivedAt ?? 'an earlier date', bodyText: prior.bodyText })
      inReplyTo = prior.messageIdHeader
      references = prior.messageIdHeader
      quotesPriorContent = true
    } catch {
      // Fetch failed (e.g. message deleted, permissions) — fall through
      // with no quote. The wording guard immediately below is what
      // actually protects against sending inaccurate "below" language
      // in this case, not this catch block.
    }
  }

  const wordingCheck = validateFollowUpWording(draft.bodyText, quotesPriorContent)
  if (!wordingCheck.valid) {
    throw new Error(`Follow-up for ${projectId} rejected before sending: ${wordingCheck.issue}`)
  }

  const sentAt = nowIso(deps)
  if (deps.gmail.isConfigured()) {
    const sent = await deps.gmail.sendMessage({ to: state.primaryContact.email, from: outreachFromEmail(), subject: draft.subject, bodyText: quotesPriorContent ? quotedBodyText : draft.bodyText, threadId: state.outreachThreadId, inReplyTo, references })
    state.outreachMessageId = sent.messageId
    state.outreachThreadId = sent.threadId
    state.outreachSentReal = true
  } else {
    state.outreachSentSimulated = true
  }

  const priorFollowUp: FollowUpState = state.followUp ?? { attemptsMade: 0, lastContactAt: null, requestedWaitUntil: null, parked: false }
  const updatedFollowUp: FollowUpState = { ...priorFollowUp, attemptsMade: priorFollowUp.attemptsMade + 1, lastContactAt: sentAt }
  const nextFollowUpAt = computeNextFollowUpAt(updatedFollowUp, sentAt)

  state.followUp = updatedFollowUp
  state.followUpDraft = null
  appendHistory(state, `${sentAt.slice(0, 10)}: follow-up sent (attempt ${updatedFollowUp.attemptsMade}). Next follow-up checkpoint: ${nextFollowUpAt ?? 'none — max attempts reached, relationship parks if it stays silent'}.`)

  run.state = state
  run.status = 'WAITING'
  run.jerryReason = null
  run.decisionPacket = null
  run.currentStage = 'WAITING_FOR_REPLY'
  run.updatedAt = sentAt
  await deps.runStore.put(run)
  return run
}

export async function driveDestinationRelationship(deps: RelationshipDriverDeps, projectId: string, options: DriveDestinationRelationshipOptions): Promise<PlaybookRunRecord> {
  let run = await getOrCreateRun(deps.runStore, DESTINATION_RELATIONSHIP_DRIVER_PLAYBOOK_KEY, projectId, 'RELATIONSHIP_READY', deps.now)
  if (run.status === 'PAUSED' || run.status === 'DONE') return run

  const state = readState(run)
  if (!state.dap) {
    state.destinationName = options.destinationName
    state.dap = options.dap
    state.dva1 = options.dva1 ?? null
    state.dva2 = options.dva2 ?? null
    state.primaryContact = options.contact
    state.contacts = state.contacts ?? []
    run.state = state
    await persist(run, deps)
  }

  if (run.status === 'NEEDS_JERRY' || run.status === 'BLOCKED') return run

  // Jerry's approval was just recorded (recordJerryDecision flips status
  // back to RUNNING while currentStage stays INITIAL_OUTREACH) — perform
  // the actual send (or simulated-send, honestly, if unconfigured) before
  // stepping forward.
  if (run.currentStage === 'INITIAL_OUTREACH' && readState(run).outreachApproved && !readState(run).outreachSentReal && !readState(run).outreachSentSimulated) {
    await performApprovedSend(deps, run)
  }

  const maxSteps = options.maxSteps ?? 10
  for (let step = 0; step < maxSteps; step++) {
    switch (run.currentStage as RelationshipStage) {
      case 'RELATIONSHIP_READY':
        run = await stepRelationshipReady(deps, run)
        break
      case 'ASSETS_PREP':
        run = await stepAssetsPrep(deps, run)
        break
      case 'INITIAL_OUTREACH':
        run = await stepInitialOutreach(run)
        break
      default:
        // Every later stage is event-driven (applyRelationshipResumeEvent)
        // — the forward auto-loop stops once it reaches WAITING_FOR_REPLY
        // or beyond; nothing more to auto-advance without new evidence.
        return run
    }
    await persist(run, deps)
    if (run.status !== 'RUNNING') return run
  }
  return run
}

// ---------------------------------------------------------------------------
// Event-driven path — reuses destinationExecutorGap.ts's deriveResumeAction
// exactly, then performs the real (or dry-run/fake-adapter) work that
// action implies.
// ---------------------------------------------------------------------------

export type RelationshipResumeEventInput =
  | (DestinationRelationshipResumeEvent & { kind: 'GMAIL_REPLY_RECEIVED'; email: InboundEmail; introducedContact?: RelationshipContactInput })
  | (DestinationRelationshipResumeEvent & { kind: 'MEETING_REQUESTED' })
  | (DestinationRelationshipResumeEvent & { kind: 'MEETING_SCHEDULED'; meetingSummary: string })
  | (DestinationRelationshipResumeEvent & { kind: 'MEETING_COMPLETE'; outcome: MeetingOutcome })

export type ResumeEventResult = { rejected: true; reason: string } | { rejected: false; run: PlaybookRunRecord }

export async function applyRelationshipResumeEvent(deps: RelationshipDriverDeps, projectId: string, event: RelationshipResumeEventInput): Promise<ResumeEventResult> {
  const run = await deps.runStore.get(`${DESTINATION_RELATIONSHIP_DRIVER_PLAYBOOK_KEY}:${projectId}`)
  if (!run) return { rejected: true, reason: `No relationship run for project ${projectId}.` }
  if (run.status === 'NEEDS_JERRY' || run.status === 'BLOCKED') return { rejected: true, reason: `Run is ${run.status} — a pending Jerry decision or block must be resolved first.` }

  const state = readState(run)
  const action = deriveResumeAction(event)

  if (action.action === 'ASSOCIATE_AND_CLASSIFY' && event.kind === 'GMAIL_REPLY_RECEIVED') {
    // DestinationContactContext (destinationRelationship.ts) deliberately
    // carries no email field — it's relationship SENTIMENT state, not
    // identity. contactEmails is this driver's own lookup from contactId
    // to the address that contact actually emails from, so a stakeholder
    // introduced mid-relationship (Scenario B) can still be correctly
    // associated when THEY reply later, not just the original contact.
    const contactEmails: Record<string, string> = (state.contactEmails as Record<string, string> | undefined) ?? {}
    const primaryContact = state.primaryContact
    if (primaryContact) contactEmails[primaryContact.contactId] = primaryContact.email
    state.contactEmails = contactEmails
    const contactThreadIds = (state.contactThreadIds as Record<string, string> | undefined) ?? {}
    const known: KnownRelationshipContact[] = Object.entries(contactEmails).map(([contactId, contactEmail]) => ({ destinationId: projectId, contactId, email: contactEmail, threadId: contactThreadIds[contactId] ?? null }))
    const association = associateInboundEmail(event.email, known)
    if (!association.associated) return { rejected: true, reason: association.reason }
    if (association.destinationId !== projectId) return { rejected: true, reason: `Association resolved to destination ${association.destinationId}, not the requested ${projectId} — refusing cross-destination association.` }

    const classification = classifyReply(event.email.bodyText)
    state.lastClassification = classification
    appendHistory(state, `Inbound reply classified as ${classification.classification} (${classification.confidence} confidence).`)
    run.state = state

    if (classification.classification === 'INTRODUCTION_REFERRAL' && event.introducedContact) {
      const newContext: DestinationContactContext = { destinationId: projectId, contactId: event.introducedContact.contactId, role: event.introducedContact.role, sentiment: 'UNKNOWN', promisesMade: [], introducedBy: association.contactId, isChampion: false, isBlocker: false }
      isolateContactContext(state.contacts ?? [], projectId, event.introducedContact.contactId) // throws if a duplicate context already exists for this pair
      state.contacts = [...(state.contacts ?? []), newContext]
      contactEmails[event.introducedContact.contactId] = event.introducedContact.email
      state.contactEmails = contactEmails
      appendHistory(state, `${event.introducedContact.name} introduced by ${primaryContact?.name}.`)
      run.state = state
      await deps.contactDirectory?.upsertContact({ destinationId: projectId, contactId: event.introducedContact.contactId, email: event.introducedContact.email, threadId: null })
    }

    if (run.currentStage === 'WAITING_FOR_REPLY') moveTo(run, 'ENGAGED')

    if (classification.classification === 'INFORMATION_REQUEST') {
      if (assetLevelReadyToGenerate('LEVEL_1_ONE_PAGER', !!state.dap)) {
        state.onePagerMarkdown = buildOnePagerMarkdown({ dva1: state.dva1 ?? null, dap: state.dap!, includePricing: false })
        appendHistory(state, 'Generated a Level-1 one-pager in response to an information request.')
      }
      if (run.currentStage === 'ENGAGED') moveTo(run, 'MATERIAL_REQUESTED')
      run.state = state
      await persist(run, deps)
      return { rejected: false, run }
    }

    if (classification.classification === 'MEETING_INTEREST') {
      if (run.currentStage === 'ENGAGED') moveTo(run, 'MEETING_REQUESTED')
      run.state = state
      await persist(run, deps)
      return applyRelationshipResumeEvent(deps, projectId, { kind: 'MEETING_REQUESTED', destinationId: projectId, contactId: association.contactId, occurredAt: event.occurredAt, payload: {} })
    }

    if (classification.classification === 'NO_INTEREST') {
      moveTo(run, 'FOLLOW_UP')
      state.followUp = { attemptsMade: state.followUpAttempts ?? 0, lastContactAt: nowIso(deps), requestedWaitUntil: null, parked: true }
      appendHistory(state, 'Recipient declined — parking with history preserved, no further auto follow-up.')
      run.state = state
      await persist(run, deps)
      return { rejected: false, run: wait(run, 'Declined — parked.') }
    }

    if (classification.classification === 'BUDGET_PRICING') {
      run.state = state
      const escalated = escalate(run, `${state.destinationName}: a pricing/budget question arrived — this is APPROVAL_REQUIRED.`, { decisionNeeded: 'Respond to a pricing/budget question.', why: 'destination_relationship.change_pricing is APPROVAL_REQUIRED — Chief never discusses pricing unilaterally.', inboundSnippet: event.email.bodyText.slice(0, 280) })
      await persist(escalated, deps)
      return { rejected: false, run: escalated }
    }

    // POSITIVE_INTEREST / QUESTION / OBJECTION / UNCLEAR — routine engagement, no escalation needed.
    run.state = state
    await persist(run, deps)
    return { rejected: false, run }
  }

  if (action.action === 'CHECK_JERRY_AVAILABILITY') {
    const from = nowIso(deps)
    const to = new Date(new Date(from).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const busy = deps.calendar.isConfigured() ? await deps.calendar.freeBusy(deps.jerryCalendarId, from, to) : []
    const proposedWindows = proposeMeetingWindows(from, busy)
    state.meetingWindows = proposedWindows
    const cheatSheet = buildQuickMeetingCheatSheet(state, proposedWindows)
    state.meetingCheatSheet = cheatSheet
    run.state = state
    const escalated = escalate(run, `${state.destinationName}: meaningful meeting interest — proposing windows for Jerry.`, { decisionNeeded: 'Pick a meeting window and approve booking it.', why: action.reason, proposedWindows, cheatSheet })
    await persist(escalated, deps)
    return { rejected: false, run: escalated }
  }

  if (action.action === 'CREATE_MEETING_PREP_TASK' && event.kind === 'MEETING_SCHEDULED') {
    moveTo(run, 'MEETING_SCHEDULED')
    moveTo(run, 'MEETING_PREP')
    const packet = buildMeetingPrepPacket({
      destinationName: state.destinationName ?? projectId,
      contactName: state.primaryContact?.name ?? 'Unknown',
      contactRole: state.primaryContact?.role ?? null,
      whyTheyMatter: state.dap?.extracted.checkoffValueProposition ?? '',
      relationshipHistory: state.relationshipHistory ?? [],
      dvaDapStatus: `DVA-1 score ${state.dva1?.score ?? 'n/a'}; DVA-2 ${state.dva2?.recommendedNextStep ?? 'n/a'}; DAP on file.`,
      whatTheyCareAbout: state.dap?.extracted.destinationPainPoints ?? [],
      whatWeSent: [state.draftedOutreach?.subject ?? '(no outreach on file)', state.onePagerMarkdown ? 'One-pager' : null].filter((x): x is string => !!x),
      whatTheyAsked: state.lastClassification ? [state.lastClassification.classification] : [],
      budgetTimingIntel: state.dap?.extracted.fundingBudgetClues ?? [],
      likelyObjections: state.dap?.extracted.objectionsHurdles ?? [],
      meetingObjective: event.meetingSummary,
      recommendedQuestions: ['What would make this an easy yes for your team?', 'Who else should be part of this decision?'],
      doNotPromise: ['Specific pricing beyond the approved standard/founder numbers', 'A go-live date not yet confirmed by Chief/Jerry', 'Exclusivity or custom terms'],
      desiredNextStep: 'Confirm mutual fit and identify the concrete next step (proposal, additional stakeholder intro, or pilot scope).',
    })
    state.meetingPrepPacket = packet
    appendHistory(state, 'Meeting prep packet generated.')
    run.state = state
    await persist(run, deps)
    return { rejected: false, run }
  }

  if (action.action === 'CAPTURE_OUTCOME_AND_FOLLOW_UPS' && event.kind === 'MEETING_COMPLETE') {
    moveTo(run, 'MEETING_COMPLETE')
    const followUp: MeetingFollowUpResult = deriveMeetingFollowUp(event.outcome)
    state.meetingFollowUpTasks = followUp.tasks
    state.recommendedForOpenBrain = followUp.recommendedForOpenBrain
    appendHistory(state, `Meeting complete — ${followUp.tasks.length} follow-up task(s) created.`)
    moveTo(run, 'FOLLOW_UP')
    run.state = state
    await persist(run, deps)
    return { rejected: false, run: wait(run, 'Meeting complete — routine follow-up in progress.') }
  }

  return { rejected: true, reason: `Unhandled resume action "${action.action}" for event kind "${event.kind}".` }
}

function proposeMeetingWindows(fromIso: string, busy: readonly FreeBusyWindow[]): FreeBusyWindow[] {
  const candidates: FreeBusyWindow[] = []
  const start = new Date(fromIso)
  for (let dayOffset = 2; candidates.length < 3 && dayOffset < 12; dayOffset++) {
    const day = new Date(start.getTime() + dayOffset * 24 * 60 * 60 * 1000)
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue // skip weekends
    const slotStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17, 0)) // 17:00 UTC ~ late morning US
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000)
    const overlapsBusy = busy.some((b) => new Date(b.startIso) < slotEnd && new Date(b.endIso) > slotStart)
    if (!overlapsBusy) candidates.push({ startIso: slotStart.toISOString(), endIso: slotEnd.toISOString() })
  }
  return candidates
}

function buildQuickMeetingCheatSheet(state: RelationshipDriverState, windows: readonly FreeBusyWindow[]): string {
  return [
    `# ${state.destinationName} — Meeting Interest`,
    `**Contact:** ${state.primaryContact?.name ?? 'Unknown'}${state.primaryContact?.role ? ` (${state.primaryContact.role})` : ''}`,
    `**Why it matters:** ${state.dap?.extracted.checkoffValueProposition ?? '(no value proposition on file)'}`,
    `**Proposed windows:** ${windows.length > 0 ? windows.map((w) => w.startIso).join(', ') : '(none available in the next 14 days — check calendar configuration)'}`,
  ].join('\n')
}
