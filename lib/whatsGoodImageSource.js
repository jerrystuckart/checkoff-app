// Home 2026 / Community Cover Photos V1 — the image-source boundary for
// What's Good / Near You cards. "Image-capable, not image-dependent" —
// this function decides whether a TRUSTWORTHY, item/venue-specific image
// exists; every card must render a fully-designed result either way (see
// components/home/EditorialCard.jsx for the two render modes this feeds).
//
// PRIORITY ORDER (per the approved image quality hierarchy):
//   1. activeCoverImageUrl — a community Cover Candidate an admin has
//                            explicitly SELECTED as this item's cover (see
//                            lib/coverCandidates.js's resolveActiveCoverUrl
//                            — a short-lived SIGNED url, never a raw
//                            storage path or a public url). Not yet
//                            populated by any current query (V1 has zero
//                            selected candidates by construction); read
//                            defensively so wiring it into a data loader
//                            later needs no change here.
//   2. item_image_url     — an actual photo of the specific item/experience (not yet in schema)
//   3. venue_image_url    — a real photo of the venue itself (not yet in schema)
//   4. photo_url          — an approved business-supplied image (today: partners.photo_url,
//                           joined in HomeScreen.jsx's mapRailItem — the only field
//                           actually populated by any current query, and even that is
//                           0% populated across live partners as of the prior audit)
//   5. (none)             — typography-first no-image treatment
//
// This function NEVER decides which candidate is "approved" or "selected"
// — that's entirely a database-and-RLS decision (only an admin can set
// item_cover_candidates.status = 'selected', see the migration). By the
// time a value reaches this function, it's already trusted. Organic
// ranking (whatsGoodSelection.js) never reads this — whether an image
// exists has zero influence on which items get selected, and whether a
// business supplied an image is completely independent of whether a
// community photo gets picked (partner/payment status is never checked
// anywhere in this file or in item_cover_candidates' RLS).
//
// Never returns a generic/stock image — there is no such concept in this
// schema; every source above is item/venue/community-specific or nothing.

/**
 * @param {object} item
 * @returns {{url: string}|null}  null means "render typography-first" —
 *   never a broken-image placeholder.
 */
export function resolvedItemImage(item) {
  const candidates = [item?.activeCoverImageUrl, item?.item_image_url, item?.venue_image_url, item?.photo_url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return { url: candidate.trim() }
    }
  }
  return null
}

/** @deprecated kept as an alias so existing callers (components/home/EditorialCard.jsx) don't need to change — prefer resolvedItemImage for new code. */
export const resolveWhatsGoodImage = resolvedItemImage
