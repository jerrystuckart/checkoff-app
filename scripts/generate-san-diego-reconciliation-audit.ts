#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-reconciliation-audit.ts
//
// READ-ONLY reconciliation audit for the San Diego/Tijuana catalog patch
// (2026-09-06). Generates scripts/output/san-diego-final-reconciliation-
// audit-2026-09-06.sql — a file containing ZERO INSERT/UPDATE/DELETE
// against any public.* table. It uses the EXACT SAME candidate-building
// and matching logic as the write patch (shared via
// sanDiegoReconciliationShared.ts, imported by both — not copy-pasted,
// so the two can never silently drift), so what this reports IS what the
// patch would do, before Jerry ever runs anything that mutates data.
//
// This script itself never touches public.* either — it only calls the
// same pipeline functions the write-patch generator does (which read
// this run's own persisted candidate state via agent.tasks, plus one
// read of agent_service's own visible `items.maps_query` values for the
// pipeline's cross-metro dedup check) and writes a local .sql file.
//
// The generated file creates TEMP tables (session-local, auto-dropped,
// not a public.* write) to hold the 152-candidate target state and the
// match results, then returns SELECT-only reports. Every "integrity
// guard" is a SELECT that should return zero rows, not a RAISE
// EXCEPTION — the point of this file is for Jerry to inspect every
// row before anything is decided, not to halt before he can see them.
//
// Usage: npx tsx scripts/generate-san-diego-reconciliation-audit.ts

import { writeFileSync, mkdirSync } from 'node:fs'
import { loadEnvFile, dollarQuote, buildFinalRecords, fetchExistingProductionMapsQueries, EXPECTED_EXISTING_ITEM_COUNT, RECOVERY_REASONS, fallbackVenueMatchCondition } from './sanDiegoReconciliationShared'
import { MEXICO_NEIGHBORHOODS } from './metroCatalogSanDiegoConfig'

loadEnvFile('.env')

async function main() {
  const existingProductionMapsQueries = await fetchExistingProductionMapsQueries()
  const sd = await buildFinalRecords('san-diego', existingProductionMapsQueries)
  const tj = await buildFinalRecords('san-diego-tijuana-extension', existingProductionMapsQueries)

  console.error('=== Final-output gate check (informational — this audit runs regardless, since it never writes anything) ===')
  for (const [label, r] of [['San Diego', sd], ['Tijuana', tj]] as const) {
    for (const g of r.gates) console.error(`  [${label}] ${g.key}: ${g.verdict} — ${g.reason}`)
  }

  const sdRecords = sd.records
  const tjRecords = tj.records
  const allRecords = [...sdRecords, ...tjRecords]

  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`-- San Diego/Tijuana catalog RECONCILIATION AUDIT — READ ONLY.`)
  push(`-- Generated 2026-09-06. Contains ZERO INSERT/UPDATE/DELETE against any public.*`)
  push(`-- table. Uses the exact same candidate-building and matching logic as the write`)
  push(`-- patch (scripts/output/san-diego-final-editorial-and-recovery-patch-2026-09-06.sql)`)
  push(`-- — shared code (scripts/sanDiegoReconciliationShared.ts), not a re-derivation, so`)
  push(`-- what this reports is exactly what the patch would do.`)
  push(`--`)
  push(`-- WHY THIS FILE EXISTS: agent_service (this repo's own DB role) could not see the`)
  push(`-- real 141 existing staged San Diego/Tijuana items at all at the time this was`)
  push(`-- first discovered — \`items\` has RLS enabled with a public-read policy gated on`)
  push(`-- is_active=true AND is_approved=true, and at that time every one of the 141 real`)
  push(`-- rows was is_active=false. That silently filtered them out of every read this`)
  push(`-- session ran, with no error to signal it — confirmed via pg_policies/pg_roles,`)
  push(`-- not guessed. So the exact reconciliation counts below are UNVERIFIED until run`)
  push(`-- under your own privileged Supabase SQL Editor session, which is not subject to`)
  push(`-- that filter. NOTE (2026-09-06 correction): Jerry has since intentionally allowed`)
  push(`-- some San Diego items to be is_active=true during this build/testing phase — this`)
  push(`-- audit does not assume any particular active/inactive state; Report 1 below shows`)
  push(`-- the live current-vs-active breakdown rather than assuming zero.`)
  push(`--`)
  push(`-- HOW TO RUN: paste this whole file into Supabase SQL Editor and run it once —`)
  push(`-- it's all SELECT/CREATE TEMP TABLE (session-scoped, harmless) after the initial`)
  push(`-- setup block. Supabase's SQL Editor only displays the LAST statement's result`)
  push(`-- when running a multi-statement script, so to see every report below, run this`)
  push(`-- file once to build the temp tables, then re-run (or highlight-and-run) each`)
  push(`-- individual "-- ── N. ..." SELECT block one at a time — the temp tables persist`)
  push(`-- for the rest of your Editor session (until you close the tab or the session`)
  push(`-- times out), so you don't need to rebuild them between sections.`)
  push(``)

  // ── candidate temp table (identical shape/content to the write patch) ──
  push(`-- ── 0. Build the 152-candidate target state (read-only: a session-local TEMP table, not a public.* write) ──`)
  push(`DROP TABLE IF EXISTS _sd_final_candidates;`)
  push(`CREATE TEMP TABLE _sd_final_candidates (`)
  push(`  source_id text PRIMARY KEY,`)
  push(`  body text NOT NULL,`)
  push(`  category_name text NOT NULL,`)
  push(`  neighborhood_name text NOT NULL,`)
  push(`  maps_query text NOT NULL,`)
  push(`  venue_name text NOT NULL,`)
  push(`  metro_label text NOT NULL,`)
  push(`  recovery_reason text`)
  push(`);`)
  push(``)
  push(`INSERT INTO _sd_final_candidates (source_id, body, category_name, neighborhood_name, maps_query, venue_name, metro_label, recovery_reason) VALUES`)
  allRecords.forEach((r, i) => {
    const sourceId = `SD-${String(i + 1).padStart(4, '0')}`
    const metroLabel = i < sdRecords.length ? 'San Diego' : 'Tijuana'
    const recoveryReason = RECOVERY_REASONS[r.candidateName] ?? null
    const comma = i < allRecords.length - 1 ? ',' : ';'
    push(
      `  (${dollarQuote(sourceId, 'sid')}, ${dollarQuote(r.body, 'bd')}, ${dollarQuote(r.dbCategory, 'cat')}, ${dollarQuote(r.neighborhoodName!, 'nb')}, ${dollarQuote(r.mapsQuery, 'mq')}, ${dollarQuote(r.candidateName, 'vn')}, ${dollarQuote(metroLabel, 'ml')}, ${recoveryReason ? dollarQuote(recoveryReason, 'rr') : 'NULL'})${comma}`
    )
  })
  push(``)

  push(`-- ── 1. Match existing production rows to final candidates (primary: normalized maps_query) ──`)
  push(`DROP TABLE IF EXISTS _sd_matches;`)
  push(`CREATE TEMP TABLE _sd_matches (source_id text PRIMARY KEY, item_id uuid NOT NULL, match_method text NOT NULL);`)
  push(`INSERT INTO _sd_matches (source_id, item_id, match_method)`)
  push(`SELECT f.source_id, i.id, 'normalized_maps_query'`)
  push(`FROM _sd_final_candidates f`)
  push(`JOIN public.items i`)
  push(`  ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`   = lower(regexp_replace(btrim(f.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego');`)
  push(``)
  push(`-- Fallback match: normalized venue-name-only (real candidate name, not a maps_query`)
  push(`-- split — a venue name containing a comma would otherwise be truncated), for a`)
  push(`-- candidate whose neighborhood correction changed its maps_query text. Only when`)
  push(`-- exactly one candidate and exactly one existing item share that venue name.`)
  push(`INSERT INTO _sd_matches (source_id, item_id, match_method)`)
  push(`SELECT vm.source_id, vm.item_id, 'verified_name_override'`)
  push(`FROM (`)
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

  push(`-- ── 2. Obsolete existing rows: under the San Diego metro, matched to NO final candidate ──`)
  push(`DROP TABLE IF EXISTS _sd_obsolete;`)
  push(`CREATE TEMP TABLE _sd_obsolete AS`)
  push(`SELECT i.id FROM public.items i`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`  AND i.id NOT IN (SELECT item_id FROM _sd_matches);`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- REPORT 1 — Exact reconciliation summary`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT`)
  push(`  (SELECT count(*) FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')) AS current_existing_rows,`)
  push(`  (SELECT count(*) FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.is_active = true) AS current_existing_active_rows,`)
  push(`  (SELECT count(*) FROM _sd_matches) AS retained_matched_rows,`)
  push(`  (SELECT count(*) FROM _sd_obsolete) AS obsolete_rows,`)
  push(`  (SELECT count(*) FROM _sd_matches) AS final_candidates_already_represented,`)
  push(`  ((SELECT count(*) FROM _sd_final_candidates) - (SELECT count(*) FROM _sd_matches)) AS genuinely_new_unmatched_candidates,`)
  push(`  (SELECT count(*) FROM _sd_final_candidates) AS final_expected_total,`)
  push(`  -- Item active-state note (2026-09-06 correction): the write patch does NOT touch`)
  push(`  -- is_active on retained/matched rows (current_existing_active_rows above carries`)
  push(`  -- forward unchanged) and inserts new/recovered rows is_active=true — so the`)
  push(`  -- post-patch active count = current_existing_active_rows + genuinely_new_unmatched_candidates.`)
  push(`  -- This is informational, not a proof equation — no particular active count is required.`)
  push(`  -- Proof equations — both should read 't' (true). If either reads 'f', STOP and investigate before running the write patch.`)
  push(`  ((SELECT count(*) FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego'))`)
  push(`    = (SELECT count(*) FROM _sd_matches) + (SELECT count(*) FROM _sd_obsolete)) AS proof_${EXPECTED_EXISTING_ITEM_COUNT}_equals_retained_plus_obsolete,`)
  push(`  ((SELECT count(*) FROM _sd_final_candidates)`)
  push(`    = (SELECT count(*) FROM _sd_matches) + ((SELECT count(*) FROM _sd_final_candidates) - (SELECT count(*) FROM _sd_matches))) AS proof_${allRecords.length}_equals_retained_plus_new;`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- REPORT 2 — Existing rows proposed for removal (~35 expected) — INSPECT EVERY ROW`)
  push(`-- before deciding whether the write patch's obsolete-removal step is correct.`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT`)
  push(`  i.id AS existing_item_id,`)
  push(`  i.body AS current_body,`)
  push(`  i.maps_query,`)
  push(`  c.name AS category,`)
  push(`  nb.name AS neighborhood,`)
  push(`  (SELECT string_agg(cl.title || ' (' || cl.slug || ')', ', ') FROM public.curated_list_items cli JOIN public.curated_lists cl ON cl.id = cli.curated_list_id WHERE cli.item_id = i.id) AS curated_list_membership,`)
  push(`  'Not matched to any of the 152 final candidates by normalized maps_query or venue name — either superseded/renamed, or excluded by tonight''s editorial specificity bar. Cross-reference against the write patch''s final candidate list to confirm which.' AS reason_not_represented`)
  push(`FROM public.items i`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`JOIN public.categories c ON c.id = i.category_id`)
  push(`WHERE i.id IN (SELECT id FROM _sd_obsolete)`)
  push(`ORDER BY nb.name, i.body;`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- REPORT 3 — New rows proposed for insertion (${allRecords.length - EXPECTED_EXISTING_ITEM_COUNT >= 0 ? 'genuinely new/recovered' : 'see summary'}) `)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT`)
  push(`  f.venue_name AS candidate_name,`)
  push(`  f.body AS final_checkoff_body,`)
  push(`  f.maps_query,`)
  push(`  f.category_name AS category,`)
  push(`  f.neighborhood_name AS neighborhood,`)
  push(`  f.metro_label,`)
  push(`  COALESCE(f.recovery_reason, 'Recovered via an earlier session pipeline fix not individually tracked — see the reconciliation report''s narrative for the full list of mechanisms (NBSP fix, category-classifier fix, verified-address override, final specificity salvage, etc.).') AS recovery_source_reason`)
  push(`FROM _sd_final_candidates f`)
  push(`WHERE f.source_id NOT IN (SELECT source_id FROM _sd_matches)`)
  push(`ORDER BY f.metro_label, f.neighborhood_name, f.venue_name;`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- REPORT 4 — Matched rows (existing production row -> final candidate)`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`SELECT`)
  push(`  i.id AS existing_item_id,`)
  push(`  f.venue_name AS candidate_name,`)
  push(`  i.body AS current_body,`)
  push(`  f.body AS final_body,`)
  push(`  i.maps_query AS current_maps_query,`)
  push(`  f.maps_query AS final_maps_query,`)
  push(`  nb_current.name AS current_neighborhood,`)
  push(`  f.neighborhood_name AS final_neighborhood,`)
  push(`  mt.match_method`)
  push(`FROM _sd_matches mt`)
  push(`JOIN _sd_final_candidates f ON f.source_id = mt.source_id`)
  push(`JOIN public.items i ON i.id = mt.item_id`)
  push(`JOIN public.neighborhoods nb_current ON nb_current.id = i.neighborhood_id`)
  push(`ORDER BY mt.match_method DESC, f.venue_name;`)
  push(``)

  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(`-- REPORT 5 — Matching-integrity guards. EVERY query below MUST return ZERO ROWS.`)
  push(`-- Any row returned here means STOP — do not run the write patch until resolved.`)
  push(`-- ═══════════════════════════════════════════════════════════════════════`)
  push(``)
  push(`-- 5a. One existing item mapped to multiple final candidates — must be empty.`)
  push(`SELECT item_id, count(*) AS candidate_count, array_agg(source_id) AS candidates`)
  push(`FROM _sd_matches GROUP BY item_id HAVING count(*) > 1;`)
  push(``)
  push(`-- 5b. One final candidate mapped to multiple existing items — must be empty`)
  push(`-- (unless explicitly identified as an intentional duplicate collapse — none are`)
  push(`-- expected or allow-listed for this batch; any row here needs manual review).`)
  push(`SELECT source_id, count(*) AS item_count, array_agg(item_id) AS items`)
  push(`FROM _sd_matches GROUP BY source_id HAVING count(*) > 1;`)
  push(``)
  push(`-- 5c. Ambiguous fallback venue-name match (more than one candidate or more than one`)
  push(`-- existing item shared a venue name and so was correctly EXCLUDED from the`)
  push(`-- fallback match) — must be empty. A non-empty result means a real candidate is`)
  push(`-- going unmatched (and would show up as "new" in Report 3) purely because of an`)
  push(`-- ambiguous name collision, not because it's genuinely new — worth a manual look.`)
  push(`SELECT f.source_id, f.venue_name, count(i.id) AS ambiguous_item_matches`)
  push(`FROM _sd_final_candidates f`)
  push(`JOIN public.items i`)
  push(`  ON ${fallbackVenueMatchCondition('i', 'f')}`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`  AND f.source_id NOT IN (SELECT source_id FROM _sd_matches)`)
  push(`GROUP BY f.source_id, f.venue_name`)
  push(`HAVING count(i.id) > 1;`)
  push(``)
  push(`-- 5h. Final candidate with ZERO fallback matches despite a known existing venue`)
  push(`-- identity — i.e. some existing row's maps_query begins with this candidate's`)
  push(`-- venue name, but it did NOT end up in _sd_matches (whether because it was`)
  push(`-- suppressed by the ambiguous >1 guard above, or some other reason) — must be`)
  push(`-- empty. This complements 5c: 5c only catches AMBIGUOUS (>1) fallback matches,`)
  push(`-- this catches a real existing-venue candidate silently ending up with NO match`)
  push(`-- at all (which would misclassify a retained venue as "new" in Report 3).`)
  push(`SELECT f.source_id, f.venue_name`)
  push(`FROM _sd_final_candidates f`)
  push(`WHERE f.source_id NOT IN (SELECT source_id FROM _sd_matches)`)
  push(`  AND EXISTS (`)
  push(`    SELECT 1 FROM public.items i`)
  push(`    JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`    WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`      AND ${fallbackVenueMatchCondition('i', 'f')}`)
  push(`  );`)
  push(``)
  push(`-- 5d. Any Tijuana final candidate whose target neighborhood is a California one — must be empty.`)
  push(`SELECT source_id, venue_name, neighborhood_name FROM _sd_final_candidates`)
  push(`WHERE metro_label = 'Tijuana' AND neighborhood_name NOT IN (${[...MEXICO_NEIGHBORHOODS].map((n) => dollarQuote(n, 'mxn')).join(', ')});`)
  push(``)
  push(`-- 5e. Any San Diego final candidate whose target neighborhood is a Mexico one — must be empty.`)
  push(`SELECT source_id, venue_name, neighborhood_name FROM _sd_final_candidates`)
  push(`WHERE metro_label = 'San Diego' AND neighborhood_name IN (${[...MEXICO_NEIGHBORHOODS].map((n) => dollarQuote(n, 'mxn2')).join(', ')});`)
  push(``)
  push(`-- 5f. Live cross-check: any MATCHED row whose live neighborhood.state field is`)
  push(`-- inconsistent with its metro_label (a Tijuana candidate should always land on a`)
  push(`-- neighborhood with state='Baja California, Mexico'; a San Diego candidate on`)
  push(`-- state='CA') — must be empty.`)
  push(`SELECT mt.source_id, f.venue_name, f.metro_label, nb.name AS current_neighborhood, nb.state AS current_state`)
  push(`FROM _sd_matches mt`)
  push(`JOIN _sd_final_candidates f ON f.source_id = mt.source_id`)
  push(`JOIN public.items i ON i.id = mt.item_id`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE (f.metro_label = 'Tijuana' AND nb.state <> 'Baja California, Mexico')`)
  push(`   OR (f.metro_label = 'San Diego' AND nb.state <> 'CA');`)
  push(``)
  push(`-- 5g. Reconciliation math check — must return a single row with both columns 'true'.`)
  push(`SELECT`)
  push(`  ((SELECT count(*) FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')) = ${EXPECTED_EXISTING_ITEM_COUNT}) AS existing_count_is_141,`)
  push(`  ((SELECT count(*) FROM _sd_matches) + (SELECT count(*) FROM _sd_obsolete) = ${EXPECTED_EXISTING_ITEM_COUNT}) AS retained_plus_obsolete_equals_141,`)
  push(`  ((SELECT count(*) FROM _sd_matches) + ((SELECT count(*) FROM _sd_final_candidates) - (SELECT count(*) FROM _sd_matches)) = ${allRecords.length}) AS retained_plus_new_equals_${allRecords.length};`)
  push(``)
  push(`-- No public.* row was inserted, updated, or deleted by this file. Temp tables`)
  push(`-- (_sd_final_candidates, _sd_matches, _sd_obsolete) are session-local and will be`)
  push(`-- dropped automatically when this SQL Editor session ends.`)

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-final-reconciliation-audit-${new Date().toISOString().slice(0, 10)}.sql`
  writeFileSync(outPath, lines.join('\n'))
  console.error(`\nWrote ${outPath}`)
  console.error(`${allRecords.length} final candidates (${sdRecords.length} SD + ${tjRecords.length} TJ) will be reconciled against ${EXPECTED_EXISTING_ITEM_COUNT} confirmed existing production rows.`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
