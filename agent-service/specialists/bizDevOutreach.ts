// Business-development outreach for ordinary (non-destination) contacts —
// the smallest reusable extension to Chief's existing infrastructure.
//
// What it reuses (nothing parallel is created):
//   - agent.tasks / agent.task_events / agent.contacts / agent.interactions,
//     with the EXISTING TaskStatus set (the opportunity is one task that
//     lives in WAITING and escalates to NEEDS_JERRY / terminal CANCELED).
//   - mutations.ts (createTask / transitionTask / updateTaskPlan) for every
//     status or plan change, so the audit trail is the normal one.
//   - RealGmailAdapter for search/read/send, classifyReply() for intent,
//     isKnownForwardingAddress() for the Resend relay, the launchd
//     com.checkoff.chief-monitor loop as the scheduler (monitorCli.ts
//     calls runBizDevTick() once per poll).
//
// What it deliberately does NOT touch: the destination_relationship
// playbook, whose send_email stays APPROVAL_REQUIRED. Autonomous sending
// exists ONLY for sequences registered in BIZDEV_SEQUENCES below (an
// explicit, code-reviewed allowlist) — a task whose metadata names any
// other sequence key is never sent to.
//
// The SAME engine also drives multi-recipient campaigns (mode: 'campaign'):
// recipients are ordinary tasks of this kind, the campaign definition lives in a
// 'bizdev_campaign' task (see bizDevCampaign.ts), and a campaign sends only
// after Jerry's recorded approval (standing authority bizdev_campaign.*).
//
// State lives in agent.tasks.metadata.bizdev (jsonb, already present).
// Duplicate-send protection: a step is atomically CLAIMED in the DB before
// the Gmail send; a crash after the claim can never re-send (it escalates
// to Jerry instead), and a send failure is never retried automatically.

import type { GmailAdapter, GmailFullMessage, GmailMessageSummary } from './googleAdapters'
import { extractEmailAddress } from '../playbooks/gmailRelationshipLogic'
import { evaluateAuthority } from '../playbooks/standingAuthority'
import { query, withWriteTransaction } from '../db'
import { transitionTask, updateTaskPlan } from '../mutations'
import type { TaskStatus } from '../types'
import {
  resolveSender, matchesSequence, isBounce, classifyBounce, isOwnSend, safeIso, stripQuoted, decideReply, decideCampaignReply, buildEscalation, buildCampaignEscalation, OWN_ADDRESSES, type ReplyDecision,
} from './bizDevReplies'
import { renderTemplate, validateOutreachCopy } from './outreachTemplates'
import { PriorContactIndex, describeConflicts, normalizeEmail, type ContactedRecord } from './priorContact'
import {
  campaignToDef, computeCapacity, firstTouchAllowance, CAMPAIGN_DEFAULTS, campaignScanQueries, bounceRateTripped, isSystemicSendError, gmailDay, MAX_FETCH_PER_TICK, MAX_PROCESSED_IDS, type CampaignRuntime,
} from './bizDevCampaign'

// Reply logic lives in bizDevReplies.ts (pure); re-exported so existing imports keep working.
export {
  resolveSender, matchesSequence, isBounce, classifyBounce, safeIso, stripQuoted, isAutoReply, isOptOut, decideReply, decideCampaignReply, extractCommercialTerms, buildEscalation, buildCampaignEscalation, OWN_ADDRESSES,
} from './bizDevReplies'
export type { ReplyDecision, ReplyKind, ReplyClass } from './bizDevReplies'

// ---------------------------------------------------------------------------
// Sequence allowlist
// ---------------------------------------------------------------------------

export interface BizDevFollowUp {
  /** 2 = Follow-Up 1, 3 = Follow-Up 2 (step 1 is the initial email, sent by hand/script). */
  step: number
  /** Business days (Mon–Fri) after the PREVIOUS step was sent. */
  afterBusinessDays: number
  bodyText: string
}

export interface BizDevSequenceDef {
  key: string
  contactName: string
  contactEmail: string
  organization: string
  /** Must be a verified Gmail send-as identity. */
  from: string
  subject: string
  followUps: readonly BizDevFollowUp[]
  /** Business days after the LAST email before the opportunity is closed. No email is sent at close. */
  closeAfterBusinessDays: number
  /** Hard cap on outbound emails to this contact while there is no response, initial included. */
  maxOutbound: number
  /** Business days Winston waits after a routine-FAQ answer before asking Jerry what to do. */
  answeredWaitBusinessDays: number
  /** 'single' (default) = one named contact on a code allowlist (Blair). 'campaign' = per-recipient fields come from each recipient's contact + merge vars. */
  mode?: 'single' | 'campaign'
  campaignKey?: string
  /** Campaign only: auto-answer routine factual questions. Single-contact sequences always may. */
  faqEnabled?: boolean
  /** Campaign only: the literal stem of the subject, what the batched reply scan searches on. */
  subjectSearchTerm?: string
}

const SIGNATURE = '\n\nJerry Stuckart\nFounder, CheckOff\njerry@getcheckoff.com'

export const BIZDEV_SEQUENCES: Readonly<Record<string, BizDevSequenceDef>> = Object.freeze({
  'living-north-phoenix-v1': {
    key: 'living-north-phoenix-v1',
    contactName: 'Blair Ballin',
    contactEmail: 'blair@livingnorthphoenix.com',
    organization: 'Living North Phoenix',
    from: 'jerry@getcheckoff.com',
    subject: 'Fellow local guy building something for North Phoenix',
    followUps: [
      {
        step: 2,
        afterBusinessDays: 5,
        bodyText:
          'Hey Blair,\n\nJust circling back on my note from a few days ago. I know your inbox is probably full.\n\nI genuinely like what you\'re doing with Living North Phoenix, connecting neighbors with the local businesses that make this area what it is. That\'s the same thing we care about at CheckOff, which was built right here in the Peoria area.\n\nWould you be open to exploring a collaboration? Happy to keep it simple and on your terms.\n\nThanks, Blair!' +
          SIGNATURE,
      },
      {
        step: 3,
        afterBusinessDays: 7,
        bodyText:
          'Hey Blair,\n\nOne last note from me, and then I\'ll stop cluttering your inbox.\n\nOne idea I\'d have fun exploring with you is "Living North Phoenix Favorites" on CheckOff: a curated list of your favorite North Phoenix restaurants, hidden gems, neighborhood businesses, and local experiences. It could give your readers something new to explore, put a little more spotlight on local businesses, and give CheckOff a chance to reach people who care about this community.\n\nThat\'s only a starting idea. Nothing has been created or promised, and I\'d only move forward if it made sense for you.\n\nIf it\'s not a fit, no worries at all. Either way, I appreciate what you\'re doing for North Phoenix.' +
          SIGNATURE,
      },
    ],
    closeAfterBusinessDays: 7,
    maxOutbound: 3,
    answeredWaitBusinessDays: 10,
  },
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Mon–Fri only; no holiday calendar (documented limitation). */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let remaining = days
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) remaining--
  }
  return d
}

export type SequenceStatus =
  | 'QUEUED'
  | 'ACTIVE'
  | 'ANSWERED'
  | 'ESCALATED'
  | 'DECLINED'
  | 'OPTED_OUT'
  | 'COMPLETE_NO_RESPONSE'
  | 'PAUSED'
  | 'CONFIRMED'
  | 'DEFERRED'
  | 'BOUNCED'
  | 'SEND_UNCERTAIN'
  | 'EXPIRED'
  | 'PRIOR_CONTACT'

export interface BizDevSentStep {
  step: number
  kind: 'INITIAL' | 'FOLLOW_UP' | 'FAQ_ANSWER'
  messageId: string
  sentAt: string
}

export interface BizDevSendAttempt {
  step: number
  at: string
  outcome: 'ATTEMPTED' | 'ACCEPTED' | 'UNCERTAIN'
  detail?: string
}

export interface BizDevListing {
  itemId: string
  text: string
  token: string
  confirmUrl: string
}

export interface BizDevState {
  sequenceKey: string
  contactEmail: string
  threadId: string
  sequenceStatus: SequenceStatus
  stepsSent: BizDevSentStep[]
  /** Highest step ever claimed for sending — the duplicate-send latch. */
  claimedStep?: number
  processedMessageIds?: string[]
  autoAnswers?: number
  answeredAt?: string
  lastError?: string
  deliveryFailure?: { messageId: string; detectedAt: string; reason: string }
  /** Earlier sends that bounced (never delivered). They still appear in Gmail Sent, so the manual-contact guard must count them. */
  failedSends?: Array<{ messageId: string; threadId: string; sentAt: string; bounceMessageId: string; reason: string }>
  // ---- campaign recipients only ----
  campaignKey?: string
  /** The rendered first-touch subject; follow-ups are "Re: <subject>". */
  subject?: string
  /** Merge values frozen at approval so every message (and every re-run) renders identically. */
  vars?: Record<string, string>
  listings?: BizDevListing[]
  /** Every attempted and accepted send, in order. */
  attempts?: BizDevSendAttempt[]
  deferredUntil?: string
  lastReplyClass?: string
  [k: string]: unknown
}

export interface BizDevSequenceView {
  taskId: string
  taskUpdatedAt: Date
  contactId: string
  contactEmail: string
  contactName?: string | null
  organization?: string | null
  contactSuppressed: boolean
  state: BizDevState
}

/** Next scheduled instant (cadence is business days after the PREVIOUS send). */
export type DueAction =
  | { kind: 'NONE' }
  | { kind: 'SEND'; followUp: BizDevFollowUp; dueAt: Date }
  | { kind: 'CLOSE'; dueAt: Date }

/** Deterministic: what (if anything) is due for an ACTIVE sequence at `now`. */
export function dueAction(def: BizDevSequenceDef, state: BizDevState, now: Date): DueAction {
  if (state.sequenceStatus !== 'ACTIVE') return { kind: 'NONE' }
  const sent = state.stepsSent.length
  if (sent === 0) return { kind: 'NONE' }
  const last = state.stepsSent[sent - 1]
  const nextFollowUp = def.followUps.find((f) => f.step === sent + 1)
  if (nextFollowUp && sent < def.maxOutbound) {
    const dueAt = addBusinessDays(new Date(last.sentAt), nextFollowUp.afterBusinessDays)
    return now >= dueAt ? { kind: 'SEND', followUp: nextFollowUp, dueAt } : { kind: 'NONE' }
  }
  const closeAt = addBusinessDays(new Date(last.sentAt), def.closeAfterBusinessDays)
  return now >= closeAt ? { kind: 'CLOSE', dueAt: closeAt } : { kind: 'NONE' }
}

export function nextScheduledAt(def: BizDevSequenceDef, state: BizDevState): Date | null {
  const sent = state.stepsSent.length
  if (sent === 0) return null
  const last = state.stepsSent[sent - 1]
  const nextFollowUp = def.followUps.find((f) => f.step === sent + 1)
  if (nextFollowUp && sent < def.maxOutbound) return addBusinessDays(new Date(last.sentAt), nextFollowUp.afterBusinessDays)
  return addBusinessDays(new Date(last.sentAt), def.closeAfterBusinessDays)
}

// ---------------------------------------------------------------------------
// Store port (DB in production, in-memory in tests)
// ---------------------------------------------------------------------------

export type TransitionTarget = 'NEEDS_JERRY' | 'CANCELED' | 'DONE' | 'WAITING' | 'BLOCKED'

export interface TransitionDetail {
  jerryRequest?: string
  nextAction?: string
  reason?: string
  nextCheckAt?: Date
  blockerNote?: string
}

export interface BizDevStore {
  listActive(): Promise<BizDevSequenceView[]>
  /** Atomically latches `step`; false means it was already claimed (never send). */
  claimStep(taskId: string, step: number): Promise<boolean>
  saveState(taskId: string, state: BizDevState): Promise<void>
  recordInteraction(i: { contactId: string; taskId: string; direction: 'INBOUND' | 'OUTBOUND'; occurredAt: string; subject: string; summary: string; requiresAction: boolean; messageId: string; threadId: string; extra?: Record<string, unknown> }): Promise<void>
  suppressContact(contactId: string): Promise<void>
  setPlan(taskId: string, plan: { nextCheckAt: Date; nextAction: string }): Promise<void>
  transition(taskId: string, to: TransitionTarget, detail: TransitionDetail): Promise<void>
  // ---- campaign support (optional so single-contact stores/fakes stay valid) ----
  listQueued?(): Promise<BizDevSequenceView[]>
  listUncertain?(): Promise<BizDevSequenceView[]>
  campaignRuntimes?(): Promise<CampaignRuntime[]>
  /** Merge-patches the runtime and mirrors state onto the campaign task's status. `escalate` also moves the campaign task to NEEDS_JERRY. */
  saveCampaign?(key: string, patch: Partial<CampaignRuntime> & { escalate?: { jerryRequest: string; nextAction: string } }): Promise<void>
  setCampaignProgress?(key: string, line: string): Promise<void>
  /** Which of these /confirm tokens exist in public.business_outreach_tokens (read-only). */
  confirmTokensExist?(tokens: string[]): Promise<Set<string>>
  /** Everything already recorded as contacted (all campaigns, test/canary excluded). Feeds the send-time prior-contact barrier. */
  contactedRecords?(): Promise<ContactedRecord[]>
  /** token -> the item_id its row points at (tokens with no row are absent). Lets the sender verify a token matches the approved item. */
  confirmTokenItems?(tokens: string[]): Promise<Map<string, string>>
  /** First touches this campaign sent at or after `since` (source of truth: the recipients' recorded sends). Drives the daily first-touch limit. */
  countFirstTouchesSince?(campaignKey: string, since: Date): Promise<number>
}

export interface BizDevTickResult {
  actions: string[]
  errors: string[]
}

export interface BizDevDeps {
  gmail: GmailAdapter
  store: BizDevStore
  now?: () => Date
  sequences?: Readonly<Record<string, BizDevSequenceDef>>
  /** Injectable pacing so tests never wait. */
  sleep?: (ms: number) => Promise<void>
}

function pushProcessed(state: BizDevState, id: string): void {
  state.processedMessageIds = [...(state.processedMessageIds ?? []), id].slice(-200)
}

// ---------------------------------------------------------------------------
// Per-tick context (campaign scan results + the shared daily budget)
// ---------------------------------------------------------------------------

interface Budget {
  remaining: number
  sentLast24h: number
  effectiveCap: number
}

interface TickCtx {
  runtimes: Map<string, CampaignRuntime>
  inbound: Map<string, GmailFullMessage[]>
  fullCache: Map<string, GmailFullMessage>
  budgets: Map<string, Budget>
  /** Follow-ups falling due within the next 24h, per sending identity: capacity held back from new first touches. */
  reserved: Map<string, number>
  firstTouchStats: Map<string, { sentLast24h: number; limit: number; allowed: number; limitedBy: string }>
  tokensChecked: Map<string, Set<string>>
  /** Campaign message ids fully handled this tick (merged into the campaign's scan cursor so closed recipients' mail is never re-fetched). */
  handled: Map<string, string[]>
}

async function getFull(deps: BizDevDeps, ctx: TickCtx, id: string): Promise<GmailFullMessage> {
  const hit = ctx.fullCache.get(id)
  if (hit) return hit
  const full = await deps.gmail.getFullMessage(id)
  ctx.fullCache.set(id, full)
  return full
}

async function listIds(gmail: GmailAdapter, q: string, max: number): Promise<Array<{ id: string; threadId: string }>> {
  if (gmail.searchMessageIds) return gmail.searchMessageIds(q, max)
  return (await gmail.searchMessages(q, Math.min(max, 100))).map((m) => ({ id: m.id, threadId: m.threadId }))
}

/** Everything sent from this identity in the last rolling 24h — Winston's own sends AND anything else (manual replies), per "include other outgoing activity". */
async function getBudget(deps: BizDevDeps, ctx: TickCtx, c: CampaignRuntime): Promise<Budget> {
  // ONE budget per sending identity, shared by every campaign that sends from it: the cap is a property of the mailbox/provider, not of a campaign.
  const sender = c.from.toLowerCase()
  const hit = ctx.budgets.get(sender)
  if (hit) return hit
  const same = [...ctx.runtimes.values()].filter((r) => r.from.toLowerCase() === sender)
  const strictest = same.length ? same : [c]
  const sent = await listIds(deps.gmail, `in:sent from:${c.from} newer_than:1d`, 500)
  const cap = computeCapacity({ dailyCap: Math.min(...strictest.map((r) => r.dailyCap)), providerLimit: Math.min(...strictest.map((r) => r.providerLimit)), reserve: Math.max(...strictest.map((r) => r.reserve)), sentLast24h: sent.length })
  const b: Budget = { remaining: cap.remaining, sentLast24h: cap.sentLast24h, effectiveCap: cap.effectiveCap }
  ctx.budgets.set(sender, b)
  return b
}

function markHandled(ctx: TickCtx, def: BizDevSequenceDef, id: string): void {
  if (!def.campaignKey) return
  ctx.handled.set(def.campaignKey, [...(ctx.handled.get(def.campaignKey) ?? []), id])
}

const toSummary = (m: GmailFullMessage): GmailMessageSummary => ({ id: m.id, threadId: m.threadId, from: m.from, to: m.to, subject: m.subject, snippet: '', receivedAt: m.receivedAt, replyTo: m.replyTo })

function effectiveDef(def: BizDevSequenceDef, view: BizDevSequenceView): BizDevSequenceDef {
  if (def.mode !== 'campaign') return def
  const name = view.contactName?.trim() || view.organization?.trim() || 'there'
  const org = view.organization?.trim() || view.contactName?.trim() || view.contactEmail
  return { ...def, contactEmail: view.contactEmail, contactName: name, organization: org }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export async function runBizDevTick(deps: BizDevDeps): Promise<BizDevTickResult> {
  const now = (deps.now ?? (() => new Date()))()
  const result: BizDevTickResult = { actions: [], errors: [] }
  if (!deps.gmail.isConfigured()) return result

  const defs: Record<string, BizDevSequenceDef> = { ...(deps.sequences ?? BIZDEV_SEQUENCES) }
  const runtimes = deps.store.campaignRuntimes ? await deps.store.campaignRuntimes() : []
  const ctx: TickCtx = { runtimes: new Map(), inbound: new Map(), fullCache: new Map(), budgets: new Map(), reserved: new Map(), firstTouchStats: new Map(), tokensChecked: new Map(), handled: new Map() }
  for (const c of runtimes) {
    // A campaign is only ever acted on with Jerry's recorded approval (standing authority: APPROVAL_REQUIRED, satisfied only by campaign.approval).
    if (!c.approval || c.approval.approvedBy !== 'jerry') continue
    ctx.runtimes.set(c.key, c)
    defs[`campaign:${c.key}`] = campaignToDef(c)
  }

  let views = await deps.store.listActive()

  // 0. Hard stop: an expired campaign sends nothing more, closes every recipient, and completes (records are preserved, not deleted).
  for (const c of [...ctx.runtimes.values()]) {
    if (!c.expiresAt || now < new Date(c.expiresAt)) continue
    try {
      await expireCampaign(deps, c, views, now, result)
    } catch (err) {
      result.errors.push(`campaign:${c.key}: expiry failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    ctx.runtimes.delete(c.key)
    views = views.filter((v) => v.state.campaignKey !== c.key)
  }

  // 1. One batched scan per campaign (never one search per recipient).
  const byCampaign = new Map<string, BizDevSequenceView[]>()
  for (const v of views) {
    const ck = v.state.campaignKey
    if (ck && ctx.runtimes.has(ck)) byCampaign.set(ck, [...(byCampaign.get(ck) ?? []), v])
  }
  for (const [ck, vs] of byCampaign) {
    try {
      await scanCampaignInbound(deps, ctx, ctx.runtimes.get(ck)!, vs, now, result)
    } catch (err) {
      result.errors.push(`campaign:${ck}: scan failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 1b. Capacity held back for follow-ups that fall due in the next 24h (those already due are sent in step 2, before any first touch).
  const horizon = new Date(now.getTime() + 86_400_000)
  for (const v of views) {
    const c = v.state.campaignKey ? ctx.runtimes.get(v.state.campaignKey) : undefined
    const def = defs[v.state.sequenceKey]
    if (!c || c.state !== 'ACTIVE' || !def || def.mode !== 'campaign') continue
    const d = dueAction(effectiveDef(def, v), v.state, horizon)
    if (d.kind === 'SEND' && d.dueAt > now) ctx.reserved.set(c.from.toLowerCase(), (ctx.reserved.get(c.from.toLowerCase()) ?? 0) + 1)
  }

  // 2. Replies, bounces, follow-ups, closes.
  for (const view of views) {
    const def = defs[view.state.sequenceKey]
    if (!def) continue // not explicitly authorized -> never touched
    if (def.mode === 'campaign') {
      if (!def.campaignKey || view.state.campaignKey !== def.campaignKey) continue
    } else if (def.contactEmail.toLowerCase() !== view.contactEmail.toLowerCase()) continue
    try {
      await processSequence(deps, ctx, effectiveDef(def, view), view, now, result)
    } catch (err) {
      result.errors.push(`${def.key}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 3. First touches (respecting the daily governor), uncertain-send reconciliation, completion, progress.
  if (deps.store.listQueued) {
    try {
      await runCampaignSends(deps, ctx, now, result, views)
    } catch (err) {
      result.errors.push(`campaign sends: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 4. Persist the scan cursor additions (handled mail is never fetched again).
  for (const [key, ids] of ctx.handled) {
    const c = ctx.runtimes.get(key)
    if (!c || ids.length === 0) continue
    c.scan = { ...c.scan, processedMessageIds: [...c.scan.processedMessageIds, ...ids].slice(-MAX_PROCESSED_IDS) }
    try {
      await deps.store.saveCampaign?.(key, { scan: c.scan })
    } catch (err) {
      result.errors.push(`campaign:${key}: could not save scan cursor: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Batched inbound scan (campaigns)
// ---------------------------------------------------------------------------

async function scanCampaignInbound(deps: BizDevDeps, ctx: TickCtx, c: CampaignRuntime, views: BizDevSequenceView[], now: Date, out: BizDevTickResult): Promise<void> {
  const idSets = await Promise.all(campaignScanQueries(c).map((q) => listIds(deps.gmail, q, 500)))
  const seen = new Set<string>(c.scan.processedMessageIds)
  for (const v of views) for (const id of v.state.processedMessageIds ?? []) seen.add(id)
  const fresh: Array<{ id: string; threadId: string }> = []
  for (const set of idSets) for (const m of set) if (!seen.has(m.id) && !fresh.some((f) => f.id === m.id)) fresh.push(m)
  if (fresh.length === 0) return

  const byEmail = new Map(views.map((v) => [v.contactEmail.toLowerCase(), v]))
  const byThread = new Map(views.filter((v) => v.state.threadId).map((v) => [v.state.threadId, v]))
  const batch = fresh.slice(0, MAX_FETCH_PER_TICK)
  const unmatched: string[] = []
  for (const m of batch) {
    const full = await getFull(deps, ctx, m.id)
    let view: BizDevSequenceView | undefined
    if (isBounce(full)) view = byThread.get(full.threadId)
    else {
      const sender = resolveSender(full)
      view = (sender && byEmail.get(sender)) || byThread.get(full.threadId)
      if (view && !matchesSequence(full, view.state, view.state.subject)) view = undefined
    }
    if (view) ctx.inbound.set(view.taskId, [...(ctx.inbound.get(view.taskId) ?? []), full])
    else unmatched.push(m.id)
  }
  // Unmatched messages are remembered so they are never re-fetched; matched ones are remembered by the recipient state once handled.
  const merged = [...c.scan.processedMessageIds, ...unmatched].slice(-MAX_PROCESSED_IDS)
  c.scan = { ...c.scan, processedMessageIds: merged }
  await deps.store.saveCampaign?.(c.key, { scan: c.scan })
  out.actions.push(`campaign:${c.key}: scanned ${batch.length} new message(s)${fresh.length > batch.length ? `, ${fresh.length - batch.length} deferred to next tick` : ''}`)
}

// ---------------------------------------------------------------------------
// Per-sequence processing
// ---------------------------------------------------------------------------

function statusAfter(decision: ReplyDecision): SequenceStatus {
  switch (decision.kind) {
    case 'OPT_OUT': return 'OPTED_OUT'
    case 'DECLINED': return 'DECLINED'
    case 'FAQ': return 'ANSWERED'
    case 'CONFIRMED': return 'CONFIRMED'
    case 'DEFERRED': return 'DEFERRED'
    default: return 'ESCALATED'
  }
}

async function processSequence(deps: BizDevDeps, ctx: TickCtx, def: BizDevSequenceDef, view: BizDevSequenceView, now: Date, out: BizDevTickResult): Promise<void> {
  const { store, gmail } = deps
  const isCampaign = def.mode === 'campaign'
  const campaign = isCampaign ? ctx.runtimes.get(def.campaignKey ?? '') : undefined
  const state: BizDevState = { ...view.state, stepsSent: [...view.state.stepsSent] }
  const firstSent = state.stepsSent[0]
  if (!firstSent) return
  const ourSubject = state.subject ?? def.subject

  // ---- 0. Self-heal: a stopped sequence whose task is still WAITING (e.g. a crash between saving state and moving the task) is finished off, never left to drift. ----
  if (state.sequenceStatus === 'DECLINED' || state.sequenceStatus === 'OPTED_OUT' || state.sequenceStatus === 'COMPLETE_NO_RESPONSE' || state.sequenceStatus === 'BOUNCED' || state.sequenceStatus === 'EXPIRED' || state.sequenceStatus === 'PRIOR_CONTACT') {
    await store.transition(view.taskId, 'CANCELED', { reason: `Sequence state ${state.sequenceStatus}; task closed by recovery check.` })
    out.actions.push(`${def.key}: recovered stranded ${state.sequenceStatus} -> CANCELED`)
    return
  }
  if (state.sequenceStatus === 'CONFIRMED') {
    await store.transition(view.taskId, 'DONE', {})
    out.actions.push(`${def.key}: recovered stranded CONFIRMED -> DONE`)
    return
  }
  if (state.sequenceStatus === 'ESCALATED' || state.sequenceStatus === 'PAUSED') {
    await store.transition(view.taskId, 'NEEDS_JERRY', {
      jerryRequest: `Opportunity: ${def.organization} Partnership\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY\nConversation Summary: Automation stopped (${state.sequenceStatus}${state.lastError ? `: ${state.lastError}` : ''}) but the task had not been handed over. Open the Gmail thread ${state.threadId} for the latest messages.\nJerry Action Required: Review the thread and decide the next step.`,
      nextAction: `Jerry: review Gmail thread ${state.threadId} with ${def.contactName}.`,
    })
    out.actions.push(`${def.key}: recovered stranded ${state.sequenceStatus} -> NEEDS_JERRY`)
    return
  }

  // ---- 1. Replies first: a response always beats a scheduled follow-up. ----
  let found: GmailMessageSummary[]
  if (isCampaign) {
    found = (ctx.inbound.get(view.taskId) ?? []).map(toSummary)
  } else {
    const sinceDay = new Date(new Date(firstSent.sentAt).getTime() - 86_400_000).toISOString().slice(0, 10).replace(/-/g, '/')
    found = await gmail.searchMessages(`after:${sinceDay} -in:sent -in:drafts (from:${def.contactEmail} OR "${def.contactEmail}")`, 25)
  }
  const processed = new Set(state.processedMessageIds ?? [])

  // 1-pre. A follow-up is about to go out. Do not rely on the batched scan alone: ask Gmail DIRECTLY whether THIS business
  // has replied or bounced since the first touch. Anything found goes through the normal reply/bounce handling below, and
  // handling a reply cancels the follow-up before it can be sent.
  const forced = new Set<string>()
  if (isCampaign && dueAction(def, state, now).kind === 'SEND') {
    const extra = await preSendInboundCheck(deps, ctx, def, state, firstSent.sentAt, processed)
    for (const m of extra) {
      forced.add(m.id)
      if (!found.some((x) => x.id === m.id)) found.push(toSummary(m))
    }
    out.actions.push(`${def.key}: pre-follow-up Gmail check for ${def.contactEmail}: ${extra.length === 0 ? 'no reply or bounce' : `${extra.length} message(s) to handle first`}`)
  }

  // 1a. Bounces in our thread: the email never arrived. This is not a response.
  const bounce = found.find((m) => !processed.has(m.id) && (m.threadId === state.threadId || forced.has(m.id)) && isBounce(m))
  if (bounce) {
    const full = await getFull(deps, ctx, bounce.id)
    const reason = full.bodyText.replace(/\s+/g, ' ').trim().slice(0, 600)
    pushProcessed(state, bounce.id)
    if (isCampaign) markHandled(ctx, def, bounce.id)
    if (isCampaign && campaign) {
      await handleCampaignBounce(deps, campaign, def, view, state, full, reason, now, out)
      return
    }
    state.sequenceStatus = 'PAUSED'
    state.deliveryFailure = { messageId: bounce.id, detectedAt: now.toISOString(), reason }
    await store.saveState(view.taskId, state)
    await store.recordInteraction({ contactId: view.contactId, taskId: view.taskId, direction: 'INBOUND', occurredAt: safeIso(full.receivedAt, now), subject: full.subject, summary: `[BOUNCE] ${reason.slice(0, 400)}`, requiresAction: true, messageId: bounce.id, threadId: full.threadId, extra: { decision: 'BOUNCE' } })
    await store.transition(view.taskId, 'NEEDS_JERRY', {
      jerryRequest: `Opportunity: ${def.organization} Partnership\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY (all automated sends paused)\nConversation Summary: Winston sent step ${state.stepsSent.length} from ${def.from} (Gmail accepted it) but Gmail then returned a delivery failure, so ${def.contactName} did NOT receive it. No follow-ups will go out while the sender is broken.\nProvider error: "${reason}"\nOpportunity Assessment: Nothing is wrong with the opportunity; this is a sender-configuration failure.\nWinston's Recommendation: Fix the Gmail "Send mail as" SMTP credentials for ${def.from} (Gmail > Settings > Accounts > Send mail as > edit info), then tell Winston to re-send the initial email and restart the sequence.\nJerry Action Required: Repair the send-as credentials, then reply "resume". Thread: ${state.threadId}, bounce message ${bounce.id}.`,
      nextAction: `Jerry: repair ${def.from} send-as SMTP credentials (535 auth error), then have Winston re-send to ${def.contactName}.`,
    })
    out.actions.push(`${def.key}: DELIVERY FAILURE detected -> paused, NEEDS_JERRY`)
    return
  }

  const candidates = found.filter((m) => !processed.has(m.id) && !isBounce(m) && (matchesSequence(m, state, ourSubject) || forced.has(m.id)))
  candidates.sort((a, b) => (a.receivedAt ? Date.parse(a.receivedAt) || 0 : 0) - (b.receivedAt ? Date.parse(b.receivedAt) || 0 : 0))

  for (const summary of candidates) {
    const full: GmailFullMessage = await getFull(deps, ctx, summary.id)
    const text = stripQuoted(full.bodyText)
    const decision = isCampaign
      ? decideCampaignReply(full.subject, full.bodyText, { attachments: full.attachments, autoAnswersSoFar: state.autoAnswers ?? 0, faqEnabled: def.faqEnabled ?? false, now })
      : decideReply(full.subject, full.bodyText, state.autoAnswers ?? 0)
    pushProcessed(state, summary.id)
    if (isCampaign) markHandled(ctx, def, summary.id)

    if (decision.kind === 'AUTO_REPLY_IGNORED') {
      await store.saveState(view.taskId, state)
      out.actions.push(`${def.key}: ignored auto-reply ${summary.id}`)
      continue
    }

    // Cancel pending follow-ups IMMEDIATELY (persisted before anything else can happen).
    const prevStatus = state.sequenceStatus
    state.sequenceStatus = statusAfter(decision)
    state.lastReplyClass = decision.replyClass
    if (decision.kind === 'DEFERRED') state.deferredUntil = decision.deferredUntil
    await store.saveState(view.taskId, state)
    const needsAction = decision.kind === 'ESCALATE' || decision.kind === 'CORRECTION' || decision.kind === 'PHOTO'
    await store.recordInteraction({
      contactId: view.contactId, taskId: view.taskId, direction: 'INBOUND', occurredAt: safeIso(full.receivedAt, now), subject: full.subject,
      summary: `[${decision.replyClass ?? decision.classification}] ${text.slice(0, 500)}`, requiresAction: needsAction, messageId: summary.id, threadId: full.threadId,
      extra: { decision: decision.kind, replyClass: decision.replyClass, previousSequenceStatus: prevStatus, transportSender: extractEmailAddress(full.from), originalSender: resolveSender(full), attachmentCount: full.attachments?.length ?? 0 },
    })
    out.actions.push(`${def.key}: reply ${summary.id} -> ${decision.kind}; follow-ups cancelled`)

    if (decision.kind === 'OPT_OUT') {
      await store.suppressContact(view.contactId)
      await store.transition(view.taskId, 'CANCELED', { reason: `Contact opted out: "${text.slice(0, 160)}"` })
    } else if (decision.kind === 'DECLINED') {
      await store.transition(view.taskId, 'CANCELED', { reason: `Contact declined: "${text.slice(0, 160)}"` })
    } else if (decision.kind === 'CONFIRMED') {
      // Routine: recorded, closed, and NOT sent to Jerry. (The /confirm page remains the only writer of business_confirmation_submissions.)
      await store.transition(view.taskId, 'DONE', {})
    } else if (decision.kind === 'DEFERRED') {
      await store.setPlan(view.taskId, { nextCheckAt: new Date(decision.deferredUntil ?? addBusinessDays(now, 20).toISOString()), nextAction: `Business asked to be contacted around ${(decision.deferredUntil ?? '').slice(0, 10)}; no automated outreach until then.` })
    } else if (decision.kind === 'FAQ') {
      const first = def.contactName.split(' ')[0]
      const sent = await sendInThread(deps, def, state, `Hey ${first},\n\n${decision.faqAnswer}\n\nThanks, ${first}!${SIGNATURE}`, full.messageIdHeader, 'FAQ_ANSWER', view, now)
      state.autoAnswers = (state.autoAnswers ?? 0) + 1
      state.answeredAt = now.toISOString()
      await store.saveState(view.taskId, state)
      await store.setPlan(view.taskId, { nextCheckAt: addBusinessDays(now, def.answeredWaitBusinessDays), nextAction: `Answered a routine question (message ${sent}); no further automated outreach. If no reply, escalate to Jerry.` })
      out.actions.push(`${def.key}: answered routine FAQ (message ${sent})`)
    } else {
      const esc = isCampaign
        ? buildCampaignEscalation(def, state, decision, text, { id: summary.id, threadId: full.threadId, subject: full.subject })
        : buildEscalation(def, state, decision, text, { id: summary.id, threadId: full.threadId, subject: full.subject })
      await store.transition(view.taskId, 'NEEDS_JERRY', { jerryRequest: esc.jerryRequest, nextAction: esc.nextAction })
      out.actions.push(`${def.key}: escalated to NEEDS_JERRY (${decision.replyClass ?? decision.classification})`)
    }
    return // sequence is no longer ACTIVE; nothing else to do this tick
  }
  if (candidates.length > 0) return // only auto-replies were seen; state saved, fall through next tick

  // ---- 2. ANSWERED / DEFERRED -> after the wait, hand back to Jerry (no silent limbo). ----
  if (state.sequenceStatus === 'DEFERRED') {
    if (state.deferredUntil && now >= new Date(state.deferredUntil)) {
      state.sequenceStatus = 'ESCALATED'
      await store.saveState(view.taskId, state)
      await store.transition(view.taskId, 'NEEDS_JERRY', {
        jerryRequest: `Opportunity: ${def.organization}\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY\nConversation Summary: The business asked to be contacted around ${state.deferredUntil.slice(0, 10)}. That date has arrived; Winston sent nothing further.\nJerry Action Required: Decide whether to follow up personally. Gmail thread ${state.threadId}.`,
        nextAction: `Jerry: the requested contact date for ${def.organization} has arrived (thread ${state.threadId}).`,
      })
      out.actions.push(`${def.key}: deferral date reached -> NEEDS_JERRY`)
    }
    return
  }
  if (state.sequenceStatus === 'ANSWERED') {
    const waitUntil = addBusinessDays(new Date(state.answeredAt ?? now.toISOString()), def.answeredWaitBusinessDays)
    if (now >= waitUntil) {
      state.sequenceStatus = 'ESCALATED'
      await store.saveState(view.taskId, state)
      await store.transition(view.taskId, 'NEEDS_JERRY', {
        jerryRequest: `Opportunity: ${def.organization} Partnership\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY\nConversation Summary: ${def.contactName} asked a routine question; Winston answered from verified facts and sent nothing further. No further reply in ${def.answeredWaitBusinessDays} business days.\nWinston's Recommendation: Decide whether to send one personal note or close.\nJerry Action Required: Choose follow up vs. close. Gmail thread ${state.threadId}.`,
        nextAction: `Jerry: decide whether to follow up with ${def.contactName} (thread ${state.threadId}).`,
      })
      out.actions.push(`${def.key}: answered, no response -> NEEDS_JERRY`)
    }
    return
  }
  if (state.sequenceStatus !== 'ACTIVE') return

  // ---- 3. Scheduled follow-up / close. ----
  const due = dueAction(def, state, now)
  if (due.kind === 'NONE') return

  if (view.contactSuppressed) {
    state.sequenceStatus = 'OPTED_OUT'
    await store.saveState(view.taskId, state)
    await store.transition(view.taskId, 'CANCELED', { reason: 'Contact is suppressed (do-not-contact); sequence stopped.' })
    out.actions.push(`${def.key}: suppressed contact, stopped`)
    return
  }

  if (due.kind === 'CLOSE') {
    state.sequenceStatus = 'COMPLETE_NO_RESPONSE'
    await store.saveState(view.taskId, state)
    await store.transition(view.taskId, 'CANCELED', { reason: `No response after the approved ${state.stepsSent.length}-email sequence (final email ${state.stepsSent[state.stepsSent.length - 1].sentAt.slice(0, 10)}); closed per plan. No further emails.` })
    out.actions.push(`${def.key}: sequence complete, closed (no email sent)`)
    return
  }

  // SEND: campaign gates first (paused campaigns send nothing; the daily governor applies to follow-ups too).
  let budget: Budget | undefined
  if (isCampaign) {
    evaluateAuthority('bizdev_campaign.send_follow_up') // APPROVAL_REQUIRED: runBizDevTick only loads campaigns carrying Jerry's recorded approval
    if (!campaign || campaign.state !== 'ACTIVE') { out.actions.push(`${def.key}: follow-up due but campaign is ${campaign?.state ?? 'unknown'}; not sent`); return }
    budget = await getBudget(deps, ctx, campaign)
    if (budget.remaining <= 0) { out.actions.push(`${def.key}: follow-up due but daily cap reached (${budget.sentLast24h}/${budget.effectiveCap}); deferred`); return }
  }

  // SEND: guard rails, then claim, then send exactly once.
  const outboundCount = state.stepsSent.filter((s) => s.kind !== 'FAQ_ANSWER').length
  if (outboundCount >= def.maxOutbound) return
  const step = due.followUp.step
  if (state.stepsSent.length + 1 !== step) return

  // If Jerry (or anything else) has emailed this contact SINCE WE STARTED, don't pile on: hand over. Mail sent before the sequence began,
  // and our own sends (including Gmail's self-delivered duplicate of one), do not count.
  const sinceDay = gmailDay(new Date(Date.parse(firstSent.sentAt) - 86_400_000))
  const sentToContact = await gmail.searchMessages(`in:sent to:${def.contactEmail} after:${sinceDay}`, 50)
  // Gmail's after: is day-granular, so refine by the real timestamp: only mail sent AFTER the first touch counts (5-minute tolerance for clock skew).
  const startedMs = Date.parse(firstSent.sentAt) - 5 * 60_000
  const foreign = sentToContact.filter((m) => !isOwnSend(m, state, ourSubject) && !(m.receivedAt && Date.parse(m.receivedAt) < startedMs))
  if (foreign.length > 0) {
    state.sequenceStatus = 'PAUSED'
    await store.saveState(view.taskId, state)
    const what = `Gmail shows ${foreign.length} sent message(s) to this contact since the sequence began that Winston did not send (${foreign.slice(0, 3).map((m) => `"${m.subject.slice(0, 50)}"`).join(', ')}), so someone has already emailed them.`
    await store.transition(view.taskId, 'NEEDS_JERRY', {
      jerryRequest: isCampaign
        ? `Opportunity: ${def.organization} listing outreach (campaign ${def.campaignKey})\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY\nConversation Summary: Follow-up ${step - 1} was due, but ${what}\nJerry Action Required: Confirm whether the automated sequence should resume or stay stopped. Nothing was sent. Thread: ${state.threadId}.`
        : `Opportunity: ${def.organization} Partnership\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY\nConversation Summary: Follow-up ${step - 1} was due, but ${what}\nJerry Action Required: Confirm whether the automated sequence should resume or stay stopped. Nothing was sent.`,
      nextAction: `Jerry: confirm resume vs. stop for ${def.contactName}; thread ${state.threadId}.`,
    })
    out.actions.push(`${def.key}: manual contact detected -> paused, NEEDS_JERRY`)
    return
  }

  if (isCampaign && !(await followUpTokensOk(store, state))) {
    out.errors.push(`${def.key}: follow-up HELD, a confirmation token is missing or points at a different item than the one recorded; nothing sent`)
    return
  }

  let body = due.followUp.bodyText
  if (isCampaign) {
    try {
      body = renderTemplate(due.followUp.bodyText, state.vars ?? {})
    } catch (err) {
      out.errors.push(`${def.key}: follow-up template could not be rendered (${err instanceof Error ? err.message : String(err)}); not sent`)
      return
    }
    const check = validateOutreachCopy(body)
    if (!check.pass) { out.errors.push(`${def.key}: follow-up copy failed validation (${check.issues.join('; ')}); not sent`); return }
  }

  if (!(await store.claimStep(view.taskId, step))) {
    out.errors.push(`${def.key}: step ${step} already claimed; refusing to resend`)
    return
  }
  state.claimedStep = step
  if (budget) budget.remaining -= 1
  try {
    const first = await getFull(deps, ctx, firstSent.messageId)
    const messageId = await sendInThread(deps, def, state, body, first.messageIdHeader, 'FOLLOW_UP', view, now)
    await store.saveState(view.taskId, state)
    const next = nextScheduledAt(def, state)
    if (next) {
      const isLast = state.stepsSent.length >= def.maxOutbound
      const followUpsSent = state.stepsSent.filter((s) => s.kind === 'FOLLOW_UP').length // step 1 is the initial email, not a follow-up
      await store.setPlan(view.taskId, { nextCheckAt: next, nextAction: isLast ? `Final email sent; close the opportunity on ${next.toISOString().slice(0, 10)} if no response. No further emails.` : `Follow-Up ${followUpsSent} sent; next email due ${next.toISOString().slice(0, 10)} if no response.` })
    }
    out.actions.push(`${def.key}: sent step ${step} (message ${messageId})`)
  } catch (err) {
    // Never auto-retry a send that may or may not have gone out.
    state.sequenceStatus = 'PAUSED'
    state.lastError = err instanceof Error ? err.message : String(err)
    await store.saveState(view.taskId, state)
    await store.transition(view.taskId, 'NEEDS_JERRY', {
      jerryRequest: `Opportunity: ${def.organization} Partnership\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY\nConversation Summary: Follow-up step ${step} failed while sending (${state.lastError}). Winston did NOT retry, to avoid a duplicate in case it went out.\nJerry Action Required: Check Gmail Sent for thread ${state.threadId}; resume or send by hand.`,
      nextAction: `Jerry: verify whether step ${step} reached ${def.contactName} (thread ${state.threadId}).`,
    })
    out.errors.push(`${def.key}: send failed at step ${step}: ${state.lastError}`)
    if (campaign && isSystemicSendError(state.lastError)) {
      await pauseCampaignForFailure(deps, campaign, `Systemic send error while sending a follow-up: ${state.lastError}`, out)
    }
  }
}

async function sendInThread(deps: BizDevDeps, def: BizDevSequenceDef, state: BizDevState, bodyText: string, inReplyTo: string | null, kind: BizDevSentStep['kind'], view: BizDevSequenceView, now: Date): Promise<string> {
  const base = state.subject ?? def.subject
  const subject = base.toLowerCase().startsWith('re:') ? base : `Re: ${base}`
  const step = state.stepsSent.length + 1
  state.attempts = [...(state.attempts ?? []), { step, at: now.toISOString(), outcome: 'ATTEMPTED' }]
  const sent = await deps.gmail.sendMessage({ to: def.contactEmail, from: def.from, subject, bodyText, threadId: state.threadId, inReplyTo, references: inReplyTo })
  state.attempts = state.attempts.map((a) => (a.step === step && a.outcome === 'ATTEMPTED' ? { ...a, outcome: 'ACCEPTED' as const } : a))
  state.stepsSent.push({ step, kind, messageId: sent.messageId, sentAt: now.toISOString() })
  await deps.store.recordInteraction({ contactId: view.contactId, taskId: view.taskId, direction: 'OUTBOUND', occurredAt: now.toISOString(), subject, summary: `${kind === 'FAQ_ANSWER' ? 'Routine FAQ answer' : `Follow-up ${step - 1}`} sent to ${def.contactName} (step ${step}).`, requiresAction: false, messageId: sent.messageId, threadId: sent.threadId, extra: { sequenceStep: step, sequenceKey: def.key, from: def.from } })
  return sent.messageId
}

// ---------------------------------------------------------------------------
// Campaign: bounces, safety pauses, first-touch sending
// ---------------------------------------------------------------------------

async function pauseCampaignForFailure(deps: BizDevDeps, c: CampaignRuntime, reason: string, out: BizDevTickResult): Promise<void> {
  if (c.state === 'PAUSED') return
  c.state = 'PAUSED'
  c.pauseReason = reason
  await deps.store.saveCampaign?.(c.key, {
    state: 'PAUSED',
    pauseReason: reason,
    escalate: {
      jerryRequest: `Opportunity: ${c.name} (campaign ${c.key})\nCurrent Stage: NEEDS_JERRY (campaign PAUSED, no further sends)\nConversation Summary: Winston paused the whole campaign automatically.\nReason: ${reason}\nWinston's Recommendation: Fix the cause (Gmail authorization, the "Send mail as" SMTP credentials for ${c.from}, or the provider limit), check Gmail Sent for any uncertain sends, then resume the campaign.\nJerry Action Required: Repair, then run: npx tsx agent-service/outreachCampaignCli.ts resume ${c.key}`,
      nextAction: `Jerry: campaign ${c.key} is paused (${reason.slice(0, 120)}).`,
    },
  })
  out.errors.push(`campaign:${c.key}: PAUSED — ${reason}`)
}

async function handleCampaignBounce(deps: BizDevDeps, c: CampaignRuntime, def: BizDevSequenceDef, view: BizDevSequenceView, state: BizDevState, full: GmailFullMessage, reason: string, now: Date, out: BizDevTickResult): Promise<void> {
  const kind = classifyBounce(reason)
  state.deliveryFailure = { messageId: full.id, detectedAt: now.toISOString(), reason }
  await deps.store.recordInteraction({ contactId: view.contactId, taskId: view.taskId, direction: 'INBOUND', occurredAt: safeIso(full.receivedAt, now), subject: full.subject, summary: `[BOUNCE:${kind}] ${reason.slice(0, 400)}`, requiresAction: kind === 'SENDER_CONFIG', messageId: full.id, threadId: full.threadId, extra: { decision: 'BOUNCE', replyClass: 'bounce', bounceKind: kind } })
  if (kind === 'SENDER_CONFIG') {
    state.sequenceStatus = 'PAUSED'
    await deps.store.saveState(view.taskId, state)
    await deps.store.transition(view.taskId, 'BLOCKED', { blockerNote: `Delivery failed because of OUR sender configuration, not the address: ${reason.slice(0, 200)}. Re-send by hand after the sender is repaired.`, nextAction: `Re-send to ${def.contactEmail} after the sender is repaired.` })
    await pauseCampaignForFailure(deps, c, `Sender-configuration bounce: ${reason.slice(0, 300)}`, out)
    out.actions.push(`${def.key}: SENDER bounce -> campaign paused`)
    return
  }
  state.sequenceStatus = 'BOUNCED'
  await deps.store.saveState(view.taskId, state)
  await deps.store.transition(view.taskId, 'CANCELED', { reason: `Address bounced: ${reason.slice(0, 200)}` })
  c.bounceCount += 1
  await deps.store.saveCampaign?.(c.key, { bounceCount: c.bounceCount })
  out.actions.push(`${def.key}: recipient bounced -> closed`)
  if (bounceRateTripped(c.bounceCount, c.firstTouchSent)) await pauseCampaignForFailure(deps, c, `Bounce rate tripped: ${c.bounceCount} bounces of ${c.firstTouchSent} first touches`, out)
}

/** Replies and bounces for ONE recipient, fetched on demand right before a follow-up. Two cheap id-only list queries; full fetches only for unseen mail. */
async function preSendInboundCheck(deps: BizDevDeps, ctx: TickCtx, def: BizDevSequenceDef, state: BizDevState, firstSentAt: string, processed: ReadonlySet<string>): Promise<GmailFullMessage[]> {
  const email = def.contactEmail.toLowerCase()
  const day = gmailDay(new Date(Date.parse(firstSentAt) - 86_400_000))
  const [fromThem, bounces] = await Promise.all([
    listIds(deps.gmail, `after:${day} -in:sent -in:drafts (from:${email} OR "${email}")`, 25),
    listIds(deps.gmail, `after:${day} from:(mailer-daemon OR postmaster) "${email}"`, 25),
  ])
  const out: GmailFullMessage[] = []
  const seen = new Set<string>()
  for (const m of [...fromThem, ...bounces]) {
    if (seen.has(m.id) || processed.has(m.id)) continue
    seen.add(m.id)
    if (out.length >= 10) break
    const full = await getFull(deps, ctx, m.id)
    if (isBounce(full)) {
      if (full.threadId === state.threadId || full.bodyText.toLowerCase().includes(email)) out.push(full)
      continue
    }
    const sender = resolveSender(full)
    if (sender === email || (full.threadId === state.threadId && sender !== null && !OWN_ADDRESSES.includes(sender))) out.push(full)
  }
  return out
}

/** A follow-up may only carry confirm links that exist and point at the recorded items. */
async function followUpTokensOk(store: BizDevStore, state: BizDevState): Promise<boolean> {
  const listings = state.listings ?? []
  if (listings.length === 0) return true
  const tokens = listings.map((l) => l.token)
  if (store.confirmTokenItems) {
    const itemOf = await store.confirmTokenItems(tokens)
    return listings.every((l) => itemOf.get(l.token) === l.itemId)
  }
  if (store.confirmTokensExist) {
    const present = await store.confirmTokensExist(tokens)
    return tokens.every((t) => present.has(t))
  }
  return true
}

/** Gmail Sent history for these addresses, as prior-contact records (one batched query per 20 addresses). */
async function gmailSentRecords(gmail: GmailAdapter, emails: string[]): Promise<ContactedRecord[]> {
  const records: ContactedRecord[] = []
  const want = new Map(emails.map((e) => [normalizeEmail(e), e]))
  for (let i = 0; i < emails.length; i += 20) {
    const chunk = emails.slice(i, i + 20)
    const hits = await gmail.searchMessages(`in:sent (${chunk.map((e) => `to:${e}`).join(' OR ')})`, 100)
    for (const m of hits) {
      for (const to of m.to) {
        const addr = (to.match(/<([^<>]+)>/)?.[1] ?? to).trim().toLowerCase()
        if (want.has(normalizeEmail(addr))) records.push({ via: 'gmail', ref: `gmail:${m.id}`, email: addr, messageIds: [m.id] })
      }
    }
  }
  return records
}

/**
 * Last barrier before a first touch: anyone already contacted (by email, Gmail message id, business or item, in ANY campaign or in Gmail Sent)
 * is closed as PRIOR_CONTACT instead of being emailed. Independent of how the recipient got into the queue.
 */
async function dropPriorContacts(deps: BizDevDeps, c: CampaignRuntime, wanted: BizDevSequenceView[], out: BizDevTickResult): Promise<BizDevSequenceView[]> {
  const { store, gmail } = deps
  if (!store.contactedRecords || wanted.length === 0) return wanted
  const records = await store.contactedRecords()
  const fromGmail = c.allowPriorOutreach ? [] : await gmailSentRecords(gmail, wanted.map((v) => v.contactEmail))
  const index = new PriorContactIndex([...records, ...fromGmail])
  const keep: BizDevSequenceView[] = []
  for (const v of wanted) {
    const conflicts = index.check({ email: v.contactEmail, businessName: v.organization ?? undefined, itemIds: (v.state.listings ?? []).map((l) => l.itemId), messageIds: v.state.stepsSent.map((s) => s.messageId) }, { ignoreRef: v.taskId })
    if (conflicts.length === 0) { keep.push(v); continue }
    await store.saveState(v.taskId, { ...v.state, sequenceStatus: 'PRIOR_CONTACT' })
    await store.transition(v.taskId, 'CANCELED', { reason: `Prior contact: ${describeConflicts(conflicts).slice(0, 300)}. No first touch sent.` })
    out.actions.push(`campaign:${c.key}: SUPPRESSED ${v.contactEmail} (prior contact: ${conflicts.map((x) => x.key).join(', ')}); no first touch sent`)
  }
  return keep
}

async function tokenVerifiedRecipients(store: BizDevStore, c: CampaignRuntime, queued: BizDevSequenceView[], out: BizDevTickResult): Promise<BizDevSequenceView[]> {
  const tokens = [...new Set(queued.flatMap((v) => (v.state.listings ?? []).map((l) => l.token)))]
  let itemOf: Map<string, string>
  if (store.confirmTokenItems) itemOf = await store.confirmTokenItems(tokens)
  else {
    const present = store.confirmTokensExist ? await store.confirmTokensExist(tokens) : new Set(tokens)
    itemOf = new Map()
    for (const v of queued) for (const l of v.state.listings ?? []) if (present.has(l.token)) itemOf.set(l.token, l.itemId)
  }
  const ready: BizDevSequenceView[] = []
  let missing = 0
  const wrong: string[] = []
  for (const v of queued) {
    const ls = v.state.listings ?? []
    if (ls.some((l) => !itemOf.has(l.token))) { missing += 1; continue }
    if (ls.some((l) => itemOf.get(l.token) !== l.itemId)) { wrong.push(v.contactEmail); continue }
    ready.push(v)
  }
  if (missing > 0) out.actions.push(`campaign:${c.key}: ${missing} queued recipient(s) held until their confirmation token exists (apply the token SQL); ${ready.length} ready`)
  if (wrong.length > 0) out.errors.push(`campaign:${c.key}: ${wrong.length} queued recipient(s) NOT sent because a confirmation token points at a different item than the one approved (${wrong.slice(0, 5).join(', ')}).`)
  return ready
}

async function runCampaignSends(deps: BizDevDeps, ctx: TickCtx, now: Date, out: BizDevTickResult, activeViews: BizDevSequenceView[]): Promise<void> {
  const store = deps.store
  const queuedAll = await store.listQueued!()
  const uncertainAll = store.listUncertain ? await store.listUncertain() : []
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  for (const c of ctx.runtimes.values()) {
    evaluateAuthority('bizdev_campaign.send_first_touch') // throws if the operation were ever unregistered
    const queued = queuedAll.filter((v) => v.state.campaignKey === c.key && v.state.sequenceStatus === 'QUEUED')
    const uncertain = uncertainAll.filter((v) => v.state.campaignKey === c.key)
    const waiting = activeViews.filter((v) => v.state.campaignKey === c.key)

    // Reconcile sends whose outcome was uncertain: look (read-only) for the message in Gmail Sent; NEVER resend.
    for (const v of uncertain.slice(0, 10)) await reconcileUncertain(deps, c, v, now, out)

    if (c.state === 'ACTIVE' && queued.length > 0) {
      const budget = await getBudget(deps, ctx, c)
      if (budget.remaining <= 0) {
        out.actions.push(`campaign:${c.key}: daily cap reached (${budget.sentLast24h} sent in 24h, cap ${budget.effectiveCap}); ${queued.length} queued, waiting for capacity`)
      } else if (!(await senderVerified(deps, c))) {
        await pauseCampaignForFailure(deps, c, `Sending identity ${c.from} is not a verified Gmail send-as address.`, out)
      } else {
        // Per-recipient gate: a queued recipient is sendable only when EVERY one of its tokens exists and points at the approved item.
        // Recipients still waiting for their token SQL are held individually; they never block the recipients that are ready.
        const eligible = await tokenVerifiedRecipients(store, c, queued, out)
        // Daily first-touch limit + follow-up reserve: the limit is a ceiling, never a target, and never overrides the shared cap.
        const limit = c.firstTouchDailyLimit ?? CAMPAIGN_DEFAULTS.firstTouchDailyLimit
        const sentLast24h = store.countFirstTouchesSince ? await store.countFirstTouchesSince(c.key, new Date(now.getTime() - 86_400_000)) : 0
        const allowance = firstTouchAllowance({ dailyLimit: limit, firstTouchesLast24h: sentLast24h, capacityRemaining: budget.remaining, reservedFollowUps: ctx.reserved.get(c.from.toLowerCase()) ?? 0 })
        ctx.firstTouchStats.set(c.key, { sentLast24h, limit, allowed: allowance.allowed, limitedBy: allowance.limitedBy })
        if (eligible.length > 0 && allowance.allowed <= 0) out.actions.push(`campaign:${c.key}: ${eligible.length} ready first touch(es) waiting: ${allowance.limitedBy === 'first_touch_limit' ? `daily first-touch limit reached (${sentLast24h}/${limit} in 24h)` : allowance.limitedBy === 'follow_up_reserve' ? `capacity reserved for ${ctx.reserved.get(c.from.toLowerCase()) ?? 0} follow-up(s) due within 24h` : 'daily cap reached'}`)
        const wanted = await dropPriorContacts(deps, c, eligible.slice(0, Math.min(allowance.allowed, c.batchPerTick)), out)
        {
          let sentNow = 0
          for (const v of wanted) {
            if (c.state !== 'ACTIVE') break
            const ok = await sendFirstTouch(deps, c, v, now, out)
            if (ok) { budget.remaining -= 1; sentNow += 1 }
            if (c.state !== 'ACTIVE') break
            await sleep(c.sendDelayMs)
          }
          if (sentNow > 0) out.actions.push(`campaign:${c.key}: sent ${sentNow} first touch(es); ${budget.remaining} capacity left today`)
        }
      }
    }

    const queuedLeft = queued.length - (out.actions.filter((a) => a.startsWith(`campaign:${c.key}: first touch to`)).length)
    if (c.state === 'ACTIVE' && queued.length === 0 && waiting.length === 0 && uncertain.length === 0 && c.firstTouchSent > 0) {
      await store.saveCampaign?.(c.key, { state: 'COMPLETE' })
      c.state = 'COMPLETE'
      out.actions.push(`campaign:${c.key}: every recipient is closed; campaign COMPLETE`)
    }
    const budget = ctx.budgets.get(c.from.toLowerCase())
    const ft = ctx.firstTouchStats.get(c.key)
    await store.setCampaignProgress?.(c.key, `Campaign ${c.key} ${c.state}: ~${Math.max(queuedLeft, 0)} queued, ${waiting.length} awaiting reply${budget ? `, ${budget.sentLast24h}/${budget.effectiveCap} sent in last 24h` : ''}${ft ? `, first touches ${ft.sentLast24h}/${ft.limit} (+${ft.allowed} allowed now)` : ''}, ${ctx.reserved.get(c.from.toLowerCase()) ?? 0} follow-up(s) due next 24h.`)
  }
}

async function expireCampaign(deps: BizDevDeps, c: CampaignRuntime, activeViews: BizDevSequenceView[], now: Date, out: BizDevTickResult): Promise<void> {
  const { store } = deps
  const queued = store.listQueued ? await store.listQueued() : []
  const uncertain = store.listUncertain ? await store.listUncertain() : []
  const mine = [...activeViews, ...queued, ...uncertain].filter((v) => v.state.campaignKey === c.key)
  for (const v of mine) {
    await store.saveState(v.taskId, { ...v.state, sequenceStatus: 'EXPIRED' })
    await store.transition(v.taskId, 'CANCELED', { reason: `Campaign expired at ${c.expiresAt}; no further emails.` })
  }
  c.state = 'COMPLETE'
  await store.saveCampaign?.(c.key, { state: 'COMPLETE', pauseReason: `Expired ${c.expiresAt}` })
  out.actions.push(`campaign:${c.key}: EXPIRED at ${c.expiresAt}; ${mine.length} recipient(s) closed, nothing more will be sent`)
}

async function senderVerified(deps: BizDevDeps, c: CampaignRuntime): Promise<boolean> {
  const ids = await deps.gmail.listSendAsIdentities()
  return ids.some((i) => i.sendAsEmail.toLowerCase() === c.from.toLowerCase() && i.verificationStatus === 'accepted')
}

async function sendFirstTouch(deps: BizDevDeps, c: CampaignRuntime, view: BizDevSequenceView, now: Date, out: BizDevTickResult): Promise<boolean> {
  const { store, gmail } = deps
  const state: BizDevState = { ...view.state, stepsSent: [] }
  const label = `campaign:${c.key}: first touch to ${view.contactEmail}`

  if (view.contactSuppressed) {
    state.sequenceStatus = 'OPTED_OUT'
    await store.saveState(view.taskId, state)
    await store.transition(view.taskId, 'CANCELED', { reason: 'Contact is suppressed (do-not-contact); never emailed.' })
    out.actions.push(`${label} skipped (suppressed)`)
    return false
  }

  // Render + validate BEFORE claiming: a template problem is certain (nothing was sent) and systemic.
  let subject: string, body: string
  try {
    subject = state.subject ?? renderTemplate(c.subjectTemplate, state.vars ?? {})
    body = renderTemplate(c.firstTouchBody, state.vars ?? {})
    const check = validateOutreachCopy(`${subject}\n${body}`)
    if (!check.pass) throw new Error(check.issues.join('; '))
  } catch (err) {
    await pauseCampaignForFailure(deps, c, `First-touch template failed to render/validate for ${view.contactEmail}: ${err instanceof Error ? err.message : String(err)}`, out)
    return false
  }

  if (!(await store.claimStep(view.taskId, 1))) {
    out.errors.push(`${label}: step 1 already claimed; refusing to resend`)
    return false
  }
  state.claimedStep = 1
  state.attempts = [...(state.attempts ?? []), { step: 1, at: now.toISOString(), outcome: 'ATTEMPTED' }]
  await store.saveState(view.taskId, state) // the attempt is durable BEFORE Gmail is called

  try {
    const sent = await gmail.sendMessage({ to: view.contactEmail, from: c.from, subject, bodyText: body })
    state.threadId = sent.threadId
    state.subject = subject
    state.sequenceStatus = 'ACTIVE'
    state.stepsSent = [{ step: 1, kind: 'INITIAL', messageId: sent.messageId, sentAt: now.toISOString() }]
    state.attempts = state.attempts.map((a) => (a.step === 1 && a.outcome === 'ATTEMPTED' ? { ...a, outcome: 'ACCEPTED' as const } : a))
    await store.saveState(view.taskId, state)
    await store.recordInteraction({ contactId: view.contactId, taskId: view.taskId, direction: 'OUTBOUND', occurredAt: now.toISOString(), subject, summary: `First-touch outreach sent to ${view.contactName ?? view.contactEmail} (step 1). Gmail accepted it; delivery is not yet confirmed.`, requiresAction: false, messageId: sent.messageId, threadId: sent.threadId, extra: { sequenceStep: 1, sequenceKey: state.sequenceKey, campaignKey: c.key, from: c.from } })
    const firstFollowUp = c.followUps[0]
    const next = addBusinessDays(now, firstFollowUp?.afterBusinessDays ?? 5)
    await store.transition(view.taskId, 'WAITING', { nextCheckAt: next, nextAction: `Await reply; Follow-Up 1 due ${next.toISOString().slice(0, 10)} if no substantive reply or confirmation.` })
    c.consecutiveSendFailures = 0
    c.firstTouchSent += 1
    await store.saveCampaign?.(c.key, { consecutiveSendFailures: 0, firstTouchSent: c.firstTouchSent })
    out.actions.push(`${label} accepted (message ${sent.messageId})`)
    return true
  } catch (err) {
    // The outcome is UNCERTAIN (it may have gone out). Never retried automatically.
    const detail = err instanceof Error ? err.message : String(err)
    state.sequenceStatus = 'SEND_UNCERTAIN'
    state.lastError = detail
    state.attempts = (state.attempts ?? []).map((a) => (a.step === 1 && a.outcome === 'ATTEMPTED' ? { ...a, outcome: 'UNCERTAIN' as const, detail: detail.slice(0, 200) } : a))
    await store.saveState(view.taskId, state)
    await store.transition(view.taskId, 'BLOCKED', { blockerNote: `First-touch send outcome is uncertain (${detail.slice(0, 160)}). Winston will not retry; it will look for the message in Gmail Sent.`, nextAction: `Verify in Gmail Sent whether ${view.contactEmail} received the first touch.` })
    c.consecutiveSendFailures += 1
    await store.saveCampaign?.(c.key, { consecutiveSendFailures: c.consecutiveSendFailures })
    out.errors.push(`${label}: send failed, outcome uncertain: ${detail}`)
    if (isSystemicSendError(detail) || c.consecutiveSendFailures >= 3) {
      await pauseCampaignForFailure(deps, c, `${c.consecutiveSendFailures} consecutive send failure(s); last: ${detail}`, out)
    }
    return false
  }
}

async function reconcileUncertain(deps: BizDevDeps, c: CampaignRuntime, view: BizDevSequenceView, now: Date, out: BizDevTickResult): Promise<void> {
  const attempt = [...(view.state.attempts ?? [])].reverse().find((a) => a.step === 1 && a.outcome === 'UNCERTAIN')
  if (!attempt) return
  const day = gmailDay(new Date(new Date(attempt.at).getTime() - 86_400_000))
  const hits = await deps.gmail.searchMessages(`in:sent to:${view.contactEmail} after:${day}`, 3)
  if (hits.length === 0) return
  const m = hits[0]
  const state: BizDevState = { ...view.state, stepsSent: [{ step: 1, kind: 'INITIAL', messageId: m.id, sentAt: attempt.at }], threadId: m.threadId, subject: m.subject || view.state.subject, sequenceStatus: 'ACTIVE' }
  state.attempts = (view.state.attempts ?? []).map((a) => (a === attempt ? { ...a, outcome: 'ACCEPTED' as const, detail: 'reconciled from Gmail Sent' } : a))
  await deps.store.saveState(view.taskId, state)
  await deps.store.recordInteraction({ contactId: view.contactId, taskId: view.taskId, direction: 'OUTBOUND', occurredAt: attempt.at, subject: m.subject, summary: 'First touch found in Gmail Sent after an uncertain send; recorded (no resend).', requiresAction: false, messageId: m.id, threadId: m.threadId, extra: { sequenceStep: 1, reconciled: true, campaignKey: c.key } })
  const next = addBusinessDays(now, c.followUps[0]?.afterBusinessDays ?? 5)
  await deps.store.transition(view.taskId, 'WAITING', { nextCheckAt: next, nextAction: `Await reply; Follow-Up 1 due ${next.toISOString().slice(0, 10)}.` })
  c.firstTouchSent += 1
  await deps.store.saveCampaign?.(c.key, { firstTouchSent: c.firstTouchSent })
  out.actions.push(`campaign:${c.key}: reconciled uncertain send to ${view.contactEmail} from Gmail Sent`)
}

// ---------------------------------------------------------------------------
// Postgres-backed store (existing tables only)
// ---------------------------------------------------------------------------

export const BIZDEV_SOURCE_TYPE = 'bizdev_outreach'
export const BIZDEV_CAMPAIGN_SOURCE_TYPE = 'bizdev_campaign'

interface ViewRow { id: string; updated_at: Date; contact_id: string; email: string; person_name: string | null; organization_name: string | null; relationship_status: string | null; bizdev: BizDevState }

function rowToView(r: ViewRow): BizDevSequenceView {
  return { taskId: r.id, taskUpdatedAt: r.updated_at, contactId: r.contact_id, contactEmail: r.email, contactName: r.person_name, organization: r.organization_name, contactSuppressed: r.relationship_status === 'DO_NOT_CONTACT', state: r.bizdev }
}

export class DbBizDevStore implements BizDevStore {
  private async viewsWhere(statusSql: string, extra = ''): Promise<BizDevSequenceView[]> {
    const rows = await query<ViewRow>(
      `SELECT t.id, t.updated_at, c.id AS contact_id, c.email, c.person_name, c.organization_name, c.relationship_status, t.metadata->'bizdev' AS bizdev
         FROM agent.tasks t JOIN agent.contacts c ON c.id = t.contact_id
        WHERE t.source_type = $1 AND ${statusSql} AND t.metadata ? 'bizdev' ${extra}
        ORDER BY t.created_at, t.id`,
      [BIZDEV_SOURCE_TYPE]
    )
    return rows.map(rowToView)
  }

  listActive(): Promise<BizDevSequenceView[]> {
    return this.viewsWhere(`t.status = 'WAITING'`)
  }

  listQueued(): Promise<BizDevSequenceView[]> {
    return this.viewsWhere(`t.status = 'READY'`, `AND t.metadata #>> '{bizdev,sequenceStatus}' = 'QUEUED'`)
  }

  listUncertain(): Promise<BizDevSequenceView[]> {
    return this.viewsWhere(`t.status = 'BLOCKED'`, `AND t.metadata #>> '{bizdev,sequenceStatus}' = 'SEND_UNCERTAIN'`)
  }

  async campaignRuntimes(): Promise<CampaignRuntime[]> {
    const rows = await query<{ id: string; campaign: CampaignRuntime }>(
      `SELECT t.id, t.metadata->'campaign' AS campaign FROM agent.tasks t WHERE t.source_type = $1 AND t.metadata ? 'campaign' AND t.status NOT IN ('DONE','CANCELED')`,
      [BIZDEV_CAMPAIGN_SOURCE_TYPE]
    )
    return rows.map((r) => ({ ...r.campaign, taskId: r.id }))
  }

  async saveCampaign(key: string, patch: Partial<CampaignRuntime> & { escalate?: { jerryRequest: string; nextAction: string } }): Promise<void> {
    const { escalate, ...rest } = patch
    const rows = await withWriteTransaction(async (c) => {
      const r = await c.query<{ id: string; status: TaskStatus }>(
        `UPDATE agent.tasks SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{campaign}', coalesce(metadata->'campaign','{}'::jsonb) || $2::jsonb)
          WHERE source_type = $3 AND source_ref = $1 RETURNING id, status`,
        [key, JSON.stringify(rest), BIZDEV_CAMPAIGN_SOURCE_TYPE]
      )
      return r.rows
    })
    const task = rows[0]
    if (!task) throw new Error(`campaign ${key} not found`)
    const want: TaskStatus | null = escalate ? 'NEEDS_JERRY' : rest.state === 'ACTIVE' ? 'IN_PROGRESS' : rest.state === 'PAUSED' ? 'BLOCKED' : rest.state === 'COMPLETE' ? 'DONE' : null
    if (!want || want === task.status) return
    const updatedAt = await this.freshUpdatedAt(task.id)
    if (want === 'NEEDS_JERRY') await transitionTask({ taskId: task.id, toStatus: 'NEEDS_JERRY', actorOwnerKey: 'chief', expectedUpdatedAt: updatedAt, jerryRequest: escalate!.jerryRequest, nextAction: escalate!.nextAction })
    else if (want === 'BLOCKED') await transitionTask({ taskId: task.id, toStatus: 'BLOCKED', actorOwnerKey: 'chief', expectedUpdatedAt: updatedAt, blockerNote: rest.pauseReason ?? 'Paused', nextAction: 'Resume the campaign when ready.' })
    else if (want === 'IN_PROGRESS') await transitionTask({ taskId: task.id, toStatus: 'IN_PROGRESS', actorOwnerKey: 'chief', ownerKey: 'chief', expectedUpdatedAt: updatedAt, nextAction: 'Campaign active: sending and following up automatically.' })
    else await transitionTask({ taskId: task.id, toStatus: 'DONE', actorOwnerKey: 'chief', expectedUpdatedAt: updatedAt })
  }

  async setCampaignProgress(key: string, line: string): Promise<void> {
    const rows = await query<{ id: string; status: string; next_action: string | null }>(`SELECT id, status, next_action FROM agent.tasks WHERE source_type = $1 AND source_ref = $2`, [BIZDEV_CAMPAIGN_SOURCE_TYPE, key])
    const t = rows[0]
    if (!t || t.status === 'DONE' || t.status === 'CANCELED' || t.next_action === line) return
    await updateTaskPlan({ taskId: t.id, actorOwnerKey: 'chief', expectedUpdatedAt: await this.freshUpdatedAt(t.id), nextAction: line })
  }

  async contactedRecords(): Promise<ContactedRecord[]> {
    const rows = await query<{ id: string; email: string; business: string | null; items: string[] | null; msgs: string[] | null }>(
      `SELECT t.id::text AS id, lower(c.email) AS email, c.organization_name AS business,
              (SELECT array_agg(l->>'itemId') FROM jsonb_array_elements(coalesce(t.metadata #> '{bizdev,listings}', '[]'::jsonb)) l) AS items,
              (SELECT array_agg(s->>'messageId') FROM jsonb_array_elements(coalesce(t.metadata #> '{bizdev,stepsSent}', '[]'::jsonb)) s) AS msgs
         FROM agent.tasks t JOIN agent.contacts c ON c.id = t.contact_id
        WHERE t.source_type = $1
          AND jsonb_array_length(coalesce(t.metadata #> '{bizdev,stepsSent}', '[]'::jsonb)) > 0
          -- Test and canary campaigns are not correspondence with a business (they email Jerry's own addresses).
          AND coalesce(t.metadata #>> '{bizdev,campaignKey}', '') !~ '(-test|-canary)$'`,
      [BIZDEV_SOURCE_TYPE]
    )
    return rows.map((r) => ({ via: 'winston' as const, ref: r.id, email: r.email, businessName: r.business ?? undefined, itemIds: r.items ?? [], messageIds: r.msgs ?? [] }))
  }

  async confirmTokensExist(tokens: string[]): Promise<Set<string>> {
    if (tokens.length === 0) return new Set()
    const rows = await query<{ token: string }>(`SELECT token FROM public.business_outreach_tokens WHERE token = ANY($1::text[])`, [tokens])
    return new Set(rows.map((r) => r.token))
  }

  async countFirstTouchesSince(campaignKey: string, since: Date): Promise<number> {
    const rows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM agent.tasks t
        WHERE t.source_type = $1 AND t.metadata #>> '{bizdev,campaignKey}' = $2
          AND jsonb_array_length(coalesce(t.metadata #> '{bizdev,stepsSent}', '[]'::jsonb)) > 0
          AND (t.metadata #>> '{bizdev,stepsSent,0,sentAt}')::timestamptz > $3`,
      [BIZDEV_SOURCE_TYPE, campaignKey, since.toISOString()]
    )
    return Number(rows[0]?.n ?? 0)
  }

  async confirmTokenItems(tokens: string[]): Promise<Map<string, string>> {
    if (tokens.length === 0) return new Map()
    const rows = await query<{ token: string; item_id: string }>(`SELECT token, item_id::text AS item_id FROM public.business_outreach_tokens WHERE token = ANY($1::text[])`, [tokens])
    return new Map(rows.map((r) => [r.token, r.item_id]))
  }

  async claimStep(taskId: string, step: number): Promise<boolean> {
    return withWriteTransaction(async (c) => {
      const r = await c.query(
        `UPDATE agent.tasks SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{bizdev,claimedStep}', to_jsonb($2::int))
          WHERE id = $1 AND coalesce((metadata #>> '{bizdev,claimedStep}')::int, 0) < $2 RETURNING id`,
        [taskId, step]
      )
      return (r.rowCount ?? 0) === 1
    })
  }

  async saveState(taskId: string, state: BizDevState): Promise<void> {
    await withWriteTransaction(async (c) => {
      await c.query(`UPDATE agent.tasks SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{bizdev}', $2::jsonb) WHERE id = $1`, [taskId, JSON.stringify(state)])
    })
  }

  async recordInteraction(i: Parameters<BizDevStore['recordInteraction']>[0]): Promise<void> {
    await withWriteTransaction(async (c) => {
      await c.query(
        `INSERT INTO agent.interactions (contact_id, project_id, task_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
         SELECT $1, t.project_id, $2, 'EMAIL', $3, $4::timestamptz, $5, $6, $7, $8, $9::jsonb FROM agent.tasks t WHERE t.id = $2
         ON CONFLICT DO NOTHING`,
        [i.contactId, i.taskId, i.direction, i.occurredAt, i.subject, i.summary, i.requiresAction, `gmail:${i.messageId}`, JSON.stringify({ gmailMessageId: i.messageId, gmailThreadId: i.threadId, ...(i.extra ?? {}) })]
      )
    })
  }

  async suppressContact(contactId: string): Promise<void> {
    await withWriteTransaction(async (c) => {
      await c.query(`UPDATE agent.contacts SET relationship_status = 'DO_NOT_CONTACT', updated_at = now() WHERE id = $1`, [contactId])
    })
  }

  private async freshUpdatedAt(taskId: string): Promise<Date> {
    const rows = await query<{ updated_at: Date }>(`SELECT updated_at FROM agent.tasks WHERE id = $1`, [taskId])
    if (rows.length === 0) throw new Error(`task ${taskId} not found`)
    return rows[0].updated_at
  }

  async setPlan(taskId: string, plan: { nextCheckAt: Date; nextAction: string }): Promise<void> {
    await updateTaskPlan({ taskId, actorOwnerKey: 'chief', expectedUpdatedAt: await this.freshUpdatedAt(taskId), nextCheckAt: plan.nextCheckAt, nextAction: plan.nextAction })
  }

  async transition(taskId: string, to: TransitionTarget, d: TransitionDetail): Promise<void> {
    const base = { taskId, toStatus: to, actorOwnerKey: 'chief', expectedUpdatedAt: await this.freshUpdatedAt(taskId) }
    if (to === 'NEEDS_JERRY') await transitionTask({ ...base, jerryRequest: d.jerryRequest, nextAction: d.nextAction })
    else if (to === 'CANCELED') await transitionTask({ ...base, cancellationReason: d.reason ?? 'closed' })
    else if (to === 'WAITING') await transitionTask({ ...base, nextAction: d.nextAction, nextCheckAt: d.nextCheckAt })
    else if (to === 'BLOCKED') await transitionTask({ ...base, blockerNote: d.blockerNote, nextAction: d.nextAction })
    else await transitionTask(base)
  }
}
