// Chief Phase 2AF (2026-09-09 instruction) — editorial Home-list theming.
//
// A real production category (items.category_id — see metroCatalog.ts's
// RealDbCategory) is NOT the same thing as a visitor-facing themed list.
// Vienna's first pass at this (Phase 2AE) grouped certified items
// straight into one list per dbCategory ("Arts & Culture", "Outdoor
// Adventures", ...) — technically correct classification, but not an
// editorially curated visitor experience: a themed list should be able
// to cross category lines (a coffeehouse crawl mixes Food & drink with
// Shopping; "Vienna After Dark" mixes Nightlife with Bar & drinks) and
// should only exist when the frozen catalog genuinely supports it.
//
// This module is deliberately the SAME kind of pure, deterministic,
// keyword/tag-grounded classifier as categoryNormalization.ts and
// geoSecondPassResolver.ts — never a new AI call ("do not do new
// discovery" — this only re-slices the already-certified, already-
// verified 177-item Vienna catalog). Word-boundary regex matching
// against diacritics-stripped text (same discipline as
// categoryNormalization.ts, and for the same reason: a naive substring
// match on "bar" would false-positive inside "baroque").

import { stripDiacritics } from './categoryNormalization'
import type { RealDbCategory } from './metroCatalog'

export interface ThemeableItem {
  candidateName: string
  venueName: string
  finalBody: string
  finalTags: readonly string[]
  dbCategory: RealDbCategory
  /** Certification attempt count — a real, already-collected signal (fewer attempts needed = a cleaner first pass) used ONLY to break ties deterministically when a curated list must choose among more qualifying items than it needs; never used to exclude an item outright. */
  attempts: number
}

export interface ThemedListDefinition {
  id: string
  /** Visitor-facing title — never a raw category or classification string. */
  title: string
  /** Word-boundary, case-insensitive patterns matched against diacritics-stripped venueName + finalBody + candidateName. ANY match qualifies the item. */
  patterns: readonly RegExp[]
  /** An item already matching one of these tags also qualifies, independent of the text patterns — real, already-curated evidence (M7.5 TAG_ASSIGNMENT), not a guess. */
  tags?: readonly string[]
  /** An item in one of these real production categories also qualifies outright (e.g. every Nightlife item belongs in "Vienna After Dark", not just the ones whose body happens to say "cocktail"). Optional — most themes rely on keyword/tag matching alone so they can genuinely cross category lines. */
  categories?: readonly RealDbCategory[]
}

/**
 * The candidate theme catalog — evaluated against the frozen catalog by
 * buildEditorialThemedLists, which KEEPS only the ones the real
 * inventory actually supports (see minItems there). Titles/keywords are
 * generic (not Vienna-specific wording) so this same definition set is
 * reusable for any future metro — Vienna's real content is what decides
 * which of these actually ship, never a Vienna-only hardcoded list.
 */
export const THEMED_LIST_DEFINITIONS: readonly ThemedListDefinition[] = [
  {
    id: 'imperial',
    title: 'Imperial & Grand Landmarks',
    patterns: [/\bpalace\b/, /\bhofburg\b/, /\bschonbrunn\b/, /\bhabsburg\b/, /\bimperial\b/, /\bkaiser\b/, /\bbelvedere\b/, /\bcathedral\b/, /\bbasilica\b/, /\briding school\b/, /\bopera house\b/, /\bstate opera\b/],
  },
  {
    id: 'after_dark',
    title: 'After Dark',
    patterns: [/\bcocktail\b/, /\bspeakeasy\b/, /\bnightclub\b/, /\bnight club\b/, /\bdance floor\b/, /\bdisco\b/, /\blate[- ]night\b/],
    // Deliberately NOT a bare \bbar\b text pattern nor the generic
    // 'bar-food'/'club' tags — both were found (real Vienna data,
    // 2026-09-09) to false-positive broadly: 'bar-food' is assigned to
    // ordinary casual-dining items (roast beef, breakfast, sushi) far
    // beyond actual nightlife venues, and bare 'club' matches a sports
    // club ("Sport-Club-Stadion Hernals"). 'nightlife'/'cocktail-bar'/
    // 'hidden-bar'/'late-night'/'night-out' were verified to correlate
    // exactly with the real Nightlife/Bar & drinks category items.
    tags: ['nightlife', 'cocktail-bar', 'hidden-bar', 'late-night', 'night-out'],
    categories: ['Nightlife', 'Bar & drinks'],
  },
  {
    id: 'classical_performing_arts',
    title: 'Classical & Performing Arts',
    patterns: [/\borchestra\b/, /\bopera\b/, /\bconcert\b/, /\bsymphony\b/, /\bmusikverein\b/, /\bphilharmonic\b/, /\bclassical music\b/, /\bchamber\b/, /\bcabaret\b/, /\btheater\b/, /\btheatre\b/],
    tags: ['classical-music', 'live-performance', 'music-venue', 'concert'],
  },
  {
    id: 'cafes_markets_local_flavor',
    title: 'Cafés, Markets & Local Flavor',
    patterns: [/\bcoffeehouse\b/, /\bkaffeehaus\b/, /\bcafe\b/, /\btorte\b/, /\bpastry\b/, /\bpastries\b/, /\bpatisserie\b/, /\bstrudel\b/, /\bsachertorte\b/, /\bmarket\b/, /\bmarkt\b/, /\bheuriger\b/, /\bwine tavern\b/, /\bdeli\b/, /\bdelicatessen\b/, /\bbakery\b/],
    // 'coffee-shop' deliberately excluded — real Vienna data (2026-09-09)
    // showed it also gets assigned to a shopping mall with a coffee
    // stand inside ("The Mall"), not just genuine cafés. 'farmers-market'
    // is precise (every occurrence is a real market) and kept.
    tags: ['coffee', 'farmers-market'],
  },
  {
    id: 'hidden_vienna',
    title: 'Hidden Gems',
    patterns: [/\bhidden\b/, /\bsecret\b/, /\bcourtyard\b/, /\bunderground\b/, /\btucked away\b/],
    tags: ['hidden-gem', 'hidden-bar', 'local-favorite'],
  },
] as const

function haystackOf(item: ThemeableItem): string {
  return stripDiacritics(`${item.venueName} ${item.finalBody} ${item.candidateName}`).toLowerCase()
}

/** Whole-word, case-insensitive match against ANY of a definition's patterns/tags/categories. */
export function itemMatchesTheme(item: ThemeableItem, def: ThemedListDefinition): boolean {
  if (def.categories?.includes(item.dbCategory)) return true
  if (def.tags?.some((t) => item.finalTags.includes(t))) return true
  const haystack = haystackOf(item)
  return def.patterns.some((p) => new RegExp(p.source, 'i').test(haystack))
}

/**
 * Normalizes a venue name down to letters+digits only, diacritics
 * stripped, so genuinely-the-same-venue duplicates that differ only by
 * spacing/punctuation/accent characters ("Prater Dome" / "Praterdome",
 * "St. Stephen's Cathedral" / "St. Stephen's Cathedral" with a curly
 * apostrophe) collapse to the same key. Deliberately conservative —
 * this is exact-match only, never fuzzy/similarity-based, so two
 * genuinely different venues (e.g. "Bezirksmuseum Währing" vs
 * "Bezirksmuseum Meidling" — different districts) are never merged on a
 * guess.
 */
export function normalizedVenueKey(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const VENUE_NAME_STOPWORDS = new Set(['and', 'the', 'of', 'in', 'at', 'a', 'an', 'or', 'for'])

/** Words of 3+ letters, diacritics stripped, generic filler dropped — the vocabulary compared by isSameVenue's subset check. */
function significantWords(name: string): Set<string> {
  const words = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !VENUE_NAME_STOPWORDS.has(w))
  return new Set(words)
}

/**
 * Two venue names are treated as the same real place when either (a)
 * they normalize to the identical string (spacing/punctuation/accent
 * differences only — "Prater Dome" / "Praterdome"), or (b) one name's
 * full set of significant words is entirely contained in the other's
 * ("Augarten Baroque Park & Porcelain Manufactory" ⊇ "Augarten park and
 * Augarten Porcelain Manufactory" — the same M3 discovery bundle
 * described with extra/fewer words). Deliberately NOT a similarity
 * score/fuzzy ratio: "Bezirksmuseum Währing" and "Bezirksmuseum
 * Meidling" share one word but neither is a subset of the other (each
 * has its own distinctive district name) — real, different venues,
 * correctly never merged. A same-language rewording is caught; a
 * German/English name pair for the same venue (e.g. "Vienna State
 * Opera" vs "Wiener Staatsoper") is NOT — that needs the resolved
 * canonical-venue-identity infrastructure (canonicalVenueName.ts) to
 * agree on ONE name for both discovery candidates, which is a separate,
 * upstream (M6.5) fix, not something this list-curation step should
 * guess at.
 */
export function isSameVenue(nameA: string, nameB: string): boolean {
  if (normalizedVenueKey(nameA) === normalizedVenueKey(nameB)) return true
  const wa = significantWords(nameA)
  const wb = significantWords(nameB)
  if (wa.size === 0 || wb.size === 0) return false
  const aSubsetOfB = [...wa].every((w) => wb.has(w))
  const bSubsetOfA = [...wb].every((w) => wa.has(w))
  return aSubsetOfB || bSubsetOfA
}

/** Stable dedup — keeps the first occurrence in `items`' own order (callers pre-sort for a meaningful "first") and drops any later item isSameVenue as one already kept. */
function dedupByVenue<T extends ThemeableItem>(items: readonly T[]): T[] {
  const out: T[] = []
  for (const item of items) {
    if (out.some((kept) => isSameVenue(kept.venueName, item.venueName))) continue
    out.push(item)
  }
  return out
}

/** Deterministic "strongest first" ordering within a tier — fewer certification attempts (a cleaner first pass) first, ties broken alphabetically for full reproducibility. Never a quality judgment beyond what M7 already certified; every item here already passed the SAME bar. */
function byStrengthThenName(a: ThemeableItem, b: ThemeableItem): number {
  if (a.attempts !== b.attempts) return a.attempts - b.attempts
  return a.candidateName.localeCompare(b.candidateName)
}

export interface EditorialThemedList {
  id: string
  title: string
  candidateNames: string[]
}

/**
 * Evaluates every candidate theme definition against the real, frozen
 * catalog and keeps only the ones with real support — "only if
 * supported by the inventory" (2026-09-09 instruction). Within a kept
 * theme, near-duplicate venues collapse to one (see normalizedVenueKey)
 * so the same real place never occupies two slots in one list.
 */
export function buildEditorialThemedLists(items: readonly ThemeableItem[], defs: readonly ThemedListDefinition[] = THEMED_LIST_DEFINITIONS, minItems = 10): EditorialThemedList[] {
  const results: EditorialThemedList[] = []
  for (const def of defs) {
    const matched = items.filter((it) => itemMatchesTheme(it, def)).sort(byStrengthThenName)
    const deduped = dedupByVenue(matched)
    if (deduped.length < minItems) continue
    results.push({ id: def.id, title: def.title, candidateNames: deduped.map((it) => it.candidateName) })
  }
  return results
}

/**
 * A single, deterministic flagship selection — "one Fall 2026 Vienna
 * flagship list of approximately 30 strong, balanced items" (2026-09-09
 * instruction), never all 177. Balance is computed by the largest-
 * remainder (Hare-quota) apportionment method: each real dbCategory gets
 * a share of `targetSize` proportional to how much of the certified
 * catalog it represents, so a 81-item category doesn't crowd out an
 * 8-item one entirely, and a 1-item category isn't forced to contribute
 * a slot it can't fill. Global near-duplicate-venue dedup runs first, so
 * the same real place is never double-counted toward the target size or
 * given two flagship slots.
 */
export function selectFlagshipList(items: readonly ThemeableItem[], targetSize = 30): string[] {
  const pool = dedupByVenue([...items].sort(byStrengthThenName))
  if (pool.length <= targetSize) return pool.map((it) => it.candidateName)

  const byCategory = new Map<RealDbCategory, ThemeableItem[]>()
  for (const it of pool) byCategory.set(it.dbCategory, [...(byCategory.get(it.dbCategory) ?? []), it])

  const total = pool.length
  const quotas: Array<{ category: RealDbCategory; base: number; remainder: number; available: number }> = []
  for (const [category, catItems] of byCategory) {
    const exact = (catItems.length / total) * targetSize
    const base = Math.min(Math.floor(exact), catItems.length)
    quotas.push({ category, base, remainder: exact - Math.floor(exact), available: catItems.length })
  }

  let allocated = quotas.reduce((sum, q) => sum + q.base, 0)
  // Largest-remainder pass: hand out the leftover slots to whichever
  // category is closest to "deserving" one more, skipping any category
  // that's already exhausted its real inventory.
  const byRemainderDesc = [...quotas].sort((a, b) => b.remainder - a.remainder || a.category.localeCompare(b.category))
  let i = 0
  while (allocated < targetSize && quotas.some((q) => q.base < q.available)) {
    const q = byRemainderDesc[i % byRemainderDesc.length]!
    if (q.base < q.available) {
      q.base += 1
      allocated += 1
    }
    i += 1
    if (i > targetSize * quotas.length + quotas.length) break // hard stop — never loop forever
  }

  const selected: ThemeableItem[] = []
  for (const q of quotas) {
    const catItems = (byCategory.get(q.category) ?? []).sort(byStrengthThenName)
    selected.push(...catItems.slice(0, q.base))
  }
  return selected.sort(byStrengthThenName).map((it) => it.candidateName)
}
