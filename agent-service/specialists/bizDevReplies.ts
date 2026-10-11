// Pure reply logic for business-development outreach (no I/O, no DB, no Gmail).
// Extracted from bizDevOutreach.ts so the single-contact (Blair) sequence and
// the multi-recipient campaigns share ONE classifier. bizDevOutreach.ts
// re-exports everything here, so existing callers and tests are unchanged.
//
// Type-only imports from bizDevOutreach.ts keep this module free of runtime
// cycles.

import { classifyReply, extractEmailAddress, type ReplyClassification } from '../playbooks/gmailRelationshipLogic'
import { isKnownForwardingAddress } from '../playbooks/gmailForwardUnwrapping'
import { parseRequestedWait } from '../playbooks/followUpEngine'
import type { BizDevSequenceDef, BizDevState } from './bizDevOutreach'

// ---------------------------------------------------------------------------
// Sender resolution + reply matching
// ---------------------------------------------------------------------------

export const OWN_ADDRESSES = ['jerry@getcheckoff.com', 'forwarder@getcheckoff.com', 'jerrystuckart@gmail.com', 'jerrystuckart@hotmail.com']

/** The real person behind a message: Reply-To when the Gmail-visible sender is a CheckOff relay, else From. Null when unknowable. */
export function resolveSender(msg: { from: string; replyTo: string | null }): string | null {
  const from = extractEmailAddress(msg.from)
  if (isKnownForwardingAddress(from)) return msg.replyTo ? extractEmailAddress(msg.replyTo) : null
  return from
}

export const REPLY_PREFIX = /^\s*((re|aw|antw|sv|fw|fwd)\s*:\s*)+/i
export function normalizeSubject(s: string): string {
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
  const inThread = !!state.threadId && msg.threadId === state.threadId
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

/**
 * SENDER bounces mean OUR sending is broken (every send will fail) and must
 * pause the whole campaign; RECIPIENT bounces mean one address is bad.
 */
export function classifyBounce(bodyText: string): 'SENDER_CONFIG' | 'RECIPIENT' {
  if (/(send mail as|custom ?from|535|authentication credentials invalid|misconfigured|sender (address )?rejected|spf|dkim|dmarc|rate limit|quota|daily user sending)/i.test(bodyText)) return 'SENDER_CONFIG'
  return 'RECIPIENT'
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

const AUTO_REPLY = /(automatic reply|auto-?reply|out of office|out-of-office|autoreply|vacation reply|i am currently out|i'm currently out|abwesenheit|automatische antwort)/i
export function isAutoReply(subject: string, body: string): boolean {
  return AUTO_REPLY.test(subject) || AUTO_REPLY.test(body.slice(0, 400))
}

const OPT_OUT = /(unsubscribe|stop (emailing|contacting|sending)|do not (email|contact)|don'?t (email|contact) me|remove me|take me off|no further (contact|emails?)|please remove|opt[- ]?out|leave me alone)/i
export function isOptOut(text: string): boolean {
  return OPT_OUT.test(text)
}

// ---------------------------------------------------------------------------
// Single-contact classifier (Blair) — behavior unchanged from the original.
// Routine factual questions Winston may answer alone use ONLY facts already
// stated in the approved outreach email — nothing invented.
// ---------------------------------------------------------------------------

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

export type ReplyKind = 'OPT_OUT' | 'DECLINED' | 'FAQ' | 'ESCALATE' | 'AUTO_REPLY_IGNORED' | 'CONFIRMED' | 'CORRECTION' | 'PHOTO' | 'DEFERRED'

export interface ReplyDecision {
  kind: ReplyKind
  classification: ReplyClassification | 'AUTO_REPLY'
  reason: string
  faqAnswer?: string
  /** Stable label used for campaign reporting (interaction metadata.replyClass). */
  replyClass?: ReplyClass
  /** Set when kind === 'DEFERRED': the date the business asked to be contacted again. */
  deferredUntil?: string
  alsoConfirmed?: boolean
}

export function decideReply(subject: string, rawBody: string, autoAnswersSoFar: number, allowedFaqTopics?: readonly string[]): ReplyDecision {
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
        const faq = FAQS.find((f) => f.matches.test(q) && (!allowedFaqTopics || allowedFaqTopics.includes(f.topic)))
        if (!faq) { allCovered = false; break }
        if (!answers.includes(faq.answer)) answers.push(faq.answer)
      }
      if (allCovered && answers.length > 0) return { kind: 'FAQ', classification: cls.classification, reason: 'Routine factual question(s) covered by verified FAQ.', faqAnswer: answers.join(' ') }
    }
  }
  return { kind: 'ESCALATE', classification: cls.classification, reason: 'Needs Jerry: partnership interest, commercial terms, or a question outside the verified FAQ.' }
}

// ---------------------------------------------------------------------------
// Campaign classifier (many businesses, listing-confirmation flavored).
// Order encodes priority: out-of-office / opt-out / decline first, then
// corrections (always Jerry), photos (always moderation), then routine
// confirmations (the ONLY class that closes a recipient without Jerry).
// ---------------------------------------------------------------------------

export const CAMPAIGN_FAQ_TOPICS = ['what_is_checkoff', 'curated_lists', 'website'] as const

export type ReplyClass =
  | 'listing_confirmed'
  | 'correction_requested'
  | 'photo_provided'
  | 'question'
  | 'partnership_interest'
  | 'decline'
  | 'opt_out'
  | 'out_of_office'
  | 'bounce'
  | 'deferred'
  | 'unclear'

export interface CampaignReplyOptions {
  attachments?: ReadonlyArray<{ filename: string; mimeType: string; size: number }>
  autoAnswersSoFar: number
  faqEnabled: boolean
  now: Date
}

const CORRECTION_RE = /(\bnot (quite |totally |entirely )?(accurate|correct|right|true)\b|\binaccurate\b|\bincorrect\b|\bno longer\b|\bactually\b|\bshould (be|say|read)\b|\binstead\b|\bchange (it|that|this|the)\b|\bcorrection\b|\bupdate (it|that|the|this)\b|\bisn'?t (available|offered|on)\b|\bnot (on|part of) (the|our) menu\b|\bwe don'?t (offer|have|serve|do|sell)\b|\bclosed (for|permanently|down)\b|\bdiscontinued\b|\bis now\b|\bwe (now|only)\b|\bnew (name|hours|owner)\b)/i
const PHOTO_NOUN = /\b(photos?|pictures?|pics?|images?|headshot|logo)\b/i
const PHOTO_OFFER = /(\battached\b|\battaching\b|\bhere('| i)?s (a|our|the|my)\b|\bi('| wi)ll send\b|\bhappy to send\b|\bcan send\b|\bsending (you )?(a|the|our)\b|\bwe have (a|some)\b|\bsee attached\b)/i
const CONFIRM_RE = /(\byes\b|\byep\b|\byeah\b|\baccurate\b|\bthat'?s (right|correct)\b|\bis (right|correct|accurate)\b|\bcorrect\b|\bconfirm(ed|ing)?\b|\blooks (good|great|right|accurate)\b|\bsounds (good|great|right)\b|\bno changes\b|\bstill (accurate|correct|true)\b|\bworks for (us|me)\b|\ball good\b|\bperfect\b)/i
/** The words the business actually wrote: greetings, thanks and sign-offs removed per line (never dropping a line that also carries content). */
function significantText(text: string): string {
  const out: string[] = []
  for (let line of text.split('\n')) {
    line = line.trim()
    if (!line) continue
    if (/^(--|sent from|best\b|regards|cheers|sincerely|warmly|thanks,?$|thank you,?$)/i.test(line)) continue
    line = line.replace(/^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^,.!:\n]{0,40}[,.!:]?\s*/i, '')
    line = line.replace(/\b(thanks|thank you)\b[!., ]*$/i, '').trim()
    if (line) out.push(line)
  }
  return out.join(' ').trim()
}

export function decideCampaignReply(subject: string, rawBody: string, opts: CampaignReplyOptions): ReplyDecision {
  const text = stripQuoted(rawBody)
  // Campaign auto-answers are limited to location-neutral topics (the 'availability' answer is Phoenix-specific).
  const base = decideReply(subject, rawBody, opts.autoAnswersSoFar, CAMPAIGN_FAQ_TOPICS)
  if (base.kind === 'AUTO_REPLY_IGNORED') return { ...base, replyClass: 'out_of_office' }
  if (base.kind === 'OPT_OUT') return { ...base, replyClass: 'opt_out' }
  if (base.kind === 'DECLINED') return { ...base, replyClass: 'decline' }

  const sig = significantText(text)
  const hasImageAttachment = (opts.attachments ?? []).some((a) => /^image\//i.test(a.mimeType) || /\.(jpe?g|png|heic|webp|gif)$/i.test(a.filename))
  const correction = CORRECTION_RE.test(sig)
  const photoOffered = hasImageAttachment || (PHOTO_NOUN.test(sig) && PHOTO_OFFER.test(sig))
  const questionMark = sig.includes('?')
  const confirmWords = CONFIRM_RE.test(sig)

  if (correction) return { kind: 'CORRECTION', classification: base.classification, reason: 'Business proposed a change to the listing.', replyClass: 'correction_requested', alsoConfirmed: false }
  if (photoOffered) return { kind: 'PHOTO', classification: base.classification, reason: hasImageAttachment ? 'Business attached an image.' : 'Business offered or described a photo.', replyClass: 'photo_provided', alsoConfirmed: confirmWords }
  if (confirmWords && !questionMark && sig.length <= 400 && base.classification !== 'BUDGET_PRICING' && base.classification !== 'MEETING_INTEREST') {
    return { kind: 'CONFIRMED', classification: base.classification, reason: 'Short, unambiguous confirmation of the listing.', replyClass: 'listing_confirmed' }
  }

  // "Contact me next month" style requests: reuse followUpEngine's bounded parser (never free-form NLP).
  const wait = parseRequestedWait(sig, opts.now.toISOString())
  if (wait && !questionMark) return { kind: 'DEFERRED', classification: base.classification, reason: `Business asked to be contacted ${wait.label}.`, replyClass: 'deferred', deferredUntil: wait.resumeAt }

  if (base.kind === 'FAQ' && opts.faqEnabled) return { ...base, replyClass: 'question' }
  if (base.kind === 'FAQ') return { kind: 'ESCALATE', classification: base.classification, reason: 'Routine question, but auto-answers are not enabled for this campaign.', replyClass: 'question' }

  const partnership = base.classification === 'POSITIVE_INTEREST' || base.classification === 'MEETING_INTEREST' || base.classification === 'BUDGET_PRICING' || base.classification === 'INTRODUCTION_REFERRAL'
  if (partnership) return { ...base, replyClass: 'partnership_interest' }
  if (base.classification === 'QUESTION' || base.classification === 'INFORMATION_REQUEST') return { ...base, replyClass: 'question' }
  return { ...base, replyClass: 'unclear' }
}

// ---------------------------------------------------------------------------
// Escalation text (jerry_request)
// ---------------------------------------------------------------------------

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

/** Campaign escalations: listing-aware, class-specific, and explicit that nothing was published. */
export function buildCampaignEscalation(def: BizDevSequenceDef, state: BizDevState, decision: ReplyDecision, replyText: string, msg: { id: string; threadId: string; subject: string }): { jerryRequest: string; nextAction: string } {
  const wording = replyText.replace(/\s+/g, ' ').trim().slice(0, 900)
  const who = `${def.organization} <${def.contactEmail}>`
  const items = state.vars?.items_block ?? state.vars?.item_text ?? '(listing text not recorded)'
  const sent = state.stepsSent.map((s) => `step ${s.step} (${s.kind}) ${s.sentAt.slice(0, 10)}`).join('; ')
  const cls = decision.replyClass ?? 'unclear'
  const recommendation: Record<string, string> = {
    correction_requested: 'Review the proposed change. If it is right, edit the item through the existing admin flow. Winston never publishes a correction. Then reply to the business.',
    photo_provided: 'Save the photo from the Gmail message and add it through the existing cover-candidate moderation (or ask the business to upload via its /confirm link, which records rights acknowledgement). Winston never publishes a photo.',
    partnership_interest: 'Reply personally from jerry@getcheckoff.com. Nothing has been promised or scheduled.',
    question: 'Answer from the thread. The question is outside Winston\'s verified FAQ.',
    unclear: 'Read the thread and decide; Winston could not classify the reply confidently.',
    deferred: 'The business asked to be contacted later; decide whether to follow up personally.',
  }
  const jerryRequest = [
    `Opportunity: ${def.organization} — ${state.campaignKey ?? def.key} listing outreach`,
    `Contact: ${who}`,
    `Current Stage: NEEDS_JERRY (this recipient's follow-ups are cancelled)`,
    `Reply type: ${cls}${decision.alsoConfirmed ? ' (also confirmed the listing)' : ''} — ${decision.reason}`,
    `Listing(s) we sent:\n${items}`,
    `Conversation Summary: Winston sent from ${def.from}: ${sent}. The business replied.`,
    `Business's Response: "${wording}"`,
    `Winston's Recommendation: ${recommendation[cls] ?? recommendation.unclear}`,
    `Jerry Action Required: Decide as above. Thread: Gmail thread ${msg.threadId}, reply message ${msg.id}, subject "${msg.subject}".`,
  ].join('\n')
  return { jerryRequest, nextAction: `Jerry: ${cls.replace(/_/g, ' ')} from ${def.organization} (Gmail thread ${msg.threadId}).` }
}
