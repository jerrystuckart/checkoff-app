#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-post-apply-verification.ts
//
// READ-ONLY post-apply verification for the San Diego/Tijuana catalog
// patch, generated after Jerry ran the write patch and hit an ambiguous
// "relation _sd_final_candidates does not exist" error with no other
// message — while his own admin tool already showed 149 total items
// under San Diego (the correct target), strongly suggesting the patch's
// transaction committed successfully and the error came from something
// AFTER commit (that temp table is deliberately ON COMMIT DROP — the
// only one of the three that is).
//
// This file contains ZERO INSERT/UPDATE/DELETE. It rebuilds the exact
// same 149-record final target (shared code, not a re-derivation) and
// checks it against the NOW-LIVE, already-applied production state —
// unlike the original reconciliation audit, which compared the target
// against the PRE-apply 143-row baseline. Every check here is either a
// plain SELECT or a DO block that only RAISE NOTICEs, never RAISE
// EXCEPTIONs — nothing here can roll anything back or block anything;
// it's pure read-only confirmation for Jerry to eyeball.
//
// Usage: npx tsx scripts/generate-san-diego-post-apply-verification.ts

import { writeFileSync, mkdirSync } from 'node:fs'
import { loadEnvFile, dollarQuote, buildFinalRecords } from './sanDiegoReconciliationShared'

loadEnvFile('.env')

async function main() {
  // Deliberately NOT calling fetchExistingProductionMapsQueries() here. That helper
  // reads maps_query from ALL of public.items, unscoped by metro — it exists so the
  // WRITE PATCH can avoid inserting a candidate that duplicates some OTHER metro's
  // existing item. Now that the patch has already run and some San Diego items are
  // is_active=true, they're visible via that same unscoped read, and the pipeline's
  // own cross-metro dedup check would treat them as "already exists elsewhere" and
  // silently exclude them — a false self-collision, confirmed the hard way (a first
  // version of this script that reused fetchExistingProductionMapsQueries() produced
  // only 106 San Diego records instead of 139, entirely from this artifact). This
  // script is a pure comparison tool, not a candidate-list builder for insertion, so
  // it passes an empty list and always gets the full, correct 149-record target.
  const sd = await buildFinalRecords('san-diego', [])
  const tj = await buildFinalRecords('san-diego-tijuana-extension', [])
  const sdRecords = sd.records
  const tjRecords = tj.records
  const allRecords = [...sdRecords, ...tjRecords]

  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`-- San Diego/Tijuana catalog POST-APPLY VERIFICATION — READ ONLY.`)
  push(`-- Generated 2026-09-06, after the write patch was run and produced an ambiguous`)
  push(`-- "relation _sd_final_candidates does not exist" error with no other message,`)
  push(`-- while the admin tool already showed 149 total San Diego items (the correct`)
  push(`-- target). Contains ZERO INSERT/UPDATE/DELETE. Rebuilds the exact same`)
  push(`-- ${allRecords.length}-record final target (shared code — not a re-derivation) and checks it`)
  push(`-- against the NOW-LIVE, already-applied production state. Every check below is`)
  push(`-- either a plain SELECT or a DO block that only RAISE NOTICEs — nothing here can`)
  push(`-- roll anything back or block anything. Paste the whole file into Supabase SQL`)
  push(`-- Editor and run it once.`)
  push(``)

  push(`DROP TABLE IF EXISTS _sd_verify_target;`)
  push(`CREATE TEMP TABLE _sd_verify_target (`)
  push(`  source_id text PRIMARY KEY,`)
  push(`  body text NOT NULL,`)
  push(`  category_name text NOT NULL,`)
  push(`  neighborhood_name text NOT NULL,`)
  push(`  maps_query text NOT NULL,`)
  push(`  venue_name text NOT NULL,`)
  push(`  metro_label text NOT NULL`)
  push(`);`)
  push(``)
  push(`INSERT INTO _sd_verify_target (source_id, body, category_name, neighborhood_name, maps_query, venue_name, metro_label) VALUES`)
  allRecords.forEach((r, i) => {
    const sourceId = `SD-${String(i + 1).padStart(4, '0')}`
    const metroLabel = i < sdRecords.length ? 'San Diego' : 'Tijuana'
    const comma = i < allRecords.length - 1 ? ',' : ';'
    push(
      `  (${dollarQuote(sourceId, 'sid')}, ${dollarQuote(r.body, 'bd')}, ${dollarQuote(r.dbCategory, 'cat')}, ${dollarQuote(r.neighborhoodName!, 'nb')}, ${dollarQuote(r.mapsQuery, 'mq')}, ${dollarQuote(r.candidateName, 'vn')}, ${dollarQuote(metroLabel, 'ml')})${comma}`
    )
  })
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- CHECK 1 — Total counts`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT`)
  push(`  (SELECT count(*) FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')) AS live_total_items,`)
  push(`  ${allRecords.length} AS expected_total,`)
  push(`  (SELECT count(*) FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.is_active = true) AS live_active_items,`)
  push(`  (SELECT count(*) FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.is_active = false) AS live_inactive_items,`)
  push(`  (SELECT count(*) FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-catalog')) AS sd_catalog_list_items,`)
  push(`  ${sdRecords.length} AS sd_catalog_expected,`)
  push(`  (SELECT count(*) FROM public.curated_list_items WHERE curated_list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension')) AS tj_list_items,`)
  push(`  ${tjRecords.length} AS tj_expected,`)
  push(`  (SELECT is_active FROM public.metro_areas WHERE slug = 'san-diego') AS metro_is_active_expect_false,`)
  push(`  (SELECT is_active FROM public.curated_lists WHERE slug = 'san-diego-catalog') AS sd_list_is_active_expect_false,`)
  push(`  (SELECT is_active FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension') AS tj_list_is_active_expect_false;`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- CHECK 2 — Every final-target candidate resolves to EXACTLY ONE live item.`)
  push(`-- Must return ZERO ROWS. A row here means either a candidate never made it in`)
  push(`-- (0 matches) or something duplicated (>1 matches).`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT t.source_id, t.venue_name, t.metro_label, count(i.id) AS live_match_count`)
  push(`FROM _sd_verify_target t`)
  push(`LEFT JOIN (`)
  push(`  SELECT i2.id, i2.maps_query FROM public.items i2`)
  push(`  JOIN public.neighborhoods nb2 ON nb2.id = i2.neighborhood_id`)
  push(`  WHERE nb2.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`) i ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`     = lower(regexp_replace(btrim(t.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`GROUP BY t.source_id, t.venue_name, t.metro_label`)
  push(`HAVING count(i.id) <> 1;`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- CHECK 3 — Every LIVE item under San Diego is represented in the final target`)
  push(`-- (the mirror image of Check 2 — catches an obsolete row that was NOT actually`)
  push(`-- removed). Must return ZERO ROWS.`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT i.id, i.body, i.maps_query`)
  push(`FROM public.items i`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`  AND NOT EXISTS (`)
  push(`    SELECT 1 FROM _sd_verify_target t`)
  push(`    WHERE lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`        = lower(regexp_replace(btrim(t.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  );`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- CHECK 4 — Neighborhood/state cross-contamination (Tijuana vs. California).`)
  push(`-- Must return ZERO ROWS.`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT t.source_id, t.venue_name, t.metro_label, nb.name AS live_neighborhood, nb.state AS live_state`)
  push(`FROM _sd_verify_target t`)
  push(`JOIN public.items i`)
  push(`  ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`   = lower(regexp_replace(btrim(t.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE (t.metro_label = 'Tijuana' AND nb.state <> 'Baja California, Mexico')`)
  push(`   OR (t.metro_label = 'San Diego' AND nb.state <> 'CA');`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- CHECK 5 — featured_experiences bridge card sanity.`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT title, subtitle, city, state, deep_link, active`)
  push(`FROM public.featured_experiences`)
  push(`WHERE list_id = (SELECT id FROM public.curated_lists WHERE slug = 'san-diego-tijuana-extension');`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- SUMMARY — if Checks 2, 3, and 4 all returned zero rows, and Check 1's`)
  push(`-- live_total_items = ${allRecords.length} and sd/tj list item counts match their expected`)
  push(`-- values, the write patch applied completely and correctly. The`)
  push(`-- "_sd_final_candidates does not exist" error you saw is then confirmed to be`)
  push(`-- unrelated to the actual data — that table is deliberately ON COMMIT DROP and`)
  push(`-- vanishes the instant the transaction commits successfully.`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- No public.* row was inserted, updated, or deleted by this file.`)

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-post-apply-verification-${new Date().toISOString().slice(0, 10)}.sql`
  writeFileSync(outPath, lines.join('\n'))
  console.error(`Wrote ${outPath}`)
  console.error(`${allRecords.length} final-target rows (${sdRecords.length} SD + ${tjRecords.length} TJ) will be checked against the live, already-applied production state.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
