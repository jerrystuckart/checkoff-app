// Per photo consent evidence. A version string is written ONLY when the matching consent text (lib/photoConsentCopy.js) was actually shown on
// the screen the photo was submitted from. Older clients never send these fields, so their rows stay NULL ("unversioned"); the publication
// date alone is never treated as proof of consent. There is no account wide acceptance flag and no backfill.
//   check_ins.photo_terms_version            check in photos (standard, trip mode, visit confirmation, and mirror rows of the same photo)
//   item_cover_candidates.consent_version    cover submissions
// The deletion pipeline copies the check in version into retained_checkin_photos.consent_version (no identity) before the check in row is removed.

export const PHOTO_TERMS_VERSION = 'photo-terms-v1'

// Effective date of the updated Terms (America/Phoenix date, shown in the notice and on the website: October 8, 2026) and the instant that separates
// "existing" accounts (they get the one time notice) from accounts created afterwards (they only ever see the updated consent screens). Both were set
// at publication (2026-10-08); the website Terms, privacy and delete pages carry the same date.
export const PHOTO_TERMS_EFFECTIVE_DATE = '2026-10-08'
export const PHOTO_TERMS_NOTICE_ACCOUNTS_BEFORE = '2026-10-09T01:30:00Z'

/** Fields to merge into a check_ins insert/upsert row. Empty unless a photo is attached AND the consent line was presented on that screen. */
export function checkInPhotoTermsFields({ photoUrl, consentPresented }) {
  return photoUrl && consentPresented === true ? { photo_terms_version: PHOTO_TERMS_VERSION } : {}
}

/** Mirror rows (fan out, list join credit) reuse the version of the row whose photo they copy; never invent one. */
export function mirrorPhotoTermsFields({ photoUrl, sourceVersion }) {
  return photoUrl && sourceVersion ? { photo_terms_version: sourceVersion } : {}
}

/** Fields for a cover submission insert; the cover consent screen is always presented before submit. */
export function coverConsentFields() {
  return { consent_version: PHOTO_TERMS_VERSION }
}

/** Show the notice to an existing account (created before the effective date) until it is closed on this device. Shown before and after the date so people get advance notice. */
export function shouldShowPhotoTermsNotice({ accountCreatedAt, dismissed = false, accountsBefore = PHOTO_TERMS_NOTICE_ACCOUNTS_BEFORE }) {
  if (dismissed) return false
  const cutoff = new Date(accountsBefore)
  const created = accountCreatedAt ? new Date(accountCreatedAt) : null
  if (Number.isNaN(cutoff.getTime()) || !created || Number.isNaN(created.getTime())) return false
  return created < cutoff
}
