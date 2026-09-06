#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-metadata-patch.ts
//
// Self-certifying, fail-closed metadata patch for the already-reconciled
// 149-item San Diego/Tijuana catalog. Writes ONLY 5 approved columns:
// has_alcohol, difficulty, photo_required, checkin_type,
// visit_profile_key — computed by
// agent-service/playbooks/metroMetadataEnrichment.ts's corrected,
// Jerry-approved rules (2026-09-06). Never touches body, category,
// neighborhood, catalog membership, is_active, is_secret, metro/list
// state, geo fields, or website_url.
//
// EXECUTION-COMPATIBILITY REWRITE (2026-09-06): Jerry hit
// `ERROR 42P01: relation "_sd_metadata_patch" does not exist` — Supabase
// SQL Editor does not reliably preserve a CREATE TEMP TABLE across
// multiple statements sent through this execution path. This version
// contains ONE statement only: a single `DO $$ ... $$;` block with the
// 149 target rows inlined as literal `VALUES (...)` data directly in
// every SQL statement that needs them (the pre-check, the UPDATE, and
// the post-check each carry their own copy of the same literal data —
// no CREATE TEMP TABLE, no session-persistent object, no statement
// depends on anything an earlier statement created). If ANY check
// raises inside the block, the whole block — and everything it did —
// rolls back automatically; nothing partial can ever land.
//
// Skips a before/after snapshot of unrelated columns (unlike the
// original TEMP-table version) because it's unnecessary, not because
// it's unavailable: `public.items` has exactly two triggers
// (`trg_apply_seasonal_active_on_tag_change`, column-scoped to
// `season_tag`; `items_reject_secret_active_cover`, column-scoped to
// `is_secret`/`active_cover_candidate_id`) and both are Postgres
// "UPDATE OF <column>" triggers, which only fire when that specific
// column appears in the UPDATE's own SET list — confirmed via direct
// inspection of supabase/migrations/20260809_seasonal_item_active.sql
// and 20260903_secret_item_cover_protection.sql. Neither column is
// touched by this patch, so neither trigger can fire, so no other
// column can move as a side effect — the UPDATE's own 5-column SET
// list is sufficient proof on its own.
//
// GENERATED, NOT APPLIED. This repo's agent_service DB role has no
// demonstrated write path to `items` in this session, and
// `metro_launch.stage_catalog_write`'s standing AUTO authority is
// explicitly scoped to "staged (is_active=false) writes only" — San
// Diego currently has 34 already-ACTIVE items mixed into these same
// 149 rows, so this write falls outside that scope. Generates the
// exact SQL for Jerry to run via Supabase SQL Editor.
//
// Usage: npx tsx scripts/generate-san-diego-metadata-patch.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { loadEnvFile, dollarQuote, buildFinalRecords } from './sanDiegoReconciliationShared'
import { evaluateItemMetadata, evaluateMetadataCompletenessGate, type MetadataEnrichmentResult } from '../agent-service/playbooks/metroMetadataEnrichment'

loadEnvFile('.env')

const EXPECTED_TOTAL = 149

const KNOWN_MANUAL_OVERRIDES: Record<string, { difficulty?: number; photoRequired?: boolean }> = {
  'The Goods': { difficulty: 10, photoRequired: true },
}

const KNOWN_VISIT_PROFILE_KEYS = ['quick_stop', 'retail', 'fast_casual', 'restaurant', 'bar', 'attraction', 'outdoor', 'event', 'landmark', 'manual_only']

async function main() {
  const sd = await buildFinalRecords('san-diego', [])
  const tj = await buildFinalRecords('san-diego-tijuana-extension', [])
  const allRecords = [...sd.records, ...tj.records]

  if (allRecords.length !== EXPECTED_TOTAL) {
    console.error(`FATAL: rebuilt ${allRecords.length} candidates, expected exactly ${EXPECTED_TOTAL}. Refusing to generate a patch against a drifted candidate set.`)
    process.exitCode = 1
    return
  }

  const results: MetadataEnrichmentResult[] = allRecords.map((r) =>
    evaluateItemMetadata({
      candidateName: r.candidateName,
      body: r.body,
      dbCategory: r.dbCategory,
      existing: KNOWN_MANUAL_OVERRIDES[r.candidateName],
    })
  )
  const gate = evaluateMetadataCompletenessGate(results)
  console.error(`METADATA_COMPLETENESS_GATE: ${gate.verdict} — ${gate.reason}`)
  if (gate.verdict !== 'PASS') {
    console.error('Refusing to generate a patch — gate did not pass.')
    process.exitCode = 1
    return
  }

  const byName = new Map(results.map((r) => [r.candidateName, r]))

  // The literal VALUES(...) rows shared verbatim across every SQL statement in the block.
  const valuesRows = allRecords.map((r) => {
    const m = byName.get(r.candidateName)!
    const vpk = m.visitProfileKey.value ? dollarQuote(m.visitProfileKey.value, 'vpk') : 'NULL'
    return `    (${dollarQuote(r.mapsQuery, 'mq')}, ${m.hasAlcohol.value}, ${m.difficulty.value}, ${m.photoRequired.value}, ${dollarQuote(m.checkinType.value, 'ct')}, ${vpk})`
  })
  const valuesBlock = valuesRows.join(',\n')

  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`-- Chief M10 — San Diego/Tijuana METADATA PATCH (approved 2026-09-06).`)
  push(`-- GENERATED, NOT APPLIED. ONE statement: a single DO $$ ... $$ block, no`)
  push(`-- CREATE TEMP TABLE, no session-persistent object — every check and the UPDATE`)
  push(`-- itself each carry their own literal copy of the same ${EXPECTED_TOTAL}-row VALUES data.`)
  push(`-- Fail-closed: any RAISE EXCEPTION inside rolls back the entire block automatically.`)
  push(`--`)
  push(`-- Writes ONLY has_alcohol, difficulty, photo_required, checkin_type,`)
  push(`-- visit_profile_key. Never touches body, category, neighborhood, catalog`)
  push(`-- membership, is_active, is_secret, metro/list state, geo fields, or`)
  push(`-- website_url. The Goods' existing manual difficulty=10/photo_required=true`)
  push(`-- override is preserved verbatim (baked into its target row below).`)
  push(``)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_metro_id uuid;`)
  push(`  v_total_before int;`)
  push(`  v_bad_key_count int;`)
  push(`  v_unmatched int;`)
  push(`  v_ambiguous int;`)
  push(`  v_wrong_value_count int;`)
  push(`  v_total_after int;`)
  push(`  v_alcohol_true int; v_alcohol_false int;`)
  push(`  v_diff_1 int; v_diff_5 int; v_diff_10 int; v_diff_other int;`)
  push(`  v_photo int; v_tap int;`)
  push(`BEGIN`)

  push(`  -- 1. Verify San Diego metro exists.`)
  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego';`)
  push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'Certification failed: san-diego metro_areas row missing.'; END IF;`)
  push(``)

  push(`  -- 2. Verify exactly ${EXPECTED_TOTAL} items currently exist.`)
  push(`  SELECT count(*) INTO v_total_before FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_total_before <> ${EXPECTED_TOTAL} THEN`)
  push(`    RAISE EXCEPTION 'Certification failed: expected exactly ${EXPECTED_TOTAL} San Diego/Tijuana items, found %. Catalog membership must be frozen before this metadata-only patch runs.', v_total_before;`)
  push(`  END IF;`)
  push(``)

  push(`  -- 3. Verify all intended visit_profile_key values exist.`)
  push(`  SELECT count(*) INTO v_bad_key_count FROM (VALUES ${KNOWN_VISIT_PROFILE_KEYS.map((k) => `(${dollarQuote(k, 'vpk')})`).join(', ')}) AS wanted(key)`)
  push(`  WHERE NOT EXISTS (SELECT 1 FROM public.visit_detection_profiles vdp WHERE vdp.key = wanted.key);`)
  push(`  IF v_bad_key_count > 0 THEN`)
  push(`    RAISE EXCEPTION 'Certification failed: % of the visit_profile_key value(s) this patch is about to write do not exist in visit_detection_profiles.', v_bad_key_count;`)
  push(`  END IF;`)
  push(``)

  push(`  -- 4/5. The ${EXPECTED_TOTAL} target rows (inline VALUES, no temp table) — verify every`)
  push(`  -- target maps to exactly one live item before touching anything.`)
  push(`  SELECT count(*) INTO v_unmatched FROM (VALUES`)
  push(valuesBlock + ')')
  push(`  AS v(maps_query, has_alcohol, difficulty, photo_required, checkin_type, visit_profile_key)`)
  push(`  WHERE NOT EXISTS (`)
  push(`    SELECT 1 FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`    WHERE nb.metro_id = v_metro_id`)
  push(`      AND lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  );`)
  push(`  IF v_unmatched > 0 THEN RAISE EXCEPTION 'Certification failed: % target row(s) match no live item.', v_unmatched; END IF;`)
  push(``)

  push(`  SELECT count(*) INTO v_ambiguous FROM (`)
  push(`    SELECT v.maps_query, count(i.id) AS c FROM (VALUES`)
  push(valuesBlock + ')')
  push(`    AS v(maps_query, has_alcohol, difficulty, photo_required, checkin_type, visit_profile_key)`)
  push(`    JOIN public.items i`)
  push(`      ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`    JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id AND nb.metro_id = v_metro_id`)
  push(`    GROUP BY v.maps_query HAVING count(i.id) <> 1`)
  push(`  ) x;`)
  push(`  IF v_ambiguous > 0 THEN RAISE EXCEPTION 'Certification failed: % target row(s) match more than one live item.', v_ambiguous; END IF;`)
  push(``)

  push(`  -- 6. Update ONLY has_alcohol, difficulty, photo_required, checkin_type, visit_profile_key.`)
  push(`  UPDATE public.items i`)
  push(`  SET has_alcohol = v.has_alcohol,`)
  push(`      difficulty = v.difficulty,`)
  push(`      photo_required = v.photo_required,`)
  push(`      checkin_type = v.checkin_type,`)
  push(`      visit_profile_key = v.visit_profile_key`)
  push(`  FROM (VALUES`)
  push(valuesBlock + ')')
  push(`  AS v(maps_query, has_alcohol, difficulty, photo_required, checkin_type, visit_profile_key)`)
  push(`  WHERE lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`    AND i.neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id = v_metro_id);`)
  push(``)

  push(`  -- 7. Verify all ${EXPECTED_TOTAL} rows now carry exactly their intended target values.`)
  push(`  SELECT count(*) INTO v_wrong_value_count FROM (VALUES`)
  push(valuesBlock + ')')
  push(`  AS v(maps_query, has_alcohol, difficulty, photo_required, checkin_type, visit_profile_key)`)
  push(`  JOIN public.items i`)
  push(`    ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  WHERE i.has_alcohol IS DISTINCT FROM v.has_alcohol`)
  push(`     OR i.difficulty IS DISTINCT FROM v.difficulty`)
  push(`     OR i.photo_required IS DISTINCT FROM v.photo_required`)
  push(`     OR i.checkin_type IS DISTINCT FROM v.checkin_type`)
  push(`     OR i.visit_profile_key IS DISTINCT FROM v.visit_profile_key;`)
  push(`  IF v_wrong_value_count > 0 THEN`)
  push(`    RAISE EXCEPTION 'Certification failed: % row(s) do not carry their intended metadata values after the UPDATE.', v_wrong_value_count;`)
  push(`  END IF;`)
  push(``)

  push(`  -- 8. Verify total catalog count is still ${EXPECTED_TOTAL}.`)
  push(`  SELECT count(*) INTO v_total_after FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_total_after <> ${EXPECTED_TOTAL} THEN`)
  push(`    RAISE EXCEPTION 'Certification failed: expected exactly ${EXPECTED_TOTAL} items after this patch, found %.', v_total_after;`)
  push(`  END IF;`)
  push(``)

  push(`  -- 9. Final notices — computed live from the now-updated rows, not hardcoded.`)
  push(`  SELECT count(*) FILTER (WHERE i.has_alcohol = true), count(*) FILTER (WHERE i.has_alcohol = false)`)
  push(`    INTO v_alcohol_true, v_alcohol_false`)
  push(`    FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  SELECT count(*) FILTER (WHERE i.difficulty = 1), count(*) FILTER (WHERE i.difficulty = 5), count(*) FILTER (WHERE i.difficulty = 10), count(*) FILTER (WHERE i.difficulty NOT IN (1,5,10))`)
  push(`    INTO v_diff_1, v_diff_5, v_diff_10, v_diff_other`)
  push(`    FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  SELECT count(*) FILTER (WHERE i.checkin_type = 'photo'), count(*) FILTER (WHERE i.checkin_type = 'tap')`)
  push(`    INTO v_photo, v_tap`)
  push(`    FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(``)
  push(`  RAISE NOTICE '=== SAN DIEGO METADATA PATCH — FINAL RESULT ===';`)
  push(`  RAISE NOTICE 'has_alcohol: % true / % false', v_alcohol_true, v_alcohol_false;`)
  push(`  RAISE NOTICE 'difficulty: %@1, %@5, %@10, %@other', v_diff_1, v_diff_5, v_diff_10, v_diff_other;`)
  push(`  RAISE NOTICE 'checkin_type: % photo / % tap', v_photo, v_tap;`)
  push(`  RAISE NOTICE 'total items: % (unchanged from before: %)', v_total_after, v_total_before;`)
  push(`  RAISE NOTICE 'CERTIFICATION: PASS';`)
  push(`END $$;`)

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-metadata-patch-${new Date().toISOString().slice(0, 10)}.sql`
  writeFileSync(outPath, lines.join('\n'))
  console.error(`\nWrote ${outPath}`)
  console.error(`${allRecords.length} items patched (5 columns only), single atomic DO block, no temp tables.`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
