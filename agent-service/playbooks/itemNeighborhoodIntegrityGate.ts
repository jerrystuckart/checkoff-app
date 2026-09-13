// agent-service/playbooks/itemNeighborhoodIntegrityGate.ts
//
// Chief Phase 2AO (2026-09-13, Munich neighborhood-integrity postmortem) —
// direct response to a real incident: Munich's `finalReadyToApplyAudit`
// reported READY_TO_APPLY and `metroLaunchCertification` reported
// READY_TO_ACTIVATE with 75 certified items, while the generated SQL patch
// only created 8 canonical neighborhood rows and the 75 items' own
// `neighborhood_id` lookups referenced 39 distinct strings — mostly raw
// M3/M5 discovery-stage descriptive labels (`Maximiliansplatz / near
// English Garden`, `Inner City`, `Old Town (Altstadt)`, `Hackenstraße,
// near Hofstatt`, `near city center Munich`, `various`, duplicate Unicode
// hyphen variants of `Au-Haidhausen`, etc.) that were never mapped to
// production canonical neighborhoods. Every existing gate
// (NEIGHBORHOOD_COMPLETENESS_GATE included) checks the CANONICAL list's
// own completeness (is every canonical neighborhood covered / reported)
// but never the reverse direction: does every ITEM's neighborhood
// reference actually resolve to a real member of that canonical list?
// That reverse check — and geographic consistency between an item's own
// verified coordinates and the metro it is being packaged into — is what
// was missing. This module is that missing check, generalized so it
// applies to every future metro, not just Munich.
//
// Same incident also surfaced a second, independent defect: the package
// contained a `Frauenkirche` item whose verified Google Places data
// (`Neumarkt, 01067 Dresden, Germany`, lat 51.05/lng 13.74) was Dresden's
// Frauenkirche, not Munich's (Frauenplatz 1, 80331 München) — roughly
// 300km away. No existing gate cross-checks an item's own verified
// coordinates against the metro's real geography once the item is past
// OUT_OF_MARKET_CONTAMINATION_GATE's string-anchor/state-code heuristics
// (which only catch known OTHER-metro place-name mentions or a US state
// mismatch — neither applies to a same-country, same-language address
// like this one). ITEM_GEO_METRO_CONSISTENCY_GATE below closes that gap
// with a real distance-from-center check.
//
// Pure logic only — no DB access, no AI calls, no network calls. Both
// gates adapt to the shared StagingGateResult shape (metroCatalog.ts) so
// they plug directly into the same gates[] array every other M8/M10 gate
// uses, and are wired as REQUIRED in metroLaunchCertification.ts and
// finalReadyToApplyAudit.ts — never checked ad hoc per-metro again.

import type { StagingGateResult } from './metroCatalog'

// ---------------------------------------------------------------------------
// ITEM_NEIGHBORHOOD_REFERENTIAL_INTEGRITY_GATE
// ---------------------------------------------------------------------------

/** One retained item's neighborhood reference, as it will actually be written into the generated SQL package. */
export interface ItemNeighborhoodReference {
  /** Item/venue name, for reporting only. */
  itemName: string
  /** The exact neighborhood name string this item's SQL will look up (`WHERE ... name = '<neighborhoodName>'`). */
  neighborhoodName: string
}

export interface NeighborhoodReferentialIntegrityResult extends StagingGateResult {
  key: 'ITEM_NEIGHBORHOOD_REFERENTIAL_INTEGRITY_GATE'
  /** Item neighborhood references that do not exactly match (after Unicode normalization) any frozen canonical neighborhood. */
  unresolvedReferences: Array<{ itemName: string; neighborhoodName: string; reason: string }>
}

/**
 * Unicode-normalizes a neighborhood name for identity comparison: NFC
 * normalization plus collapsing every visually-identical hyphen/dash
 * variant (regular hyphen, non-breaking hyphen U+2011, figure dash,
 * en dash, em dash, Hebrew/other lookalike hyphens) to a single plain
 * ASCII hyphen. This is the exact defect class that let
 * `Au-Haidhausen` (U+002D) and `Au‑Haidhausen` (U+2011) exist as two
 * silently-different neighborhood identities in the Munich SQL. Also
 * trims and collapses internal whitespace, since a stray extra space
 * is the same class of "looks identical, isn't" defect.
 */
export function normalizeNeighborhoodName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Heuristic class-detector for a descriptive/free-text label masquerading
 * as a production neighborhood name — deliberately a PATTERN check, not a
 * hardcoded blocklist of the specific strings this incident happened to
 * produce (those exact strings will never recur verbatim; the next
 * metro's stray labels will look different but share the same shape).
 * Flags a name as suspect when it:
 *   - contains a preposition/relative-location word ("near", "adjacent",
 *     "close to", "outside", "north/south/east/west of") — a real
 *     neighborhood name never describes its position relative to
 *     something else;
 *   - contains "area", "region", "vicinity", "various", "unknown",
 *     "center"/"centre" used generically (not as part of a real proper
 *     noun a caller explicitly allowlists via `allowGenericCenter`);
 *   - contains a street/road/bridge/landmark-type common noun combined
 *     with a comma or "at"/"near" clause (e.g. "Hackenstraße, near
 *     Hofstatt", "Sendlinger railway bridge", "former substation");
 *   - is a full sentence/clause shape: contains a comma-separated
 *     qualifier, a parenthetical starting with "near"/"former"/"adjacent",
 *     or is implausibly long for a proper noun (very long AND contains a
 *     preposition).
 * A real combined district name ("Ludwigsvorstadt-Isarvorstadt",
 * "Au-Haidhausen", "Sendling-Westpark") never trips this — those are
 * two proper nouns joined by a hyphen/slash, with no preposition, no
 * "near"/"former"/generic-area word, and no comma clause.
 */
export function looksLikeDescriptiveLabel(name: string): { suspect: boolean; reason?: string } {
  const n = normalizeNeighborhoodName(name)
  const lower = n.toLowerCase()

  const relativeLocationWords = ['near ', ' near', 'adjacent', 'close to', 'outside ', 'north of', 'south of', 'east of', 'west of', 'vicinity']
  for (const w of relativeLocationWords) {
    if (lower.includes(w)) return { suspect: true, reason: `contains relative-location phrase "${w.trim()}" — a real neighborhood name never describes its position relative to something else` }
  }

  const genericAreaWords = [' area', 'region', 'various', 'unknown', 'city center', 'city centre', 'inner city', 'downtown area', 'old town']
  for (const w of genericAreaWords) {
    if (lower.includes(w)) return { suspect: true, reason: `contains generic placeholder phrase "${w.trim()}" instead of a real, specific neighborhood/district proper noun` }
  }

  if (lower === 'various' || lower === 'unknown' || lower === 'n/a' || lower === 'tbd') {
    return { suspect: true, reason: 'is a placeholder token, not a real neighborhood name' }
  }

  // Parenthetical qualifier that itself reads as an explanation rather than
  // an alternate proper name, e.g. "(former substation)", "(near Kunstareal)".
  const parenMatch = n.match(/\(([^)]*)\)/)
  if (parenMatch) {
    const inner = parenMatch[1].toLowerCase()
    if (/^(near|former|adjacent|next to|by the|behind|across from)\b/.test(inner)) {
      return { suspect: true, reason: `parenthetical qualifier "(${parenMatch[1]})" is an explanatory phrase, not an alternate proper name` }
    }
  }

  // A bare street/road/bridge/landmark-type noun with no district name at
  // all (e.g. "Sendlinger railway bridge", "Ringeisenstraße" alone used as
  // if it were a neighborhood, "Hackenstraße, near Hofstatt").
  if (/,/.test(n)) {
    return { suspect: true, reason: 'contains a comma-separated qualifier clause — a real neighborhood name is a single proper noun (or hyphen/slash-joined pair of them), never a clause' }
  }
  if (/\b(bridge|railway|substation)\b/i.test(n)) {
    return { suspect: true, reason: 'reads as a landmark/infrastructure description, not a neighborhood proper noun' }
  }

  // Implausibly long AND contains a preposition-shaped word elsewhere not
  // already caught above (belt-and-suspenders for sentence-shaped labels).
  if (n.length > 40 && /\b(to|the|of|in)\b/i.test(n)) {
    return { suspect: true, reason: 'reads as a descriptive sentence/clause rather than a proper noun (too long, contains sentence-structure words)' }
  }

  return { suspect: false }
}

/**
 * Every retained item's neighborhood reference must exactly equal (after
 * Unicode normalization) one member of `canonicalNeighborhoods` — the one
 * frozen, approved list for this metro. This is the REVERSE direction of
 * NEIGHBORHOOD_COMPLETENESS_GATE (which only checks the canonical list's
 * own coverage): here, every ITEM reference must resolve, and any name
 * that resolves to nothing in the canonical set is reported, whether or
 * not it also looks like a descriptive label (a typo'd real name and a
 * fabricated descriptive label are both real referential-integrity
 * failures, just with different root causes — both are named in the
 * result, only the former gets the "descriptive label" reason text).
 *
 * `canonicalNeighborhoods === null` (no frozen model supplied at all) is a
 * hard FAIL, matching NEIGHBORHOOD_COMPLETENESS_GATE's own fail-closed
 * precondition — never silently treated as "nothing to check against."
 */
export function evaluateItemNeighborhoodReferentialIntegrityGate(canonicalNeighborhoods: readonly string[] | null, items: readonly ItemNeighborhoodReference[]): NeighborhoodReferentialIntegrityResult {
  if (canonicalNeighborhoods === null) {
    return {
      key: 'ITEM_NEIGHBORHOOD_REFERENTIAL_INTEGRITY_GATE',
      verdict: 'FAIL',
      unresolvedReferences: [],
      reason: 'No explicit, frozen canonical neighborhood model was supplied — refusing to check item neighborhood references against nothing. Supply the real, approved neighborhood list before this metro can reach production-ready status.',
    }
  }

  const canonicalSet = new Set(canonicalNeighborhoods.map(normalizeNeighborhoodName))
  const unresolvedReferences: Array<{ itemName: string; neighborhoodName: string; reason: string }> = []

  for (const item of items) {
    const normalized = normalizeNeighborhoodName(item.neighborhoodName)
    if (canonicalSet.has(normalized)) continue

    const descriptiveCheck = looksLikeDescriptiveLabel(item.neighborhoodName)
    unresolvedReferences.push({
      itemName: item.itemName,
      neighborhoodName: item.neighborhoodName,
      reason: descriptiveCheck.suspect ? `does not match any frozen canonical neighborhood, and ${descriptiveCheck.reason} — looks like a stale discovery-stage descriptive label, not a production neighborhood name` : 'does not match any frozen canonical neighborhood (not a recognized typo/variant either — verify this is the intended assignment)',
    })
  }

  const verdict: 'PASS' | 'FAIL' = unresolvedReferences.length === 0 ? 'PASS' : 'FAIL'
  return {
    key: 'ITEM_NEIGHBORHOOD_REFERENTIAL_INTEGRITY_GATE',
    verdict,
    unresolvedReferences,
    reason:
      verdict === 'PASS'
        ? `All ${items.length} retained item(s) reference a frozen canonical neighborhood exactly (Unicode-normalized).`
        : `${unresolvedReferences.length}/${items.length} retained item(s) reference a neighborhood name that is not a member of the frozen canonical list: ${unresolvedReferences.map((u) => `${u.itemName} → "${u.neighborhoodName}" (${u.reason})`).join('; ')}`,
  }
}

// ---------------------------------------------------------------------------
// ITEM_GEO_METRO_CONSISTENCY_GATE
// ---------------------------------------------------------------------------

export interface ItemGeoRecord {
  itemName: string
  lat: number
  lng: number
  /** Optional, for reporting only. */
  formattedAddress?: string | null
}

export interface MetroGeoBoundary {
  /** The metro's approximate center, in decimal degrees. */
  centerLat: number
  centerLng: number
  /** Radius (km) beyond which an item is considered out-of-market, absent an explicit named exception. Should reflect the metro's real approved geography (city + reasonable nearby-destination margin), never an arbitrarily tight number that would flag legitimate outer neighborhoods. */
  maxRadiusKm: number
  /**
   * Explicit, named exceptions — mirrors metroLaunch.ts's
   * `approvedCategoryExceptions` precedent: the ONLY way an item outside
   * `maxRadiusKm` can still PASS is a real, named entry here (e.g. a
   * genuinely accepted nearby-destination boundary), never an implicit
   * pass. Matched by exact `itemName`.
   */
  approvedDistanceExceptions?: readonly { itemName: string; reason: string }[]
}

export interface GeoMetroConsistencyResult extends StagingGateResult {
  key: 'ITEM_GEO_METRO_CONSISTENCY_GATE'
  violations: Array<{ itemName: string; distanceKm: number; reason: string }>
}

/** Haversine great-circle distance in km between two lat/lng points. */
function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Every retained item's own VERIFIED coordinates (from Places geocoding,
 * never re-derived from free text) must lie within `boundary.maxRadiusKm`
 * of the metro's center, or carry an explicit, named
 * `approvedDistanceExceptions` entry. This is deliberately independent of
 * OUT_OF_MARKET_CONTAMINATION_GATE's string/anchor-name and US-state-code
 * heuristics (outOfMarketContamination.ts) — the real Munich incident (a
 * Dresden address, same country, no US state code, no string mention of
 * any other registered metro's anchor names) would have passed that gate
 * cleanly. A coordinate-distance check catches it regardless of what the
 * address text says.
 *
 * A genuinely ambiguous case (item is far but plausibly a real, intended
 * day-trip/nearby destination) is never silently passed — it must appear
 * in `approvedDistanceExceptions` with a stated reason, or it BLOCKS.
 */
export function evaluateItemGeoMetroConsistencyGate(boundary: MetroGeoBoundary, items: readonly ItemGeoRecord[]): GeoMetroConsistencyResult {
  const exceptionsByName = new Map((boundary.approvedDistanceExceptions ?? []).map((e) => [e.itemName, e.reason]))
  const violations: Array<{ itemName: string; distanceKm: number; reason: string }> = []

  for (const item of items) {
    const distanceKm = haversineDistanceKm(boundary.centerLat, boundary.centerLng, item.lat, item.lng)
    if (distanceKm <= boundary.maxRadiusKm) continue

    const exceptionReason = exceptionsByName.get(item.itemName)
    if (exceptionReason) continue // explicit, named, approved — never an implicit pass

    violations.push({
      itemName: item.itemName,
      distanceKm: Math.round(distanceKm * 10) / 10,
      reason: `${Math.round(distanceKm)}km from metro center exceeds the approved ${boundary.maxRadiusKm}km boundary${item.formattedAddress ? ` (verified address: ${item.formattedAddress})` : ''} — not in approvedDistanceExceptions`,
    })
  }

  const verdict: 'PASS' | 'FAIL' = violations.length === 0 ? 'PASS' : 'FAIL'
  return {
    key: 'ITEM_GEO_METRO_CONSISTENCY_GATE',
    verdict,
    violations,
    reason:
      verdict === 'PASS'
        ? `All ${items.length} retained item(s) verified-coordinate distance from metro center is within the approved ${boundary.maxRadiusKm}km boundary (or an explicit named exception).`
        : `${violations.length}/${items.length} retained item(s) fail geo-metro consistency: ${violations.map((v) => `${v.itemName} (${v.reason})`).join('; ')}`,
  }
}
