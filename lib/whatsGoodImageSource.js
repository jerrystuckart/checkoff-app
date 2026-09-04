// Home 2026 / Community Cover Photos V1 → Multi-Image Rotation (2026-09-03)
// — the image-source boundary for What's Good / What's the Thing / Item
// Detail. "Image-capable, not image-dependent" — these functions decide
// whether a TRUSTWORTHY, item/venue-specific image exists; every card
// must render a fully-designed result either way (see
// components/home/EditorialCard.jsx for the two render modes this feeds).
//
// TWO FUNCTIONS, TWO JOBS (do not conflate them — same rule as the
// moderation lifecycle itself: approved / display-eligible / primary are
// three distinct concepts, and "which images exist" is a distinct
// question from "which one do we show right now"):
//
//   resolvedItemImages(item)          -> the full display-eligible pool,
//                                         already-signed URLs + isPrimary/
//                                         weight, in NO particular order.
//                                         Never decides anything — just
//                                         exposes what's available.
//   resolvedItemImage(item, context)  -> the ONE image to render for this
//                                         call, deterministically chosen
//                                         from the pool via
//                                         pickDeterministicImage. Same
//                                         (item, context) always produces
//                                         the same image — no
//                                         Math.random(), no network call,
//                                         pure function of its inputs.
//
// DATA CONTRACT: item.displayEligibleImages, when present, is the
// authoritative pool — an array of { url, isPrimary, weight, candidateId }
// already resolved to real signed URLs by the data layer (see
// lib/coverCandidates.js's attachActiveCoverImages / fetchItemImagePool).
// When that field is ABSENT (undefined — a call site that hasn't been
// wired to the new pool-fetching data layer yet, NOT the same as an
// empty array, which correctly means "fetched, zero images"),
// resolvedItemImages falls back to the legacy single-field priority
// chain below, wrapped as a single-entry pool — bit-for-bit the same
// behavior this file had before rotation existed. This is what makes the
// rollout non-breaking: every existing caller keeps working exactly as
// before until its data layer is explicitly updated to attach the pool.
//
// LEGACY PRIORITY ORDER (used only for the single-entry fallback above):
//   1. activeCoverImageUrl — a Cover Candidate an admin selected as primary
//   2. item_image_url      — an actual photo of the specific item/experience (not yet in schema)
//   3. venue_image_url     — a real photo of the venue itself (not yet in schema)
//   4. photo_url           — an approved business-supplied image (partners.photo_url)
//   5. (none)              — typography-first no-image treatment
//
// This file NEVER decides which candidate is approved/display-eligible/
// primary — that's entirely a database-and-RLS + agent-service/
// coverCandidateModeration.ts decision. By the time a value reaches this
// file, it's already trusted. Organic ranking (whatsGoodSelection.js)
// never reads this — whether an image exists has zero influence on which
// items get selected.
//
// Never returns a generic/stock image — there is no such concept in this
// schema; every source is item/venue/community/business-specific or
// nothing.

function legacyFallbackPool(item) {
  const candidates = [item?.activeCoverImageUrl, item?.item_image_url, item?.venue_image_url, item?.photo_url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return [{ url: candidate.trim(), isPrimary: true, weight: 1, candidateId: null }]
    }
  }
  return []
}

/**
 * @param {object} item
 * @returns {{url: string, isPrimary: boolean, weight: number, candidateId: string|null}[]}
 *   Empty array means "no display-eligible image" — render the
 *   typography-first no-image treatment, never a broken-image placeholder.
 */
export function resolvedItemImages(item) {
  if (Array.isArray(item?.displayEligibleImages)) {
    return item.displayEligibleImages.filter((entry) => typeof entry?.url === 'string' && entry.url.trim().length > 0)
  }
  return legacyFallbackPool(item)
}

// FNV-1a, 32-bit — chosen only because it's ~10 lines of pure integer
// math with no dependency, good-enough distribution for "pick one of a
// handful of images," and, critically, IDENTICAL across every JS runtime
// this app touches (RN/Hermes, Node in tests, the admin tool's browser
// JS) with no locale/platform-specific number formatting to worry about.
// Never used for anything security-sensitive — this is display rotation,
// not an auth token.
function fnv1aHash(str) {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0 // unsigned
}

// Primary gets shown roughly this many times more often than a same-
// weight non-primary — a real preference, not a suppression of the rest
// of the pool. Simple constant, not a config table — "keep exact
// weighting configurable/simple" per the product spec. Change this one
// number to retune the whole app.
//
// IMPORTANT — this is a per-entry multiplier, NOT a fixed "primary shows
// X% of the time" guarantee; the actual share the primary gets shrinks as
// the pool grows, since it's still just one weighted entry among more
// competitors:
//   primary + 1 normal image  -> 3 / (3 + 1)  = 75%
//   primary + 2 normal images -> 3 / (3 + 2)  = 60%
//   primary + 3 normal images -> 3 / (3 + 3)  = 50%
// (general form: MULTIPLIER / (MULTIPLIER + poolSize - 1), all non-primary
// weights = 1). Release Candidate final cleanup (2026-09-03): documented
// here after this was flagged as a possibly-misleading "75%" comment —
// the number itself is unchanged; this is a clarification, not a fix.
export const PRIMARY_WEIGHT_MULTIPLIER = 3

/**
 * Deterministic weighted pick — same (pool, context) always returns the
 * same entry. No Math.random(), no Date.now() read internally (the
 * caller decides what "today" means and passes dateKey explicitly, which
 * is what keeps this function a pure, exhaustively-unit-testable
 * function rather than something that silently behaves differently
 * depending on when a test happens to run).
 *
 * @param {{url: string, isPrimary: boolean, weight: number}[]} pool
 * @param {object} context
 * @param {string} [context.itemId]  include even though every pool entry
 *   is already scoped to one item — without it, two different items that
 *   happened to share a userId+dateKey would hash identically and always
 *   pick the "same position" in their respective pools.
 * @param {string|null} [context.userId]  null/undefined -> 'anon' (a
 *   signed-out session still gets a STABLE pick for the day, just not a
 *   per-user-different one — better than re-rolling every render).
 * @param {string} [context.dateKey]  e.g. '2026-09-03' — the caller's
 *   notion of "today" (UTC-normalized upstream). Omitting it is allowed
 *   (falls back to the empty string) but means the pick never varies by
 *   day, which is almost never what a real caller wants — see
 *   lib/rotationContext.js for the one place "today" should be computed.
 * @returns {{url: string, isPrimary: boolean, weight: number}|null}
 */
export function pickDeterministicImage(pool, context = {}) {
  if (!Array.isArray(pool) || pool.length === 0) return null
  if (pool.length === 1) return pool[0]

  const seed = `${context.itemId ?? ''}|${context.userId ?? 'anon'}|${context.dateKey ?? ''}`
  const hash = fnv1aHash(seed)

  const weights = pool.map((entry) => {
    const base = typeof entry.weight === 'number' && entry.weight > 0 ? entry.weight : 1
    return entry.isPrimary ? base * PRIMARY_WEIGHT_MULTIPLIER : base
  })
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const point = hash % totalWeight

  let cumulative = 0
  for (let i = 0; i < pool.length; i++) {
    cumulative += weights[i]
    if (point < cumulative) return pool[i]
  }
  return pool[pool.length - 1] // unreachable in practice; defensive
}

/**
 * The one image to render for this call. Same (item, context) always
 * returns the same result — see pickDeterministicImage. Every existing
 * call site (EditorialCard, WhatsTheThingHero, ItemDetailScreen) already
 * calls this as resolvedItemImage(item) with no context, which still
 * works exactly as before: a 0-or-1-length pool never touches the
 * hashing path at all, so single-image items are bit-for-bit unchanged.
 *
 * @param {object} item
 * @param {object} [context]  see pickDeterministicImage — itemId is
 *   filled in from item.id automatically if not passed.
 * @returns {{url: string}|null}
 */
export function resolvedItemImage(item, context = {}) {
  const pool = resolvedItemImages(item)
  if (pool.length === 0) return null
  const picked = pool.length === 1 ? pool[0] : pickDeterministicImage(pool, { itemId: item?.id, ...context })
  // Return shape is deliberately just { url } — the same shape this
  // function has always returned (pre-rotation callers/tests rely on
  // exact-shape equality). isPrimary/weight/candidateId are pool-internal
  // bookkeeping; a caller that wants them can read resolvedItemImages
  // directly.
  return { url: picked.url }
}

/** @deprecated kept as an alias so existing callers don't need to change — prefer resolvedItemImage for new code. */
export const resolveWhatsGoodImage = resolvedItemImage
