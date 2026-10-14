// Presentation rules for Destination Hub lists. A visitor opens a PERSONAL COPY of a Hub list (adoptDestinationList), so anything
// the admin sets on the Hub's own list (permanent = no dates, artwork, title) has to be read from the source list, not the copy.
// Pure, no React Native.

/** Dates a new personal copy gets. Seasonal source lists keep the legacy behaviour (today .. Dec 31); a permanent source (no end date) gets no end date. */
export function copyDatesForAdoption(sourceList, today, year) {
  const permanent = !sourceList?.ends_at
  return { starts_at: permanent ? null : today, ends_at: permanent ? null : `${year}-12-31` }
}

/**
 * Overlay the Hub source list's presentation onto the copy's meta.
 * - Permanent source (no ends_at): the copy shows no start/end, so no "Ends ..." countdown and no "List ended" banner.
 * - Seasonal source: the copy's own dates are kept exactly as before.
 * - Artwork and title come from the source list when the copy has none.
 */
export function overlayHubSource(copyMeta, sourceList) {
  if (!copyMeta || !sourceList) return copyMeta
  const permanent = !sourceList.ends_at
  return {
    ...copyMeta,
    title: sourceList.title || copyMeta.title,
    cover_emoji: copyMeta.cover_emoji ?? sourceList.cover_emoji ?? null,
    hero_image_url: copyMeta.hero_image_url ?? sourceList.hero_image_url ?? null,
    starts_at: permanent ? null : copyMeta.starts_at,
    ends_at: permanent ? null : copyMeta.ends_at,
    isPermanentHubList: permanent,
  }
}

/** PostgREST filter that finds a visitor's still-usable copy: no end date, or an end date in the future. */
export function activeCopyFilter(today) {
  return `ends_at.is.null,ends_at.gt.${today}`
}

/** Fraction 0..1 for the card progress bar. */
export function progressFraction(progress) {
  if (!progress || !progress.total) return 0
  return Math.max(0, Math.min(1, progress.checked / progress.total))
}

/** Cover emoji for Hub list cards and headers. 🔟 is the Next-10 default and renders as "10" on some platforms, so it is never shown here. */
export function hubListEmoji(emoji) {
  const e = String(emoji ?? '').trim()
  return e && e !== '🔟' ? e : null
}
