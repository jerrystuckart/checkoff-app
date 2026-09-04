// Home 2026 — Visual Polish Pass 2: safe, conservative venue/thing
// separation from the existing single `body` sentence field.
//
// AUDIT FINDING (from real production body samples): item bodies have no
// consistent grammatical structure. Some end with a trailing `at 'Venue'`
// clause ("Order an appetizer at 'Citizen Public House'"), some have the
// venue clause mid-sentence followed by unrelated trailing context ("Walk
// the full loop around the 'Wisconsin State Capitol' at golden hour and
// stop when the light hits the dome"), some never mention the venue in the
// body text at all ("Sample some Rattlesnake"), and at least one has
// mismatched quote characters ("Try the Secret Item at "Baba's Burgers &
// Birds'"). A generic "find quoted text and strip everything after it"
// regex would mangle multiple real examples above — not demonstrably safe.
//
// SAFE PATTERN USED INSTEAD: only remove the substring " at '<venue>'"
// (quote style flexible: straight or curly, open/close independently, to
// tolerate the mismatched-quote case above) when <venue> is the EXACT,
// already-trusted partner name from the items→partners join (partnerName /
// item.partners.business_name) — never a guessed/regex-discovered name.
// Because we already display the venue separately, this only removes a
// now-redundant clause; it never rewrites or invents content, and it
// naturally leaves anything it doesn't confidently recognize completely
// untouched (the Wisconsin Capitol and Rattlesnake cases above both pass
// through unmodified — matching the task's "report the limitation rather
// than silently mangle" instruction rather than forcing a transform).

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string|null|undefined} body
 * @param {string|null|undefined} venueName  the trusted venue name (item.partnerName)
 * @returns {string}  body with the redundant " at '<venueName>'" clause
 *   removed if (and only if) it's present verbatim; otherwise the original
 *   body, completely unchanged.
 */
export function extractThingFromBody(body, venueName) {
  if (!body) return ''
  if (!venueName) return body

  const escaped = escapeRegExp(venueName)
  const pattern = new RegExp(` at ["'“”]${escaped}["'“”]`, 'i')
  const stripped = body.replace(pattern, '')
  return stripped === body ? body : stripped.trim()
}

/**
 * @param {object} item  a mapped rail item (see HomeScreen.jsx's mapRailItem)
 * @returns {{venueName: string|null, thing: string}}
 */
export function deriveVenueAndThing(item) {
  const venueName = item?.partnerName ?? null
  const thing = extractThingFromBody(item?.body ?? '', venueName)
  return { venueName, thing }
}
