// Final UI Pass Before Build 144 — Item Detail's nav header must show the
// real venue/business name ("Red Zone Sports Grill"), never the clipped
// full item body ("Order the fried-then-grilled j..."). Falls back to the
// app name, never a truncated sentence fragment, when there's no
// meaningful venue name (universal items, items with no partner/venue).
//
// Pure so App.jsx's three identical ItemDetail Stack.Screen `options`
// callbacks (Nearby/Home/Profile stacks) can all share one tested rule.
//
// item.partnerName ONLY exists for items with a real partners row — per
// Jerry's explicit architectural correction (2026-09-03), most featured
// businesses are ordinary items with NO Partner account, so partnerName is
// null far more often than not (confirmed live: Red Zone Sports Grill has
// no partner_id and was showing "CheckOff" instead of its own name until
// this fallback was added). Second source: the same "at '<venue>'" quoted
// clause lib/whatsGoodItemPresentation.js already audits as the dominant
// body shape across real production items — extracted here read-only,
// never used to rewrite item.body itself.

// Three alternatives, each requiring a MATCHING quote pair (straight
// double, straight single, curly) — deliberately not a single
// any-quote-to-any-quote pattern. A few real production bodies mix quote
// styles for a venue name that itself contains an apostrophe (e.g. a
// documented case: `at "Baba's Burgers & Birds'"`, open double / close
// single, precisely BECAUSE "Baba's" has an apostrophe). A greedy
// any-to-any pattern would truncate that at the apostrophe and show a
// wrong/mangled name in the header. Symmetric-only means that case falls
// through to null (→ "CheckOff") instead of showing something wrong —
// same "report the limitation, never silently mangle" rule this codebase
// already applies in lib/whatsGoodItemPresentation.js.
const QUOTED_VENUE_PATTERNS = [
  / at "([^"]+)"/,
  / at '([^']+)'/,
  / at “([^”]+)”/,
  / at ‘([^’]+)’/,
]

/**
 * @param {string|null|undefined} body
 * @returns {string|null}
 */
export function extractQuotedVenueFromBody(body) {
  if (!body) return null
  for (const pattern of QUOTED_VENUE_PATTERNS) {
    const name = body.match(pattern)?.[1]?.trim()
    if (name) return name
  }
  return null
}

/**
 * @param {object|null|undefined} item  route.params.item
 * @returns {string}
 */
export function resolveItemDetailHeaderTitle(item) {
  const partnerName = item?.partnerName
  if (typeof partnerName === 'string' && partnerName.trim().length > 0) {
    return partnerName.trim()
  }
  const extracted = extractQuotedVenueFromBody(item?.body)
  return extracted ?? 'CheckOff'
}
