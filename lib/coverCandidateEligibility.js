// Community Cover Photos V1 — pure eligibility rule for the "No photo yet
// 👀 / Want to help make this better?" contribution CTA. All policy
// decisions live here so they're independently testable; the caller (see
// components/CoverCandidateCTA.jsx) just renders the result.
//
// Deliberately conservative: every condition must hold, and the function
// never guesses — a missing/unknown input is treated as "not eligible",
// never "eligible by default".

/**
 * @param {object} params
 * @param {boolean} params.isAtPlace  the existing foreground presence rule (min(geo_radius_m, 150m)) already determined this
 * @param {boolean} params.hasApprovedImage  true if the item already resolves a real image (see lib/whatsGoodImageSource.js)
 * @param {boolean} params.isSecret  item.is_secret — V1 never offers contribution for secret/spoiler-sensitive items
 * @param {boolean} params.hasPendingSubmission  true if this user already has an unresolved (pending/needs_review) candidate for this item
 * @param {boolean} params.flagEnabled  resolved community_cover_photos flag for this user
 * @returns {{eligible: boolean, reason: string}}
 */
export function isCoverCandidateEligible({
  isAtPlace,
  hasApprovedImage,
  isSecret,
  hasPendingSubmission,
  flagEnabled,
}) {
  if (!flagEnabled) return { eligible: false, reason: 'flag_disabled' }
  if (!isAtPlace) return { eligible: false, reason: 'not_at_place' }
  if (isSecret) return { eligible: false, reason: 'secret_item_excluded_in_v1' }
  if (hasApprovedImage) return { eligible: false, reason: 'already_has_approved_image' }
  if (hasPendingSubmission) return { eligible: false, reason: 'pending_submission_exists' }
  return { eligible: true, reason: 'eligible' }
}
