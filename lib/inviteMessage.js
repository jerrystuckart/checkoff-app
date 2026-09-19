// Item Detail Redesign (2026-09-18), corrected 2026-09-19 — pure
// message-builder for the "Do This Together" invitation card, extracted
// out of screens/ItemDetailScreen.jsx's old inviteMessage() so the copy
// rule has real automated coverage (this repo's established convention —
// see lib/whatsGoodImageSource.js, lib/artworkResolution.js, etc. — every
// pure product rule lives in lib/ and is unit-tested with node:test;
// there is no RN render harness).
//
// Approved copy (final, 2026-09-19 pass) — replaces the earlier
// venue-phrase draft ("...to do at {venue}. You in?"), which is no longer
// used: item.body already carries the venue naturally, so no separate
// venue framing is prepended.
//
//   body present:  I found something cool for us to do: "{complete body}" You in?
//                  https://getcheckoff.com/item/{id}
//   body missing:  I found something cool for us to do. You in?
//                  https://getcheckoff.com/item/{id}
//
// The shared message ALWAYS carries the item's body in full — no
// truncation. (The old truncateItemBody-in-the-message behavior from
// 624e549 is intentionally removed for the shared text; truncateItemBody
// itself is kept only for the compact on-screen card preview, which may
// still be visually clamped for space per the approved spec.)
//
// URL rule: prefers the item-specific https://getcheckoff.com/item/<id>
// link (see buildItemDeepLinkUrl below) whenever itemId is a
// well-formed UUID. If itemId is missing or malformed, this NEVER
// fabricates a broken item URL — it falls back to the existing working
// URL behavior this screen already had: a list join link when a
// listInviteCode is present (preserves list-mode sharing, unchanged),
// otherwise the bare homepage. A raw checkoff:// URL is never used here —
// that scheme is for in-app deep-link resolution only, not for a link
// shared to someone who may not have the app installed. Never throws,
// never returns undefined.

const MAX_BODY_LENGTH = 120

// RFC-4122-shaped UUID check — mirrors screens/DeepLinkItemResolverScreen.jsx's
// UUID_RE (afc1a61) so both sides of the item-link contract agree on what
// counts as a valid item id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * @param {string|null|undefined} body
 * @param {number} [maxLength]
 * @returns {string}  '' for empty/missing input, otherwise the trimmed
 *   body, ellipsized to maxLength characters when longer. Used ONLY for
 *   the compact card's own visual preview text (buildInviteAskLine below)
 *   — the full shareable message (buildInviteMessage) never truncates.
 */
export function truncateItemBody(body, maxLength = MAX_BODY_LENGTH) {
  if (typeof body !== 'string') return ''
  const trimmed = body.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/**
 * https://getcheckoff.com/item/<id> — the preferred item-specific deep-link
 * URL format. Returns null (never a broken/half-built URL) when itemId is
 * missing or is not a well-formed UUID, so callers can safely fall back
 * to existing generic sharing behavior instead of fabricating a bad link.
 *
 * @param {string|null|undefined} itemId
 * @returns {string|null}
 */
export function buildItemDeepLinkUrl(itemId) {
  if (typeof itemId !== 'string' || !UUID_RE.test(itemId)) return null
  return `https://getcheckoff.com/item/${itemId}`
}

/**
 * Resolves the URL to append to a shared invite: the item-specific link
 * when itemId is valid, else the existing list-join link, else the bare
 * homepage. Never a raw checkoff:// URL, never fabricated from a bad id.
 *
 * @param {object} [params]
 * @param {string|null} [params.itemId]
 * @param {string|null} [params.listInviteCode]
 * @returns {string}
 */
function resolveShareUrl({ itemId = null, listInviteCode = null } = {}) {
  const itemUrl = buildItemDeepLinkUrl(itemId)
  if (itemUrl) return itemUrl
  if (listInviteCode) return `https://getcheckoff.com/join/${listInviteCode}`
  return 'https://getcheckoff.com'
}

/**
 * The short "ask" line shown on the compact Detail invite card (visible
 * copy only — this is a display-only, safely-clamped preview of the
 * conversational portion of the real message; the full shareable text is
 * always built by buildInviteMessage below and is never truncated).
 *
 * @param {object} [params]
 * @param {string|null} [params.itemBody]
 * @param {number} [params.maxBodyLength]
 * @returns {string}
 */
export function buildInviteAskLine({ itemBody = null, maxBodyLength = MAX_BODY_LENGTH } = {}) {
  const body = truncateItemBody(itemBody, maxBodyLength)
  return body
    ? `I found something cool for us to do: "${body}" You in?`
    : 'I found something cool for us to do. You in?'
}

/**
 * Builds the complete, shareable invitation message: the conversational
 * opening, the COMPLETE item body in quotes (never truncated), "You in?",
 * then the share URL on its own final line.
 *
 * @param {object} params
 * @param {string|null} [params.itemBody]
 * @param {string|null} [params.itemId]  the item's canonical UUID — used
 *   to build the item-specific URL when valid.
 * @param {string|null} [params.listInviteCode]  preserves existing
 *   list-mode sharing behavior unchanged, used only when itemId is
 *   missing/invalid.
 * @returns {string}
 */
export function buildInviteMessage({
  itemBody = null,
  itemId = null,
  listInviteCode = null,
} = {}) {
  const body = typeof itemBody === 'string' ? itemBody.trim() : ''
  const url = resolveShareUrl({ itemId, listInviteCode })

  const ask = body
    ? `I found something cool for us to do: "${body}" You in?`
    : 'I found something cool for us to do. You in?'

  return `${ask}\n${url}`
}
