// agent-service/playbooks/metroGeoEnrichment.ts
//
// Chief Phase 2X — real Google Places match classification, extracted
// and generalized from the one-off San Diego dry-run script
// (scripts/generate-san-diego-places-dry-run.ts, 2026-09-06) into a
// permanent, reusable Winston metro-launch module. Pure logic only —
// this file makes zero network/DB calls; it takes an already-fetched
// Places result and decides what to do with it. The real HTTP call and
// the cache live in agent-service/specialists/metroGeoEnrichmentDriver.ts
// (this repo's standing I/O-vs-logic split).
//
// Six classification tiers (Jerry, 2026-09-07 pre-Vienna closure spec):
//   exact / high-confidence parent / ambiguous / rejected wrong match /
//   no canonical venue / unresolved.
// A candidate is NEVER forced into exact/high-confidence just to raise
// coverage — see classifyPlacesMatch's own doc.

import type { StagingGateResult } from './metroCatalog'

// ---------------------------------------------------------------------------
// Name similarity — Levenshtein-based, with a substring-containment
// boost (Places' own suffixing/branding conventions constantly produce
// "Zuma" -> "Zuma San Diego"-shaped near-matches that plain edit
// distance over max length punishes just for length difference).
// ---------------------------------------------------------------------------

function normalizeVenueName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalizeVenueName(a)
  const nb = normalizeVenueName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = Math.min(na.length, nb.length)
    const longer = Math.max(na.length, nb.length)
    return 0.75 + 0.25 * (shorter / longer)
  }
  const dist = levenshtein(na, nb)
  return 1 - dist / Math.max(na.length, nb.length)
}

// ---------------------------------------------------------------------------
// Structural risk flags — computed from the candidate's own name/body,
// BEFORE any Places result is consulted.
// ---------------------------------------------------------------------------

export interface GeoRiskFlags {
  variousOperators: boolean
  multiLocationChain: boolean
  parentSubVenue: boolean
  recurringEvent: boolean
  areaOrDistrict: boolean
}

export function computeGeoRiskFlags(candidateName: string, body: string): GeoRiskFlags {
  const nameLower = candidateName.toLowerCase()
  const bodyLower = body.toLowerCase()
  return {
    variousOperators: /\(various operators\)/i.test(candidateName),
    multiLocationChain: /\b(third|second|fourth|multiple) location/i.test(candidateName) || /\blocations?\b/i.test(candidateName),
    parentSubVenue: /\bat\b .+ (hotel|building|park|golf course|marina|resort)/i.test(bodyLower) || /\binside\b/i.test(bodyLower),
    recurringEvent: /\b(festival|parade|regatta|tournament|contest|classic|marathon|skate event)\b/i.test(nameLower) || /\b(festival|parade|regatta|tournament)\b/i.test(bodyLower),
    areaOrDistrict: /\b(park|district|quarter|market|zona)\b/i.test(nameLower) && !/restaurant|café|cafe/i.test(nameLower),
  }
}

// ---------------------------------------------------------------------------
// Match classification — the six tiers.
// ---------------------------------------------------------------------------

export type PlacesMatchClassification = 'EXACT' | 'HIGH_CONFIDENCE_PARENT_VENUE' | 'AMBIGUOUS_NEEDS_REVIEW' | 'REJECTED_WRONG_MATCH' | 'NO_CANONICAL_VENUE' | 'UNRESOLVED'

/** Tiers that count as "confidently enriched" for GEO_ENRICHMENT_GATE. */
export const CONFIDENT_TIERS: readonly PlacesMatchClassification[] = ['EXACT', 'HIGH_CONFIDENCE_PARENT_VENUE']
/** NO_CANONICAL_VENUE is the explicit, intentional "this candidate structurally has no single venue to geocode" exception (events, routes, districts, multi-operator experiences) — it counts as an ACCEPTABLE exception for the gate, never a failure, but is never silently treated the same as a confident match either. */
export const ACCEPTABLE_EXCEPTION_TIERS: readonly PlacesMatchClassification[] = ['NO_CANONICAL_VENUE']

export interface PlacesResultLike {
  placeId: string | null
  name: string
  formattedAddress: string | null
  lat: number | null
  lng: number | null
  websiteUri: string | null
  /** ISO 3166-1 alpha-2 country code Places returned for this result, if parseable. */
  country: string | null
  /** Half the haversine diagonal of the result's viewport, in meters — used only for area/chain candidates' geo_radius_m proposal. */
  viewportRadiusM: number | null
}

export interface ClassifyMatchInput {
  candidateName: string
  body: string
  expectedCountry: string
  /** Places' top result for this query, or null when Places returned zero results / the call failed. */
  topResult: PlacesResultLike | null
  /** Present only when the Places call itself failed (network/API error) — distinguished from a genuine zero-result response for reporting, though both classify UNRESOLVED. */
  apiError?: string | null
}

export interface ClassifyMatchResult {
  classification: PlacesMatchClassification
  reason: string
  riskFlags: GeoRiskFlags
  nameSimilarity: number | null
  countryMatch: boolean | null
  /** Only proposed for area/chain candidates where Places' viewport data justifies a specific value beyond the app's existing default radius — never fabricated for a normal single-venue match. */
  proposedGeoRadiusM: number | null
}

/**
 * The core classification decision. NEVER forces a low-confidence match
 * into EXACT/HIGH_CONFIDENCE_PARENT_VENUE just to raise coverage
 * numbers — an unconvincing match stays AMBIGUOUS_NEEDS_REVIEW or
 * REJECTED_WRONG_MATCH, a genuine structural non-venue stays
 * NO_CANONICAL_VENUE, and a failed/empty lookup stays UNRESOLVED.
 */
export function classifyPlacesMatch(input: ClassifyMatchInput): ClassifyMatchResult {
  const riskFlags = computeGeoRiskFlags(input.candidateName, input.body)

  if (input.apiError || !input.topResult) {
    return {
      classification: 'UNRESOLVED',
      reason: input.apiError ? `Places API error: ${input.apiError}` : 'Places returned zero results for this query.',
      riskFlags,
      nameSimilarity: null,
      countryMatch: null,
      proposedGeoRadiusM: null,
    }
  }

  const top = input.topResult
  const nameSim = nameSimilarity(input.candidateName, top.name)
  const countryMatch = top.country ? top.country === input.expectedCountry : null
  const proposedGeoRadiusM = (riskFlags.areaOrDistrict || riskFlags.multiLocationChain) ? top.viewportRadiusM : null

  // Structural "no single venue" cases — never a wrong-match rejection,
  // never forced into a confident tier either. Preserved as an explicit,
  // intentional exception record (events, routes, districts, multi-operator).
  if (riskFlags.variousOperators) {
    return { classification: 'NO_CANONICAL_VENUE', reason: '"(various operators)" experience — no single canonical business to resolve to; any Places result is at best a general-area proxy, never accepted as the definitive venue.', riskFlags, nameSimilarity: nameSim, countryMatch, proposedGeoRadiusM: null }
  }
  if (riskFlags.recurringEvent) {
    return { classification: 'NO_CANONICAL_VENUE', reason: 'Recurring/scheduled event, not a fixed standing venue — the host location is not the same thing as a resolvable, permanent venue for this item.', riskFlags, nameSimilarity: nameSim, countryMatch, proposedGeoRadiusM: null }
  }

  if (countryMatch === false) {
    return { classification: 'REJECTED_WRONG_MATCH', reason: `Country mismatch: expected ${input.expectedCountry}, Places returned ${top.country} — a definite wrong match, never accepted regardless of name similarity.`, riskFlags, nameSimilarity: nameSim, countryMatch, proposedGeoRadiusM }
  }
  if (countryMatch === null) {
    return { classification: 'AMBIGUOUS_NEEDS_REVIEW', reason: 'Places result had no parseable country component — cannot verify correctness, needs human review.', riskFlags, nameSimilarity: nameSim, countryMatch, proposedGeoRadiusM }
  }
  if (nameSim >= 0.75) {
    return { classification: 'EXACT', reason: `Name similarity ${nameSim.toFixed(2)} and country confirmed (${top.country}).`, riskFlags, nameSimilarity: nameSim, countryMatch, proposedGeoRadiusM }
  }
  if ((riskFlags.parentSubVenue || riskFlags.areaOrDistrict || riskFlags.multiLocationChain) && nameSim >= 0.35) {
    return {
      classification: 'HIGH_CONFIDENCE_PARENT_VENUE',
      reason: `Name similarity only ${nameSim.toFixed(2)} but candidate is a sub-experience/area/chain (${Object.entries(riskFlags).filter(([, v]) => v).map(([k]) => k).join(', ')}) and country confirmed (${top.country}) — Places likely resolved the parent venue/area correctly, not a wrong match.`,
      riskFlags,
      nameSimilarity: nameSim,
      countryMatch,
      proposedGeoRadiusM,
    }
  }
  if (nameSim < 0.2) {
    return { classification: 'REJECTED_WRONG_MATCH', reason: `Name similarity ${nameSim.toFixed(2)} is too low to plausibly be the same venue, with no structural explanation for the gap — a definite wrong match.`, riskFlags, nameSimilarity: nameSim, countryMatch, proposedGeoRadiusM: null }
  }
  return { classification: 'AMBIGUOUS_NEEDS_REVIEW', reason: `Name similarity only ${nameSim.toFixed(2)} with no structural explanation for the gap — needs a human to confirm this is really the same venue before accepting.`, riskFlags, nameSimilarity: nameSim, countryMatch, proposedGeoRadiusM }
}

// ---------------------------------------------------------------------------
// The certification gate. Replaces the placeholder boolean-flag
// evaluateGeoEnrichmentGate(hasRunGooglePlacesPass, evidence) in
// metroMetadataEnrichment.ts (kept there, unchanged, for any caller
// still using the old placeholder shape) with a REAL per-item gate now
// that classification actually exists.
// ---------------------------------------------------------------------------

export interface GeoEnrichmentItemResult {
  candidateName: string
  classification: PlacesMatchClassification
  reason: string
}

export function evaluateGeoEnrichmentCertificationGate(results: readonly GeoEnrichmentItemResult[]): StagingGateResult {
  if (results.length === 0) {
    return { key: 'GEO_ENRICHMENT_GATE', verdict: 'FAIL', reason: 'No items were evaluated — this gate cannot pass on an empty catalog.' }
  }
  const unacceptable = results.filter((r) => !CONFIDENT_TIERS.includes(r.classification) && !ACCEPTABLE_EXCEPTION_TIERS.includes(r.classification))
  if (unacceptable.length > 0) {
    return {
      key: 'GEO_ENRICHMENT_GATE',
      verdict: 'FAIL',
      reason: `${unacceptable.length}/${results.length} item(s) are not confidently enriched or an accepted exception: ${unacceptable.map((r) => `${r.candidateName} (${r.classification}: ${r.reason})`).join(' | ')}`,
    }
  }
  const confident = results.filter((r) => CONFIDENT_TIERS.includes(r.classification)).length
  const exceptions = results.filter((r) => ACCEPTABLE_EXCEPTION_TIERS.includes(r.classification)).length
  return {
    key: 'GEO_ENRICHMENT_GATE',
    verdict: 'PASS',
    reason: `${confident}/${results.length} item(s) confidently enriched (EXACT/HIGH_CONFIDENCE_PARENT_VENUE), ${exceptions} explicit NO_CANONICAL_VENUE exception(s) — zero AMBIGUOUS/REJECTED/UNRESOLVED items remain.`,
  }
}
