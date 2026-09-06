#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-catalog-sql.ts
//
// Generates (never applies) the full San Diego + Tijuana catalog
// foundation SQL, following docs/metro-launch-playbook.md Phase 4 and
// docs/metro-launch-audit/patches/denver_catalog_insert_CORRECTED.sql's
// proven house style: gen_random_uuid() (no invented UUIDs), NOT EXISTS
// idempotency guards (not ON CONFLICT against unverifiable constraints),
// one wrapping transaction, preflight + postflight RAISE EXCEPTION
// checks. Writes ONLY a local .sql file for Jerry to review and run
// himself via Supabase SQL Editor — this script has no DB write access
// and never attempts one.
//
// Architecture (Jerry's explicit decision, 2026-09-06): Tijuana is
// NOT its own metro_areas row — it's a cross-border extension, modeled
// as neighborhoods under San Diego's own metro_id, isolated into its
// own dedicated curated list (never mixed into the main San Diego
// catalog list), with Mexico geography preserved explicitly in each
// item's maps_query text.
//
// Usage: npx tsx scripts/generate-san-diego-catalog-sql.ts

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DbPlaybookRunStore } from '../agent-service/specialists/dbPlaybookRunStore'
import { playbookRunId } from '../agent-service/specialists/playbookRun'
import { classifyCategory } from '../agent-service/playbooks/categoryNormalization'
import { mapCandidatesToIntakeRecords, checkForDuplicates, resolveNeighborhoods, type MetroCatalogCandidate, type ItemIntakeRecord } from '../agent-service/playbooks/metroCatalog'
import { Pool } from 'pg'

function loadEnvFile(relPath: string): void {
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
loadEnvFile('.env')

const TIJUANA_NEIGHBORHOODS = new Set(['Zona Centro', 'Zona Río', 'Zona Norte', 'Otay', 'Chapultepec Alamar'])

const CANONICAL_NEIGHBORHOODS = [
  'Gaslamp Quarter', 'East Village', 'Little Italy', 'Barrio Logan', 'North Park', 'South Park',
  'Hillcrest', 'Mission Hills', 'Point Loma', 'Ocean Beach', 'Mission Beach', 'Pacific Beach',
  'La Jolla', 'Coronado', 'Chula Vista', 'Del Mar', 'Solana Beach', 'Encinitas', 'Carlsbad',
  'Oceanside', 'Escondido', 'Rancho Santa Fe', 'San Marcos', 'Vista',
  'Balboa Park', 'Mission Bay', 'Old Town', 'Liberty Station', 'Mission Valley', 'Kearny Mesa',
  'San Ysidro', 'University City', 'Normal Heights', 'University Heights', 'Mira Mesa',
  'Zona Centro', 'Zona Río', 'Zona Norte', 'Otay', 'Chapultepec Alamar',
]
const NEIGHBORHOOD_ALIASES: Record<string, string> = {
  downtown: 'Gaslamp Quarter',
  'petco park': 'East Village',
  embarcadero: 'Gaslamp Quarter',
  'avenida revolución': 'Zona Centro',
  revolución: 'Zona Centro',
  'pueblo amigo': 'Zona Norte',
  pedwest: 'Zona Centro',
}

function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Dollar-quoted string literal — avoids ALL single-quote/apostrophe escaping headaches for real venue names/copy (Warwick's Books, native Spanish text, etc.), same technique Denver's own draft SQL used ($co$...$co$). Tag is content-derived so it can never collide with the literal text itself. */
function dollarQuote(text: string, tagHint: string): string {
  let tag = tagHint
  while (text.includes(`$${tag}$`)) tag += 'x'
  return `$${tag}$${text}$${tag}$`
}

async function loadCandidates(projectId: string): Promise<MetroCatalogCandidate[]> {
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

async function fetchExistingProductionMapsQueries(): Promise<string[]> {
  const pool = new Pool({ connectionString: process.env.AGENT_SERVICE_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 })
  try {
    const result = await pool.query<{ maps_query: string }>('SELECT maps_query FROM public.items WHERE maps_query IS NOT NULL')
    return result.rows.map((r) => r.maps_query)
  } finally {
    await pool.end()
  }
}

interface ResolvedRecord extends ItemIntakeRecord {
  resolvedNeighborhood: string
  isMexico: boolean
}

async function buildCleanRecords(projectId: string, existingProductionMapsQueries: string[]): Promise<ResolvedRecord[]> {
  const candidates = await loadCandidates(projectId)
  const { records } = mapCandidatesToIntakeRecords(candidates)
  const { clean } = checkForDuplicates(records, existingProductionMapsQueries)
  const { resolved } = resolveNeighborhoods(clean, CANONICAL_NEIGHBORHOODS, NEIGHBORHOOD_ALIASES)
  return clean
    .filter((r) => resolved.has(r.candidateName))
    .map((r) => {
      const resolvedNeighborhood = resolved.get(r.candidateName)!
      const isMexico = TIJUANA_NEIGHBORHOODS.has(resolvedNeighborhood)
      let mapsQuery = r.mapsQuery
      if (isMexico && !/tijuana/i.test(mapsQuery)) mapsQuery = `${mapsQuery}, Tijuana, Mexico`
      return { ...r, resolvedNeighborhood, isMexico, mapsQuery }
    })
}

async function main() {
  const geo = JSON.parse(readFileSync('scripts/output/san-diego-neighborhoods-with-radii.json', 'utf8')) as Array<{ name: string; lat: number; lng: number; ring0RadiusM: number; ring1RadiusM: number; ring2RadiusM: number; isMexico: boolean }>
  const existingProductionMapsQueries = await fetchExistingProductionMapsQueries()

  const sdRecords = await buildCleanRecords('san-diego', existingProductionMapsQueries)
  const tjRecords = await buildCleanRecords('san-diego-tijuana-extension', existingProductionMapsQueries)
  const allRecords = [...sdRecords, ...tjRecords]

  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`-- Chief M7-M9 — San Diego Metro + Tijuana Cross-Border Extension catalog foundation.`)
  push(`-- GENERATED, NOT APPLIED. Review before running — same convention as every other`)
  push(`-- migration in this repo (supabase/migrations/*.sql). Run manually via Supabase SQL`)
  push(`-- Editor, one statement group at a time, verifying against a query after each`)
  push(`-- section, per docs/metro-launch-playbook.md Phase 6.`)
  push(`--`)
  push(`-- PREREQUISITE: supabase/migrations/20260906_add_shopping_sports_social_travel_categories.sql`)
  push(`-- must already be applied (preflight below verifies this and aborts if not).`)
  push(`--`)
  push(`-- Architecture: Tijuana is NOT its own metro_areas row (Jerry's explicit decision,`)
  push(`-- 2026-09-06) — it is a cross-border extension, modeled as neighborhoods under San`)
  push(`-- Diego's own metro_id, isolated into its own dedicated curated list (never mixed`)
  push(`-- into the main San Diego catalog list), with Mexico geography preserved explicitly`)
  push(`-- in every Tijuana item's maps_query text and every Tijuana neighborhood's state`)
  push(`-- field ("Baja California, Mexico", never a US state code).`)
  push(`--`)
  push(`-- Coordinates: neighborhood centers are REAL, geocoded via Google Places Text Search`)
  push(`-- (scripts/geocode-san-diego-neighborhoods.js) — never estimated. Item-level`)
  push(`-- maps_lat/maps_lng are intentionally left NULL here, per the same convention every`)
  push(`-- prior metro used (Denver's real 149-item intake): coordinates are a SEPARATE,`)
  push(`-- later, human-reviewed geocoding pass (scripts/geocode-items.js), never fabricated`)
  push(`-- from AI research at intake time.`)
  push(`--`)
  push(`-- Staging: metro_areas.is_active=false and every curated_lists row is_active=false`)
  push(`-- throughout. Flipping metro_areas.is_active=true is the deliberate, separate launch`)
  push(`-- trigger (Part 3 of the playbook) — NOT part of this file.`)
  push(``)
  push(`BEGIN;`)
  push(``)
  push(`-- ── Preflight ──────────────────────────────────────────────────────────`)
  push(`DO $$`)
  push(`BEGIN`)
  push(`  IF EXISTS (SELECT 1 FROM public.metro_areas WHERE slug = 'san-diego') THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: metro_areas.slug=''san-diego'' already exists — this file is not meant to be re-run for metro creation.';`)
  push(`  END IF;`)
  push(`  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Shopping')`)
  push(`     OR NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Sports')`)
  push(`     OR NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Social')`)
  push(`     OR NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Travel') THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: run supabase/migrations/20260906_add_shopping_sports_social_travel_categories.sql first.';`)
  push(`  END IF;`)
  push(`END $$;`)
  push(``)

  // ── metro_areas ──
  push(`-- ── 1. metro_areas — San Diego (Tijuana is NOT a separate metro; see header) ──`)
  push(`INSERT INTO public.metro_areas (id, name, slug, state, is_active, timezone, center_lat, center_lng, hero_images)`)
  push(`SELECT gen_random_uuid(), ${dollarQuote('San Diego Metro', 'sd')}, 'san-diego', 'CA', false, 'America/Los_Angeles', 32.7157, -117.1611, ARRAY[]::text[]`)
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.metro_areas WHERE slug = 'san-diego');`)
  push(``)

  // ── neighborhoods ──
  push(`-- ── 2. neighborhoods (${geo.length}) — San Diego's own + Tijuana's, ALL under San Diego's metro_id. Real, geocoded centers (scripts/geocode-san-diego-neighborhoods.js); ring radii computed to guarantee zero ring_2 overlap (verifyNoRingOverlap), a JUDGMENT CALL worth reviewing, not a fixed platform rule. ──`)
  for (const n of geo) {
    const isMexico = TIJUANA_NEIGHBORHOODS.has(n.name)
    const state = isMexico ? 'Baja California, Mexico' : 'CA'
    push(`INSERT INTO public.neighborhoods (id, metro_id, name, slug, state, center_geo, ring_0_radius_m, ring_1_radius_m, ring_2_radius_m, is_active)`)
    push(
      `SELECT gen_random_uuid(), (SELECT id FROM public.metro_areas WHERE slug = 'san-diego'), ${dollarQuote(n.name, 'nb')}, '${slugify(n.name)}', ${dollarQuote(state, 'st')}, ST_SetSRID(ST_MakePoint(${n.lng}, ${n.lat}), 4326)::geography, ${n.ring0RadiusM}, ${n.ring1RadiusM}, ${n.ring2RadiusM}, true`
    )
    push(`WHERE NOT EXISTS (SELECT 1 FROM public.neighborhoods nb JOIN public.metro_areas m ON m.id = nb.metro_id WHERE m.slug = 'san-diego' AND nb.name = ${dollarQuote(n.name, 'nb2')});`)
  }
  push(``)

  // ── items ──
  push(`-- ── 3. items (${allRecords.length}: ${sdRecords.length} San Diego + ${tjRecords.length} Tijuana). Category via name subquery (no invented UUIDs). Duplicate check re-verified inline (normalized maps_query, global — same discipline as Denver's real intake) even though the dry run already confirmed zero collisions, since production may have changed since. maps_lat/maps_lng intentionally NULL — see header. ──`)
  for (const r of allRecords) {
    push(`INSERT INTO public.items (body, category_id, checkin_type, is_universal, is_active, is_approved, neighborhood_id, maps_query, is_recurring, difficulty, photo_required, has_alcohol)`)
    push(`SELECT`)
    push(`  ${dollarQuote(r.body, 'bd')},`)
    push(`  (SELECT id FROM public.categories WHERE name = ${dollarQuote(r.dbCategory, 'cat')}),`)
    push(`  'tap', false, true, true,`)
    push(`  (SELECT nb.id FROM public.neighborhoods nb JOIN public.metro_areas m ON m.id = nb.metro_id WHERE m.slug = 'san-diego' AND nb.name = ${dollarQuote(r.resolvedNeighborhood, 'nb')}),`)
    push(`  ${dollarQuote(r.mapsQuery, 'mq')}, true, 1, false, false`)
    push(
      `WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE lower(regexp_replace(btrim(maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(${dollarQuote(r.mapsQuery, 'mq2')}), '[^a-zA-Z0-9]+', '', 'g')));`
    )
  }
  push(``)

  // ── audience_groups ──
  push(`-- ── 4. audience_groups — one San Diego chip, used by both curated lists below (JUDGMENT CALL: thin model, per Phase 3 decision #4 — review before applying) ──`)
  push(`INSERT INTO public.audience_groups (id, name, emoji, tagline, city_slug)`)
  push(`SELECT gen_random_uuid(), ${dollarQuote('San Diego', 'ag')}, '🌊', ${dollarQuote('SoCal favorites, curated for you', 'agt')}, 'san-diego'`)
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.audience_groups WHERE city_slug = 'san-diego' AND name = 'San Diego');`)
  push(``)

  // ── curated_lists + curated_list_metros ──
  push(`-- ── 5. curated_lists — exactly 2: the permanent San Diego catalog, and the isolated Tijuana cross-border list. NOT dumping all ${allRecords.length} items into arbitrary seasonal/themed lists (per explicit instruction) — additional themed curation is a later, deliberate pass. Both is_active=false (staged). curated_list_metros (not the legacy city_slug column) is the real visibility mechanism. ──`)
  push(`INSERT INTO public.curated_lists (id, title, tagline, description, slug, city_slug, audience_group_id, is_active, is_featured)`)
  push(
    `SELECT gen_random_uuid(), ${dollarQuote('San Diego', 'cl1t')}, ${dollarQuote('Every verified San Diego experience', 'cl1tg')}, ${dollarQuote('The permanent, complete San Diego catalog.', 'cl1d')}, 'san-diego-catalog', 'san-diego', (SELECT id FROM public.audience_groups WHERE city_slug = 'san-diego' AND name = 'San Diego'), false, false`
  )
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.curated_lists WHERE slug = 'san-diego-catalog');`)
  push(``)
  push(`INSERT INTO public.curated_lists (id, title, tagline, description, slug, city_slug, audience_group_id, is_active, is_featured)`)
  push(
    `SELECT gen_random_uuid(), ${dollarQuote('San Diego Cross-Border: Tijuana', 'cl2t')}, ${dollarQuote('Food, culture, and nightlife just across the border', 'cl2tg')}, ${dollarQuote('A small, intentional set of Tijuana, Mexico experiences for San Diego visitors crossing the border — explicitly outside the United States; account for border-crossing practicality before you go.', 'cl2d')}, 'san-diego-tijuana-extension', 'san-diego', (SELECT id FROM public.audience_groups WHERE city_slug = 'san-diego' AND name = 'San Diego'), false, false`
  )
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension');`)
  push(``)
  push(`INSERT INTO public.curated_list_metros (id, curated_list_id, city_slug)`)
  push(`SELECT gen_random_uuid(), (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog'), 'san-diego'`)
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.curated_list_metros WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog') AND city_slug = 'san-diego');`)
  push(``)
  push(`INSERT INTO public.curated_list_metros (id, curated_list_id, city_slug)`)
  push(`SELECT gen_random_uuid(), (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension'), 'san-diego'`)
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.curated_list_metros WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension') AND city_slug = 'san-diego');`)
  push(``)

  // ── curated_list_items ──
  push(`-- ── 6. curated_list_items — San Diego's ${sdRecords.length} items into the main catalog list, Tijuana's ${tjRecords.length} into its own isolated list. Never mixed. ──`)
  sdRecords.forEach((r, i) => {
    push(`INSERT INTO public.curated_list_items (id, curated_list_id, item_id, display_order)`)
    push(
      `SELECT gen_random_uuid(), (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog'), (SELECT id FROM public.items WHERE lower(regexp_replace(btrim(maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(${dollarQuote(r.mapsQuery, 'mq')}), '[^a-zA-Z0-9]+', '', 'g'))), ${i}`
    )
    push(
      `WHERE NOT EXISTS (SELECT 1 FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog') AND item_id = (SELECT id FROM public.items WHERE lower(regexp_replace(btrim(maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(${dollarQuote(r.mapsQuery, 'mq2')}), '[^a-zA-Z0-9]+', '', 'g'))));`
    )
  })
  push(``)
  tjRecords.forEach((r, i) => {
    push(`INSERT INTO public.curated_list_items (id, curated_list_id, item_id, display_order)`)
    push(
      `SELECT gen_random_uuid(), (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension'), (SELECT id FROM public.items WHERE lower(regexp_replace(btrim(maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(${dollarQuote(r.mapsQuery, 'mq')}), '[^a-zA-Z0-9]+', '', 'g'))), ${i}`
    )
    push(
      `WHERE NOT EXISTS (SELECT 1 FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension') AND item_id = (SELECT id FROM public.items WHERE lower(regexp_replace(btrim(maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(${dollarQuote(r.mapsQuery, 'mq2')}), '[^a-zA-Z0-9]+', '', 'g'))));`
    )
  })
  push(``)

  // ── featured_experiences bridge card ──
  push(`-- ── 7. featured_experiences — one explicit bridge card on San Diego's home rail linking to the Tijuana list, per Jerry's "make the cross-border nature explicit" requirement. JUDGMENT CALL: copy/title, review before applying. staged inactive. ──`)
  push(`INSERT INTO public.featured_experiences (id, title, subtitle, city, metro_slug, list_id, display_order, active, vibes)`)
  push(
    `SELECT gen_random_uuid(), ${dollarQuote('Cross the Border', 'fe1t')}, ${dollarQuote('Tijuana food, culture & nightlife — just minutes away in Mexico', 'fe1s')}, 'San Diego', 'san-diego', (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension'), 0, false, ARRAY['adventurous','international']::text[]`
  )
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.featured_experiences WHERE list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension'));`)
  push(``)

  // ── postflight ──
  push(`-- ── Postflight ──────────────────────────────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_metro_id uuid;`)
  push(`  v_neighborhood_count int;`)
  push(`  v_sd_item_count int;`)
  push(`  v_tj_item_count int;`)
  push(`BEGIN`)
  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego';`)
  push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'Postflight failed: san-diego metro_areas row missing.'; END IF;`)
  push(`  SELECT count(*) INTO v_neighborhood_count FROM public.neighborhoods WHERE metro_id = v_metro_id;`)
  push(`  IF v_neighborhood_count <> ${geo.length} THEN RAISE EXCEPTION 'Postflight failed: expected % neighborhoods, found %.', ${geo.length}, v_neighborhood_count; END IF;`)
  push(`  SELECT count(*) INTO v_sd_item_count FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog');`)
  push(`  IF v_sd_item_count <> ${sdRecords.length} THEN RAISE EXCEPTION 'Postflight failed: expected % San Diego catalog items, found %.', ${sdRecords.length}, v_sd_item_count; END IF;`)
  push(`  SELECT count(*) INTO v_tj_item_count FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension');`)
  push(`  IF v_tj_item_count <> ${tjRecords.length} THEN RAISE EXCEPTION 'Postflight failed: expected % Tijuana items, found %.', ${tjRecords.length}, v_tj_item_count; END IF;`)
  push(`END $$;`)
  push(``)
  push(`COMMIT;`)
  push(``)
  push(`-- Absolute boundary (per docs/metro-launch-playbook.md Phase 6): do NOT flip`)
  push(`-- metro_areas.is_active=true or any curated_lists.is_active=true as part of applying`)
  push(`-- this file. That is the deliberate, separate launch trigger — a later step, once`)
  push(`-- visual assets/QA/season are ready, not a side effect of running this migration.`)

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-catalog-foundation-${new Date().toISOString().slice(0, 10)}.sql`
  writeFileSync(outPath, lines.join('\n'))
  console.error(`Wrote ${outPath}`)
  console.error(`${geo.length} neighborhoods, ${allRecords.length} items (${sdRecords.length} SD + ${tjRecords.length} TJ), 2 curated_lists, 1 audience_group, 1 featured_experience.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
