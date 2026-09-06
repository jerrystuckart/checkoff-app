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
  const unmappedCategoryFailures = evidence.intakeFailures.filter((f) => f.reason.includes('category'))
  if (unmappedCategoryFailures.length > 0) {
    reasons.push(`${unmappedCategoryFailures.length} candidate(s) failed on category mapping — not inserted, not silently recategorized`)
  }
  return { key: 'CATALOG_GATE', verdict: reasons.length === 0 ? 'PASS' : 'FAIL', reason: reasons.length === 0 ? `${evidence.stagedRecords.length}/${evidence.expectedCanonicalCount} canonical items staged cleanly, zero duplicates.` : reasons.join('; ') }
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
