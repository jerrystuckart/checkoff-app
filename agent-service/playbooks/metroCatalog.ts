// Chief — M7-M9 Metro Catalog Construction / Staging (Phase 2V). Pure
// logic only, reusable across metros (San Diego, Tijuana, Vienna, and
// every future one) — no metro-specific code path.
//
// SOURCE OF TRUTH FOR THE REAL SCHEMA: docs/metro-launch-audit/
// (05_item_intake_contract.md, patches/denver_catalog_insert_CORRECTED.sql,
// patches/denver_catalog_insert_review_notes.md) — the actual, executed
// Denver production intake. This module encodes that same contract in
// code so future metros don't re-derive it from scratch:
//   - `items` has NO title/name column and NO metro column. Display
//     text lives in `body` (a single "Checkoffized" sentence embedding
//     the venue name); metro scoping is ONLY via
//     neighborhood_id -> neighborhoods.metro_id (or is_universal=true).
//   - `items.category_id` is a real FK — NOT free text. Only 8 real
//     categories exist in production: Adventure, Arts & Culture,
//     Bar & drinks, Food & drink, Misc, Nightlife, Play, Spa & self-care.
//     4 of this pipeline's 11 canonical categories (Shopping, Sports,
//     Social, Travel) have NO confirmed real-DB equivalent — per
//     explicit product policy, these FAIL INTAKE rather than get
//     guessed into "Play"/"Misc" (see CANONICAL_TO_DB_CATEGORY below).
//   - No UNIQUE constraint on `items` at all. The ONLY real dedup
//     mechanism (proven in the actual Denver intake) is an
//     application-side normalized-`maps_query` comparison against the
//     ENTIRE production catalog, every metro, not just the target one.
//   - Coordinates are NOT set at intake. Denver's real 149 items were
//     inserted with maps_lat/maps_lng NULL by design; geocoding is a
//     separate, later, human-reviewed pass (scripts/geocode-*.js). This
//     pipeline follows the same convention — LOCATION_GATE checks that
//     a candidate has enough evidence for that LATER pass (a real,
//     specific maps_query string), never that coordinates already exist,
//     and never fabricates lat/lng from AI research alone.

import type { CanonicalCategory } from './categoryNormalization'

// ---------------------------------------------------------------------------
// Category mapping — canonical (AI pipeline) -> real production category.
// ---------------------------------------------------------------------------

/**
 * The real `categories.name` set — ASSUMES
 * supabase/migrations/20260906_add_shopping_sports_social_travel_categories.sql
 * has been applied (a read-only dependency audit that same day confirmed
 * categories are fully data-driven end-to-end — DB -> app -> admin —
 * with zero app/admin code changes required to add a category; see that
 * migration's own header for the full audit). Before this migration
 * runs, Shopping/Sports/Social/Travel genuinely have no home and MUST
 * fail intake (the original, more conservative behavior) — this file
 * cannot verify live which state is currently true, since agent_service
 * has no SELECT grant on `categories` itself. Confirm the migration has
 * actually been run before trusting this mapping for a real build.
 */
export const REAL_DB_CATEGORIES = ['Adventure', 'Arts & Culture', 'Bar & drinks', 'Food & drink', 'Misc', 'Nightlife', 'Play', 'Spa & self-care', 'Shopping', 'Sports', 'Social', 'Travel'] as const
export type RealDbCategory = (typeof REAL_DB_CATEGORIES)[number]

/** 1:1 — every canonical Winston taxonomy category now has a real, unchanged-name equivalent (see doc above). No guessing/remapping performed for any candidate. */
export const CANONICAL_TO_DB_CATEGORY: Record<CanonicalCategory, RealDbCategory | null> = {
  'Food & drink': 'Food & drink',
  'Bar & drinks': 'Bar & drinks',
  Adventure: 'Adventure',
  'Arts & Culture': 'Arts & Culture',
  Shopping: 'Shopping',
  Sports: 'Sports',
  Social: 'Social',
  Travel: 'Travel',
  Nightlife: 'Nightlife',
  'Spa & self-care': 'Spa & self-care',
  Misc: 'Misc',
}

export interface CategoryMappingResult {
  dbCategory: RealDbCategory | null
  failed: boolean
  reason: string | null
}

export function mapCanonicalCategoryToDb(canonical: CanonicalCategory | null): CategoryMappingResult {
  if (!canonical) return { dbCategory: null, failed: true, reason: 'candidate has no canonical category at all (unclassified upstream)' }
  const dbCategory = CANONICAL_TO_DB_CATEGORY[canonical]
  if (!dbCategory) {
    return { dbCategory: null, failed: true, reason: `canonical category "${canonical}" has no confident real-DB equivalent (production only has: ${REAL_DB_CATEGORIES.join(', ')}) — needs an explicit product decision before intake, not a guess` }
  }
  return { dbCategory, failed: false, reason: null }
}

// ---------------------------------------------------------------------------
// Dedup key — identical normalization to the real, executed Denver intake
// (denver_catalog_insert_CORRECTED.sql:379-402): lowercase, strip
// everything but letters/digits, compare against the ENTIRE production
// catalog (every metro), not just the target metro.
// ---------------------------------------------------------------------------

export function normalizeMapsQuery(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

// ---------------------------------------------------------------------------
// The candidate -> item-intake mapping.
// ---------------------------------------------------------------------------

export interface MetroCatalogCandidate {
  /** The canonical (post-dedupe) candidate name — e.g. "Westfield UTC". */
  name: string
  /** The already-normalized canonical category from categoryNormalization.ts (null if upstream classification failed). */
  canonicalCategory: CanonicalCategory | null
  /** Free-text neighborhood/area as the research pipeline recorded it. */
  neighborhood: string | null
  /** The final CheckOff-voiced sentence from M6.5 (stepEditor's checkoffizedItem) — becomes items.body. */
  checkoffizedItem: string
  /** The original research claim — preserved as internal provenance, never shown to users. */
  claimSupported: string
  /** The (possibly several, deduped) research source URLs — preserved as internal provenance. */
  sourceUrls: string[]
  verificationConfidence?: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface ItemIntakeRecord {
  /** Not a schema column — the canonical candidate name, kept for the generated SQL's own readability/audit trail and for matching back to checkoffizedItems. */
  candidateName: string
  body: string
  dbCategory: RealDbCategory
  /** The literal, specific Google-Places-style search string this item resolves to — required (items.maps_query is NOT NULL in production) and is the input the LATER geocoding pass keys off. Never fabricated coordinates from this. */
  mapsQuery: string
  neighborhoodName: string | null
  dedupKey: string
  /** Internal-only, not written to any items column that doesn't already exist for it — preserved for audit per "retain provenance of merged sources if practical". */
  provenance: { claimSupported: string; sourceUrls: string[]; verificationConfidence?: string }
}

export interface IntakeFailure {
  candidateName: string
  reason: string
}

export interface IntakeMappingResult {
  records: ItemIntakeRecord[]
  failures: IntakeFailure[]
}

/**
 * Pure candidate -> intake-record mapping. "One canonical candidate ->
 * at most one item row" is upheld structurally: each MetroCatalogCandidate
 * produces exactly zero (on failure) or one ItemIntakeRecord — this
 * function is never given the power to split or multiply a candidate.
 * A candidate whose category can't be confidently mapped, or whose body/
 * name is empty/placeholder, fails intake and is reported, never guessed.
 */
export function mapCandidateToIntakeRecord(candidate: MetroCatalogCandidate): { record: ItemIntakeRecord | null; failure: IntakeFailure | null } {
  const name = candidate.name.trim()
  if (!name) return { record: null, failure: { candidateName: candidate.name, reason: 'candidate has no name' } }

  const body = candidate.checkoffizedItem.trim()
  if (!body) return { record: null, failure: { candidateName: name, reason: 'candidate has no checkoffized item text (M6.5 output missing)' } }

  const categoryResult = mapCanonicalCategoryToDb(candidate.canonicalCategory)
  if (categoryResult.failed || !categoryResult.dbCategory) {
    return { record: null, failure: { candidateName: name, reason: categoryResult.reason ?? 'category mapping failed' } }
  }

  const mapsQuery = [name, candidate.neighborhood].filter(Boolean).join(', ')
  if (!mapsQuery) return { record: null, failure: { candidateName: name, reason: 'no name/neighborhood text available to build a maps_query' } }

  return {
    record: {
      candidateName: name,
      body,
      dbCategory: categoryResult.dbCategory,
      mapsQuery,
      neighborhoodName: candidate.neighborhood,
      dedupKey: normalizeMapsQuery(mapsQuery),
      provenance: { claimSupported: candidate.claimSupported, sourceUrls: candidate.sourceUrls, verificationConfidence: candidate.verificationConfidence },
    },
    failure: null,
  }
}

// ---------------------------------------------------------------------------
// Neighborhood resolution — a candidate's free-text `neighborhood` field
// is exactly as variable as its category ("La Jolla" vs "La Jolla (UTC)"
// vs "University City / La Jolla"). The real `neighborhoods` table needs
// items.neighborhood_id to point at ONE specific row, so every record
// must resolve to exactly one of the metro's real, geocoded neighborhood
// names before it can be inserted — same substring-containment
// discipline as metroLaunchDriver.ts's buildAuditEvidence, applied here
// to pick a single winner rather than just count matches.
// ---------------------------------------------------------------------------

export interface NeighborhoodResolutionResult {
  resolved: Map<string, string> // candidateName -> canonical neighborhood name
  unresolved: Array<{ candidateName: string; rawNeighborhood: string | null; reason: string }>
}

/**
 * Resolves each record's free-text neighborhood to exactly one of
 * `canonicalNeighborhoods`. A record whose text matches MORE than one
 * canonical name (ambiguous) or none at all is reported unresolved,
 * never guessed — the same "fail rather than guess" discipline as
 * category mapping. Prefers the LONGEST matching canonical name when
 * more than one is a substring match candidate but only one is not
 * itself a substring of another match (e.g. "Otay" vs "Otay Mesa" would
 * both hit generically named text — longest-match-wins resolves the
 * common case; a genuine tie still fails rather than guessing).
 */
/** Any of these appearing in a candidate's raw neighborhood text is a strong, explicit signal the venue is in Mexico — used to keep cross-border resolution honest (see resolveNeighborhoods' countryHint check below). */
const MEXICO_TEXT_SIGNAL = /\b(tijuana|mexico|méxico|baja california)\b/i

export function resolveNeighborhoods(
  records: readonly ItemIntakeRecord[],
  canonicalNeighborhoods: readonly string[],
  /** landmark/area keyword (lowercase) -> canonical neighborhood name, for real sub-areas/landmarks that fall within a canonical neighborhood but never mention its name literally (e.g. "Avenida Revolución" is IN Zona Centro but the text alone never says "Zona Centro"). Checked only when no direct canonical-name match exists — never overrides a direct match. */
  aliases: Readonly<Record<string, string>> = {},
  /**
   * The subset of `canonicalNeighborhoods` that are actually in Mexico.
   * Structural bug fix (San Diego/Tijuana catalog SQL review, 2026-09-06):
   * "Estación Federal", "La Mezcalera", and "Rubiks" — all real Tijuana
   * venues whose raw text was "Downtown Tijuana..." — resolved to
   * "Gaslamp Quarter" because the generic `downtown -> Gaslamp Quarter`
   * alias fired on the word "downtown" without checking that the SAME
   * text also explicitly said "Tijuana". A candidate whose raw text
   * carries an explicit Mexico signal (MEXICO_TEXT_SIGNAL) may now ONLY
   * resolve to a neighborhood in this set — a same-country match that
   * would otherwise win (via canonical name or alias) is discarded
   * rather than accepted, and a candidate with NO Mexico neighborhood
   * match at all fails resolution rather than silently landing on a
   * California one.
   */
  mexicoNeighborhoods: ReadonlySet<string> = new Set()
): NeighborhoodResolutionResult {
  const resolved = new Map<string, string>()
  const unresolved: Array<{ candidateName: string; rawNeighborhood: string | null; reason: string }> = []
  const mexicoLower = new Set([...mexicoNeighborhoods].map((n) => n.toLowerCase()))

  for (const record of records) {
    const raw = (record.neighborhoodName ?? '').toLowerCase()
    if (!raw) {
      unresolved.push({ candidateName: record.candidateName, rawNeighborhood: record.neighborhoodName, reason: 'no neighborhood text at all' })
      continue
    }
    const isMexicoSignaled = MEXICO_TEXT_SIGNAL.test(raw)

    let matches = canonicalNeighborhoods.filter((n) => raw.includes(n.toLowerCase()))
    if (matches.length === 0) {
      const aliasMatches = Object.entries(aliases)
        .filter(([keyword]) => raw.includes(keyword))
        .map(([, canonical]) => canonical)
      if (aliasMatches.length > 0) matches = [...new Set(aliasMatches)]
    }

    if (isMexicoSignaled && mexicoLower.size > 0) {
      const consistent = matches.filter((m) => mexicoLower.has(m.toLowerCase()))
      if (matches.length > 0 && consistent.length === 0) {
        unresolved.push({ candidateName: record.candidateName, rawNeighborhood: record.neighborhoodName, reason: `country mismatch — "${record.neighborhoodName}" explicitly signals Mexico but only matched non-Mexico neighborhood(s): ${matches.join(', ')}` })
        continue
      }
      matches = consistent
    }

    if (matches.length === 0) {
      unresolved.push({ candidateName: record.candidateName, rawNeighborhood: record.neighborhoodName, reason: `no canonical neighborhood name found in "${record.neighborhoodName}"` })
      continue
    }
    // Longest match wins when multiple canonical names are substrings of each other's text (e.g. both "Otay" and "Otay Mesa" would match "Otay Mesa, Tijuana" — the longer, more specific one wins).
    const maxLen = Math.max(...matches.map((m) => m.length))
    const longest = matches.filter((m) => m.length === maxLen)
    if (longest.length > 1) {
      unresolved.push({ candidateName: record.candidateName, rawNeighborhood: record.neighborhoodName, reason: `ambiguous — "${record.neighborhoodName}" matches multiple canonical neighborhoods equally: ${longest.join(', ')}` })
      continue
    }
    resolved.set(record.candidateName, longest[0])
  }

  return { resolved, unresolved }
}

export function mapCandidatesToIntakeRecords(candidates: readonly MetroCatalogCandidate[]): IntakeMappingResult {
  const records: ItemIntakeRecord[] = []
  const failures: IntakeFailure[] = []
  for (const candidate of candidates) {
    const { record, failure } = mapCandidateToIntakeRecord(candidate)
    if (record) records.push(record)
    if (failure) failures.push(failure)
  }
  return { records, failures }
}

// ---------------------------------------------------------------------------
// Dedup against an existing catalog (either the real production `items`
// table's maps_query column, or the batch's own records) — same
// normalized-key equality as Denver's real intake, checked globally.
// ---------------------------------------------------------------------------

export interface DedupCheckResult {
  /** Records safe to insert — no collision with the existing catalog or with each other. */
  clean: ItemIntakeRecord[]
  /** A record whose dedup key collides with something ALREADY in production. */
  collidesWithProduction: Array<{ record: ItemIntakeRecord; existingMapsQuery: string }>
  /** Two or more records within the SAME batch that collide with each other (should not happen if candidateMerge.ts's own dedupe already ran, but checked here as a genuine safety net, not by construction). */
  collidesWithinBatch: Array<{ records: ItemIntakeRecord[] }>
}

export function checkForDuplicates(candidateRecords: readonly ItemIntakeRecord[], existingProductionMapsQueries: readonly string[]): DedupCheckResult {
  const productionKeys = new Map<string, string>()
  for (const mq of existingProductionMapsQueries) {
    const key = normalizeMapsQuery(mq)
    if (key && !productionKeys.has(key)) productionKeys.set(key, mq)
  }

  const byKey = new Map<string, ItemIntakeRecord[]>()
  for (const record of candidateRecords) {
    const group = byKey.get(record.dedupKey) ?? []
    group.push(record)
    byKey.set(record.dedupKey, group)
  }

  const clean: ItemIntakeRecord[] = []
  const collidesWithProduction: Array<{ record: ItemIntakeRecord; existingMapsQuery: string }> = []
  const collidesWithinBatch: Array<{ records: ItemIntakeRecord[] }> = []

  for (const [key, group] of byKey) {
    const existingMapsQuery = productionKeys.get(key)
    if (existingMapsQuery) {
      for (const record of group) collidesWithProduction.push({ record, existingMapsQuery })
      continue
    }
    if (group.length > 1) {
      collidesWithinBatch.push({ records: group })
      continue
    }
    clean.push(group[0])
  }

  return { clean, collidesWithProduction, collidesWithinBatch }
}

// ---------------------------------------------------------------------------
// Semantic same-venue duplicate detection — the San Diego catalog SQL
// review (2026-09-06) found normalized-maps_query dedup (checkForDuplicates
// above) insufficient: it only catches literal maps_query collisions, but
// real duplicate pairs slipped through with genuinely different maps_query
// text because the underlying research produced a second, differently-
// worded NAME for the same real venue — a qualifier appended in
// parentheses ("Zuma" / "Zuma (Guild Hotel)", "By The Sea" / "By The Sea
// (new restaurant)", "Mr. Charlie's" / "Mr. Charlie's (Hillcrest)", "Joan
// and Irwin Jacobs Performing Arts Center" / "...(\"The Joan\")",
// "Museum of Contemporary Art San Diego" / "...(La Jolla)"), a dropped
// generic suffix word ("Fashion Valley Mall" / "Fashion Valley"), or a
// genuine re-wording ("Harland Clubhouse" / "Harland Brewing Co. – The
// Clubhouse"). This is a NAME-level check, deliberately separate from
// candidateMerge.ts's own (name-identity-only, by design — see that
// module's doc) dedup, since these names are NOT identical strings.
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const VENUE_NAME_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'co', 'company'])
/** Generic descriptor words safe to drop ONLY from the end of a name (never mid-name, where they might be load-bearing — e.g. "Point Loma" itself must never be touched). */
const VENUE_NAME_TRAILING_NOISE = new Set(['mall', 'center', 'centre', 'museum', 'clubhouse', 'restaurant', 'cafe'])

function normalizeVenueNameForSemanticMatch(rawName: string): string {
  const withoutQualifiers = rawName
    .replace(/\([^)]*\)/g, ' ') // strip parenthetical qualifiers entirely — "(Guild Hotel)", "(La Jolla)", "(\"The Joan\")", "(redundant?)"
    .replace(/[“”"']/g, '')
  const normalized = normalizeText(withoutQualifiers)
  const words = normalized.split(' ').filter((w) => w && !VENUE_NAME_STOPWORDS.has(w))
  while (words.length > 1 && VENUE_NAME_TRAILING_NOISE.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

/**
 * Words too generic to count as venue-IDENTITY evidence for the
 * similarity fallback specifically (never used for the exact-match tier,
 * where they're harmless). Found necessary after a real false-positive:
 * "San Diego Padres" was grouped with "San Diego Zoo", "SeaWorld San
 * Diego", "San Diego Zoo Safari Park", and a skate event — all that's
 * actually shared is the city name itself, present in nearly every venue
 * in a single-metro catalog by construction, so it carries zero
 * distinguishing signal. Same story for "Timken Museum of Art" vs. the
 * completely unrelated "Oceanside Museum of Art" — "museum"/"art" are
 * category-descriptive, not venue-identifying.
 */
const VENUE_NAME_GENERIC_WORDS = new Set(['san', 'diego', 'tijuana', 'mexico', 'california', 'baja', 'museum', 'art', 'center', 'centre', 'gallery', 'park', 'plaza', 'hotel', 'historic', 'district'])

function venueNameSignificantWords(rawName: string): Set<string> {
  return new Set(
    normalizeVenueNameForSemanticMatch(rawName)
      .split(' ')
      .filter((w) => w.length > 2 && !VENUE_NAME_GENERIC_WORDS.has(w))
  )
}

export interface SemanticDuplicateGroup {
  normalizedName: string
  members: ItemIntakeRecord[]
  /** 'exact' = identical after stripping qualifiers/noise words (high confidence); 'similar' = high name-token overlap, not identical (flagged for review, still excluded — see module doc). */
  matchKind: 'exact' | 'similar'
}

const SEMANTIC_NAME_SIMILARITY_THRESHOLD = 0.5

/**
 * Finds groups of records that are almost certainly the same real venue
 * despite carrying different literal names. Deliberately conservative on
 * the 'similar' (non-exact) tier — the threshold and the trailing-noise-
 * word list were tuned against this real dataset's actual false-positive
 * risk (e.g. "La Jolla Cove" vs "La Jolla Village" would NOT trigger this,
 * since neither is a trailing-noise-stripped near-match of the other and
 * their shared token "la jolla" alone sits below the threshold once
 * combined with each name's other distinct words).
 */
export function findSemanticDuplicates(records: readonly ItemIntakeRecord[]): SemanticDuplicateGroup[] {
  const exactGroups = new Map<string, ItemIntakeRecord[]>()
  for (const r of records) {
    const key = normalizeVenueNameForSemanticMatch(r.candidateName)
    exactGroups.set(key, [...(exactGroups.get(key) ?? []), r])
  }

  const groups: SemanticDuplicateGroup[] = []
  const consumed = new Set<string>() // candidateName, already placed in an exact group

  for (const [key, members] of exactGroups) {
    if (members.length > 1) {
      groups.push({ normalizedName: key, members, matchKind: 'exact' })
      for (const m of members) consumed.add(m.candidateName)
    }
  }

  const remaining = records.filter((r) => !consumed.has(r.candidateName))
  const seen = new Set<string>()
  for (let i = 0; i < remaining.length; i++) {
    if (seen.has(remaining[i].candidateName)) continue
    const wordsA = venueNameSignificantWords(remaining[i].candidateName)
    const similar: ItemIntakeRecord[] = [remaining[i]]
    for (let j = i + 1; j < remaining.length; j++) {
      if (seen.has(remaining[j].candidateName)) continue
      const wordsB = venueNameSignificantWords(remaining[j].candidateName)
      if (wordsA.size === 0 || wordsB.size === 0) continue
      let intersection = 0
      for (const w of wordsA) if (wordsB.has(w)) intersection += 1
      const union = wordsA.size + wordsB.size - intersection
      const similarity = union === 0 ? 0 : intersection / union
      if (similarity >= SEMANTIC_NAME_SIMILARITY_THRESHOLD) similar.push(remaining[j])
    }
    if (similar.length > 1) {
      for (const m of similar) seen.add(m.candidateName)
      groups.push({ normalizedName: normalizeVenueNameForSemanticMatch(remaining[i].candidateName), members: similar, matchKind: 'similar' })
    }
  }

  return groups
}

/** Applies findSemanticDuplicates and keeps only the most-complete representative from each group (same completeness scoring as dedupeCandidates) — a deterministic way to actually resolve what the audit found, not just report it. */
export function dedupeSemanticDuplicates<T extends ItemIntakeRecord>(records: readonly T[]): { deduped: T[]; removed: Array<{ kept: T; discarded: T[] }> } {
  const groups = findSemanticDuplicates(records)
  const toRemove = new Set<string>()
  const removed: Array<{ kept: T; discarded: T[] }> = []
  for (const group of groups) {
    const members = group.members as T[]
    const best = members.reduce((a, b) => (candidateCompletenessScoreForIntakeRecord(b) > candidateCompletenessScoreForIntakeRecord(a) ? b : a))
    for (const m of members) if (m !== best) toRemove.add(m.candidateName)
    removed.push({ kept: best, discarded: members.filter((m) => m !== best) })
  }
  return { deduped: records.filter((r) => !toRemove.has(r.candidateName)) as T[], removed }
}

function candidateCompletenessScoreForIntakeRecord(r: ItemIntakeRecord): number {
  let score = r.body.length
  if (r.provenance.verificationConfidence === 'HIGH') score += 1000
  else if (r.provenance.verificationConfidence === 'MEDIUM') score += 500
  score += r.provenance.sourceUrls.length * 10
  return score
}

// ---------------------------------------------------------------------------
// Real M7+ launch gates — replace the metro_launch driver's synthetic
// CATALOG_GATE/LOCATION_GATE/PRESENTATION_GATE/OUTREACH_GATE placeholders
// once a real staged catalog exists. Pure functions, same discipline as
// metroLaunch.ts's evaluateMetroGates.
// ---------------------------------------------------------------------------

export type StagingGateVerdict = 'PASS' | 'FAIL'

export interface StagingGateResult {
  key: string
  verdict: StagingGateVerdict
  reason: string
}

export interface CatalogGateEvidence {
  expectedCanonicalCount: number
  stagedRecords: readonly ItemIntakeRecord[]
  intakeFailures: readonly IntakeFailure[]
  duplicates: DedupCheckResult
}

/**
 * What this gate actually verifies: the STAGED set's own internal
 * integrity — every candidate is accounted for (none silently dropped),
 * and nothing in the staged set duplicates production or itself. It
 * deliberately does NOT fail just because some candidates were excluded
 * during intake (unmapped category, unresolvable neighborhood, semantic
 * duplicate, bad presentation text) — those are the pipeline correctly
 * doing its job ("fail rather than guess"), not evidence the CATALOG
 * itself is broken. "All required category mappings present" is true by
 * construction: every ItemIntakeRecord in stagedRecords already carries
 * a real, non-null RealDbCategory — there is no code path that puts an
 * unmapped record into this array. (Design fix, San Diego catalog SQL
 * review, 2026-09-06: an earlier version treated ANY category-mapping
 * exclusion as a gate failure, which meant this gate could never pass
 * on a real run — 17-19 candidates always fail intake for genuinely
 * vague upstream text, and that's expected, not a defect.)
 */
export function evaluateCatalogGate(evidence: CatalogGateEvidence): StagingGateResult {
  const reasons: string[] = []
  if (evidence.stagedRecords.length + evidence.intakeFailures.length !== evidence.expectedCanonicalCount) {
    reasons.push(`staged(${evidence.stagedRecords.length}) + failed(${evidence.intakeFailures.length}) != expected canonical count(${evidence.expectedCanonicalCount}) — a candidate was silently dropped somewhere`)
  }
  if (evidence.duplicates.collidesWithProduction.length > 0) {
    reasons.push(`${evidence.duplicates.collidesWithProduction.length} candidate(s) duplicate an existing production item`)
  }
  if (evidence.duplicates.collidesWithinBatch.length > 0) {
    reasons.push(`${evidence.duplicates.collidesWithinBatch.length} group(s) of candidates duplicate each other within this batch`)
  }
  const excludedCount = evidence.intakeFailures.length
  return {
    key: 'CATALOG_GATE',
    verdict: reasons.length === 0 ? 'PASS' : 'FAIL',
    reason:
      reasons.length === 0
        ? `${evidence.stagedRecords.length}/${evidence.expectedCanonicalCount} canonical items staged cleanly, zero duplicates${excludedCount > 0 ? ` (${excludedCount} legitimately excluded during intake — see failures list, not a gate violation)` : ''}.`
        : reasons.join('; '),
  }
}

export interface LocationGateEvidence {
  records: readonly ItemIntakeRecord[]
}

/**
 * "Valid location strategy" per explicit product policy means a real,
 * specific maps_query string exists for the later geocoding pass — NOT
 * that lat/lng are already populated (production convention: coordinates
 * are always a separate, later, human-reviewed pass; see module doc).
 * A generic/placeholder-looking query (just a neighborhood name with no
 * venue name) fails, since it gives the geocoder nothing specific to find.
 */
export function evaluateLocationGate(evidence: LocationGateEvidence): StagingGateResult {
  const invalid = evidence.records.filter((r) => !r.mapsQuery || r.mapsQuery.trim().length < 4 || r.mapsQuery.trim() === r.neighborhoodName?.trim())
  return {
    key: 'LOCATION_GATE',
    verdict: invalid.length === 0 ? 'PASS' : 'FAIL',
    reason: invalid.length === 0 ? `All ${evidence.records.length} items have a specific maps_query ready for the geocoding pass.` : `${invalid.length} item(s) lack a specific enough maps_query for geocoding: ${invalid.map((r) => r.candidateName).join(', ')}`,
  }
}

export interface PresentationGateEvidence {
  records: readonly ItemIntakeRecord[]
}

const PLACEHOLDER_PATTERNS = [/\btbd\b/i, /\blorem ipsum\b/i, /\bplaceholder\b/i, /\bfixme\b/i, /\btodo\b/i, /^checkoffized:?\s*$/i]
/**
 * A process artifact, not real editorial copy — found in the San Diego
 * catalog SQL review (2026-09-06): "Fleurette (redundant?)" carried the
 * body "Fleurette has already been counted and does not require a new
 * checkoff item." — the M6/verification stage's own internal reasoning
 * leaked into what should have been user-facing copy. This is a content
 * check distinct from (and a safety net alongside) findSemanticDuplicates
 * below, which independently catches the name-level duplicate itself.
 */
const META_PROCESS_LANGUAGE_PATTERNS = [/already been counted/i, /\bredundant\b/i, /does not require a new checkoff/i, /no new checkoff item/i, /duplicate of (an?|the) existing/i]
/** A run of 3+ consecutive U+FFFD (replacement character) or literal "�" is the reliable signature of a real mojibake/encoding failure — a single accented character is normal, correct Unicode and must never be flagged. */
const MOJIBAKE_PATTERN = /�{3,}/

function hasBrokenCapitalization(text: string): boolean {
  // ALL-CAPS (excluding short acronyms) or a sentence with no capital letter at all.
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 12 && letters === letters.toUpperCase()) return true
  if (letters.length > 0 && letters === letters.toLowerCase()) return true
  return false
}

export function evaluatePresentationGate(evidence: PresentationGateEvidence): StagingGateResult {
  const problems: string[] = []
  for (const r of evidence.records) {
    const text = r.body
    if (!text || text.trim().length < 10) problems.push(`${r.candidateName}: body text missing or too short`)
    else if (PLACEHOLDER_PATTERNS.some((p) => p.test(text))) problems.push(`${r.candidateName}: placeholder text detected`)
    else if (META_PROCESS_LANGUAGE_PATTERNS.some((p) => p.test(text))) problems.push(`${r.candidateName}: meta/process language leaked into body text ("${text}")`)
    else if (MOJIBAKE_PATTERN.test(text)) problems.push(`${r.candidateName}: broken/mojibake encoding detected`)
    else if (hasBrokenCapitalization(text)) problems.push(`${r.candidateName}: malformed capitalization (all-caps or no capitals)`)
  }
  // Duplicate DISPLAY text (not name) across different candidates is a real presentation problem — two different venues should never show the identical sentence.
  const byBody = new Map<string, string[]>()
  for (const r of evidence.records) {
    const key = r.body.trim().toLowerCase()
    byBody.set(key, [...(byBody.get(key) ?? []), r.candidateName])
  }
  for (const [, names] of byBody) {
    if (names.length > 1) problems.push(`identical display text reused across distinct candidates: ${names.join(', ')}`)
  }
  return {
    key: 'PRESENTATION_GATE',
    verdict: problems.length === 0 ? 'PASS' : 'FAIL',
    reason: problems.length === 0 ? `All ${evidence.records.length} items have clean, non-placeholder, correctly-encoded display text.` : problems.join('; '),
  }
}

export interface OutreachGateEvidence {
  records: readonly ItemIntakeRecord[]
}

/**
 * Soft-launch policy: outreach is NOT required before launch. This gate
 * only verifies the system COULD later derive a business-outreach queue
 * safely from this catalog (every item resolves to an identifiable real
 * venue name) — never that outreach happened or is required to.
 */
export function evaluateOutreachGate(evidence: OutreachGateEvidence): StagingGateResult {
  const unidentifiable = evidence.records.filter((r) => !r.candidateName || r.candidateName.trim().length < 2)
  return {
    key: 'OUTREACH_GATE',
    verdict: unidentifiable.length === 0 ? 'PASS' : 'FAIL',
    reason: unidentifiable.length === 0 ? `All ${evidence.records.length} items resolve to an identifiable venue — a future outreach pass could safely derive a business queue. No outreach required or performed for this soft launch.` : `${unidentifiable.length} item(s) have no identifiable venue name for future outreach.`,
  }
}

// ---------------------------------------------------------------------------
// The single, consolidated intake pipeline (San Diego catalog SQL review,
// 2026-09-06). Both the dry-run report and the SQL generator call THIS
// function and nothing else — a prior version had each script re-derive
// its own version of "clean records," and they drifted (the dry run's
// gates were evaluated against an upstream set, not the exact rows the
// SQL generator actually emitted). One function, one final record set,
// gates evaluated against exactly what would be inserted.
// ---------------------------------------------------------------------------

export interface IntakePipelineInput {
  candidates: readonly MetroCatalogCandidate[]
  existingProductionMapsQueries: readonly string[]
  canonicalNeighborhoods: readonly string[]
  neighborhoodAliases?: Readonly<Record<string, string>>
  mexicoNeighborhoods?: ReadonlySet<string>
}

export interface IntakePipelineResult {
  /** The exact, final record set — this and only this should ever be turned into INSERT statements. */
  finalRecords: ItemIntakeRecord[]
  failures: IntakeFailure[]
  semanticDuplicatesRemoved: Array<{ kept: ItemIntakeRecord; discarded: ItemIntakeRecord[] }>
  gates: StagingGateResult[]
}

export function runIntakePipeline(input: IntakePipelineInput): IntakePipelineResult {
  const { records, failures: mappingFailures } = mapCandidatesToIntakeRecords(input.candidates)
  const duplicates = checkForDuplicates(records, input.existingProductionMapsQueries)

  const { resolved, unresolved } = resolveNeighborhoods(duplicates.clean, input.canonicalNeighborhoods, input.neighborhoodAliases ?? {}, input.mexicoNeighborhoods ?? new Set())
  const geographicallyResolved = duplicates.clean
    .filter((r) => resolved.has(r.candidateName))
    .map((r) => ({ ...r, neighborhoodName: resolved.get(r.candidateName)! }))

  const { deduped: semanticallyClean, removed: semanticDuplicatesRemoved } = dedupeSemanticDuplicates(geographicallyResolved)

  const presentationProblems: IntakeFailure[] = []
  const presentationClean = semanticallyClean.filter((r) => {
    const text = r.body
    const isBad = !text || text.trim().length < 10 || PLACEHOLDER_PATTERNS.some((p) => p.test(text)) || META_PROCESS_LANGUAGE_PATTERNS.some((p) => p.test(text)) || MOJIBAKE_PATTERN.test(text)
    if (isBad) presentationProblems.push({ candidateName: r.candidateName, reason: `rejected by presentation content check: "${text}"` })
    return !isBad
  })

  const neighborhoodFailures: IntakeFailure[] = unresolved.map((u) => ({ candidateName: u.candidateName, reason: `neighborhood: ${u.reason}` }))
  const semanticDupFailures: IntakeFailure[] = semanticDuplicatesRemoved.flatMap((g) => g.discarded.map((d) => ({ candidateName: d.candidateName, reason: `semantic duplicate of "${g.kept.candidateName}" (${g.kept.candidateName === d.candidateName ? 'exact' : 'name'} match) — kept the more complete record` })))
  const allFailures = [...mappingFailures, ...neighborhoodFailures, ...semanticDupFailures, ...presentationProblems]

  const catalogGate = evaluateCatalogGate({ expectedCanonicalCount: input.candidates.length, stagedRecords: presentationClean, intakeFailures: allFailures, duplicates })
  const locationGate = evaluateLocationGate({ records: presentationClean })
  const presentationGate = evaluatePresentationGate({ records: presentationClean })
  const outreachGate = evaluateOutreachGate({ records: presentationClean })

  return {
    finalRecords: presentationClean,
    failures: allFailures,
    semanticDuplicatesRemoved,
    gates: [catalogGate, locationGate, presentationGate, outreachGate],
  }
}
