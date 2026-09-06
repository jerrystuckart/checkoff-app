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
// Calls agent-service/playbooks/metroCatalog.ts's single consolidated
// runIntakePipeline() — the SAME function scripts/metro-catalog-dry-run.ts
// calls — so the rows this file INSERTs are always exactly the rows the
// dry-run report's gates were evaluated against (San Diego catalog SQL
// review, 2026-09-06: a prior version let these drift).
//
// Architecture (Jerry's explicit decision, 2026-09-06): Tijuana is
// NOT its own metro_areas row — it's a cross-border extension, modeled
// as neighborhoods under San Diego's own metro_id, isolated into its
// own dedicated curated list (never mixed into the main San Diego
// catalog list), with Mexico geography preserved explicitly in each
// item's maps_query text.
//
// STAGING SAFETY (San Diego catalog SQL review, 2026-09-06): items are
// inserted with is_active=false, NOT true. Denver's real intake used
// `true` at insert time, relying on metro_areas.is_active=false alone
// for invisibility — but lib/useNearby.js's fetchItems() has NO metro
// filter at all (it queries ALL active, non-universal items with a
// neighborhood, across every metro combined, then filters by GPS radius
// client-side). An is_active=true item is therefore globally
// discoverable via Nearby the moment it's inserted, regardless of
// metro_areas.is_active — this genuinely deviates from the historical
// convention on Jerry's explicit instruction, because that convention
// has a real, live exposure. RLS gates public read on
// `is_active=true AND is_approved=true`, so is_active=false alone fully
// hides these rows everywhere (Nearby included) until a separate,
// later activation step flips them — see the companion activation
// snippet noted at the end of the generated file.
//
// Usage: npx tsx scripts/generate-san-diego-catalog-sql.ts

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { DbPlaybookRunStore } from '../agent-service/specialists/dbPlaybookRunStore'
import { playbookRunId } from '../agent-service/specialists/playbookRun'
import { classifyCategory } from '../agent-service/playbooks/categoryNormalization'
import { runIntakePipeline, buildFeaturedExperienceBridgeCard, validateFeaturedExperienceBridgeCard, type MetroCatalogCandidate, type ItemIntakeRecord } from '../agent-service/playbooks/metroCatalog'
import { CANONICAL_NEIGHBORHOODS, NEIGHBORHOOD_ALIASES, MEXICO_NEIGHBORHOODS, SAN_DIEGO_GENERIC_PLACE_WORDS } from './metroCatalogSanDiegoConfig'
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

interface FinalRecord extends ItemIntakeRecord {
  isMexico: boolean
}

async function buildFinalRecords(projectId: string, existingProductionMapsQueries: string[]): Promise<{ records: FinalRecord[]; gates: ReturnType<typeof runIntakePipeline>['gates']; candidateCount: number }> {
  const candidates = await loadCandidates(projectId)
  const result = runIntakePipeline({
    candidates,
    existingProductionMapsQueries,
    canonicalNeighborhoods: CANONICAL_NEIGHBORHOODS,
    neighborhoodAliases: NEIGHBORHOOD_ALIASES,
    mexicoNeighborhoods: MEXICO_NEIGHBORHOODS,
    additionalGenericWords: SAN_DIEGO_GENERIC_PLACE_WORDS,
  })
  const records = result.finalRecords.map((r) => {
    const isMexico = MEXICO_NEIGHBORHOODS.has(r.neighborhoodName ?? '')
    let mapsQuery = r.mapsQuery
    if (isMexico && !/tijuana/i.test(mapsQuery)) mapsQuery = `${mapsQuery}, Tijuana, Mexico`
    return { ...r, mapsQuery, isMexico }
  })
  return { records, gates: result.gates, candidateCount: candidates.length }
}

async function main() {
  const geo = JSON.parse(readFileSync('scripts/output/san-diego-neighborhoods-with-radii.json', 'utf8')) as Array<{ name: string; lat: number; lng: number; ring0RadiusM: number; ring1RadiusM: number; ring2RadiusM: number }>
  const existingProductionMapsQueries = await fetchExistingProductionMapsQueries()

  const sd = await buildFinalRecords('san-diego', existingProductionMapsQueries)
  const tj = await buildFinalRecords('san-diego-tijuana-extension', existingProductionMapsQueries)

  console.error('=== Final-output gate check (must ALL pass before any SQL is written) ===')
  let allPass = true
  for (const [label, r] of [['San Diego', sd], ['Tijuana', tj]] as const) {
    for (const g of r.gates) {
      console.error(`  [${label}] ${g.key}: ${g.verdict} — ${g.reason}`)
      if (g.verdict !== 'PASS') allPass = false
    }
  }
  if (!allPass) {
    console.error('\nOne or more final-output gates FAILED — refusing to generate SQL. Fix the pipeline, not the output.')
    process.exitCode = 1
    return
  }
  console.error('\nAll final-output gates PASS. Generating SQL...\n')

  const sdRecords = sd.records
  const tjRecords = tj.records
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
  push(`-- STAGING SAFETY (deliberate deviation from Denver's historical convention — see`)
  push(`-- this file's own header comment in the repo for the full explanation): every item`)
  push(`-- below is inserted with is_active=false, NOT true. lib/useNearby.js's Nearby query`)
  push(`-- has no metro filter at all, so an is_active=true item would be globally`)
  push(`-- discoverable immediately, regardless of metro_areas.is_active — RLS's`)
  push(`-- is_active=true AND is_approved=true read policy means is_active=false alone fully`)
  push(`-- hides these rows everywhere until a separate, later, narrowly-scoped activation`)
  push(`-- statement (matched by this exact maps_query set) flips them at real launch time.`)
  push(`-- metro_areas.is_active=false and every curated_lists row is_active=false throughout`)
  push(`-- too. Flipping any of these to true is the deliberate, separate launch trigger.`)
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
    const isMexico = MEXICO_NEIGHBORHOODS.has(n.name)
    const state = isMexico ? 'Baja California, Mexico' : 'CA'
    push(`INSERT INTO public.neighborhoods (id, metro_id, name, slug, state, center_geo, ring_0_radius_m, ring_1_radius_m, ring_2_radius_m, is_active)`)
    push(
      `SELECT gen_random_uuid(), (SELECT id FROM public.metro_areas WHERE slug = 'san-diego'), ${dollarQuote(n.name, 'nb')}, '${slugify(n.name)}', ${dollarQuote(state, 'st')}, ST_SetSRID(ST_MakePoint(${n.lng}, ${n.lat}), 4326)::geography, ${n.ring0RadiusM}, ${n.ring1RadiusM}, ${n.ring2RadiusM}, true`
    )
    push(`WHERE NOT EXISTS (SELECT 1 FROM public.neighborhoods nb JOIN public.metro_areas m ON m.id = nb.metro_id WHERE m.slug = 'san-diego' AND nb.name = ${dollarQuote(n.name, 'nb2')});`)
  }
  push(``)

  // ── items ──
  push(`-- ── 3. items (${allRecords.length}: ${sdRecords.length} San Diego + ${tjRecords.length} Tijuana). Category via name subquery (no invented UUIDs). is_active=false — see STAGING SAFETY above. Duplicate check re-verified inline (normalized maps_query, global) even though the pipeline already confirmed zero collisions, since production may have changed since. maps_lat/maps_lng intentionally NULL — see header. ──`)
  for (const r of allRecords) {
    push(`INSERT INTO public.items (body, category_id, checkin_type, is_universal, is_active, is_approved, neighborhood_id, maps_query, is_recurring, difficulty, photo_required, has_alcohol)`)
    push(`SELECT`)
    push(`  ${dollarQuote(r.body, 'bd')},`)
    push(`  (SELECT id FROM public.categories WHERE name = ${dollarQuote(r.dbCategory, 'cat')}),`)
    push(`  'tap', false, false, true,`)
    push(`  (SELECT nb.id FROM public.neighborhoods nb JOIN public.metro_areas m ON m.id = nb.metro_id WHERE m.slug = 'san-diego' AND nb.name = ${dollarQuote(r.neighborhoodName!, 'nb')}),`)
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
  // Built via the reusable buildFeaturedExperienceBridgeCard() (not inlined
  // here) after a production failure: the prior version of this INSERT
  // omitted deep_link (NOT NULL, no usable default — the transaction failed
  // and rolled back) and never set state explicitly, which silently pulled
  // in a stale 'AZ' default left over from the table's original Phoenix
  // build. See the long comment on that function for the full audit.
  const bridgeCard = buildFeaturedExperienceBridgeCard({
    title: 'Cross the Border',
    subtitle: 'Tijuana food, culture & nightlife — just minutes away in Mexico',
    city: 'San Diego',
    state: 'CA',
    metroSlug: 'san-diego',
    curatedListSlug: 'san-diego-tijuana-extension',
    vibes: ['adventurous', 'international'],
    displayOrder: 0,
    active: false,
  })
  const bridgeCardProblems = validateFeaturedExperienceBridgeCard(bridgeCard)
  if (bridgeCardProblems.length > 0) {
    throw new Error(`Refusing to generate SQL: featured_experiences bridge card failed validation: ${bridgeCardProblems.join('; ')}`)
  }
  push(`-- ── 7. featured_experiences — one explicit bridge card on San Diego's home rail linking to the Tijuana list, per Jerry's "make the cross-border nature explicit" requirement. Every column below is explicit (never left to a table default — see 2026-09 AZ/deep_link production incident). JUDGMENT CALL: copy/title, review before applying. staged inactive. ──`)
  push(`INSERT INTO public.featured_experiences (id, title, subtitle, city, state, metro_slug, deep_link, list_id, display_order, active, vibes)`)
  push(
    `SELECT gen_random_uuid(), ${dollarQuote(bridgeCard.title, 'fe1t')}, ${dollarQuote(bridgeCard.subtitle, 'fe1s')}, ${dollarQuote(bridgeCard.city, 'fe1c')}, ${dollarQuote(bridgeCard.state, 'fe1st')}, ${dollarQuote(bridgeCard.metroSlug, 'fe1ms')}, ${dollarQuote(bridgeCard.deepLink, 'fe1dl')}, (SELECT id FROM public.curated_lists WHERE slug = ${dollarQuote(bridgeCard.curatedListSlug, 'fe1ls')}), ${bridgeCard.displayOrder}, ${bridgeCard.active}, ARRAY[${bridgeCard.vibes.map((v) => dollarQuote(v, 'fe1v')).join(', ')}]::text[]`
  )
  push(`WHERE NOT EXISTS (SELECT 1 FROM public.featured_experiences WHERE list_id = (SELECT id FROM public.curated_lists WHERE slug = ${dollarQuote(bridgeCard.curatedListSlug, 'fe1ls2')}));`)
  push(``)

  // ── postflight ──
  push(`-- ── Postflight ──────────────────────────────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_metro_id uuid;`)
  push(`  v_neighborhood_count int;`)
  push(`  v_sd_item_count int;`)
  push(`  v_tj_item_count int;`)
  push(`  v_active_item_count int;`)
  push(`  v_bridge_deep_link text;`)
  push(`  v_bridge_state text;`)
  push(`BEGIN`)
  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego';`)
  push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'Postflight failed: san-diego metro_areas row missing.'; END IF;`)
  push(`  SELECT count(*) INTO v_neighborhood_count FROM public.neighborhoods WHERE metro_id = v_metro_id;`)
  push(`  IF v_neighborhood_count <> ${geo.length} THEN RAISE EXCEPTION 'Postflight failed: expected % neighborhoods, found %.', ${geo.length}, v_neighborhood_count; END IF;`)
  push(`  SELECT count(*) INTO v_sd_item_count FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog');`)
  push(`  IF v_sd_item_count <> ${sdRecords.length} THEN RAISE EXCEPTION 'Postflight failed: expected % San Diego catalog items, found %.', ${sdRecords.length}, v_sd_item_count; END IF;`)
  push(`  SELECT count(*) INTO v_tj_item_count FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension');`)
  push(`  IF v_tj_item_count <> ${tjRecords.length} THEN RAISE EXCEPTION 'Postflight failed: expected % Tijuana items, found %.', ${tjRecords.length}, v_tj_item_count; END IF;`)
  push(`  SELECT count(*) INTO v_active_item_count FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.is_active = true;`)
  push(`  IF v_active_item_count <> 0 THEN RAISE EXCEPTION 'Postflight failed: % San Diego/Tijuana item(s) are is_active=true — staging safety violated, these would be globally discoverable via Nearby right now.', v_active_item_count; END IF;`)
  push(`  SELECT deep_link, state INTO v_bridge_deep_link, v_bridge_state FROM public.featured_experiences WHERE list_id = (SELECT id FROM public.curated_lists WHERE slug = ${dollarQuote(bridgeCard.curatedListSlug, 'fe1pf')});`)
  push(`  IF v_bridge_deep_link IS NULL THEN RAISE EXCEPTION 'Postflight failed: featured_experiences bridge card has a null deep_link.'; END IF;`)
  push(`  IF v_bridge_state IS DISTINCT FROM ${dollarQuote(bridgeCard.state, 'fe1pfst')} THEN RAISE EXCEPTION 'Postflight failed: featured_experiences bridge card state is %, expected %.', v_bridge_state, ${dollarQuote(bridgeCard.state, 'fe1pfst2')}; END IF;`)
  push(`END $$;`)
  push(``)
  push(`COMMIT;`)
  push(``)
  push(`-- Absolute boundary (per docs/metro-launch-playbook.md Phase 6): do NOT flip`)
  push(`-- metro_areas.is_active=true, any curated_lists.is_active=true, or any of these`)
  push(`-- items' is_active=true as part of applying this file. Activation is a deliberate,`)
  push(`-- separate, later step — a narrowly-scoped follow-up statement matched by this`)
  push(`-- exact batch's maps_query set, run once visual assets/QA/season are ready, not a`)
  push(`-- side effect of running this migration.`)

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
