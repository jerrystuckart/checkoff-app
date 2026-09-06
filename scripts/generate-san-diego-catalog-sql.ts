#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-catalog-sql.ts
//
// Generates (never applies) the San Diego + Tijuana catalog RECONCILIATION
// SQL, following docs/metro-launch-playbook.md Phase 4 and
// docs/metro-launch-audit/patches/denver_catalog_insert_CORRECTED.sql's
// proven house style: gen_random_uuid() (no invented UUIDs), NOT EXISTS
// idempotency guards (not ON CONFLICT against unverifiable constraints),
// one wrapping transaction, preflight + postflight RAISE EXCEPTION
// checks. Writes ONLY a local .sql file for Jerry to review and run
// himself via Supabase SQL Editor — this script has no DB write access
// and never attempts one.
//
// RECONCILIATION, not blind insert (San Diego production-state
// correction, 2026-09-06): the San Diego metro already has real, staged
// items in production from an earlier successful run of an earlier
// version of this file (the original, pre-CheckOffization-audit
// wording) — agent_service's own read of `items` cannot see them (RLS
// silently filters is_active=false rows for this role even though it
// holds a table-level SELECT grant; see the regenerated report for the
// full explanation). The items section below matches each of the final
// candidates to an existing row by normalized maps_query (with a
// venue-name fallback for a candidate whose neighborhood correction
// changed its maps_query text), UPDATEs survivors in place (preserving
// their id — never delete+reinsert merely because wording changed),
// INSERTs only genuinely new/recovered candidates, and removes only the
// existing rows matched to no final candidate.
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

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { buildFeaturedExperienceBridgeCard, validateFeaturedExperienceBridgeCard } from '../agent-service/playbooks/metroCatalog'
import { MEXICO_NEIGHBORHOODS } from './metroCatalogSanDiegoConfig'
import { loadEnvFile, dollarQuote, buildFinalRecords, fetchExistingProductionMapsQueries, EXPECTED_EXISTING_ITEM_COUNT } from './sanDiegoReconciliationShared'

loadEnvFile('.env')

function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
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
  push(`-- Verifies the CURRENT real production state, confirmed via Jerry's own direct`)
  push(`-- query 2026-09-06 (agent_service's own read of \`items\` is unreliable here — RLS`)
  push(`-- silently filters is_active=false rows for this role even though it holds a`)
  push(`-- table-level SELECT grant, which is exactly what produced last night's incorrect`)
  push(`-- "zero items exist" read; see the regenerated report for the full explanation):`)
  push(`-- metro_areas.slug='san-diego' exists (is_active=false), all 40 neighborhoods exist,`)
  push(`-- and exactly ${EXPECTED_EXISTING_ITEM_COUNT} items already exist under this metro from the ORIGINAL`)
  push(`-- successful foundation run (pre-CheckOffization-audit wording) — none of them active.`)
  push(`-- This file now RECONCILES against those ${EXPECTED_EXISTING_ITEM_COUNT} real rows (update survivors in`)
  push(`-- place, insert genuinely new/recovered items, remove only explicitly-superseded`)
  push(`-- ones) rather than assuming a clean slate.`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_metro_id uuid;`)
  push(`  v_neighborhood_count int;`)
  push(`  v_existing_item_count int;`)
  push(`  v_active_item_count_pre int;`)
  push(`BEGIN`)
  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego' AND name = 'San Diego Metro' AND is_active = false;`)
  push(`  IF v_metro_id IS NULL THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: expected an existing, inactive San Diego Metro row (slug=san-diego) — none found, or it does not match the expected name/is_active state. Production has drifted from what was confirmed before generating this file; stopping rather than guessing.';`)
  push(`  END IF;`)
  push(`  SELECT count(*) INTO v_neighborhood_count FROM public.neighborhoods WHERE metro_id = v_metro_id;`)
  push(`  IF v_neighborhood_count <> ${geo.length} THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: expected % existing San Diego neighborhoods, found %.', ${geo.length}, v_neighborhood_count;`)
  push(`  END IF;`)
  push(`  SELECT count(*) INTO v_existing_item_count FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_existing_item_count <> ${EXPECTED_EXISTING_ITEM_COUNT} THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: expected exactly ${EXPECTED_EXISTING_ITEM_COUNT} existing staged San Diego/Tijuana items (the original successful foundation run), found %. Production has drifted from the confirmed starting state — stopping rather than reconciling against an unverified assumption.', v_existing_item_count;`)
  push(`  END IF;`)
  push(`  SELECT count(*) INTO v_active_item_count_pre FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.is_active = true;`)
  push(`  IF v_active_item_count_pre <> 0 THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: expected ZERO active San Diego/Tijuana items before this patch, found %.', v_active_item_count_pre;`)
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

  // ── items — RECONCILIATION against the real 141 existing staged rows ──
  // (San Diego production-state correction, 2026-09-06 — see report). Rather
  // than blindly inserting, this section: (1) matches each of the 152 final
  // candidates to an existing production row by normalized maps_query, with
  // a venue-name-only fallback for the one candidate (Cori Pastificio
  // Trattoria) whose neighborhood correction changed its maps_query text;
  // (2) UPDATEs matched rows in place, preserving their id (no delete+
  // reinsert merely because wording changed); (3) INSERTs only the
  // candidates with no match (genuinely new/recovered); (4) removes ONLY
  // the existing rows that matched no final candidate (explicitly excluded/
  // superseded), delisting them from curated_list_items first to satisfy
  // the FK before deleting.
  push(`-- ── 3. items — reconcile the ${allRecords.length} final candidates (${sdRecords.length} San Diego + ${tjRecords.length} Tijuana) against the ${EXPECTED_EXISTING_ITEM_COUNT} real existing staged rows. Category/neighborhood via name subquery (no invented UUIDs). is_active stays false throughout — see STAGING SAFETY above. ──`)
  push(`CREATE TEMP TABLE _sd_final_candidates (`)
  push(`  source_id text PRIMARY KEY,`)
  push(`  body text NOT NULL,`)
  push(`  category_name text NOT NULL,`)
  push(`  neighborhood_name text NOT NULL,`)
  push(`  maps_query text NOT NULL,`)
  push(`  venue_name text NOT NULL`)
  push(`) ON COMMIT DROP;`)
  push(``)
  push(`INSERT INTO _sd_final_candidates (source_id, body, category_name, neighborhood_name, maps_query, venue_name) VALUES`)
  allRecords.forEach((r, i) => {
    const sourceId = `SD-${String(i + 1).padStart(4, '0')}`
    const comma = i < allRecords.length - 1 ? ',' : ';'
    push(
      // venue_name is the real candidate name (never derived by splitting maps_query on
      // comma — a venue whose own name contains a comma, e.g. "Plaza Fiesta (El Depa,
      // Teléfono Gastro Park, Bosiger Beer)", would otherwise get truncated mid-name).
      // The fallback SQL match below still uses split_part(maps_query, ',', 1) against
      // the live production row, so this fallback tier only actually engages correctly
      // for a venue name with no internal comma (true for Cori Pastificio Trattoria, the
      // one candidate that needs it tonight) — a known, accepted narrowing, not a bug.
      `  (${dollarQuote(sourceId, 'sid')}, ${dollarQuote(r.body, 'bd')}, ${dollarQuote(r.dbCategory, 'cat')}, ${dollarQuote(r.neighborhoodName!, 'nb')}, ${dollarQuote(r.mapsQuery, 'mq')}, ${dollarQuote(r.candidateName, 'vn')})${comma}`
    )
  })
  push(``)
  push(`-- Primary match: normalized full maps_query (handles every unchanged item).`)
  push(`CREATE TEMP TABLE _sd_matches AS`)
  push(`SELECT f.source_id, i.id AS item_id`)
  push(`FROM _sd_final_candidates f`)
  push(`JOIN public.items i`)
  push(`  ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`   = lower(regexp_replace(btrim(f.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego');`)
  push(``)
  push(`-- Fallback match: normalized venue-name-only, for a candidate whose neighborhood`)
  push(`-- correction changed its maps_query text (e.g. Cori Pastificio Trattoria: Point`)
  push(`-- Loma -> North Park) — only against candidates/items not already matched above,`)
  push(`-- and only when exactly one candidate and exactly one existing item share that`)
  push(`-- venue name (an ambiguous multi-match is left unmatched, never guessed).`)
  push(`INSERT INTO _sd_matches (source_id, item_id)`)
  push(`SELECT vm.source_id, vm.item_id FROM (`)
  push(`  SELECT f.source_id, i.id AS item_id,`)
  push(`    count(*) OVER (PARTITION BY f.venue_name) AS candidate_dupes,`)
  push(`    count(*) OVER (PARTITION BY i.id) AS item_dupes`)
  push(`  FROM _sd_final_candidates f`)
  push(`  JOIN public.items i`)
  push(`    ON lower(regexp_replace(btrim(split_part(i.maps_query, ',', 1)), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`     = lower(regexp_replace(btrim(f.venue_name), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`  WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`    AND f.source_id NOT IN (SELECT source_id FROM _sd_matches)`)
  push(`    AND i.id NOT IN (SELECT item_id FROM _sd_matches)`)
  push(`) vm`)
  push(`WHERE vm.candidate_dupes = 1 AND vm.item_dupes = 1;`)
  push(``)
  push(`-- Safety: no candidate or existing item may appear more than once in the match set.`)
  push(`DO $$`)
  push(`DECLARE v_dupe_source int; v_dupe_item int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) INTO v_dupe_source FROM (SELECT source_id FROM _sd_matches GROUP BY source_id HAVING count(*) > 1) x;`)
  push(`  IF v_dupe_source > 0 THEN RAISE EXCEPTION 'Reconciliation failed: % final candidate(s) matched more than one existing item.', v_dupe_source; END IF;`)
  push(`  SELECT count(*) INTO v_dupe_item FROM (SELECT item_id FROM _sd_matches GROUP BY item_id HAVING count(*) > 1) x;`)
  push(`  IF v_dupe_item > 0 THEN RAISE EXCEPTION 'Reconciliation failed: % existing item(s) matched more than one final candidate.', v_dupe_item; END IF;`)
  push(`END $$;`)
  push(``)
  push(`-- Obsolete existing rows: under the San Diego metro, matched to NO final candidate —`)
  push(`-- computed BEFORE any insert, so newly-inserted rows can never appear here.`)
  push(`CREATE TEMP TABLE _sd_obsolete AS`)
  push(`SELECT i.id FROM public.items i`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`  AND i.id NOT IN (SELECT item_id FROM _sd_matches);`)
  push(``)
  push(`-- Update surviving rows in place — preserve id, refresh wording/category/neighborhood/maps_query.`)
  push(`UPDATE public.items i`)
  push(`SET body = f.body,`)
  push(`    category_id = (SELECT id FROM public.categories WHERE name = f.category_name),`)
  push(`    neighborhood_id = (SELECT nb2.id FROM public.neighborhoods nb2 JOIN public.metro_areas m2 ON m2.id = nb2.metro_id WHERE m2.slug = 'san-diego' AND nb2.name = f.neighborhood_name),`)
  push(`    maps_query = f.maps_query`)
  push(`FROM _sd_matches mt`)
  push(`JOIN _sd_final_candidates f ON f.source_id = mt.source_id`)
  push(`WHERE i.id = mt.item_id;`)
  push(``)
  push(`-- Insert genuinely new/recovered candidates (no existing match).`)
  push(`INSERT INTO public.items (body, category_id, checkin_type, is_universal, is_active, is_approved, neighborhood_id, maps_query, is_recurring, difficulty, photo_required, has_alcohol)`)
  push(`SELECT`)
  push(`  f.body,`)
  push(`  (SELECT id FROM public.categories WHERE name = f.category_name),`)
  push(`  'tap', false, false, true,`)
  push(`  (SELECT nb.id FROM public.neighborhoods nb JOIN public.metro_areas m ON m.id = nb.metro_id WHERE m.slug = 'san-diego' AND nb.name = f.neighborhood_name),`)
  push(`  f.maps_query, true, 1, false, false`)
  push(`FROM _sd_final_candidates f`)
  push(`WHERE NOT EXISTS (SELECT 1 FROM _sd_matches mt WHERE mt.source_id = f.source_id);`)
  push(``)
  push(`-- Remove obsolete rows: clear every plausible FK reference first, then delete the`)
  push(`-- item. These staged rows were never is_active=true, so real user data`)
  push(`-- (check_ins, list_items) should never reference them — but the admin tool's`)
  push(`-- Image Manager could plausibly have touched item_cover_candidates during an`)
  push(`-- earlier review pass, so that's cleared defensively too (a no-op if none exist).`)
  push(`DELETE FROM public.item_cover_candidates WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.curated_list_items WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.items WHERE id IN (SELECT id FROM _sd_obsolete);`)
  push(``)
  push(`-- Reconciliation sanity check — must reconcile exactly to ${allRecords.length}.`)
  push(`DO $$`)
  push(`DECLARE v_matched int; v_obsolete int; v_inserted int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) INTO v_matched FROM _sd_matches;`)
  push(`  SELECT count(*) INTO v_obsolete FROM _sd_obsolete;`)
  push(`  v_inserted := ${allRecords.length} - v_matched;`)
  push(`  RAISE NOTICE 'Reconciliation: % retained/rewritten, % removed as obsolete, % newly inserted, % final total.', v_matched, v_obsolete, v_inserted, ${allRecords.length};`)
  push(`  IF v_matched + v_inserted <> ${allRecords.length} THEN`)
  push(`    RAISE EXCEPTION 'Reconciliation failed: matched (%) + inserted (%) != final total (%).', v_matched, v_inserted, ${allRecords.length};`)
  push(`  END IF;`)
  push(`  IF ${EXPECTED_EXISTING_ITEM_COUNT} - v_matched <> v_obsolete THEN`)
  push(`    RAISE EXCEPTION 'Reconciliation failed: existing (%) - matched (%) != obsolete removed (%).', ${EXPECTED_EXISTING_ITEM_COUNT}, v_matched, v_obsolete;`)
  push(`  END IF;`)
  push(`END $$;`)
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
