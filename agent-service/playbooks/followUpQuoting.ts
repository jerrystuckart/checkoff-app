// Chief Phase 2T — a real live proof caught this: reusing a Gmail
// threadId makes a follow-up land in the same conversation, but it does
// NOT quote the prior message or set reply headers — Gmail's threadId is
// purely a grouping mechanism. The Williams and Elkhart Lake follow-ups
// both said "just following up on the note below," but there was no
// note below in the actual sent message; the recipient saw a bare reply
// with nothing above it to refer to. Pure logic, no I/O.

/**
 * Bounded, deterministic pattern — never free-form NLP — matching the
 * "review the raw drafting evidence" discipline used everywhere else a
 * template is validated in this codebase (see e.g.
 * destinationRelationshipDriver.ts's stepAssetsPrep shape check).
 * Deliberately generic ("below" alone, not just "note below") since the
 * failure mode is any claim that something appears beneath the message
 * that isn't actually there — "see below," "the details below," "as
 * mentioned below" all fail the same way.
 */
const BELOW_REFERENCE_PATTERN = /\bsee\s+below\b|\bbelow\b/i

export function hasBelowReferenceLanguage(text: string): boolean {
  return BELOW_REFERENCE_PATTERN.test(text)
}

export interface FollowUpWordingCheck {
  valid: boolean
  issue: string | null
}

/**
 * The deterministic guard: a follow-up may only reference "below"
 * content when the send actually quotes prior content beneath it.
 * Never auto-rewrites the sentence (a regex substitution risks a
 * grammatically broken result) — it rejects instead, so the caller fixes
 * the wording or adds the quote before anything goes out.
 */
export function validateFollowUpWording(bodyText: string, quotesPriorContent: boolean): FollowUpWordingCheck {
  if (!quotesPriorContent && hasBelowReferenceLanguage(bodyText)) {
    return {
      valid: false,
      issue:
        'Follow-up body references "below" content, but no prior message is being quoted in this send — the recipient would see no prior content at all. Use date-anchored wording instead, e.g. "Following up on my note from August 17" or "Circling back on the email I sent a couple weeks ago."',
    }
  }
  return { valid: true, issue: null }
}

export interface QuotedPriorMessage {
  /** Display form for the quote's attribution line, e.g. "Jerry Stuckart <jerry@getcheckoff.com>". */
  fromDisplay: string
  /** Display form for the quote's attribution line, e.g. "Mon, Aug 17, 2026 at 1:32 PM". Never re-derived here — callers pass whatever real date string they have (a raw Gmail Date header is fine). */
  dateDisplay: string
  bodyText: string
}

/**
 * Appends the prior message as a plain-text quote (the same "On <date>,
 * <from> wrote:" + "> "-prefixed convention nearly every mail client
 * uses) beneath the new reply text. Never truncates or summarizes the
 * prior body — quoting the wrong or partial content would be worse than
 * not quoting at all.
 */
export function buildQuotedReplyBody(replyBodyText: string, prior: QuotedPriorMessage): string {
  const quotedLines = prior.bodyText
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
  return `${replyBodyText}\n\nOn ${prior.dateDisplay}, ${prior.fromDisplay} wrote:\n${quotedLines}`
}
