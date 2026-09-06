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
export const NEIGHBORHOOD_ALIASES: Record<string, string> = {
  downtown: 'Gaslamp Quarter',
  'petco park': 'East Village',
  embarcadero: 'Gaslamp Quarter',
  'downtown tijuana': 'Zona Centro',
  'avenida revolución': 'Zona Centro',
  revolución: 'Zona Centro',
  'pueblo amigo': 'Zona Norte',
  pedwest: 'Zona Centro',
}
