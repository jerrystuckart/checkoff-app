// Community Cover Photos V1 — the automated-moderation ADAPTER INTERFACE.
//
// AUDIT FINDING: no image content-moderation service (nudity/violence/
// safety classification) is integrated anywhere in this stack today.
// Building or silently wiring one (AWS Rekognition, Google Cloud Vision
// SafeSearch, Sightengine, Hive, Microsoft Content Moderator, etc.) requires
// a new paid external vendor, new credentials, and Jerry's explicit
// approval before it becomes production infrastructure — none of that
// happens in this task. See the final report for the recommended options
// and what each would need.
//
// What THIS file provides instead: the interface every future automated
// adapter must satisfy, plus a conservative V1 implementation
// (localSanityOnlyAdapter) that performs only cheap, on-device-safe checks
// — file size / declared dimensions sanity — and explicitly does NOT
// attempt any semantic content classification (nudity, violence, text
// overlay, watermark, relevance, blur/quality). Because there is no real
// safety signal in V1, this adapter NEVER returns 'pass' for the safety
// verdict on its own authority — every submission that isn't trivially
// malformed (zero-byte, absurd dimensions) is routed to 'needs_review',
// which is exactly the manual-queue safety backstop the product spec
// requires ("Do not assume automated moderation alone is enough to select
// a public cover"). Swapping in a real vendor later means writing a new
// module with this same shape and changing one import at the call site —
// see components/CoverCandidateCTA.jsx / the submission screen for where
// this plugs in.

/**
 * @typedef {'pass'|'reject'|'needs_review'} Verdict
 * @typedef {object} ModerationAssessment
 * @property {Verdict} safetyVerdict  never 'pass' from localSanityOnlyAdapter — see module doc
 * @property {Verdict} qualityVerdict  cover-worthiness (sharpness/lighting/relevance/watermark/etc) — also never assessed automatically in V1
 * @property {object} signals  small, non-sensitive automated signals only — never raw vendor payloads or anything identifying
 */

/**
 * @param {{ width?: number, height?: number, fileSizeBytes?: number }} params
 * @returns {Promise<ModerationAssessment>}
 */
export async function localSanityOnlyAdapter({ width, height, fileSizeBytes } = {}) {
  const signals = { checkedAt: new Date().toISOString() }

  // Only reject for OBVIOUSLY malformed uploads (a failed/truncated
  // capture) — never a proxy for actual content safety or quality.
  const isMalformed =
    (typeof fileSizeBytes === 'number' && fileSizeBytes <= 0) ||
    (typeof width === 'number' && width <= 0) ||
    (typeof height === 'number' && height <= 0)

  if (isMalformed) {
    signals.malformed = true
    return { safetyVerdict: 'reject', qualityVerdict: 'reject', signals }
  }

  signals.passesBasicSanity = true
  // Deliberately 'needs_review', not 'pass' — see module doc. No real
  // safety or quality signal exists in V1 to justify auto-approval.
  return { safetyVerdict: 'needs_review', qualityVerdict: 'needs_review', signals }
}

/**
 * Maps a moderation assessment to the item_cover_candidates.status this
 * submission should land in immediately after upload. Pure, so the
 * mapping rule itself is testable independent of any real adapter.
 *
 * @param {ModerationAssessment} assessment
 * @returns {string}  one of 'automated_rejected' | 'needs_review'
 *   (never 'approved'/'cover_eligible'/'selected' — those require a human,
 *   see item_cover_candidates' RLS: ordinary users cannot set them)
 */
export function initialStatusFromAssessment(assessment) {
  if (assessment?.safetyVerdict === 'reject' || assessment?.qualityVerdict === 'reject') {
    return 'automated_rejected'
  }
  return 'needs_review'
}
