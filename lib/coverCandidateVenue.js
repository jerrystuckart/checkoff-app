// Admin → Images → Cover Candidates venue-name bug fix (2026-09-04).
//
// ROOT CAUSE: the admin tool's ccExtractVenue(item.body) derived the
// venue/business name purely from item text via a regex requiring the
// literal phrase " at '<venue>'" immediately before a quoted name. Two
// real problems: (1) it never consulted the item's actual canonical
// venue relation at all, even when one exists; (2) it silently returns
// null for any body phrased differently — e.g. "...slip into 'The
// Raven'..." has no " at '" before the quote, so it always returned
// null for that item, regardless of what's actually associated with it.
//
// FIX: canonical relational data now wins, checked in this order:
//   1. items.partner_id -> partners.business_name (the item's own
//      permanent venue identity, when a real Partner row exists)
//   2. item_cover_candidates.submitted_by_token_id ->
//      business_outreach_tokens.business_name (the exact business name
//      captured for that specific business-submission candidate during
//      outreach — only ever set for source='business_submission')
//   3. LEGACY fallback only: the existing quoted-venue text parser
//      (lib/itemDetailHeaderTitle.js's extractQuotedVenueFromBody) —
//      preserves today's correct display for Doaky/Red Zone/85 Local/
//      Throne Brewing, all of which currently have NEITHER a partner
//      row NOR an outreach-token link and rely entirely on this parser.
//   4. Otherwise: no venue name resolves. Never invented from
//      surrounding prose beyond what the legacy parser already does.
//
// `venueNameSource` is carried alongside the resolved name specifically
// so records still depending on the legacy text parser (or matching
// nothing at all) are visible and auditable — the eventual goal is a
// fully relational venue identity for every item, with 'legacy_text'
// and 'missing' driven to zero over time. See this repo's admin bug-fix
// task notes for the identified data-model gap: cover candidates are
// item-scoped, and many items (ordinary featured businesses with no
// Partner account) have no canonical venue/business relation at all —
// closing that gap is a data-model decision, not something this fix
// invents a new schema for.

import { extractQuotedVenueFromBody } from './itemDetailHeaderTitle.js'

/**
 * @typedef {'partner'|'outreach_token'|'legacy_text'|'missing'} VenueNameSource
 */

/**
 * @param {object} params
 * @param {string|null|undefined} params.partnerBusinessName  items.partner_id -> partners.business_name, when the item has a real Partner row
 * @param {string|null|undefined} params.outreachTokenBusinessName  item_cover_candidates.submitted_by_token_id -> business_outreach_tokens.business_name, when this candidate came from a business-outreach submission
 * @param {string|null|undefined} params.itemBody  the item's checkoff text — read-only input to the LEGACY parser only, never itself treated as canonical
 * @returns {{venueName: string|null, venueNameSource: VenueNameSource}}
 */
export function resolveCoverCandidateVenueName({ partnerBusinessName, outreachTokenBusinessName, itemBody }) {
  if (isMeaningful(partnerBusinessName)) {
    return { venueName: partnerBusinessName.trim(), venueNameSource: 'partner' }
  }
  if (isMeaningful(outreachTokenBusinessName)) {
    return { venueName: outreachTokenBusinessName.trim(), venueNameSource: 'outreach_token' }
  }
  const legacyExtracted = extractQuotedVenueFromBody(itemBody)
  if (legacyExtracted) {
    return { venueName: legacyExtracted, venueNameSource: 'legacy_text' }
  }
  return { venueName: null, venueNameSource: 'missing' }
}

function isMeaningful(value) {
  return typeof value === 'string' && value.trim().length > 0
}
