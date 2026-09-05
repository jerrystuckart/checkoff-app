// Chief Phase 2L — forwarded-message unwrapping. Pure logic, no I/O.
//
// A real overnight proof caught this gap: CheckOff business
// correspondence often arrives at Jerry's Gmail inbox relayed through a
// Resend-based forwarding setup, so the Gmail-visible ("transport")
// sender is a wrapper address like forwarder@getcheckoff.com or
// jerry@getcheckoff.com — never the actual person who wrote the message.
// Treating the transport sender AS the relationship identity would
// either associate real correspondence to nobody (today's behavior) or,
// worse, could someday associate it to the WRONG destination if the
// wrapper address happened to coincidentally match a contact on file.
// Per the explicit instruction: "The forwarding address itself should be
// treated as a transport/wrapper identity, not the relationship
// identity" — this module's whole job is recovering the real identity
// when one is recoverable, and being honest when it isn't.

export const DEFAULT_FORWARDING_ADDRESSES: readonly string[] = Object.freeze(['forwarder@getcheckoff.com', 'jerry@getcheckoff.com'])

/** Configurable via CHIEF_FORWARDING_ADDRESSES (comma-separated) — defaults to the known CheckOff relay identities. Never hardcoded deeper than this one config point. */
export function knownForwardingAddresses(): readonly string[] {
  const raw = process.env.CHIEF_FORWARDING_ADDRESSES
  if (!raw) return DEFAULT_FORWARDING_ADDRESSES
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return parsed.length > 0 ? parsed : DEFAULT_FORWARDING_ADDRESSES
}

export function isKnownForwardingAddress(email: string): boolean {
  return knownForwardingAddresses().includes(email.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Recovering the original message from a forwarded-header block in the
// body — the classic "---------- Forwarded message ---------" pattern
// (Gmail's own forward feature, and close variants other clients use).
// ---------------------------------------------------------------------------

export interface ForwardedHeaderBlock {
  from: string | null
  to: string[]
  cc: string[]
  subject: string | null
}

function extractAddressList(headerValue: string): string[] {
  // Splits "Name <a@b.com>, Other <c@d.com>" (or bare addresses) into individual entries, extracting the bare address from each.
  return headerValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/<([^<>]+)>/)
      return (match ? match[1] : part).trim()
    })
}

const FORWARD_MARKER = /(?:^|\n)[-\s]*(?:forwarded message|begin forwarded message)[-\s]*(?:\n|:)/i

/**
 * Looks for a forwarded-message header block anywhere in the body and
 * extracts From/To/Cc/Subject from it. Returns null when no such block is
 * recognizable — callers must never guess in that case, only fall
 * through to a weaker signal (Reply-To) or leave the message unassociated.
 */
export function parseForwardedHeaderBlock(bodyText: string): ForwardedHeaderBlock | null {
  const markerMatch = bodyText.match(FORWARD_MARKER)
  if (!markerMatch || markerMatch.index === undefined) return null

  // The header block is the next several lines after the marker, up to
  // the first blank line (or a bounded window) — real forwarded blocks
  // are short (From/Date/Subject/To[/Cc]), never the whole body.
  const afterMarker = bodyText.slice(markerMatch.index + markerMatch[0].length)
  const windowLines = afterMarker.split('\n').slice(0, 12)
  const window = windowLines.join('\n')

  const fromMatch = window.match(/^From:\s*(.+)$/im)
  const toMatch = window.match(/^To:\s*(.+)$/im)
  const ccMatch = window.match(/^Cc:\s*(.+)$/im)
  const subjectMatch = window.match(/^Subject:\s*(.+)$/im)

  if (!fromMatch && !toMatch) return null // no recognizable header content at all — not a real block, don't fabricate one

  const fromAddresses = fromMatch ? extractAddressList(fromMatch[1]) : []
  return {
    from: fromAddresses[0] ?? null,
    to: toMatch ? extractAddressList(toMatch[1]) : [],
    cc: ccMatch ? extractAddressList(ccMatch[1]) : [],
    subject: subjectMatch ? subjectMatch[1].trim() : null,
  }
}

// ---------------------------------------------------------------------------
// The combined unwrap — header-block recovery first (highest confidence,
// carries To/Cc too), Reply-To second (lower confidence, sender only),
// nothing recovered otherwise.
// ---------------------------------------------------------------------------

export interface UnwrapResult {
  recovered: boolean
  recoveredVia: 'FORWARDED_HEADER_BLOCK' | 'REPLY_TO' | null
  originalFrom: string | null
  originalTo: string[]
  originalCc: string[]
  originalSubject: string | null
}

export function unwrapForwardedSender(input: { transportFrom: string; replyTo: string | null; bodyText: string }): UnwrapResult {
  const block = parseForwardedHeaderBlock(input.bodyText)
  if (block && (block.from || block.to.length > 0)) {
    return { recovered: true, recoveredVia: 'FORWARDED_HEADER_BLOCK', originalFrom: block.from, originalTo: block.to, originalCc: block.cc, originalSubject: block.subject }
  }

  const transportAddress = input.transportFrom.match(/<([^<>]+)>/)?.[1]?.trim().toLowerCase() ?? input.transportFrom.trim().toLowerCase()
  if (input.replyTo && input.replyTo.trim().toLowerCase() !== transportAddress) {
    return { recovered: true, recoveredVia: 'REPLY_TO', originalFrom: input.replyTo.trim(), originalTo: [], originalCc: [], originalSubject: null }
  }

  return { recovered: false, recoveredVia: null, originalFrom: null, originalTo: [], originalCc: [], originalSubject: null }
}
