// Chief Phase 2I — deterministic reply classification + inbound-email
// association. Pure logic, no I/O. Classification is rule-based, not
// AI-based: this is a bounded, auditable decision (which of a fixed set
// of categories a reply falls into), the exact kind of thing this
// codebase's model-routing philosophy says should never cost an AI call
// (see modelRouting.ts's own doc: "deterministic/counting/merging/gates
// -> no AI at all"). Association is a HARD isolation check, same
// discipline as destinationDossier.ts's assertAllSameDestination — an
// inbound email that could plausibly belong to more than one destination
// is REFUSED, never guessed.

export type ReplyClassification = 'POSITIVE_INTEREST' | 'QUESTION' | 'INFORMATION_REQUEST' | 'INTRODUCTION_REFERRAL' | 'MEETING_INTEREST' | 'BUDGET_PRICING' | 'OBJECTION' | 'NO_INTEREST' | 'UNCLEAR'

export interface ClassifiedReply {
  classification: ReplyClassification
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  matchedSignals: string[]
}

// Checked IN ORDER — order encodes priority (e.g. an explicit decline
// always wins over an incidental "?" elsewhere in the message).
const RULES: ReadonlyArray<{ classification: ReplyClassification; patterns: RegExp[] }> = [
  { classification: 'NO_INTEREST', patterns: [/\bnot interested\b/i, /\bno thank(s| you)\b/i, /\bplease remove\b/i, /\bunsubscribe\b/i, /\bnot (the )?right fit\b/i, /\bpass(ing)? on this\b/i] },
  {
    classification: 'MEETING_INTEREST',
    patterns: [/\blet'?s (talk|chat|meet|connect|hop on a call)\b/i, /\blove to (talk|chat|meet|connect)\b/i, /\bhappy to (talk|chat|meet|connect|hop on a call)\b/i, /\bschedule (a|some) time\b/i, /\b(zoom|call) next week\b/i, /\btalk next week\b/i, /\bavailable (to talk|for a call)\b/i, /\bset up a (call|meeting)\b/i],
  },
  { classification: 'BUDGET_PRICING', patterns: [/\bhow much\b/i, /\bpric(e|ing)\b/i, /\bcost\b/i, /\bbudget\b/i, /\binvestment (level|required)\b/i] },
  { classification: 'INTRODUCTION_REFERRAL', patterns: [/\b(cc'?ing|cc'?d|looping in|loop(ed)? in)\b/i, /\bintroduc(e|ing|ed) you to\b/i, /\bconnect you with\b/i, /\byou should (talk|speak) to\b/i, /\breach out to\b/i] },
  { classification: 'INFORMATION_REQUEST', patterns: [/\bsend (me|over)\b/i, /\bone-?pager\b/i, /\bmore (info|information|details)\b/i, /\blearn more\b/i, /\bmaterials?\b/i, /\bdeck\b/i, /\bcan you share\b/i] },
  { classification: 'OBJECTION', patterns: [/\bconcerned\b/i, /\bnot sure (about|if)\b/i, /\bhesitant\b/i, /\bworried\b/i, /\balready (have|use|working with)\b/i, /\bskeptical\b/i] },
  // Negative lookbehind excludes "not interested" (already NO_INTEREST, checked first) from also matching here.
  { classification: 'POSITIVE_INTEREST', patterns: [/(?<!not )\binterested\b/i, /\bwould love\b/i, /\bsounds great\b/i, /\bexcited\b/i, /\blet'?s do this\b/i, /\bthis (looks|sounds) (great|good|interesting)\b/i] },
]

/**
 * Classifies a reply's plain-text body against the fixed category set —
 * never a free-form AI guess for something this bounded. Multiple rule
 * groups matching lowers confidence (genuine ambiguity, e.g. a reply
 * that is both an objection AND asks about pricing) rather than silently
 * picking the first match with false certainty.
 */
export function classifyReply(bodyText: string): ClassifiedReply {
  const matchedGroups: Array<{ classification: ReplyClassification; signals: string[] }> = []

  for (const rule of RULES) {
    const signals = rule.patterns.filter((p) => p.test(bodyText)).map((p) => p.source)
    if (signals.length > 0) matchedGroups.push({ classification: rule.classification, signals })
  }

  if (matchedGroups.length === 0) {
    if (/\?/.test(bodyText)) return { classification: 'QUESTION', confidence: 'LOW', matchedSignals: ['?'] }
    return { classification: 'UNCLEAR', confidence: 'LOW', matchedSignals: [] }
  }

  const primary = matchedGroups[0]
  const confidence: ClassifiedReply['confidence'] = matchedGroups.length === 1 ? 'HIGH' : 'MEDIUM'
  return { classification: primary.classification, confidence, matchedSignals: matchedGroups.flatMap((g) => g.signals) }
}

// ---------------------------------------------------------------------------
// Inbound association — never cross-associate one destination's email to
// another. A known relationship contact is scoped to exactly one
// (destinationId, contactId) pair, mirroring destinationRelationship.ts's
// isolateContactContext invariant.
// ---------------------------------------------------------------------------

export interface KnownRelationshipContact {
  destinationId: string
  contactId: string
  email: string
  threadId: string | null
}

/** Who Chief can currently resolve an inbound email/calendar attendee to. Implementations (in-memory, file-backed) live in gmailInboundMonitor.ts — kept here, in pure playbooks, so both the driver and the monitor can depend on the interface without a circular import between them. */
export interface KnownContactDirectory {
  listActiveContacts(): Promise<KnownRelationshipContact[]>
}

/** A directory the relationship driver itself keeps current — see destinationRelationshipDriver.ts's optional contactDirectory dep, which upserts a contact the moment it validates or learns about one (first outreach, a referral). Closes the loop so the poller doesn't need its own separate source of truth. */
export interface MutableContactDirectory extends KnownContactDirectory {
  upsertContact(contact: KnownRelationshipContact): Promise<void>
}

export interface InboundEmail {
  from: string
  to: string[]
  threadId: string | null
  subject: string
  bodyText: string
  receivedAt: string
}

export type AssociationResult = { associated: true; destinationId: string; contactId: string; matchedBy: 'THREAD_ID' | 'EMAIL_ADDRESS' } | { associated: false; reason: string }

/** Pulls the bare address out of a "Name <addr@example.com>" or plain "addr@example.com" From header. */
export function extractEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^<>]+)>/)
  return (match ? match[1] : fromHeader).trim().toLowerCase()
}

export function hasPriorCorrespondence(searchResults: ReadonlyArray<{ id: string }>): boolean {
  return searchResults.length > 0
}

/**
 * THREAD_ID match is authoritative when present (it can only ever belong
 * to the conversation it was created under). Falls back to exact sender-
 * email match. Any match against MORE THAN ONE known contact — same
 * thread id or same email address reused across two different
 * destinations — is refused rather than guessed; a human must resolve
 * that ambiguity, it is never silently attached to whichever destination
 * happened to be checked first.
 */
export function associateInboundEmail(email: InboundEmail, knownContacts: readonly KnownRelationshipContact[]): AssociationResult {
  if (email.threadId) {
    const byThread = knownContacts.filter((c) => c.threadId === email.threadId)
    if (byThread.length === 1) return { associated: true, destinationId: byThread[0].destinationId, contactId: byThread[0].contactId, matchedBy: 'THREAD_ID' }
    if (byThread.length > 1) {
      return { associated: false, reason: `threadId ${email.threadId} matches ${byThread.length} known relationship contacts across ${new Set(byThread.map((c) => c.destinationId)).size} destination(s) — ambiguous, refusing to guess.` }
    }
  }

  const senderEmail = extractEmailAddress(email.from)
  const byEmail = knownContacts.filter((c) => c.email.toLowerCase() === senderEmail)
  if (byEmail.length === 1) return { associated: true, destinationId: byEmail[0].destinationId, contactId: byEmail[0].contactId, matchedBy: 'EMAIL_ADDRESS' }
  if (byEmail.length > 1) {
    return { associated: false, reason: `sender ${senderEmail} matches ${byEmail.length} known relationship contacts across ${new Set(byEmail.map((c) => c.destinationId)).size} different destinations — never cross-associating, refusing to guess.` }
  }

  return { associated: false, reason: `no known relationship contact matches sender ${senderEmail} or threadId ${email.threadId ?? '(none)'}.` }
}
