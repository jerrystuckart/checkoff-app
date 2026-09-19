// Nearby Redesign (2026-09-19) — pure helper implementing the "bounded
// candidate pool, client-side normalized second pass" search-quality
// strategy documented in screens/DiscoverScreen.jsx's runSearch().
//
// Why this exists: PostgREST's `ilike` is a literal substring match
// against the raw stored text (which itself contains real diacritics,
// e.g. "Hüftgold" stored as-is). Client-side query normalization alone
// can't make `ilike '%hueftgold%'` match a stored "Hüftgold" — that would
// need a database-side normalization (a generated column or extension),
// which is a schema change and explicitly out of scope for this pass.
//
// The safe, no-schema-change compromise implemented here: keep the
// existing server-side `ilike` query as the PRIMARY path (already correct
// for literal/accented-correct input), and add this SECONDARY pass that
// re-checks a small, already-in-memory candidate pool — the current
// radius-filtered Nearby item list (`nearbyItems`), NOT the full catalog —
// using normalized comparison. Any item in that bounded pool whose body,
// venue, or neighborhood name normalizes to include the normalized query,
// and which the primary path didn't already find, is unioned into the
// results.
//
// Honest limitation (documented here and in the final report): this only
// recovers matches within whatever's already been fetched into the
// radius-bound Nearby pool for the CURRENT device location — it is not a
// full-catalog accent-insensitive search. An accent-mismatched item that
// exists in the catalog but outside today's ~100mi radius, or that the
// Nearby hook hasn't fetched for some other reason, is not recoverable by
// this pass. That tradeoff is deliberate: a full-catalog per-keystroke
// fetch is explicitly forbidden.
//
// Pure — no Supabase import, no React — so it's unit-testable without a
// device or a mocked network call.

import { normalizeSearchText, textIncludesNormalized } from './searchNormalize.js'

/**
 * findNormalizedExtraMatches({ pool, alreadyMatchedIds, rawQuery })
 *
 * @param {object} params
 * @param {Array<{id: string|number, body?: string, neighborhoodName?: string, partnerName?: string}>} params.pool
 *   the bounded candidate pool to re-check (e.g. the current radius-
 *   filtered nearbyItems array — never the full catalog).
 * @param {Set<string>} params.alreadyMatchedIds  ids the primary
 *   (server-side ilike) path already matched — string-keyed, so callers
 *   should pass `new Set(matchedIds.map(String))`.
 * @param {string} params.rawQuery  the user's raw, un-normalized typed
 *   search text.
 * @returns {Array} the subset of `pool` that normalized-matches but was
 *   not already found by the primary path. Only runs the (cheap but not
 *   free) per-item normalization when the normalized query actually
 *   differs from a plain lowercase of the raw query — i.e. only when the
 *   input contains something a normalization pass could actually affect
 *   (an accent, or a transliteration substring) — avoiding wasted work on
 *   the common plain-ASCII-query case, where the primary path alone is
 *   already exact.
 */
export function findNormalizedExtraMatches({ pool, alreadyMatchedIds, rawQuery }) {
  if (typeof rawQuery !== 'string' || rawQuery.length < 2) return []
  const normalizedQuery = normalizeSearchText(rawQuery)
  const plainLower = rawQuery.toLowerCase()
  if (!normalizedQuery || normalizedQuery === plainLower) return []

  const matched = alreadyMatchedIds ?? new Set()

  return (pool ?? []).filter(item => {
    if (item == null) return false
    if (matched.has(String(item.id))) return false
    return (
      textIncludesNormalized(item.body, normalizedQuery) ||
      textIncludesNormalized(item.neighborhoodName, normalizedQuery) ||
      textIncludesNormalized(item.partnerName, normalizedQuery)
    )
  })
}
