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
// GENERATED, NOT APPLIED. This repo's agent_service DB role has no
// demonstrated write path to `items` in this session, and
// `metro_launch.stage_catalog_write`'s standing AUTO authority is
// explicitly scoped to "staged (is_active=false) writes only" — San
// Diego currently has 34 already-ACTIVE items mixed into these same
// 149 rows, so this write falls outside that scope. Per Jerry's
// explicit instruction, this generates the exact SQL for him to run
// via Supabase SQL Editor rather than attempting a direct write.
//
// Usage: npx tsx scripts/generate-san-diego-metadata-patch.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { loadEnvFile, dollarQuote, buildFinalRecords } from './sanDiegoReconciliationShared'
import { evaluateItemMetadata, evaluateMetadataCompletenessGate, type MetadataEnrichmentResult } from '../agent-service/playbooks/metroMetadataEnrichment'

loadEnvFile('.env')

const EXPECTED_TOTAL = 149

// The one confirmed manual override across all 149 live items (Jerry's
// exported field-state report, 2026-09-06).
const KNOWN_MANUAL_OVERRIDES: Record<string, { difficulty?: number; photoRequired?: boolean }> = {
  'The Goods': { difficulty: 10, photoRequired: true },
}

// The 10 real visit_detection_profiles keys (confirmed via direct
// inspection of supabase/migrations/20260828_visit_detection_phase1.sql —
// agent_service has no SELECT grant on this table to verify live, so the
// generated SQL itself asserts every key it's about to write actually
// exists in the live table before writing anything).
const KNOWN_VISIT_PROFILE_KEYS = ['quick_stop', 'retail', 'fast_casual', 'restaurant', 'bar', 'attraction', 'outdoor', 'event', 'landmark', 'manual_only']

async function main() {
  const sd = await buildFinalRecords('san-diego', [])
  const tj = await buildFinalRecords('san-diego-tijuana-extension', [])
  const allRecords = [...sd.records, ...tj.records]

  if (allRecords.length !== EXPECTED_TOTAL) {
    console.error(`FATAL: rebuilt ${allRecords.length} candidates, expected exactly ${EXPECTED_TOTAL}. Refusing to generate a patch against a drifted candidate set — catalog membership must stay frozen.`)
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

  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`-- Chief M10 — San Diego/Tijuana METADATA PATCH (approved 2026-09-06).`)
  push(`-- GENERATED, NOT APPLIED. Writes ONLY has_alcohol, difficulty, photo_required,`)
  push(`-- checkin_type, visit_profile_key for the already-reconciled ${EXPECTED_TOTAL} items.`)
  push(`-- Never touches body, category, neighborhood, catalog membership, is_active,`)
  push(`-- is_secret, metro_areas/curated_lists state, geo fields, or website_url.`)
  push(`--`)
  push(`-- Values computed by agent-service/playbooks/metroMetadataEnrichment.ts's`)
  push(`-- corrected, Jerry-approved rules: has_alcohol is an ITEM property (word-boundary`)
  push(`-- keyword match on the item's own task, never inferred from venue category);`)
  push(`-- is_secret is NEVER touched by this or any pass (separate paid business feature,`)
  push(`-- confirmed out of scope for this patch — the column isn't even in the UPDATE`)
  push(`-- below); difficulty follows the completion-effort rubric (1/5/10, never`)
  push(`-- auto-25); The Goods' existing manual difficulty=10/photo_required=true override`)
  push(`-- is preserved verbatim (baked into its target values below, not special-cased`)
  push(`-- in SQL).`)
  push(``)
  push(`BEGIN;`)
  push(``)

  // ── Preflight ──
  push(`-- ── Preflight ──────────────────────────────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_metro_id uuid;`)
  push(`  v_total_count int;`)
  push(`  v_bad_key_count int;`)
  push(`BEGIN`)
  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego';`)
  push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'Preflight failed: san-diego metro_areas row missing.'; END IF;`)
  push(`  SELECT count(*) INTO v_total_count FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_total_count <> ${EXPECTED_TOTAL} THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: expected exactly ${EXPECTED_TOTAL} San Diego/Tijuana items, found %. Catalog membership must be frozen before this metadata-only patch runs.', v_total_count;`)
  push(`  END IF;`)
  push(`  SELECT count(*) INTO v_bad_key_count FROM (VALUES ${KNOWN_VISIT_PROFILE_KEYS.map((k) => `(${dollarQuote(k, 'vpk')})`).join(', ')}) AS wanted(key)`)
  push(`  WHERE NOT EXISTS (SELECT 1 FROM public.visit_detection_profiles vdp WHERE vdp.key = wanted.key);`)
  push(`  IF v_bad_key_count > 0 THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: % of the visit_profile_key value(s) this patch is about to write do not exist in visit_detection_profiles — the FK would fail. Investigate before proceeding.', v_bad_key_count;`)
  push(`  END IF;`)
  push(`END $$;`)
  push(``)

  // ── Patch target temp table ──
  push(`-- ── Patch target — ${EXPECTED_TOTAL} rows, matched to live items by exact normalized`)
  push(`-- maps_query (already proven 1:1 by the post-apply verification's Check 2/3). ──`)
  push(`CREATE TEMP TABLE _sd_metadata_patch (`)
  push(`  maps_query text PRIMARY KEY,`)
  push(`  has_alcohol boolean NOT NULL,`)
  push(`  difficulty int NOT NULL,`)
  push(`  photo_required boolean NOT NULL,`)
  push(`  checkin_type text NOT NULL,`)
  push(`  visit_profile_key text`)
  push(`) ON COMMIT DROP;`)
  push(``)
  push(`INSERT INTO _sd_metadata_patch (maps_query, has_alcohol, difficulty, photo_required, checkin_type, visit_profile_key) VALUES`)
  allRecords.forEach((r, i) => {
    const m = byName.get(r.candidateName)!
    const comma = i < allRecords.length - 1 ? ',' : ';'
    const vpk = m.visitProfileKey.value ? dollarQuote(m.visitProfileKey.value, 'vpk') : 'NULL'
    push(
      `  (${dollarQuote(r.mapsQuery, 'mq')}, ${m.hasAlcohol.value}, ${m.difficulty.value}, ${m.photoRequired.value}, ${dollarQuote(m.checkinType.value, 'ct')}, ${vpk})${comma}`
    )
  })
  push(``)

  // ── Pre-mutation certification ──
  push(`-- ── PRE-MUTATION INTEGRITY CERTIFICATION ─────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_unmatched int;`)
  push(`  v_ambiguous int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) INTO v_unmatched FROM _sd_metadata_patch p`)
  push(`  WHERE NOT EXISTS (`)
  push(`    SELECT 1 FROM public.items i`)
  push(`    JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`    WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`      AND lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  );`)
  push(`  IF v_unmatched > 0 THEN`)
  push(`    RAISE EXCEPTION '[PRE-MUTATION] Certification failed: % patch row(s) match no live item — catalog membership may have drifted since this patch was generated.', v_unmatched;`)
  push(`  END IF;`)
  push(`  SELECT count(*) INTO v_ambiguous FROM (`)
  push(`    SELECT p.maps_query, count(i.id) AS match_count`)
  push(`    FROM _sd_metadata_patch p`)
  push(`    JOIN public.items i`)
  push(`      ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`    JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`    WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`    GROUP BY p.maps_query`)
  push(`    HAVING count(i.id) <> 1`)
  push(`  ) x;`)
  push(`  IF v_ambiguous > 0 THEN`)
  push(`    RAISE EXCEPTION '[PRE-MUTATION] Certification failed: % patch row(s) match more than one live item.', v_ambiguous;`)
  push(`  END IF;`)
  push(`  RAISE NOTICE '[PRE-MUTATION] CERTIFICATION: PASS — all ${EXPECTED_TOTAL} patch rows resolve to exactly one live item each.';`)
  push(`END $$;`)
  push(``)

  // ── Before-snapshot of untouched columns ──
  push(`-- ── Snapshot of every column this patch must NOT change — compared against the`)
  push(`-- same snapshot post-mutation to prove nothing else moved. ──`)
  push(`CREATE TEMP TABLE _sd_before_snapshot AS`)
  push(`SELECT i.id, i.body, i.category_id, i.neighborhood_id, i.is_active, i.is_secret, i.maps_query, i.is_universal`)
  push(`FROM public.items i`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego');`)
  push(``)

  // ── The actual metadata UPDATE ──
  push(`-- ── The metadata UPDATE — ONLY these 5 columns. ──`)
  push(`UPDATE public.items i`)
  push(`SET has_alcohol = p.has_alcohol,`)
  push(`    difficulty = p.difficulty,`)
  push(`    photo_required = p.photo_required,`)
  push(`    checkin_type = p.checkin_type,`)
  push(`    visit_profile_key = p.visit_profile_key`)
  push(`FROM _sd_metadata_patch p`)
  push(`WHERE lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  AND i.id IN (SELECT id FROM _sd_before_snapshot);`)
  push(``)

  // ── Post-mutation certification ──
  push(`-- ── POST-MUTATION INTEGRITY CERTIFICATION ────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_final_total int;`)
  push(`  v_untouched_field_violations int;`)
  push(`  v_wrong_value_count int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) INTO v_final_total FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego');`)
  push(`  IF v_final_total <> ${EXPECTED_TOTAL} THEN`)
  push(`    RAISE EXCEPTION '[POST-MUTATION] Certification failed: expected exactly ${EXPECTED_TOTAL} San Diego/Tijuana items after this patch, found %.', v_final_total;`)
  push(`  END IF;`)
  push(``)
  push(`  -- Every one of the untouched columns (body, category, neighborhood, is_active,`)
  push(`  -- is_secret) must be byte-for-byte identical to the before-snapshot.`)
  push(`  SELECT count(*) INTO v_untouched_field_violations`)
  push(`  FROM public.items i`)
  push(`  JOIN _sd_before_snapshot s ON s.id = i.id`)
  push(`  WHERE i.body IS DISTINCT FROM s.body`)
  push(`     OR i.category_id IS DISTINCT FROM s.category_id`)
  push(`     OR i.neighborhood_id IS DISTINCT FROM s.neighborhood_id`)
  push(`     OR i.is_active IS DISTINCT FROM s.is_active`)
  push(`     OR i.is_secret IS DISTINCT FROM s.is_secret`)
  push(`     OR i.maps_query IS DISTINCT FROM s.maps_query`)
  push(`     OR i.is_universal IS DISTINCT FROM s.is_universal;`)
  push(`  IF v_untouched_field_violations > 0 THEN`)
  push(`    RAISE EXCEPTION '[POST-MUTATION] Certification failed: % row(s) had a field outside this patch''s scope (body/category/neighborhood/is_active/is_secret/maps_query/is_universal) change — this patch must ONLY touch has_alcohol/difficulty/photo_required/checkin_type/visit_profile_key.', v_untouched_field_violations;`)
  push(`  END IF;`)
  push(``)
  push(`  -- Every patched row must now carry EXACTLY the intended value for all 5 fields.`)
  push(`  SELECT count(*) INTO v_wrong_value_count`)
  push(`  FROM public.items i`)
  push(`  JOIN _sd_metadata_patch p`)
  push(`    ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  WHERE i.has_alcohol IS DISTINCT FROM p.has_alcohol`)
  push(`     OR i.difficulty IS DISTINCT FROM p.difficulty`)
  push(`     OR i.photo_required IS DISTINCT FROM p.photo_required`)
  push(`     OR i.checkin_type IS DISTINCT FROM p.checkin_type`)
  push(`     OR i.visit_profile_key IS DISTINCT FROM p.visit_profile_key;`)
  push(`  IF v_wrong_value_count > 0 THEN`)
  push(`    RAISE EXCEPTION '[POST-MUTATION] Certification failed: % row(s) do not carry their intended metadata values after the UPDATE.', v_wrong_value_count;`)
  push(`  END IF;`)
  push(``)
  push(`  RAISE NOTICE '[POST-MUTATION] CERTIFICATION: PASS — ${EXPECTED_TOTAL} total items, 0 out-of-scope field changes, 0 value mismatches.';`)
  push(`END $$;`)
  push(``)

  // ── Final summary ──
  push(`-- ── Final summary ──────────────────────────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_alcohol_true int; v_alcohol_false int;`)
  push(`  v_diff_1 int; v_diff_5 int; v_diff_10 int; v_diff_other int;`)
  push(`  v_photo int; v_tap int;`)
  push(`  v_secret_true int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) FILTER (WHERE has_alcohol = true), count(*) FILTER (WHERE has_alcohol = false)`)
  push(`    INTO v_alcohol_true, v_alcohol_false FROM _sd_metadata_patch;`)
  push(`  SELECT count(*) FILTER (WHERE difficulty = 1), count(*) FILTER (WHERE difficulty = 5), count(*) FILTER (WHERE difficulty = 10), count(*) FILTER (WHERE difficulty NOT IN (1,5,10))`)
  push(`    INTO v_diff_1, v_diff_5, v_diff_10, v_diff_other FROM _sd_metadata_patch;`)
  push(`  SELECT count(*) FILTER (WHERE checkin_type = 'photo'), count(*) FILTER (WHERE checkin_type = 'tap')`)
  push(`    INTO v_photo, v_tap FROM _sd_metadata_patch;`)
  push(`  SELECT count(*) INTO v_secret_true FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.is_secret = true;`)
  push(`  RAISE NOTICE '=== SAN DIEGO METADATA PATCH — FINAL RESULT ===';`)
  push(`  RAISE NOTICE 'has_alcohol: % true / % false', v_alcohol_true, v_alcohol_false;`)
  push(`  RAISE NOTICE 'difficulty: %@1, %@5, %@10, %@other', v_diff_1, v_diff_5, v_diff_10, v_diff_other;`)
  push(`  RAISE NOTICE 'checkin_type: % photo / % tap', v_photo, v_tap;`)
  push(`  RAISE NOTICE 'is_secret=true count (must be unchanged from before this patch): %', v_secret_true;`)
  push(`  RAISE NOTICE 'CERTIFICATION: PASS';`)
  push(`END $$;`)
  push(``)
  push(`COMMIT;`)
  push(``)
  push(`-- Untouched by this file: body, category_id, neighborhood_id, catalog membership`)
  push(`-- (curated_list_items), is_active, is_secret, metro_areas.is_active,`)
  push(`-- curated_lists.is_active, all geo fields, website_url. metro/lists remain`)
  push(`-- inactive; no activation performed here.`)

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-metadata-patch-${new Date().toISOString().slice(0, 10)}.sql`
  writeFileSync(outPath, lines.join('\n'))
  console.error(`\nWrote ${outPath}`)
  console.error(`${allRecords.length} items patched (5 columns only): has_alcohol/difficulty/photo_required/checkin_type/visit_profile_key.`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
