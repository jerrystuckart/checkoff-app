// Item Detail Redesign (2026-09-18) — pure message-builder for the
// "Do This Together" invitation card, extracted out of
// screens/ItemDetailScreen.jsx's old inviteMessage() so the copy rule has
// real automated coverage (this repo's established convention — see
// lib/whatsGoodImageSource.js, lib/artworkResolution.js, etc. — every pure
// product rule lives in lib/ and is unit-tested with node:test; there is
// no RN render harness).
//
// Approved copy (replaces the old "Want to do it together? Download
// CheckOff" framing, which led with app promotion — the new copy leads
// with the experience itself):
//   venue present:  "I found something cool for us to do at {venue}. You in?"
//   venue missing:  "I found something cool for us to do. You in?"
//
// The item's own body text is surfaced as a short quoted lead-in ahead of
// that line (not swapped in for it — the approved templates above are
// fixed strings, always present verbatim) so the recipient can see WHAT
// they're being invited to, truncated safely so an unusually long body
// never produces an unwieldy message.
//
// URL rule: prefers an explicit itemUrl (e.g.
// https://getcheckoff.com/item/<id> — see buildItemDeepLinkUrl below) when
// the caller supplies one, otherwise falls back to the existing working
// URL behavior this screen already had: a list join link when a
// listInviteCode is present (preserves list-mode sharing, unchanged),
// otherwise the bare homepage. Never throws, never returns undefined.

const MAX_BODY_LENGTH = 120

/**
 * @param {string|null|undefined} body
 * @param {number} [maxLength]
 * @returns {string}  '' for empty/missing input, otherwise the trimmed
 *   body, ellipsized to maxLength characters when longer.
 */
export function truncateItemBody(body, maxLength = MAX_BODY_LENGTH) {
  if (typeof body !== 'string') return ''
  const trimmed = body.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/**
 * https://getcheckoff.com/item/<id> — the preferred item-specific deep-link
 * URL format. Exposed so callers CAN opt into it once it's confirmed safe
 * (see App.jsx's checkoff://item/:id route + screens/DeepLinkItemResolverScreen.jsx),
 * but building this string is not, on its own, a claim that any particular
 * screen should default to using it — see the caller's own comment.
 *
 * @param {string|null|undefined} itemId
 * @returns {string|null}
 */
export function buildItemDeepLinkUrl(itemId) {
  if (!itemId) return null
  return `https://getcheckoff.com/item/${itemId}`
}

/**
 * The single "ask" line shown both on the compact Detail invite card
 * (visible copy, no body quote / no URL — Item Detail Corrective Pass,
 * 2026-09-18) and inlined into the full shareable message below. Kept as
 * its own exported function so the visible card copy and the shared
 * message text can never drift apart — both call this, neither
 * re-derives the template string independently.
 *
 * @param {object} [params]
 * @param {string|null} [params.venue]
 * @returns {string}
 */
export function buildInviteAskLine({ venue = null } = {}) {
  return venue && String(venue).trim().length > 0
    ? `I found something cool for us to do at ${String(venue).trim()}. You in?`
    : 'I found something cool for us to do. You in?'
}

/**
 * @param {object} params
 * @param {string|null} [params.itemBody]
 * @param {string|null} [params.venue]  e.g. item.partnerName, or a venue
 *   name extracted from item.body — see lib/itemDetailHeaderTitle.js's
 *   extractQuotedVenueFromBody, which this helper deliberately does NOT
 *   re-derive itself (the caller resolves venue once, the same way it
 *   already resolves the header title, so the two can never disagree).
 * @param {string|null} [params.itemUrl]  an explicit item-specific URL,
 *   when the caller has decided it's safe to use one.
 * @param {string|null} [params.listInviteCode]  preserves existing
 *   list-mode sharing behavior unchanged.
 * @param {number} [params.maxBodyLength]
 * @returns {string}
 */
export function buildInviteMessage({
  itemBody = null,
  venue = null,
  itemUrl = null,
  listInviteCode = null,
  maxBodyLength = MAX_BODY_LENGTH,
} = {}) {
  const truncatedBody = truncateItemBody(itemBody, maxBodyLength)
  const bodyLeadIn = truncatedBody ? `"${truncatedBody}" — ` : ''

  const ask = buildInviteAskLine({ venue })

  const url = itemUrl
    ? itemUrl
    : listInviteCode
      ? `https://getcheckoff.com/join/${listInviteCode}`
      : 'https://getcheckoff.com'

  return `${bodyLeadIn}${ask} ${url}`
}
