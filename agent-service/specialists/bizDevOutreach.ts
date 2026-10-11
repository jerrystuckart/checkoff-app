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
// State lives in agent.tasks.metadata.bizdev (jsonb, already present).
// Duplicate-send protection: a step is atomically CLAIMED in the DB before
// the Gmail send; a crash after the claim can never re-send (it escalates
// to Jerry instead), and a send failure is never retried automatically.

import type { GmailAdapter, GmailFullMessage, GmailMessageSummary } from './googleAdapters'
import { classifyReply, extractEmailAddress, type ReplyClassification } from '../playbooks/gmailRelationshipLogic'
import { isKnownForwardingAddress } from '../playbooks/gmailForwardUnwrapping'
import { query, withWriteTransaction } from '../db'
import { transitionTask, updateTaskPlan } from '../mutations'
import type { TaskStatus } from '../types'

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

export type SequenceStatus = 'ACTIVE' | 'ANSWERED' | 'ESCALATED' | 'DECLINED' | 'OPTED_OUT' | 'COMPLETE_NO_RESPONSE' | 'PAUSED'

export interface BizDevSentStep {
  step: number
  kind: 'INITIAL' | 'FOLLOW_UP' | 'FAQ_ANSWER'
  messageId: string
  sentAt: string
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
  [k: string]: unknown
}

export interface BizDevSequenceView {
  taskId: string
  taskUpdatedAt: Date
  contactId: string
  contactEmail: string
  contactSuppressed: boolean
  state: BizDevState
}

const OWN_ADDRESSES = ['jerry@getcheckoff.com', 'forwarder@getcheckoff.com', 'jerrystuckart@gmail.com', 'jerrystuckart@hotmail.com']

/** The real person behind a message: Reply-To when the Gmail-visible sender is a CheckOff relay, else From. Null when unknowable. */
export function resolveSender(msg: { from: string; replyTo: string | null }): string | null {
  const from = extractEmailAddress(msg.from)
  if (isKnownForwardingAddress(from)) return msg.replyTo ? extractEmailAddress(msg.replyTo) : null
  return from
}

const REPLY_PREFIX = /^\s*((re|aw|antw|sv|fw|fwd)\s*:\s*)+/i
function normalizeSubject(s: string): string {
  return s.replace(REPLY_PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * A message counts as a response only if it is a REPLY to our outreach: it
 * sits in our Gmail thread, or its subject is a "Re:"-style echo of ours
 * (relayed replies get a new thread id). A contact's unrelated mail — e.g. a
 * weekly newsletter from the same address — must never cancel a sequence.
 * A fresh email with a new subject still reaches Jerry via the existing
 * monitor's "needs review" list.
 */
export function matchesSequence(msg: { from: string; replyTo: string | null; threadId: string; subject?: string }, state: BizDevState, ourSubject?: string): boolean {
  const sender = resolveSender(msg)
  if (!sender) return false
  const inThread = msg.threadId === state.threadId
  const subjectEcho = !!ourSubject && !!msg.subject && REPLY_PREFIX.test(msg.subject) && normalizeSubject(msg.subject) === normalizeSubject(ourSubject)
  if (!inThread && !subjectEcho) return false
  if (sender === state.contactEmail.toLowerCase()) return true
  // Someone else answering inside our own thread (e.g. a colleague of the contact) still counts as a response.
  return inThread && !OWN_ADDRESSES.includes(sender)
}

/** Delivery-failure notices (bounces) are not responses; they mean the email never arrived. */
export function isBounce(msg: { from: string; subject: string }): boolean {
  return /(mailer-daemon|postmaster)@/i.test(msg.from) || /(delivery status notification|undeliverable|returned mail|mail delivery (failed|subsystem)|delivery failure)/i.test(msg.subject)
}

export function safeIso(raw: string | null | undefined, fallback: Date): string {
  const t = raw ? new Date(raw) : null
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : fallback.toISOString()
}

/** Drops quoted history so classification only sees what the contact actually wrote. */
export function stripQuoted(body: string): string {
  const lines = body.replace(/\r/g, '').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (/^\s*On .{5,200}wrote:\s*$/i.test(line) || /^\s*-{2,}\s*Original Message/i.test(line) || /^\s*From:\s.+@/i.test(line)) break
    out.push(line)
  }
  return out.join('\n').trim()
}

const AUTO_REPLY = /(automatic reply|auto-?reply|out of office|out-of-office|autoreply|vacation reply|i am currently out|i'm currently out|abwesenheit)/i
export function isAutoReply(subject: string, body: string): boolean {
  return AUTO_REPLY.test(subject) || AUTO_REPLY.test(body.slice(0, 400))
}

const OPT_OUT = /(unsubscribe|stop (emailing|contacting|sending)|do not (email|contact)|don'?t (email|contact) me|remove me|take me off|no further (contact|emails?)|please remove|opt[- ]?out|leave me alone)/i
export function isOptOut(text: string): boolean {
  return OPT_OUT.test(text)
}

// Routine factual questions Winston may answer alone. Every answer uses ONLY
// facts already stated in the approved outreach email — nothing invented.
interface Faq {
  topic: string
  matches: RegExp
  answer: string
}
const FAQS: readonly Faq[] = [
  {
    topic: 'what_is_checkoff',
    matches: /\b(what('?s| is) (checkoff|check-off|the app|it)|tell me (more )?about (checkoff|the app)|how does (it|the app|checkoff) work)\b/i,
    answer: 'CheckOff is a local bucket list app that helps people get out and experience real local businesses, hidden gems, restaurants, and adventures. You discover experiences, explore curated lists, invite friends, and earn points for actually going and doing them.',
  },
  {
    topic: 'curated_lists',
    matches: /\b(what (are|is) (a )?curated lists?|how do (the )?(curated )?lists work)\b/i,
    answer: 'Curated lists are collections of local experiences, restaurants, and hidden gems that you can work through and check off as you do them.',
  },
  {
    topic: 'availability',
    matches: /\b(is (it|checkoff) (available|live|in)|available (in|around)|(in|around) (north )?phoenix|where (is|are) (it|you) available)\b/i,
    answer: 'We started in the Phoenix area and have been expanding into other cities, but the West Valley is home.',
  },
  {
    topic: 'website',
    matches: /\b(website|link|where can i (see|find|download)|how (do|can) i (get|download|try))\b/i,
    answer: 'You can find everything at getcheckoff.com.',
  },
]
const FAQ_BLOCKERS = /(advertis|sponsor|rate card|pricing|price|cost|\$\d|partner|collaborat|feature (it|checkoff|you)|newsletter|co-?brand|call\b|meet(ing)?\b|schedule|zoom|invoice|contract|exclusive|business(es)? (appear|get listed|sign)|metrics|users?|downloads?|how many)/i

export interface ReplyDecision {
  kind: 'OPT_OUT' | 'DECLINED' | 'FAQ' | 'ESCALATE' | 'AUTO_REPLY_IGNORED'
  classification: ReplyClassification | 'AUTO_REPLY'
  reason: string
  faqAnswer?: string
}

export function decideReply(subject: string, rawBody: string, autoAnswersSoFar: number): ReplyDecision {
  const text = stripQuoted(rawBody)
  if (isAutoReply(subject, text)) return { kind: 'AUTO_REPLY_IGNORED', classification: 'AUTO_REPLY', reason: 'Automatic/out-of-office reply — not a human response.' }
  if (isOptOut(text)) return { kind: 'OPT_OUT', classification: 'NO_INTEREST', reason: 'Contact asked for no further contact.' }
  const cls = classifyReply(text)
  if (cls.classification === 'NO_INTEREST') return { kind: 'DECLINED', classification: cls.classification, reason: 'Contact declined.' }

  // Routine-FAQ path: short, pure question(s), every question covered by a verified FAQ, no commercial/partnership language.
  if ((cls.classification === 'QUESTION' || cls.classification === 'INFORMATION_REQUEST') && text.length <= 600 && !FAQ_BLOCKERS.test(text) && autoAnswersSoFar < 1) {
    const questions = text.split(/(?<=\?)/).map((s) => s.trim()).filter((s) => s.includes('?'))
    if (questions.length > 0 && questions.length <= 3) {
      const answers: string[] = []
      let allCovered = true
      for (const q of questions) {
        const faq = FAQS.find((f) => f.matches.test(q))
        if (!faq) { allCovered = false; break }
        if (!answers.includes(faq.answer)) answers.push(faq.answer)
      }
      if (allCovered && answers.length > 0) return { kind: 'FAQ', classification: cls.classification, reason: 'Routine factual question(s) covered by verified FAQ.', faqAnswer: answers.join(' ') }
    }
  }
  return { kind: 'ESCALATE', classification: cls.classification, reason: 'Needs Jerry: partnership interest, commercial terms, or a question outside the verified FAQ.' }
}

export function extractCommercialTerms(text: string): string[] {
  const terms: string[] = []
  for (const m of text.matchAll(/\$\s?\d[\d,]*(\.\d+)?(\s?(\/|per)\s?\w+)?/g)) terms.push(m[0].trim())
  for (const m of text.matchAll(/\b\d[\d,]*\s?(subscribers|readers|opens?|followers|impressions)\b/gi)) terms.push(m[0])
  for (const m of text.matchAll(/\b(sponsor(ed|ship)?|advertis\w*|rate card|media kit|banner|placement|deadline)\b/gi)) terms.push(m[0].toLowerCase())
  return [...new Set(terms)]
}

export function buildEscalation(def: BizDevSequenceDef, state: BizDevState, decision: ReplyDecision, replyText: string, msg: { id: string; threadId: string; subject: string }): { jerryRequest: string; nextAction: string } {
  const terms = extractCommercialTerms(replyText)
  const commercial = terms.length > 0
  const sent = state.stepsSent.map((s) => `step ${s.step} (${s.kind}) ${s.sentAt.slice(0, 10)}`).join('; ')
  const wording = replyText.replace(/\s+/g, ' ').trim().slice(0, 900)
  const jerryRequest = [
    `Opportunity: ${def.organization} Partnership`,
    `Contact: ${def.contactName} <${def.contactEmail}>`,
    `Organization: ${def.organization}`,
    `Current Stage: NEEDS_JERRY (autonomous outreach suspended; pending follow-ups cancelled)`,
    `Conversation Summary: Winston sent from ${def.from}: ${sent}. ${def.contactName} replied. Classified ${decision.classification} (${decision.reason})`,
    `${def.contactName}'s Response: "${wording}"`,
    `Opportunity Assessment: ${commercial ? `Commercial/sponsorship details detected (${terms.join(', ')}); capture these exactly from the thread before deciding. No spend is authorized.` : `Local community-media contact whose "real over artificial" newsletter theme matches CheckOff's mission; reply signals ${decision.classification.toLowerCase().replace(/_/g, ' ')}.`}`,
    `Winston's Recommendation: Reply personally from ${def.from} in the existing thread; ${commercial ? 'evaluate cost vs. audience reach before committing anything' : 'propose a short call and the "Living North Phoenix Favorites" curated-list idea'}. Nothing has been promised or scheduled.`,
    `Jerry Action Required: Decide how to respond (and whether to take a call/commit to anything). Thread: Gmail thread ${msg.threadId}, reply message ${msg.id}, subject "${msg.subject}".`,
  ].join('\n')
  return { jerryRequest, nextAction: `Jerry: reply to ${def.contactName} (Gmail thread ${msg.threadId}) and decide on next steps.` }
}

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

export interface BizDevStore {
  listActive(): Promise<BizDevSequenceView[]>
  /** Atomically latches `step`; false means it was already claimed (never send). */
  claimStep(taskId: string, step: number): Promise<boolean>
  saveState(taskId: string, state: BizDevState): Promise<void>
  recordInteraction(i: { contactId: string; taskId: string; direction: 'INBOUND' | 'OUTBOUND'; occurredAt: string; subject: string; summary: string; requiresAction: boolean; messageId: string; threadId: string; extra?: Record<string, unknown> }): Promise<void>
  suppressContact(contactId: string): Promise<void>
  setPlan(taskId: string, plan: { nextCheckAt: Date; nextAction: string }): Promise<void>
  transition(taskId: string, to: Extract<TaskStatus, 'NEEDS_JERRY' | 'CANCELED'>, detail: { jerryRequest?: string; nextAction?: string; reason?: string }): Promise<void>
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
}

function pushProcessed(state: BizDevState, id: string): void {
  state.processedMessageIds = [...(state.processedMessageIds ?? []), id].slice(-200)
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export async function runBizDevTick(deps: BizDevDeps): Promise<BizDevTickResult> {
  const now = (deps.now ?? (() => new Date()))()
  const sequences = deps.sequences ?? BIZDEV_SEQUENCES
  const result: BizDevTickResult = { actions: [], errors: [] }
  if (!deps.gmail.isConfigured()) return result

  const views = await deps.store.listActive()
  for (const view of views) {
    const def = sequences[view.state.sequenceKey]
    if (!def || def.contactEmail.toLowerCase() !== view.contactEmail.toLowerCase()) continue // not explicitly authorized -> never touched
    try {
      await processSequence(deps, def, view, now, result)
    } catch (err) {
      result.errors.push(`${def.key}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}

async function processSequence(deps: BizDevDeps, def: BizDevSequenceDef, view: BizDevSequenceView, now: Date, out: BizDevTickResult): Promise<void> {
  const { store, gmail } = deps
  const state: BizDevState = { ...view.state, stepsSent: [...view.state.stepsSent] }
  const firstSent = state.stepsSent[0]
  if (!firstSent) return

  // ---- 0. Self-heal: a stopped sequence whose task is still WAITING (e.g. a crash between saving state and moving the task) is finished off, never left to drift. ----
  if (state.sequenceStatus === 'DECLINED' || state.sequenceStatus === 'OPTED_OUT' || state.sequenceStatus === 'COMPLETE_NO_RESPONSE') {
    await store.transition(view.taskId, 'CANCELED', { reason: `Sequence state ${state.sequenceStatus}; task closed by recovery check.` })
    out.actions.push(`${def.key}: recovered stranded ${state.sequenceStatus} -> CANCELED`)
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
  const sinceDay = new Date(new Date(firstSent.sentAt).getTime() - 86_400_000).toISOString().slice(0, 10).replace(/-/g, '/')
  const found: GmailMessageSummary[] = await gmail.searchMessages(`after:${sinceDay} -in:sent -in:drafts (from:${def.contactEmail} OR "${def.contactEmail}")`, 25)
  const processed = new Set(state.processedMessageIds ?? [])
  // 1a. Bounces in our thread: the email never arrived. Pause everything and tell Jerry; this is not a response.
  const bounce = found.find((m) => !processed.has(m.id) && m.threadId === state.threadId && isBounce(m))
  if (bounce) {
    const full = await gmail.getFullMessage(bounce.id)
    const reason = full.bodyText.replace(/\s+/g, ' ').trim().slice(0, 600)
    pushProcessed(state, bounce.id)
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

  const candidates = found.filter((m) => !processed.has(m.id) && !isBounce(m) && matchesSequence(m, state, def.subject))
  candidates.sort((a, b) => (a.receivedAt ? Date.parse(a.receivedAt) || 0 : 0) - (b.receivedAt ? Date.parse(b.receivedAt) || 0 : 0))

  for (const summary of candidates) {
    const full: GmailFullMessage = await gmail.getFullMessage(summary.id)
    const text = stripQuoted(full.bodyText)
    const decision = decideReply(full.subject, full.bodyText, state.autoAnswers ?? 0)
    pushProcessed(state, summary.id)

    if (decision.kind === 'AUTO_REPLY_IGNORED') {
      await store.saveState(view.taskId, state)
      out.actions.push(`${def.key}: ignored auto-reply ${summary.id}`)
      continue
    }

    // Cancel pending follow-ups IMMEDIATELY (persisted before anything else can happen).
    const prevStatus = state.sequenceStatus
    state.sequenceStatus = decision.kind === 'OPT_OUT' ? 'OPTED_OUT' : decision.kind === 'DECLINED' ? 'DECLINED' : decision.kind === 'FAQ' ? 'ANSWERED' : 'ESCALATED'
    await store.saveState(view.taskId, state)
    await store.recordInteraction({ contactId: view.contactId, taskId: view.taskId, direction: 'INBOUND', occurredAt: safeIso(full.receivedAt, now), subject: full.subject, summary: `[${decision.classification}] ${text.slice(0, 500)}`, requiresAction: decision.kind === 'ESCALATE', messageId: summary.id, threadId: full.threadId, extra: { decision: decision.kind, previousSequenceStatus: prevStatus, transportSender: extractEmailAddress(full.from), originalSender: resolveSender(full) } })
    out.actions.push(`${def.key}: reply ${summary.id} -> ${decision.kind}; follow-ups cancelled`)

    if (decision.kind === 'OPT_OUT') {
      await store.suppressContact(view.contactId)
      await store.transition(view.taskId, 'CANCELED', { reason: `Contact opted out: "${text.slice(0, 160)}"` })
    } else if (decision.kind === 'DECLINED') {
      await store.transition(view.taskId, 'CANCELED', { reason: `Contact declined: "${text.slice(0, 160)}"` })
    } else if (decision.kind === 'FAQ') {
      const sent = await sendInThread(deps, def, state, `Hey ${def.contactName.split(' ')[0]},\n\n${decision.faqAnswer}\n\nThanks, ${def.contactName.split(' ')[0]}!${SIGNATURE}`, full.messageIdHeader, 'FAQ_ANSWER', view, now)
      state.autoAnswers = (state.autoAnswers ?? 0) + 1
      state.answeredAt = now.toISOString()
      await store.saveState(view.taskId, state)
      await store.setPlan(view.taskId, { nextCheckAt: addBusinessDays(now, def.answeredWaitBusinessDays), nextAction: `Answered a routine question (message ${sent}); no further automated outreach. If no reply, escalate to Jerry.` })
      out.actions.push(`${def.key}: answered routine FAQ (message ${sent})`)
    } else {
      const esc = buildEscalation(def, state, decision, text, { id: summary.id, threadId: full.threadId, subject: full.subject })
      await store.transition(view.taskId, 'NEEDS_JERRY', { jerryRequest: esc.jerryRequest, nextAction: esc.nextAction })
      out.actions.push(`${def.key}: escalated to NEEDS_JERRY`)
    }
    return // sequence is no longer ACTIVE; nothing else to do this tick
  }
  if (candidates.length > 0) return // only auto-replies were seen; state saved, fall through next tick

  // ---- 2. ANSWERED -> after the wait, hand back to Jerry (no silent limbo). ----
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

  // SEND: guard rails, then claim, then send exactly once.
  const outboundCount = state.stepsSent.filter((s) => s.kind !== 'FAQ_ANSWER').length
  if (outboundCount >= def.maxOutbound) return
  const step = due.followUp.step
  if (state.stepsSent.length + 1 !== step) return

  // If Jerry (or anything else) has emailed this contact since we started, don't pile on: hand over.
  const sentToContact = await gmail.searchMessages(`in:sent to:${def.contactEmail}`, 25)
  const expectedSent = state.stepsSent.length + (state.failedSends?.length ?? 0)
  if (sentToContact.length > expectedSent) {
    state.sequenceStatus = 'PAUSED'
    await store.saveState(view.taskId, state)
    await store.transition(view.taskId, 'NEEDS_JERRY', {
      jerryRequest: `Opportunity: ${def.organization} Partnership\nContact: ${def.contactName} <${def.contactEmail}>\nCurrent Stage: NEEDS_JERRY\nConversation Summary: Follow-up ${step - 1} was due, but Gmail shows ${sentToContact.length} sent message(s) to this contact vs. ${expectedSent} Winston recorded, so someone has already emailed them.\nJerry Action Required: Confirm whether the automated sequence should resume or stay stopped. Nothing was sent.`,
      nextAction: `Jerry: confirm resume vs. stop for ${def.contactName}; thread ${state.threadId}.`,
    })
    out.actions.push(`${def.key}: manual contact detected -> paused, NEEDS_JERRY`)
    return
  }

  if (!(await store.claimStep(view.taskId, step))) {
    out.errors.push(`${def.key}: step ${step} already claimed; refusing to resend`)
    return
  }
  state.claimedStep = step
  try {
    const first = await gmail.getFullMessage(firstSent.messageId)
    const messageId = await sendInThread(deps, def, state, due.followUp.bodyText, first.messageIdHeader, 'FOLLOW_UP', view, now)
    await store.saveState(view.taskId, state)
    const next = nextScheduledAt(def, state)
    if (next) {
      const isLast = state.stepsSent.length >= def.maxOutbound
      await store.setPlan(view.taskId, { nextCheckAt: next, nextAction: isLast ? `Final email sent; close the opportunity on ${next.toISOString().slice(0, 10)} if no response. No further emails.` : `Follow-Up ${state.stepsSent.length} sent; next email due ${next.toISOString().slice(0, 10)} if no response.` })
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
  }
}

async function sendInThread(deps: BizDevDeps, def: BizDevSequenceDef, state: BizDevState, bodyText: string, inReplyTo: string | null, kind: BizDevSentStep['kind'], view: BizDevSequenceView, now: Date): Promise<string> {
  const subject = def.subject.toLowerCase().startsWith('re:') ? def.subject : `Re: ${def.subject}`
  const sent = await deps.gmail.sendMessage({ to: def.contactEmail, from: def.from, subject, bodyText, threadId: state.threadId, inReplyTo, references: inReplyTo })
  const step = state.stepsSent.length + 1
  state.stepsSent.push({ step, kind, messageId: sent.messageId, sentAt: now.toISOString() })
  await deps.store.recordInteraction({ contactId: view.contactId, taskId: view.taskId, direction: 'OUTBOUND', occurredAt: now.toISOString(), subject, summary: `${kind === 'FAQ_ANSWER' ? 'Routine FAQ answer' : `Follow-up ${step - 1}`} sent to ${def.contactName} (step ${step}).`, requiresAction: false, messageId: sent.messageId, threadId: sent.threadId, extra: { sequenceStep: step, sequenceKey: def.key, from: def.from } })
  return sent.messageId
}

// ---------------------------------------------------------------------------
// Postgres-backed store (existing tables only)
// ---------------------------------------------------------------------------

export const BIZDEV_SOURCE_TYPE = 'bizdev_outreach'

export class DbBizDevStore implements BizDevStore {
  async listActive(): Promise<BizDevSequenceView[]> {
    const rows = await query<{ id: string; updated_at: Date; contact_id: string; email: string; relationship_status: string | null; bizdev: BizDevState }>(
      `SELECT t.id, t.updated_at, c.id AS contact_id, c.email, c.relationship_status, t.metadata->'bizdev' AS bizdev
         FROM agent.tasks t JOIN agent.contacts c ON c.id = t.contact_id
        WHERE t.source_type = $1 AND t.status = 'WAITING' AND t.metadata ? 'bizdev'`,
      [BIZDEV_SOURCE_TYPE]
    )
    return rows.map((r) => ({ taskId: r.id, taskUpdatedAt: r.updated_at, contactId: r.contact_id, contactEmail: r.email, contactSuppressed: r.relationship_status === 'DO_NOT_CONTACT', state: r.bizdev }))
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

  async transition(taskId: string, to: 'NEEDS_JERRY' | 'CANCELED', d: { jerryRequest?: string; nextAction?: string; reason?: string }): Promise<void> {
    await transitionTask({
      taskId,
      toStatus: to,
      actorOwnerKey: 'chief',
      expectedUpdatedAt: await this.freshUpdatedAt(taskId),
      ...(to === 'NEEDS_JERRY' ? { jerryRequest: d.jerryRequest, nextAction: d.nextAction } : { cancellationReason: d.reason ?? 'closed' }),
    })
  }
}
