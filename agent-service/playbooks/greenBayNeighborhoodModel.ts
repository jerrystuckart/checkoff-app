// agent-service/playbooks/greenBayNeighborhoodModel.ts
//
// Chief Phase 2AI (2026-09-10) — the authoritative, Jerry-approved 13-
// neighborhood canonical model for the Green Bay metro, and a
// deterministic classifier that resolves each item's real production
// neighborhood from its OWN verified formatted address + coordinates —
// never from the raw, often-wrong free-text "neighborhood" label the M3/M5
// discovery stage produced (that field was the actual root cause of the
// incident this module fixes: e.g. Chives Restaurant carried the discovery
// label "Green Bay, WI" despite its own verified geocode placing it in
// Suamico).
//
// Real-world facts this classifier relies on (public geography/postal
// knowledge, not fabricated):
//   - Google's own `formatted_address` city component already correctly
//     names Ashwaubenon/De Pere/Suamico/Howard/Bellevue/Allouez/Hobart/
//     Oconto whenever a venue is genuinely in one of those municipalities
//     — those pass straight through.
//   - Within the City of Green Bay itself, the address's ZIP code
//     reliably distinguishes the real geographic quadrant: 54301
//     (downtown/near-south core — Washington/Adams/Walnut/Monroe/Webster/
//     Cherry/Bodart/Main St corridor), 54302 (northeast, along the actual
//     bay shoreline — Bay Beach Rd/E Shore Dr/E Mason St/Cedar St), 54303
//     (northwest/west — the Broadway corridor, Military Ave, Riverview Dr,
//     Dousman St), 54304 (southwest, bordering Ashwaubenon — Lombardi Ave/
//     Holmgren Way/S Oneida St/S Broadway/Ridge Rd), 54311 (east —
//     University Ave/Allouez Ave border/Hoffman Rd/Bay Settlement Rd),
//     54313 (shared with Howard's own ZIP; Green Bay-attributed 54313
//     addresses are the far-northwest annexed area — treated as West Side
//     with an explicit lower-confidence note, since the ZIP is genuinely
//     shared).
//   - The City of De Pere straddles the Fox River; addresses west of
//     approximately -88.062° longitude (this batch's own Voyageur Park/
//     Riverwalk coordinates, literally at the river's edge) are West De
//     Pere, east of it are East De Pere.
//   - A "De Pere"-postal-city address whose coordinates fall far outside
//     De Pere's own built-up area (more than ~0.1° / ~10km west) and whose
//     venue name itself names the Oneida Nation is real evidence of a
//     rural/reservation address using a De Pere postal city by Wisconsin
//     rural-addressing convention — classified Oneida, not De Pere.
//   - Oconto is a genuinely separate city/county, NOT one of the 13
//     canonical neighborhoods — never silently folded into Suamico just
//     because it's geographically nearby.

export const GREEN_BAY_CANONICAL_NEIGHBORHOODS: readonly string[] = [
  'East Side Green Bay',
  'West Side Green Bay',
  'Howard',
  'Suamico',
  'The Bay',
  'Ashwaubenon',
  'Hobart',
  'Bellevue',
  'Allouez',
  'Downtown Green Bay',
  'East De Pere',
  'West De Pere',
  'Oneida',
]

import type { NeighborhoodMunicipalityRegistry } from './geographicConsistencyAudit'

/**
 * Chief Phase 2AJ (2026-09-10) — Jerry's explicit instruction: all 13
 * canonical neighborhoods must exist as real `neighborhoods` rows in
 * production even before any item is assigned to them (Hobart and Allouez
 * currently have zero retained items — that's an accepted, reported fact,
 * not something to fabricate an item to fix). A neighborhood row needs SOME
 * centroid to be created at all; for the 11 neighborhoods with real items
 * this cycle, that centroid is derived from those items' own verified
 * coordinates (see build-master-sql.ts). For Hobart and Allouez specifically,
 * this is their real, publicly-known village-center coordinate (Brown
 * County, WI municipal record — public geographic fact, not business data,
 * not fabricated) — used ONLY as a placeholder centroid until real items
 * exist there, at which point a future enrichment pass should recompute it
 * from real item coordinates the same way every other neighborhood's
 * centroid already is.
 */
export const GREEN_BAY_EMPTY_NEIGHBORHOOD_FALLBACK_CENTROIDS: Readonly<Record<string, { lat: number; lng: number }>> = Object.freeze({
  Hobart: { lat: 44.4636, lng: -88.1439 },
  Allouez: { lat: 44.4794, lng: -88.0431 },
})

export const GREEN_BAY_NEIGHBORHOOD_MUNICIPALITY_REGISTRY: NeighborhoodMunicipalityRegistry = {
  'East Side Green Bay': { municipalityAliases: ['Green Bay'] },
  'West Side Green Bay': { municipalityAliases: ['Green Bay'] },
  'Downtown Green Bay': { municipalityAliases: ['Green Bay'] },
  'The Bay': { municipalityAliases: ['Green Bay'] },
  Howard: { municipalityAliases: ['Howard'] },
  Suamico: { municipalityAliases: ['Suamico'] },
  Ashwaubenon: { municipalityAliases: ['Ashwaubenon'] },
  Hobart: { municipalityAliases: ['Hobart'] },
  Bellevue: { municipalityAliases: ['Bellevue'] },
  Allouez: { municipalityAliases: ['Allouez'] },
  'East De Pere': { municipalityAliases: ['De Pere'] },
  'West De Pere': { municipalityAliases: ['De Pere'] },
  // Oneida rural/reservation addresses often carry a De Pere or Green Bay
  // postal city by Wisconsin rural-addressing convention — both accepted.
  Oneida: { municipalityAliases: ['Oneida', 'De Pere', 'Green Bay'] },
}

/** Municipalities that exist near Green Bay but are explicitly OUTSIDE the 13-neighborhood canonical model — an item resolving here is out-of-scope by definition, never force-mapped to a nearby canonical neighborhood. */
export const KNOWN_OUT_OF_SCOPE_MUNICIPALITIES: readonly string[] = ['Oconto']

export interface GreenBayClassificationInput {
  venueName: string
  formattedAddress: string | null
  lat: number | null
  lng: number | null
}

export type GreenBayClassificationConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface GreenBayClassificationResult {
  /** Null when the item resolves to a real place OUTSIDE all 13 canonical neighborhoods (e.g. Oconto) — never a forced nearest-neighborhood guess. */
  neighborhood: string | null
  confidence: GreenBayClassificationConfidence
  reason: string
  /** Set when neighborhood is null and the address matched a known-but-out-of-scope municipality (e.g. Oconto) — distinguishes "real place, wrong metro" from "couldn't determine at all." */
  outOfScopeMunicipality?: string
}

function extractCityAndZip(address: string): { city: string | null; zip: string | null } {
  const withZip = address.match(/,\s*([A-Za-z .]+),\s*WI\s*(\d{5})/)
  if (withZip) return { city: withZip[1].trim(), zip: withZip[2] }
  // A bare "City, WI, USA" address (no street, no ZIP) — e.g. a village-level item with no specific venue address.
  const noZip = address.match(/^([A-Za-z .]+),\s*WI(?:,\s*USA)?\s*$/)
  return { city: noZip ? noZip[1].trim() : null, zip: null }
}

const GREEN_BAY_ZIP_TO_NEIGHBORHOOD: Record<string, { neighborhood: string; confidence: GreenBayClassificationConfidence }> = {
  '54301': { neighborhood: 'Downtown Green Bay', confidence: 'HIGH' },
  '54302': { neighborhood: 'The Bay', confidence: 'HIGH' },
  '54303': { neighborhood: 'West Side Green Bay', confidence: 'HIGH' },
  '54304': { neighborhood: 'West Side Green Bay', confidence: 'HIGH' },
  '54311': { neighborhood: 'East Side Green Bay', confidence: 'HIGH' },
  // Shared with Howard's own ZIP — a Green-Bay-attributed 54313 address is
  // the city's far-northwest annexed area, but the ZIP alone can't fully
  // rule out a true Howard parcel using the wrong postal city. Flagged
  // MEDIUM, never silently treated as certain.
  '54313': { neighborhood: 'West Side Green Bay', confidence: 'MEDIUM' },
}

/** The Fox River's approximate longitude through De Pere at this batch's own latitude band, derived directly from this batch's own verified riverside coordinates (Voyageur Park / De Pere Riverwalk, both real parks literally on the riverbank) — never an invented/estimated value from outside this data. */
const DE_PERE_RIVER_LONGITUDE = -88.062

function classifyDePere(input: GreenBayClassificationInput): GreenBayClassificationResult {
  // Oneida override: a "De Pere"-postal address whose coordinates are far
  // (>0.1 degrees, ~10km) west of De Pere's own built-up area, especially
  // when the venue name itself names the Oneida Nation, is real evidence
  // of a rural/reservation address using De Pere's postal city — never
  // De Pere itself.
  if (typeof input.lng === 'number' && input.lng < -88.15) {
    const nameIndicatesOneida = /oneida/i.test(input.venueName)
    return {
      neighborhood: 'Oneida',
      confidence: nameIndicatesOneida ? 'HIGH' : 'MEDIUM',
      reason: `Postal city is "De Pere" but coordinates (lng ${input.lng}) are far outside De Pere's built-up area, consistent with a rural/reservation address using De Pere's postal city by Wisconsin convention${nameIndicatesOneida ? '; venue name also explicitly names the Oneida Nation' : ''}.`,
    }
  }
  if (typeof input.lng !== 'number') {
    return { neighborhood: null, confidence: 'LOW', reason: 'De Pere address with no coordinates available — cannot determine east/west bank.' }
  }
  const neighborhood = input.lng <= DE_PERE_RIVER_LONGITUDE ? 'West De Pere' : 'East De Pere'
  return {
    neighborhood,
    confidence: 'MEDIUM',
    reason: `Longitude ${input.lng} is ${input.lng <= DE_PERE_RIVER_LONGITUDE ? 'at/west of' : 'east of'} the Fox River's approximate ${DE_PERE_RIVER_LONGITUDE} longitude in De Pere (derived from this batch's own riverside item coordinates) — no precise parcel-level river polyline available, so this is a real but MEDIUM-confidence determination worth a human glance for a boundary-adjacent address.`,
  }
}

export function classifyGreenBayNeighborhood(input: GreenBayClassificationInput): GreenBayClassificationResult {
  if (!input.formattedAddress) {
    return { neighborhood: null, confidence: 'LOW', reason: 'No verified formatted address available.' }
  }
  const { city, zip } = extractCityAndZip(input.formattedAddress)
  if (!city) {
    return { neighborhood: null, confidence: 'LOW', reason: `Could not parse a city/ZIP from address "${input.formattedAddress}".` }
  }

  if (KNOWN_OUT_OF_SCOPE_MUNICIPALITIES.some((m) => m.toLowerCase() === city.toLowerCase())) {
    return { neighborhood: null, confidence: 'HIGH', reason: `Verified address resolves to "${city}", a real municipality outside all 13 canonical Green Bay metro neighborhoods.`, outOfScopeMunicipality: city }
  }

  const directMap: Record<string, string> = {
    ashwaubenon: 'Ashwaubenon',
    suamico: 'Suamico',
    howard: 'Howard',
    bellevue: 'Bellevue',
    allouez: 'Allouez',
    hobart: 'Hobart',
    oneida: 'Oneida',
  }
  const directHit = directMap[city.toLowerCase()]
  if (directHit) {
    return { neighborhood: directHit, confidence: 'HIGH', reason: `Verified address's own city field is "${city}".` }
  }

  if (city.toLowerCase() === 'de pere') {
    return classifyDePere(input)
  }

  if (city.toLowerCase() === 'green bay') {
    if (!zip) return { neighborhood: null, confidence: 'LOW', reason: `"Green Bay" address with no parseable ZIP: "${input.formattedAddress}".` }
    const zipMatch = GREEN_BAY_ZIP_TO_NEIGHBORHOOD[zip]
    if (!zipMatch) return { neighborhood: null, confidence: 'LOW', reason: `Green Bay ZIP "${zip}" is not in the known mapping — needs a human decision, not a guess.` }
    return { neighborhood: zipMatch.neighborhood, confidence: zipMatch.confidence, reason: `Green Bay ZIP ${zip} maps to ${zipMatch.neighborhood}${zipMatch.confidence === 'MEDIUM' ? ' (ZIP is shared with Howard — worth a human glance)' : ''}.` }
  }

  return { neighborhood: null, confidence: 'LOW', reason: `Unrecognized municipality "${city}" — not one of the 13 canonical neighborhoods, not a known out-of-scope municipality either. Needs a human decision.` }
}
