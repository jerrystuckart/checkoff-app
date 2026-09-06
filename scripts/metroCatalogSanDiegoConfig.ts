// scripts/metroCatalogSanDiegoConfig.ts
//
// The San Diego + Tijuana metro's specific neighborhood/alias/country
// configuration — shared by both metro-catalog-dry-run.ts and
// generate-san-diego-catalog-sql.ts so they can never drift from each
// other. Not part of agent-service/playbooks/metroCatalog.ts itself
// because that module is deliberately metro-agnostic; this file is the
// San-Diego-specific data a future Vienna build would replace wholesale.

// The 40 real, geocoded neighborhoods (scripts/output/san-diego-neighborhoods-with-radii.json)
// — San Diego's 35 plus Tijuana's 5, all modeled under San Diego's own
// metro_id per Jerry's 2026-09-06 architecture decision. Grown from an
// initial 29 after the first dry-run pass showed ~100 real candidates
// referencing genuine sub-areas (Balboa Park, Mission Bay, Old Town,
// Liberty Station, Mission Valley, etc.) the original M1 list didn't cover.
export const CANONICAL_NEIGHBORHOODS = [
  'Gaslamp Quarter', 'East Village', 'Little Italy', 'Barrio Logan', 'North Park', 'South Park',
  'Hillcrest', 'Mission Hills', 'Point Loma', 'Ocean Beach', 'Mission Beach', 'Pacific Beach',
  'La Jolla', 'Coronado', 'Chula Vista', 'Del Mar', 'Solana Beach', 'Encinitas', 'Carlsbad',
  'Oceanside', 'Escondido', 'Rancho Santa Fe', 'San Marcos', 'Vista',
  'Balboa Park', 'Mission Bay', 'Old Town', 'Liberty Station', 'Mission Valley', 'Kearny Mesa',
  'San Ysidro', 'University City', 'Normal Heights', 'University Heights', 'Mira Mesa',
  'Zona Centro', 'Zona Río', 'Zona Norte', 'Otay', 'Chapultepec Alamar',
]

/** The subset of CANONICAL_NEIGHBORHOODS that are actually in Mexico — required by resolveNeighborhoods' country-consistency check (see metroCatalog.ts). */
export const MEXICO_NEIGHBORHOODS = new Set(['Zona Centro', 'Zona Río', 'Zona Norte', 'Otay', 'Chapultepec Alamar'])

// Real landmarks/sub-areas whose text never names their containing
// canonical neighborhood literally — checked only when no direct match
// exists (see resolveNeighborhoods' own doc). Judgment calls, flagged as
// such: "Downtown" alone (no more specific district named) defaults to
// Gaslamp Quarter, the historic downtown core; Petco Park/the Embarcadero
// waterfront likewise. Tijuana landmarks route to their real containing zone.
//
// Structural bug fix (San Diego catalog SQL review, 2026-09-06): the
// bare "downtown" alias below used to ALSO fire on "Downtown Tijuana..."
// text (3 real Tijuana venues — Estación Federal, La Mezcalera, Rubiks —
// wrongly resolved to Gaslamp Quarter). resolveNeighborhoods' own
// country-consistency check now prevents that class of bug generally,
// but "downtown tijuana" is added here explicitly too so those 3 real
// venues correctly resolve to Zona Centro instead of just failing.
/**
 * Every canonical neighborhood name's individual words, lowercased —
 * passed to runIntakePipeline's additionalGenericWords so the semantic-
 * duplicate similarity check never treats a shared neighborhood name
 * alone as venue-identity evidence. Structural bug fix (San Diego
 * catalog SQL review, 2026-09-06): "Oceanside Pier" and "Oceanside
 * Museum of Art" were wrongly grouped as duplicates — the only shared
 * word was the neighborhood name, and a metro-scale catalog will always
 * have many unrelated venues in the same area.
 */
export const SAN_DIEGO_GENERIC_PLACE_WORDS = new Set(
  CANONICAL_NEIGHBORHOODS.flatMap((n) =>
    n
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics — must match metroCatalog.ts's own normalizeText exactly, or "Río" here would never match the "rio" a candidate name normalizes to
      .toLowerCase()
      .split(/\s+/)
  )
)

export const NEIGHBORHOOD_ALIASES: Record<string, string> = {
  downtown: 'Gaslamp Quarter',
  'petco park': 'East Village',
  embarcadero: 'Gaslamp Quarter',
  'downtown tijuana': 'Zona Centro',
  'avenida revolución': 'Zona Centro',
  revolución: 'Zona Centro',
  'pueblo amigo': 'Zona Norte',
  pedwest: 'Zona Centro',
  // Added during the CheckOffization/attrition audit (2026-09) — same
  // "judgment call, flagged as such" discipline as the aliases above.
  // Each is a well-established, publicly verifiable real-world location
  // fact (not researched fresh for this batch), used only to resolve a
  // candidate whose recorded neighborhood text was too generic
  // ("Westfield UTC", "Safari Park (north inland San Diego)",
  // "Entertainment Circle area") to hit a canonical name directly. Flagged
  // for Jerry's review, not silently applied.
  'westfield utc': 'University City', // the mall itself sits in University City
  'safari park': 'Escondido', // San Diego Zoo Safari Park is in Escondido
  'daley ranch': 'Escondido', // Daley Ranch is a preserve in Escondido
  'entertainment circle': 'Chula Vista', // Sesame Place San Diego is on the Chula Vista Bayfront
  'gunpowder point': 'Chula Vista', // The Living Coast Discovery Center sits on the Sweetwater Marsh refuge in Chula Vista
}

/**
 * Verified candidateName -> canonical neighborhood overrides, from the
 * ~22-item targeted verification pass Jerry approved (2026-09) — a real
 * web-search lookup per named business/operator to confirm one specific
 * address or departure dock, NOT a broad re-research round. Checked only
 * as resolveNeighborhoods' last-resort fallback (see that function's own
 * doc) — never overrides a real match already present in the recorded
 * text. Each entry is cited below; only entries that resolved to one of
 * CANONICAL_NEIGHBORHOODS are included here — several verified addresses
 * (Golden Hill, Bankers Hill, Midway District, Mission Gorge, Harbor
 * Island) are real but NOT in the current 40-neighborhood set, so those
 * candidates are left unresolved rather than force-fit into a nearby
 * canonical name; adding them would mean adding a new neighborhood
 * (geocoding), which is out of scope for this pass.
 */
export const VERIFIED_NAME_OVERRIDES = new Map<string, string>([
  ['Callie', 'East Village'], // 1195 Island Ave, San Diego — East Village
  ['Ambrogio15', 'Pacific Beach'], // flagship/original location, 926 Turquoise St — Pacific Beach (also has Del Mar + airport locations)
  ['Et Voilà! French Bistro', 'Normal Heights'], // 3015 Adams Ave / 92116 — Normal Heights (Adams Ave is the Normal Heights/Kensington main street; some sources loosely call this stretch "North Park," also canonical if that's preferred)
  ['Solare Ristorante', 'Liberty Station'], // 2820 Roosevelt Rd, Liberty Station, Point Loma
  ['Soichi (Soichi Sushi)', 'University Heights'], // 2121 Adams Ave — University Heights (Michelin-starred, 2022)
  ['San Diego Chocolate Co.', 'North Park'], // based in North Park; caveat — operates primarily as a rotating farmers-market vendor (Hillcrest/La Mesa/North Park), not a fixed storefront
  ['Bird Rock Coffee Roasters', 'La Jolla'], // original/flagship Bird Rock location, 5627 La Jolla Blvd — Bird Rock is part of greater La Jolla
  ['Mike’s Red Tacos (third location)', 'Mira Mesa'], // 9089 Mira Mesa Blvd
  ['San Diego FC', 'Mission Valley'], // plays at Snapdragon Stadium, 2101 Stadium Way — Mission Valley
  ['San Diego Wave FC', 'Mission Valley'], // also plays at Snapdragon Stadium — Mission Valley
  ['Jeune et Jolie', 'Carlsbad'], // 2659 State St, Carlsbad — Michelin-starred
  ['Whale Watching & Dolphin Cruises (various operators)', 'Point Loma'], // representative operator: H&M Landing, Point Loma (other operators may depart elsewhere — flagged, not exhaustively verified)
  ['San Diego Bay Jet Boat Ride', 'Gaslamp Quarter'], // departs Seaport Village/Embarcadero — via the existing embarcadero->Gaslamp Quarter alias
  ['Hot Air Balloon over San Diego Coast', 'Del Mar'], // multiple real operators launch from Del Mar for this exact coastal route
])

/**
 * Candidate-name pairs manually confirmed to be genuinely distinct
 * CheckOff-worthy experiences despite the semantic-dedup similarity
 * check otherwise collapsing them — approved by Jerry, 2026-09. See
 * metroCatalog.ts's confirmedDistinctPairs doc.
 */
export const CONFIRMED_DISTINCT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['Chicano Park', 'Chicano Park Museum & Cultural Center'], // the outdoor mural landmark (National Historic Landmark) vs. a separate indoor building, opened Oct 2022, celebrating the park's muralists
]
