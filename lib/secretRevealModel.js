// Secret CheckOff screens (locked + unlocked) — the pure decisions behind
// components/secret/SecretRevealView.jsx. Kept free of React / native
// modules so the rules that matter (what photo may appear in which state,
// what the venue label is, what the status copy truthfully claims) have
// real automated coverage; see secretRevealModel.test.js.

import { extractQuotedVenueFromBody } from './itemDetailHeaderTitle.js'
import { resolvedItemImage } from './whatsGoodImageSource.js'

function clean(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The venue label shown above the title. Order: partners.business_name
 * (fetched or already on the item) -> the quoted `at "<venue>"` clause the
 * item detail header already trusts. The neighborhood / metro is NEVER used
 * as the venue name (it produced the generic "Peoria" label); it is
 * returned separately as `area` so the UI can show it as a location hint.
 *
 * @returns {{ venueName: string|null, source: 'partner'|'body'|'none', area: string|null }}
 */
export function resolveSecretVenue({ item, fetchedPartnerName } = {}) {
  const area = clean(item?.neighborhoodName)
  const partner = clean(fetchedPartnerName) ?? clean(item?.partnerName)
  if (partner) return { venueName: partner, source: 'partner', area }
  const quoted = clean(extractQuotedVenueFromBody(item?.body))
  if (quoted) return { venueName: quoted, source: 'body', area }
  return { venueName: null, source: 'none', area }
}

/**
 * Which photo a state may show.
 *
 *  locked   -> the dedicated business photo ONLY. The approved cover pool,
 *              active cover and legacy item/venue image fields can depict
 *              the secret itself, so they are never consulted here, even
 *              if the caller passes them.
 *  revealed -> the admin-managed reveal background (if any), then the approved
 *              (display-eligible / selected-cover) experience photo, then the
 *              venue's business photo, then null.
 *
 * `pool` / `activeCoverUrl` must already come from the approved-only data
 * layer (item_cover_candidates display_eligible / status 'selected'); pending
 * and rejected submissions never reach this function. Legacy single-field
 * images on the item are deliberately not read (pool is passed explicitly,
 * so resolvedItemImage never falls back to them).
 *
 * @returns {{ url: string, source: 'business'|'approved'|'reveal' }|null}
 */
export function selectHeroPhoto({ phase, itemId, businessPhotoUrl, revealImageUrl, pool, activeCoverUrl, imageContext }) {
  const business = clean(businessPhotoUrl)
  if (phase !== 'revealed') {
    return business ? { url: business, source: 'business' } : null
  }
  const reveal = clean(revealImageUrl)
  if (reveal) return { url: reveal, source: 'reveal' }
  let images = Array.isArray(pool) ? pool.filter((p) => clean(p?.url)) : []
  const cover = clean(activeCoverUrl)
  if (images.length === 0 && cover) {
    images = [{ url: cover, isPrimary: true, weight: 1, candidateId: null }]
  }
  const picked = resolvedItemImage({ id: itemId, displayEligibleImages: images }, imageContext ?? {})
  if (picked?.url) return { url: picked.url, source: 'approved' }
  return business ? { url: business, source: 'business' } : null
}

export function formatDistance(meters) {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return null
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

/**
 * Locked-state status card. Claims only what is true:
 *  - location updates happen while this screen is open (foreground watch),
 *    so nothing says "we'll notify you" or "watching for your arrival".
 *  - denied permission / no fix get their own wording and action.
 *
 * kind: 'checking' | 'far' | 'denied' | 'nofix'
 */
export function lockedStatus({ phase, permDenied, distance, radius }) {
  const unlock = `Unlocks within ${Math.round(radius)} m`
  if (phase === 'error') {
    return permDenied
      ? { kind: 'denied', headline: 'Location is off', detail: 'Allow location for CheckOff to unlock this secret.', action: 'settings' }
      : { kind: 'nofix', headline: 'No location fix yet', detail: 'Make sure location services are on, then try again.', action: 'retry' }
  }
  if (phase === 'tooFar' && formatDistance(distance)) {
    return {
      kind: 'far',
      headline: `${formatDistance(distance)} away`,
      detail: unlock,
      action: null,
    }
  }
  return { kind: 'checking', headline: 'Checking your location…', detail: unlock, action: null }
}

export function pointsLabel(item) {
  const n = Number(item?.difficulty)
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} pts` : null
}

/** Truthful photo-requirement line shown beside the primary action. */
export function photoRequirementCopy(item) {
  const required = !!(item?.photoRequired ?? item?.photo_required)
  return required
    ? { required: true, text: 'A photo is required to check this off.' }
    : { required: false, text: 'Adding a photo is optional.' }
}

/** Description paragraphs (blank-line separated) — never a headline. */
export function descriptionParagraphs(text) {
  if (typeof text !== 'string') return []
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

/**
 * Bottom-of-screen primary action, plus the ordered secondary chips.
 * Locked: Directions is primary (Settings / Try again when location fails).
 * Revealed: the gold Check it off is primary; every utility is secondary.
 * Directions drops into the secondary row whenever it is not primary.
 */
export function planActions({ phase, status, hasLocation, hasWebsite }) {
  const secondary = []
  let primary = null
  if (phase === 'revealed') {
    primary = { id: 'checkoff' }
    if (hasLocation) secondary.push('directions')
  } else if (status?.action === 'settings') {
    primary = { id: 'settings' }
    if (hasLocation) secondary.push('directions')
  } else if (status?.action === 'retry') {
    primary = { id: 'retry' }
    if (hasLocation) secondary.push('directions')
  } else if (hasLocation) {
    primary = { id: 'directions' }
  }
  if (hasWebsite) secondary.push('website')
  secondary.push('save', 'share')
  return { primary, secondary }
}

/** "Baba's Burgers & Birds" -> "Baba's Burgers & Birds'"; "The Raven" -> "The Raven's". */
export function possessive(name) {
  const n = clean(name)
  if (!n) return null
  return /s$/i.test(n) ? `${n}'` : `${n}'s`
}

/** Discovery-card headline: "You found Baba's Burgers & Birds' secret" (no venue -> "You found a secret"). */
export function revealHeadline(venueName) {
  const p = possessive(venueName)
  return p ? `You found ${p} secret` : 'You found a secret'
}

/** Unlocked hero is shorter so the secret is the focal point (never below 150). */
export function unlockedHeroHeight(lockedHeroHeight) {
  return Math.max(150, Math.round(lockedHeroHeight * 0.64))
}
