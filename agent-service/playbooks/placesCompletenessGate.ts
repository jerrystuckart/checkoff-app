// agent-service/playbooks/placesCompletenessGate.ts
//
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem) — a
// final, deterministic completeness gate distinct from GEO_ENRICHMENT_GATE.
// GEO_ENRICHMENT_GATE (metroGeoEnrichment.ts) certifies MATCH QUALITY (is
// this an EXACT/HIGH_CONFIDENCE/NO_CANONICAL_VENUE classification) — it
// does not itself assert that every required SQL column is actually
// populated for every retained item. This module closes that specific
// gap: for every item that resolved to a real, canonical venue, the six
// production fields (google_place_id, formatted_address, maps_query,
// maps_lat, maps_lng, geo_location-derivable-from-lat/lng) must all be
// present before the production package is considered ready — including
// items added AFTER the main catalog build (a themed-list enrichment
// pass, a late single-venue addition) — late adds get NO exemption from
// this gate; see lateAddItemCertification.ts.

export type PlacesCompletenessClassification = 'EXACT' | 'HIGH_CONFIDENCE_PARENT_VENUE' | 'AMBIGUOUS_NEEDS_REVIEW' | 'REJECTED_WRONG_MATCH' | 'NO_CANONICAL_VENUE' | 'UNRESOLVED'

export interface PlacesCompletenessItemInput {
  candidateName: string
  /** From the geo-enrichment pass (metroGeoEnrichment.ts). NO_CANONICAL_VENUE is the one legitimate exemption — an event/route/district/multi-operator experience genuinely has no single venue to attach Places data to. */
  classification: PlacesCompletenessClassification
  googlePlaceId: string | null
  formattedAddress: string | null
  mapsQuery: string | null
  lat: number | null
  lng: number | null
}

export interface PlacesCompletenessFinding {
  candidateName: string
  missingFields: string[]
}

export interface PlacesCompletenessResult {
  key: 'PLACES_COMPLETENESS_GATE'
  verdict: 'PASS' | 'FAIL'
  reason: string
  findings: PlacesCompletenessFinding[]
}

const REQUIRED_FIELDS: Array<{ key: keyof PlacesCompletenessItemInput; label: string }> = [
  { key: 'googlePlaceId', label: 'google_place_id' },
  { key: 'formattedAddress', label: 'formatted_address' },
  { key: 'mapsQuery', label: 'maps_query' },
  { key: 'lat', label: 'maps_lat' },
  { key: 'lng', label: 'maps_lng' },
]

function isEmpty(v: string | number | null): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0)
}

/**
 * Fails CLOSED: any item that resolved to a real venue (i.e. classification
 * is NOT `NO_CANONICAL_VENUE`) must have all five source fields populated
 * (geo_location is derived directly from lat/lng at SQL-generation time,
 * so it's covered by the lat/lng checks here, not checked separately).
 * Never silently omits a field just because the venue was "already Places-
 * verified" earlier in the pipeline — if it isn't present on THIS item's
 * final record, it fails, regardless of when in the process it was
 * supposed to have been captured.
 */
export function evaluatePlacesCompletenessGate(items: readonly PlacesCompletenessItemInput[]): PlacesCompletenessResult {
  const findings: PlacesCompletenessFinding[] = []
  for (const item of items) {
    if (item.classification === 'NO_CANONICAL_VENUE') continue // explicit, legitimate exemption — never a silent skip for any other reason
    const missingFields = REQUIRED_FIELDS.filter((f) => isEmpty(item[f.key] as string | number | null)).map((f) => f.label)
    if (missingFields.length > 0) findings.push({ candidateName: item.candidateName, missingFields })
  }
  const verdict: 'PASS' | 'FAIL' = findings.length === 0 ? 'PASS' : 'FAIL'
  return {
    key: 'PLACES_COMPLETENESS_GATE',
    verdict,
    reason:
      verdict === 'PASS'
        ? `All ${items.length} item(s) requiring real venue data have complete Google Places fields (or are a legitimate NO_CANONICAL_VENUE exception).`
        : `${findings.length}/${items.length} item(s) are missing required Places field(s): ${findings.map((f) => `${f.candidateName} [${f.missingFields.join(', ')}]`).join(' | ')}`,
    findings,
  }
}
