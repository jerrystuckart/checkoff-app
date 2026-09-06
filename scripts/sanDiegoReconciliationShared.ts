// scripts/sanDiegoReconciliationShared.ts
//
// Shared candidate-building logic between the write patch
// (generate-san-diego-catalog-sql.ts) and the read-only reconciliation
// audit (generate-san-diego-reconciliation-audit.ts) — factored out so
// the audit is GUARANTEED to reconcile against the exact same final
// candidate set as the patch by construction (shared code), not by
// copy-paste that could silently drift.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DbPlaybookRunStore } from '../agent-service/specialists/dbPlaybookRunStore'
import { playbookRunId } from '../agent-service/specialists/playbookRun'
import { classifyCategory } from '../agent-service/playbooks/categoryNormalization'
import { runIntakePipeline, type MetroCatalogCandidate, type ItemIntakeRecord } from '../agent-service/playbooks/metroCatalog'
import { CANONICAL_NEIGHBORHOODS, NEIGHBORHOOD_ALIASES, MEXICO_NEIGHBORHOODS, SAN_DIEGO_GENERIC_PLACE_WORDS, VERIFIED_NAME_OVERRIDES, CONFIRMED_DISTINCT_PAIRS } from './metroCatalogSanDiegoConfig'
import { Pool } from 'pg'

export function loadEnvFile(relPath: string): void {
  const envPath = path.join(__dirname, '..', relPath)
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Dollar-quoted string literal — avoids ALL single-quote/apostrophe escaping headaches for real venue names/copy, same technique Denver's own draft SQL used ($co$...$co$). Tag is content-derived so it can never collide with the literal text itself. */
export function dollarQuote(text: string, tagHint: string): string {
  let tag = tagHint
  while (text.includes(`$${tag}$`)) tag += 'x'
  return `$${tag}$${text}$${tag}$`
}

export async function loadCandidates(projectId: string): Promise<MetroCatalogCandidate[]> {
  const store = new DbPlaybookRunStore()
  const run = await store.get(playbookRunId('metro_launch', projectId))
  if (!run) throw new Error(`No metro_launch run found for project "${projectId}"`)
  const state = run.state as {
    candidates?: Array<{ name: string; category: string | null; neighborhood: string | null; claimSupported: string; source: string; mergedSourceUrls?: string[]; verificationConfidence?: 'LOW' | 'MEDIUM' | 'HIGH' }>
    checkoffizedItems?: Array<{ name: string; checkoffizedItem: string }>
  }
  const checkoffizedByName = new Map((state.checkoffizedItems ?? []).map((c) => [c.name, c.checkoffizedItem]))
  return (state.candidates ?? []).map((c) => ({
    name: c.name,
    canonicalCategory: classifyCategory(c.category).canonical,
    neighborhood: c.neighborhood,
    checkoffizedItem: checkoffizedByName.get(c.name) ?? '',
    claimSupported: c.claimSupported,
    sourceUrls: c.mergedSourceUrls ?? [c.source].filter(Boolean),
    verificationConfidence: c.verificationConfidence,
  }))
}

export async function fetchExistingProductionMapsQueries(): Promise<string[]> {
  const pool = new Pool({ connectionString: process.env.AGENT_SERVICE_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 })
  try {
    const result = await pool.query<{ maps_query: string }>('SELECT maps_query FROM public.items WHERE maps_query IS NOT NULL')
    return result.rows.map((r) => r.maps_query)
  } finally {
    await pool.end()
  }
}

export interface FinalRecord extends ItemIntakeRecord {
  isMexico: boolean
}

export async function buildFinalRecords(projectId: string, existingProductionMapsQueries: string[]): Promise<{ records: FinalRecord[]; gates: ReturnType<typeof runIntakePipeline>['gates']; candidateCount: number }> {
  const candidates = await loadCandidates(projectId)
  const result = runIntakePipeline({
    candidates,
    existingProductionMapsQueries,
    canonicalNeighborhoods: CANONICAL_NEIGHBORHOODS,
    neighborhoodAliases: NEIGHBORHOOD_ALIASES,
    mexicoNeighborhoods: MEXICO_NEIGHBORHOODS,
    additionalGenericWords: SAN_DIEGO_GENERIC_PLACE_WORDS,
    verifiedNameOverrides: VERIFIED_NAME_OVERRIDES,
    confirmedDistinctPairs: CONFIRMED_DISTINCT_PAIRS,
  })
  const records = result.finalRecords.map((r) => {
    const isMexico = MEXICO_NEIGHBORHOODS.has(r.neighborhoodName ?? '')
    let mapsQuery = r.mapsQuery
    if (isMexico && !/tijuana/i.test(mapsQuery)) mapsQuery = `${mapsQuery}, Tijuana, Mexico`
    return { ...r, mapsQuery, isMexico }
  })
  return { records, gates: result.gates, candidateCount: candidates.length }
}

/**
 * Deterministic venue-identity join condition for the fallback match tier,
 * shared verbatim by the write patch and the read-only audit so both use
 * IDENTICAL matching logic by construction.
 *
 * `maps_query` is always built as `${venueName}, ${neighborhood}` (see
 * `buildFinalRecords` / the intake pipeline's maps_query construction) —
 * venue name ALWAYS comes first, followed by a comma-space separator, then
 * the neighborhood. That means the normalized `maps_query` on an existing
 * production row is GUARANTEED to start with the normalized venue name,
 * regardless of whether the venue name itself contains internal commas
 * (e.g. "Plaza Fiesta (El Depa, Teléfono Gastro Park, Bosiger Beer)").
 *
 * `split_part(maps_query, ',', 1)` is UNSAFE here: it splits on the FIRST
 * comma in the string, which for a venue name with an internal comma is
 * NOT the venue/neighborhood separator — it truncates mid-name and breaks
 * the match. A normalized-prefix (LIKE) match instead checks "does the
 * existing row's maps_query start with this candidate's venue name",
 * which is correct regardless of where any internal commas fall.
 */
export function fallbackVenueMatchCondition(itemsAlias: string, candidateAlias: string): string {
  return (
    `lower(regexp_replace(btrim(${itemsAlias}.maps_query), '[^a-zA-Z0-9]+', '', 'g'))\n` +
    `     LIKE lower(regexp_replace(btrim(${candidateAlias}.venue_name), '[^a-zA-Z0-9]+', '', 'g')) || '%'`
  )
}

// Confirmed via Jerry's own direct production query, 2026-09-06: the San
// Diego metro already has exactly this many staged items (the original,
// pre-CheckOffization-audit foundation run) — agent_service's own read of
// `items` cannot see them (RLS silently filters is_active=false rows for
// this role — see the reconciliation report for the full explanation).
export const EXPECTED_EXISTING_ITEM_COUNT = 141

/** Every candidate's real recovery/source reason, for the audit's "new rows proposed for insertion" report — tracked by hand across the session, not derived. Anything not listed here is either an original-141 survivor (should match) or an OpenAI-editorial-wording-only update (no location/category change since the original run). */
export const RECOVERY_REASONS: Record<string, string> = {
  // NBSP whitespace bug fix
  'Global Fork Food Hall': 'Recovered: non-breaking-space bug in original neighborhood text fix (Little Italy)',
  // name-fallback / category-classifier / alias fixes (124 -> 145)
  'The Living Coast Discovery Center': 'Recovered: category-classifier fix (Wildlife/Educational -> Adventure)',
  'Historic Third Avenue (Third Avenue Village)': 'Recovered: category-classifier fix (Cultural/Downtown -> Arts & Culture)',
  'Coronado Central Beach': 'Recovered: category-classifier fix (Outdoor / Attraction -> Adventure)',
  'Bike rental & riding (Silver Strand / Bayshore Bikeway)': 'Recovered: category-classifier fix (Outdoor / Recreation -> Adventure)',
  'Coronado Tidelands Park': 'Recovered: category-classifier fix (Park / Outdoor -> Adventure)',
  'Libélula Books & Co.': 'Recovered: category-classifier fix (bookstore -> Shopping)',
  'Sew Loka': 'Recovered: category-classifier fix (fashion/boutique -> Shopping)',
  'Pangaea Outpost': 'Recovered: category-classifier fix (Boutique/artist collective -> Shopping)',
  'Yogurt On The Rocks': 'Recovered: category-classifier fix (Dessert -> Food & drink)',
  'Kate Sessions Park': 'Recovered: category-classifier fix (Scenic park/viewpoint -> Adventure)',
  'The Goods': 'Recovered: category-classifier fix (Artisan doughnut shop -> Food & drink)',
  'Barrio Glassworks': 'Recovered: category-classifier fix (glassblowing workshop -> Arts & Culture)',
  'Escape To VR (VR escape rooms & arcade)': 'Recovered: category-classifier fix (VR escape rooms & arcade -> Adventure)',
  'Leo Carrillo Ranch Historic Park': 'Recovered: category-classifier fix (guided tours plural-form regex bug -> Travel)',
  // address/neighborhood verification overrides (145 -> 160)
  'Callie': 'Recovered: verified-address override (San Diego general -> East Village)',
  'Ambrogio15': 'Recovered: verified-address override (San Diego general -> Pacific Beach)',
  'Et Voilà! French Bistro': 'Recovered: verified-address override (San Diego general -> Normal Heights)',
  'Solare Ristorante': 'Recovered: verified-address override (San Diego general -> Liberty Station)',
  'Soichi (Soichi Sushi)': 'Recovered: verified-address override (San Diego general -> University Heights)',
  'Bird Rock Coffee Roasters': 'Recovered: verified-address override (San Diego general -> La Jolla)',
  'Mike’s Red Tacos (third location)': 'Recovered: verified-address override (San Diego various -> Mira Mesa)',
  'San Diego FC': 'Recovered: verified-address override (San Diego -> Mission Valley, Snapdragon Stadium)',
  'San Diego Wave FC': 'Recovered: verified-address override (San Diego -> Mission Valley, Snapdragon Stadium)',
  'Jeune et Jolie': 'Recovered: verified-address override (North County -> Carlsbad)',
  'Whale Watching & Dolphin Cruises (various operators)': 'Recovered: verified-address override (San Diego Bay/coastal -> Point Loma, H&M Landing)',
  'San Diego Bay Jet Boat Ride': 'Recovered: verified-address override (San Diego Bay -> Gaslamp Quarter, Embarcadero)',
  'Hot Air Balloon over San Diego Coast': 'Recovered: verified-address override (Coastal San Diego -> Del Mar)',
  // Chicano Park Museum recovery (confirmedDistinctPairs)
  'Chicano Park Museum & Cultural Center': 'Recovered: confirmed distinct from Chicano Park (separate indoor museum, not the outdoor mural landmark)',
  // final specificity-research salvage pass (10 items)
  'Zuma': 'Recovered: final salvage pass — signature dish found (miso black cod)',
  'Telefèric Barcelona': 'Recovered: final salvage pass — signature dish found (Paella Negra)',
  'Black Mizu Café': 'Recovered: final salvage pass — signature drink found (White Miso Caramel Latte)',
  'Fleurette': 'Recovered: final salvage pass — signature dish found (Oeuf and Eggs)',
  'JRDN Restaurant at Tower23': 'Recovered: final salvage pass — signature dish/feature found (Tomahawk steak, wave wall)',
  'La Mezcalera': 'Recovered: final salvage pass — signature detail found (40 mezcals, chapulines)',
  'Bacari': 'Recovered: final salvage pass — signature dish/feature found (Moroccan cigars, open bar)',
  'Nómada': 'Recovered: final salvage pass — signature dish found (wood-fired oysters)',
  'Ikaria': 'Recovered: final salvage pass — signature feature found (fermentation workshops, Blue Zone concept)',
}
