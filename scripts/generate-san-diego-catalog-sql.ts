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
// SELF-CERTIFYING, FAIL-CLOSED (2026-09-06, Jerry's explicit requirement):
// the same matching-integrity guards the read-only audit reports as
// 5a/5b/5c/5h/5d/5e/5f are run as hard RAISE EXCEPTION checks INSIDE this
// file's own transaction — once immediately before the UPDATE/INSERT/
// DELETE (pre-mutation), and again, identically, inside postflight
// (post-mutation) — via pushIntegrityCertification() below. Any violation
// aborts the whole transaction before (or after) mutation; nothing is
// left to Jerry's manual read of a separate audit file anymore. The
// entire file remains one transaction (BEGIN...COMMIT) so any preflight,
// pre-mutation, or postflight failure rolls back everything.
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
// ITEM ACTIVE-STATE POLICY (corrected 2026-09-06 per Jerry's explicit
// instruction, superseding this file's earlier "is_active=false always"
// stance): Jerry has intentionally allowed San Diego items to be
// is_active=true during this build/testing phase — there is no real user
// exposure risk right now (no marketing push, no seasonal/themed lists
// pointing at this metro yet) and Nearby-level discoverability of a
// build-in-progress catalog is an accepted, deliberate risk, not an
// incident. Two separate rules follow from that:
//   (1) RETAINED rows (matched to an existing production row) are never
//       touched on is_active by this patch's UPDATE — whatever active
//       state a row already has in production is preserved exactly.
//       This file makes no assumption about what that state currently is.
//   (2) GENUINELY NEW/RECOVERED rows (no existing match) are INSERTed
//       with is_active=true, matching Jerry's current San Diego intake
//       instruction — same as Denver's historical convention.
// metro_areas.is_active and every curated_lists row stay is_active=false
// regardless — list/browse-level discovery (and any future featured/
// themed surfacing) remains a separate, deliberate activation step. Item
// row activity and metro/list activity are two independent switches; this
// file only ever moves the first one, and only for newly inserted rows.
//
// Usage: npx tsx scripts/generate-san-diego-catalog-sql.ts

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { buildFeaturedExperienceBridgeCard, validateFeaturedExperienceBridgeCard } from '../agent-service/playbooks/metroCatalog'
import { MEXICO_NEIGHBORHOODS } from './metroCatalogSanDiegoConfig'
import { loadEnvFile, dollarQuote, buildFinalRecords, fetchExistingProductionMapsQueries, EXPECTED_EXISTING_ITEM_COUNT, fallbackVenueMatchCondition } from './sanDiegoReconciliationShared'

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

  /**
   * Self-certifying, fail-closed integrity block — the same guards the
   * read-only audit reports as 5a/5b/5c/5h/5d/5e/5f, run here as hard
   * RAISE EXCEPTION checks INSIDE this file's own transaction, not just
   * reported for manual inspection. Emitted TWICE with identical guard
   * logic (pre-mutation, right before the UPDATE/INSERT/DELETE; and
   * post-mutation, inside postflight) so the postflight re-verification
   * is a real rerun of the same checks, not a different, weaker set.
   * `totalCheck` differs by phase: pre-mutation asserts the CURRENT
   * production count equals the confirmed existing count (143);
   * post-mutation asserts the FINAL count equals the target (149).
   * 5c/5h are pre-mutation-only guards — post-mutation, every "should
   * this candidate already exist?" question is moot (the INSERT already
   * ran), so those two are replaced by 5i: every final candidate must
   * resolve to exactly one live item via the exact maps_query match
   * (see the 2026-09-06 fix — 5c/5h rerun verbatim post-mutation
   * produced 33 false violations, since a freshly-inserted "new"
   * candidate trivially satisfies its own fallback venue-name EXISTS
   * check once its row exists).
   */
  function pushIntegrityCertification(phase: 'PRE-MUTATION' | 'POST-MUTATION') {
    const totalLabel = phase === 'PRE-MUTATION' ? 'current_total' : 'final_total'
    const totalExpected = phase === 'PRE-MUTATION' ? EXPECTED_EXISTING_ITEM_COUNT : allRecords.length
    push(`-- ── ${phase} INTEGRITY CERTIFICATION — every guard below must pass or this DO block`)
    push(`-- RAISE EXCEPTIONs before any further statement runs, rolling back the whole`)
    push(`-- transaction (per Jerry's "self-certifying, fail-closed" requirement, 2026-09-06).`)
    push(`-- Same guard logic as the read-only audit's Report 5 (5a/5b/5c/5h/5d/5e/5f).`)
    push(`DO $$`)
    push(`DECLARE`)
    push(`  v_${totalLabel} int;`)
    push(`  v_retained int;`)
    push(`  v_obsolete int;`)
    push(`  v_target int;`)
    push(`  v_new int;`)
    push(`  v_violation_count int;`)
    push(`BEGIN`)
    push(`  SELECT count(*) INTO v_${totalLabel} FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego');`)
    push(`  IF v_${totalLabel} <> ${totalExpected} THEN`)
    push(`    RAISE EXCEPTION '[${phase}] Certification failed: ${totalLabel} expected ${totalExpected}, found %.', v_${totalLabel};`)
    push(`  END IF;`)
    push(`  SELECT count(*) INTO v_retained FROM _sd_matches;`)
    push(`  SELECT count(*) INTO v_obsolete FROM _sd_obsolete;`)
    push(`  SELECT count(*) INTO v_target FROM _sd_final_candidates;`)
    push(`  v_new := v_target - v_retained;`)
    push(`  IF v_target <> ${allRecords.length} THEN`)
    push(`    RAISE EXCEPTION '[${phase}] Certification failed: target total expected ${allRecords.length}, found %.', v_target;`)
    push(`  END IF;`)
    push(`  IF ${EXPECTED_EXISTING_ITEM_COUNT} <> v_retained + v_obsolete THEN`)
    push(`    RAISE EXCEPTION '[${phase}] Certification failed: ${EXPECTED_EXISTING_ITEM_COUNT} = retained + obsolete does not hold (retained=%, obsolete=%).', v_retained, v_obsolete;`)
    push(`  END IF;`)
    push(`  IF ${allRecords.length} <> v_retained + v_new THEN`)
    push(`    RAISE EXCEPTION '[${phase}] Certification failed: ${allRecords.length} = retained + new does not hold (retained=%, new=%).', v_retained, v_new;`)
    push(`  END IF;`)
    push(``)
    push(`  -- 5a. One existing item mapped to multiple final candidates.`)
    push(`  SELECT count(*) INTO v_violation_count FROM (SELECT item_id FROM _sd_matches GROUP BY item_id HAVING count(*) > 1) x;`)
    push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5a): % existing item(s) matched more than one final candidate.', v_violation_count; END IF;`)
    push(``)
    push(`  -- 5b. One final candidate mapped to multiple existing items.`)
    push(`  SELECT count(*) INTO v_violation_count FROM (SELECT source_id FROM _sd_matches GROUP BY source_id HAVING count(*) > 1) x;`)
    push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5b): % final candidate(s) matched more than one existing item.', v_violation_count; END IF;`)
    push(``)
    if (phase === 'PRE-MUTATION') {
      // 5c/5h only make sense BEFORE mutation, when "final candidate has no item yet"
      // is a real fact about production. Once the INSERT has run, every genuinely-new
      // candidate now trivially has a matching row (the one just inserted for it), so
      // re-running these same queries post-mutation would flag every new/recovered row
      // as a false "should have matched but didn't" violation — not a real defect. The
      // POST-MUTATION branch below runs the appropriate replacement check (5i) instead.
      push(`  -- 5c. Ambiguous fallback venue-name match (more than one candidate or more than one`)
      push(`  -- existing item shares a venue name and so was correctly excluded from the fallback`)
      push(`  -- match) — a real candidate going unmatched purely from an ambiguous name collision.`)
      push(`  SELECT count(*) INTO v_violation_count FROM (`)
      push(`    SELECT f.source_id, f.venue_name, count(i.id) AS ambiguous_item_matches`)
      push(`    FROM _sd_final_candidates f`)
      push(`    JOIN public.items i`)
      push(`      ON ${fallbackVenueMatchCondition('i', 'f')}`)
      push(`    JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
      push(`    WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
      push(`      AND f.source_id NOT IN (SELECT source_id FROM _sd_matches)`)
      push(`    GROUP BY f.source_id, f.venue_name`)
      push(`    HAVING count(i.id) > 1`)
      push(`  ) x;`)
      push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5c): % final candidate(s) have an ambiguous fallback venue-name match.', v_violation_count; END IF;`)
      push(``)
      push(`  -- 5h. Final candidate with ZERO fallback matches despite a known existing venue identity.`)
      push(`  SELECT count(*) INTO v_violation_count FROM (`)
      push(`    SELECT f.source_id FROM _sd_final_candidates f`)
      push(`    WHERE f.source_id NOT IN (SELECT source_id FROM _sd_matches)`)
      push(`      AND EXISTS (`)
      push(`        SELECT 1 FROM public.items i`)
      push(`        JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
      push(`        WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
      push(`          AND ${fallbackVenueMatchCondition('i', 'f')}`)
      push(`      )`)
      push(`  ) x;`)
      push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5h): % final candidate(s) have a matching existing venue by name but were not captured in _sd_matches.', v_violation_count; END IF;`)
      push(``)
    } else {
      push(`  -- 5i (post-mutation replacement for 5c/5h). Every final candidate must now`)
      push(`  -- resolve, via the exact normalized maps_query match, to EXACTLY ONE live item`)
      push(`  -- row under this metro — whether it was updated in place or just inserted.`)
      push(`  SELECT count(*) INTO v_violation_count FROM (`)
      push(`    SELECT f.source_id, count(i.id) AS match_count`)
      push(`    FROM _sd_final_candidates f`)
      push(`    LEFT JOIN (`)
      push(`      SELECT i2.id, i2.maps_query FROM public.items i2`)
      push(`      JOIN public.neighborhoods nb2 ON nb2.id = i2.neighborhood_id`)
      push(`      WHERE nb2.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
      push(`    ) i ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
      push(`         = lower(regexp_replace(btrim(f.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
      push(`    GROUP BY f.source_id`)
      push(`    HAVING count(i.id) <> 1`)
      push(`  ) x;`)
      push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5i): % final candidate(s) do not resolve to exactly one live item via exact maps_query match.', v_violation_count; END IF;`)
      push(``)
    }
    push(`  -- 5d. Any Tijuana final candidate whose target neighborhood is a California one.`)
    push(`  SELECT count(*) INTO v_violation_count FROM _sd_final_candidates`)
    push(`  WHERE metro_label = 'Tijuana' AND neighborhood_name NOT IN (${[...MEXICO_NEIGHBORHOODS].map((n) => dollarQuote(n, 'mxn')).join(', ')});`)
    push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5d): % Tijuana final candidate(s) target a California neighborhood.', v_violation_count; END IF;`)
    push(``)
    push(`  -- 5e. Any San Diego final candidate whose target neighborhood is a Mexico one.`)
    push(`  SELECT count(*) INTO v_violation_count FROM _sd_final_candidates`)
    push(`  WHERE metro_label = 'San Diego' AND neighborhood_name IN (${[...MEXICO_NEIGHBORHOODS].map((n) => dollarQuote(n, 'mxn2')).join(', ')});`)
    push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5e): % San Diego final candidate(s) target a Mexico neighborhood.', v_violation_count; END IF;`)
    push(``)
    push(`  -- 5f. Any MATCHED row whose live neighborhood.state field is inconsistent with its metro_label.`)
    push(`  SELECT count(*) INTO v_violation_count`)
    push(`  FROM _sd_matches mt`)
    push(`  JOIN _sd_final_candidates f ON f.source_id = mt.source_id`)
    push(`  JOIN public.items i ON i.id = mt.item_id`)
    push(`  JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
    push(`  WHERE (f.metro_label = 'Tijuana' AND nb.state <> 'Baja California, Mexico')`)
    push(`     OR (f.metro_label = 'San Diego' AND nb.state <> 'CA');`)
    push(`  IF v_violation_count > 0 THEN RAISE EXCEPTION '[${phase}] Certification failed (5f): % matched row(s) have a neighborhood.state inconsistent with their metro_label.', v_violation_count; END IF;`)
    push(``)
    push(`  RAISE NOTICE '[${phase}] CERTIFICATION: PASS — ${totalLabel}=%, retained=%, obsolete=%, new=%, target=%.', v_${totalLabel}, v_retained, v_obsolete, v_new, v_target;`)
    push(`END $$;`)
    push(``)
  }

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
  push(`-- ITEM ACTIVE-STATE POLICY (corrected 2026-09-06, Jerry's explicit build-phase`)
  push(`-- instruction): retained/matched rows keep whatever is_active value they already`)
  push(`-- have in production — this patch's UPDATE never touches that column. Genuinely`)
  push(`-- new/recovered rows (no existing match) are inserted is_active=true — there is no`)
  push(`-- real user exposure risk right now, and this is the established San Diego intake`)
  push(`-- behavior during build/testing (same as Denver's historical convention).`)
  push(`-- metro_areas.is_active=false and every curated_lists row is_active=false throughout`)
  push(`-- — list/browse/featured-level discovery stays a separate, deliberate later step,`)
  push(`-- independent of individual item row activity.`)
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
  // Informational only (2026-09-06 correction): items may legitimately already be
  // is_active=true during this build/testing phase per Jerry's explicit instruction —
  // this patch never asserts or requires a particular pre-existing active count, and
  // its UPDATE never touches is_active on retained rows.
  push(`  SELECT count(*) INTO v_active_item_count_pre FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.is_active = true;`)
  push(`  RAISE NOTICE 'Preflight: % of the % existing San Diego/Tijuana items are currently is_active=true — this patch will not change that for retained rows.', v_active_item_count_pre, ${EXPECTED_EXISTING_ITEM_COUNT};`)
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

  // ── items — RECONCILIATION against the real existing staged rows (count driven
  // by EXPECTED_EXISTING_ITEM_COUNT, corrected to 143 on 2026-09-06 — see report).
  // Rather than blindly inserting, this section: (1) matches each final
  // candidate to an existing production row by normalized maps_query, with
  // a venue-name-only fallback for the one candidate (Cori Pastificio
  // Trattoria) whose neighborhood correction changed its maps_query text;
  // (2) UPDATEs matched rows in place, preserving their id (no delete+
  // reinsert merely because wording changed); (3) INSERTs only the
  // candidates with no match (genuinely new/recovered); (4) removes ONLY
  // the existing rows that matched no final candidate (explicitly excluded/
  // superseded), delisting them from curated_list_items first to satisfy
  // the FK before deleting.
  push(`-- ── 3. items — reconcile the ${allRecords.length} final candidates (${sdRecords.length} San Diego + ${tjRecords.length} Tijuana) against the ${EXPECTED_EXISTING_ITEM_COUNT} real existing staged rows. Category/neighborhood via name subquery (no invented UUIDs). Retained rows keep their current is_active value untouched; new/recovered rows insert is_active=true — see ITEM ACTIVE-STATE POLICY above. ──`)
  push(`CREATE TEMP TABLE _sd_final_candidates (`)
  push(`  source_id text PRIMARY KEY,`)
  push(`  body text NOT NULL,`)
  push(`  category_name text NOT NULL,`)
  push(`  neighborhood_name text NOT NULL,`)
  push(`  maps_query text NOT NULL,`)
  push(`  venue_name text NOT NULL,`)
  push(`  metro_label text NOT NULL`)
  push(`) ON COMMIT DROP;`)
  push(``)
  push(`INSERT INTO _sd_final_candidates (source_id, body, category_name, neighborhood_name, maps_query, venue_name, metro_label) VALUES`)
  allRecords.forEach((r, i) => {
    const sourceId = `SD-${String(i + 1).padStart(4, '0')}`
    const metroLabel = i < sdRecords.length ? 'San Diego' : 'Tijuana'
    const comma = i < allRecords.length - 1 ? ',' : ';'
    push(
      // venue_name is the real candidate name (never derived by splitting maps_query on
      // comma — a venue whose own name contains a comma, e.g. "Plaza Fiesta (El Depa,
      // Teléfono Gastro Park, Bosiger Beer)", would otherwise get truncated mid-name).
      // The fallback SQL match below uses a normalized-PREFIX match against the live
      // production row's maps_query (see fallbackVenueMatchCondition) — not split_part —
      // so it is correct regardless of internal commas in the venue name. metro_label is
      // needed by the PRE/POST-MUTATION integrity certification's 5d/5e/5f guards.
      `  (${dollarQuote(sourceId, 'sid')}, ${dollarQuote(r.body, 'bd')}, ${dollarQuote(r.dbCategory, 'cat')}, ${dollarQuote(r.neighborhoodName!, 'nb')}, ${dollarQuote(r.mapsQuery, 'mq')}, ${dollarQuote(r.candidateName, 'vn')}, ${dollarQuote(metroLabel, 'ml')})${comma}`
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
  push(`    ON ${fallbackVenueMatchCondition('i', 'f')}`)
  push(`  JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`  WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`    AND f.source_id NOT IN (SELECT source_id FROM _sd_matches)`)
  push(`    AND i.id NOT IN (SELECT item_id FROM _sd_matches)`)
  push(`) vm`)
  push(`WHERE vm.candidate_dupes = 1 AND vm.item_dupes = 1;`)
  push(``)
  push(`-- Obsolete existing rows: under the San Diego metro, matched to NO final candidate —`)
  push(`-- computed BEFORE any insert, so newly-inserted rows can never appear here.`)
  push(`CREATE TEMP TABLE _sd_obsolete AS`)
  push(`SELECT i.id FROM public.items i`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`  AND i.id NOT IN (SELECT item_id FROM _sd_matches);`)
  push(``)
  pushIntegrityCertification('PRE-MUTATION')
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
  push(`-- Insert genuinely new/recovered candidates (no existing match). is_active=true per`)
  push(`-- Jerry's current San Diego build-phase intake instruction (see ITEM ACTIVE-STATE`)
  push(`-- POLICY above) — metro_areas/curated_lists stay inactive regardless, so this does`)
  push(`-- not make the item discoverable via any list/browse/featured surface.`)
  push(`INSERT INTO public.items (body, category_id, checkin_type, is_universal, is_active, is_approved, neighborhood_id, maps_query, is_recurring, difficulty, photo_required, has_alcohol)`)
  push(`SELECT`)
  push(`  f.body,`)
  push(`  (SELECT id FROM public.categories WHERE name = f.category_name),`)
  push(`  'tap', false, true, true,`)
  push(`  (SELECT nb.id FROM public.neighborhoods nb JOIN public.metro_areas m ON m.id = nb.metro_id WHERE m.slug = 'san-diego' AND nb.name = f.neighborhood_name),`)
  push(`  f.maps_query, true, 1, false, false`)
  push(`FROM _sd_final_candidates f`)
  push(`WHERE NOT EXISTS (SELECT 1 FROM _sd_matches mt WHERE mt.source_id = f.source_id);`)
  push(``)
  push(`-- Remove obsolete rows: clear every FK reference with a NO ACTION delete rule first`)
  push(`-- (confirmed via a live pg_constraint query against production, 2026-09-06 — not`)
  push(`-- guessed from migration files, which turned out to be incomplete: geo_corrections'`)
  push(`-- own table isn't even created in this repo's migrations directory). Of the 21`)
  push(`-- foreign keys referencing public.items(id), 5 are NO ACTION (would block this`)
  push(`-- DELETE if any row references an obsolete item) and are cleared explicitly below;`)
  push(`-- the rest are already CASCADE or SET NULL at the DB level, including`)
  push(`-- item_cover_candidates and curated_list_items (kept explicit here too — harmless`)
  push(`-- redundancy, not required). These are pre-launch staged/build items with no real`)
  push(`-- marketing exposure, so check_ins/interaction_events rows referencing them (if any)`)
  push(`-- are not real user history worth preserving under this specific item id — but`)
  push(`-- partners/spotlights could plausibly have been set up by the admin tool during an`)
  push(`-- earlier review pass, so those are cleared defensively too (a no-op if none exist).`)
  push(`DELETE FROM public.check_ins WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.geo_corrections WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.interaction_events WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.partners WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.spotlights WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.item_cover_candidates WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.curated_list_items WHERE item_id IN (SELECT id FROM _sd_obsolete);`)
  push(`DELETE FROM public.items WHERE id IN (SELECT id FROM _sd_obsolete);`)
  push(``)
  pushIntegrityCertification('POST-MUTATION')

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
  push(`  v_total_item_count int;`)
  push(`  v_active_item_count int;`)
  push(`  v_bridge_deep_link text;`)
  push(`  v_bridge_state text;`)
  push(`  v_final_retained int;`)
  push(`  v_final_obsolete int;`)
  push(`  v_final_inserted int;`)
  push(`BEGIN`)
  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego';`)
  push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'Postflight failed: san-diego metro_areas row missing.'; END IF;`)
  push(`  SELECT count(*) INTO v_neighborhood_count FROM public.neighborhoods WHERE metro_id = v_metro_id;`)
  push(`  IF v_neighborhood_count <> ${geo.length} THEN RAISE EXCEPTION 'Postflight failed: expected % neighborhoods, found %.', ${geo.length}, v_neighborhood_count; END IF;`)
  push(`  SELECT count(*) INTO v_sd_item_count FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog');`)
  push(`  IF v_sd_item_count <> ${sdRecords.length} THEN RAISE EXCEPTION 'Postflight failed: expected % San Diego catalog items, found %.', ${sdRecords.length}, v_sd_item_count; END IF;`)
  push(`  SELECT count(*) INTO v_tj_item_count FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension');`)
  push(`  IF v_tj_item_count <> ${tjRecords.length} THEN RAISE EXCEPTION 'Postflight failed: expected % Tijuana items, found %.', ${tjRecords.length}, v_tj_item_count; END IF;`)
  push(`  SELECT count(*) INTO v_total_item_count FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_total_item_count <> ${allRecords.length} THEN RAISE EXCEPTION 'Postflight failed: expected exactly ${allRecords.length} final catalog rows under San Diego, found %.', v_total_item_count; END IF;`)
  // Informational only (2026-09-06 correction) — active items are expected here now:
  // every newly-inserted row is is_active=true, and retained rows keep whatever active
  // state they already had. Not a failure condition.
  push(`  SELECT count(*) INTO v_active_item_count FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.is_active = true;`)
  push(`  SELECT deep_link, state INTO v_bridge_deep_link, v_bridge_state FROM public.featured_experiences WHERE list_id = (SELECT id FROM public.curated_lists WHERE slug = ${dollarQuote(bridgeCard.curatedListSlug, 'fe1pf')});`)
  push(`  IF v_bridge_deep_link IS NULL THEN RAISE EXCEPTION 'Postflight failed: featured_experiences bridge card has a null deep_link.'; END IF;`)
  push(`  IF v_bridge_state IS DISTINCT FROM ${dollarQuote(bridgeCard.state, 'fe1pfst')} THEN RAISE EXCEPTION 'Postflight failed: featured_experiences bridge card state is %, expected %.', v_bridge_state, ${dollarQuote(bridgeCard.state, 'fe1pfst2')}; END IF;`)
  push(``)
  push(`  -- ── Final summary — rerun once more from _sd_matches/_sd_obsolete (still present`)
  push(`  -- this session; only _sd_final_candidates was declared ON COMMIT DROP) so this`)
  push(`  -- number matches exactly what the certification blocks above already verified.`)
  push(`  SELECT count(*) INTO v_final_retained FROM _sd_matches;`)
  push(`  SELECT count(*) INTO v_final_obsolete FROM _sd_obsolete;`)
  push(`  v_final_inserted := ${allRecords.length} - v_final_retained;`)
  push(`  RAISE NOTICE '=== SAN DIEGO RECONCILIATION — FINAL RESULT ===';`)
  push(`  RAISE NOTICE 'Starting rows: %', ${EXPECTED_EXISTING_ITEM_COUNT};`)
  push(`  RAISE NOTICE 'Retained: %', v_final_retained;`)
  push(`  RAISE NOTICE 'Obsolete (removed): %', v_final_obsolete;`)
  push(`  RAISE NOTICE 'Inserted (new/recovered): %', v_final_inserted;`)
  push(`  RAISE NOTICE 'Final rows: %', v_total_item_count;`)
  push(`  RAISE NOTICE 'Active rows: %', v_active_item_count;`)
  push(`  RAISE NOTICE 'CERTIFICATION: PASS';`)
  push(`END $$;`)
  push(``)
  push(`COMMIT;`)
  push(``)
  push(`-- Metro/list boundary (per docs/metro-launch-playbook.md Phase 6, item-activity`)
  push(`-- policy corrected 2026-09-06): this file does NOT flip metro_areas.is_active=true`)
  push(`-- or any curated_lists.is_active=true — list/browse/featured-level discovery`)
  push(`-- remains a deliberate, separate, later activation step. Individual item rows are a`)
  push(`-- separate switch: new/recovered rows are inserted is_active=true per Jerry's`)
  push(`-- current build-phase instruction, and retained rows keep whatever active state`)
  push(`-- they already had — neither is touched by any future metro/list activation step`)
  push(`-- either, since those two switches are independent.`)

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
