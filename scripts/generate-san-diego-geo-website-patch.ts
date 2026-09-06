#!/usr/bin/env -S npx tsx
// scripts/generate-san-diego-geo-website-patch.ts
//
// Geo/website patch for the San Diego/Tijuana catalog, built ENTIRELY
// from the already-paid-for Places dry-run cache
// (scripts/output/san-diego-places-dry-run-2026-09-06.json) — this
// script makes ZERO Google Places API calls. Per Jerry's explicit
// instruction (2026-09-06): the dry-run JSON is now the authoritative
// cached enrichment artifact for this metro; a future apply step must
// never re-call Places just because the research step was dry-run.
//
// Writes ONLY: google_place_id, formatted_address, maps_lat, maps_lng,
// geo_location (derived from maps_lat/maps_lng via the SAME formula as
// the existing update_item_location() RPC —
// ST_SetSRID(ST_MakePoint(lng, lat), 4326) — supabase/migrations/
// 20260811_update_item_location_rpc.sql), geo_radius_m (left NULL
// except where the cached Places viewport genuinely justified a
// specific value — the app's existing 500m fallback, per
// lib/geoFence.js's DEFAULT_GEOFENCE_RADIUS_M, covers everything else;
// no new radius rule invented here), website_url.
//
// Never touches body, category, neighborhood, catalog membership,
// is_active, is_secret, metro/list state, or the 5 metadata columns
// from the separate metadata patch (has_alcohol, difficulty,
// photo_required, checkin_type, visit_profile_key) — all snapshotted
// and diffed post-mutation to prove it.
//
// Match certification against the cache (no new API calls, per rule):
//   - REJECTED_WRONG_MATCHES: 7 items where the cached top result is a
//     confirmed wrong venue (named explicitly by Jerry) — excluded
//     from this patch entirely, left NULL for a future corrected pass.
//   - NO_CANONICAL_VENUE: items where the cached candidate is either
//     an org address that isn't the actual event site (San Diego
//     Pride's HQ, not the parade route) or an explicitly
//     "(various operators)" experience with no single correct venue by
//     design — excluded, left NULL.
//   - UNRESOLVED_NO_RESULT: the 1 item Places returned zero results for
//     (Damn Am San Diego, a touring skate event) — excluded, left
//     NULL; per Jerry's instruction, this needs the existing event/
//     location methodology, not a forced venue guess.
//   - Everything else (120 EXACT + 5 HIGH_CONFIDENCE_PARENT_VENUE + 14
//     ambiguous rows individually re-examined against their cached
//     address/neighborhood/country/parent-venue context and found
//     correct) is certified and included: 139 items total.
//
// Usage: npx tsx scripts/generate-san-diego-geo-website-patch.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { loadEnvFile, dollarQuote, buildFinalRecords } from './sanDiegoReconciliationShared'

loadEnvFile('.env')

const DRY_RUN_CACHE_PATH = 'scripts/output/san-diego-places-dry-run-2026-09-06.json'
const EXPECTED_TOTAL = 149

// 7 confirmed wrong cached matches (Jerry, 2026-09-06) — never applied.
const REJECTED_WRONG_MATCHES: Record<string, string> = {
  'Tianguis de la Raza Artisan Market': 'Cached top result "Centro Cultural de la Raza" is a different institution, not the artisan market.',
  'Black Mizu Café': 'Cached top result "Caffe Italia" is an unrelated restaurant.',
  'Cageless Shark Diving (La Jolla Cove)': 'Cached top result "La Jolla Cove Guided Snorkeling Tour" is a different activity/operator entirely.',
  'Zip Line & Climbing Wall at Camp Bashor': 'Cached top result "Jump Around Now Trampoline & Adventure Park" is an unrelated venue.',
  'White Rice': 'Cached top result "Chopstix 2 Mira Mesa" is an unrelated restaurant.',
  "Tita's Kitchenette": 'Cached top result "R & B Filipino Cuisine" is an unrelated restaurant.',
  'Estación Federal': 'Cached top result "PedWest Garita Tijuana" is a border-crossing checkpoint, not a venue.',
}

// Items where the cached candidate is real but NOT a valid single physical
// venue for this CheckOff item — an org HQ address standing in for an
// event site, or an explicitly multi-operator experience with no one
// correct venue by design.
const NO_CANONICAL_VENUE: Record<string, string> = {
  'San Diego Pride Parade & Festival': 'Cached result "San Diego Pride" (3620 30th St) is the organization\'s office address, not the parade route (Hillcrest) or festival site (Balboa Park) — using it would geofence the wrong location entirely.',
  'Whale Watching & Dolphin Cruises (various operators)': 'Item is explicitly "(various operators)" — the cached top result ("San Diego Whale Watch") is one real operator among several; picking it as canonical would misrepresent the item as belonging to a single company it does not.',
}

// The 1 item Places returned zero results for at all.
const UNRESOLVED_NO_RESULT: Record<string, string> = {
  'Damn Am San Diego (Skate Event)': 'Zero Places results — a touring/traveling skate contest, not a fixed business. Needs the existing event/location methodology (e.g. host-venue-only or manual location), not a forced Places match.',
}

interface CachedTopResult {
  name: string
  formattedAddress: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  websiteUri: string | null
  country: string | null
}
interface CachedRow {
  candidateName: string
  mapsQuery: string
  matchTier: 'EXACT' | 'HIGH_CONFIDENCE_PARENT_VENUE' | 'AMBIGUOUS_NEEDS_REVIEW' | 'UNRESOLVED'
  topResult: CachedTopResult | null
  riskFlags: { areaOrDistrict: boolean; multiLocationChain: boolean }
  proposedGeoRadiusM: number | null
}

async function main() {
  const cache = JSON.parse(readFileSync(DRY_RUN_CACHE_PATH, 'utf8')) as { allRows: CachedRow[] }
  const cachedByName = new Map(cache.allRows.map((r) => [r.candidateName, r]))

  const sd = await buildFinalRecords('san-diego', [])
  const tj = await buildFinalRecords('san-diego-tijuana-extension', [])
  const allRecords = [...sd.records, ...tj.records]

  if (allRecords.length !== EXPECTED_TOTAL) {
    console.error(`FATAL: rebuilt ${allRecords.length} candidates, expected exactly ${EXPECTED_TOTAL}. Refusing — catalog membership must stay frozen.`)
    process.exitCode = 1
    return
  }

  const excludedFromPatch: Array<{ candidateName: string; reason: string; bucket: string }> = []
  const certified: Array<{ candidateName: string; mapsQuery: string; result: CachedTopResult; geoRadiusM: number | null; bucket: string }> = []

  for (const r of allRecords) {
    const cached = cachedByName.get(r.candidateName)
    if (!cached) {
      console.error(`FATAL: "${r.candidateName}" is in the current 149-item catalog but not in the cached Places dry run — catalog has drifted since the cache was built. Refusing to guess; re-run the dry run for real if this is expected.`)
      process.exitCode = 1
      return
    }
    if (REJECTED_WRONG_MATCHES[r.candidateName]) {
      excludedFromPatch.push({ candidateName: r.candidateName, reason: REJECTED_WRONG_MATCHES[r.candidateName], bucket: 'REJECTED_WRONG_MATCH' })
      continue
    }
    if (NO_CANONICAL_VENUE[r.candidateName]) {
      excludedFromPatch.push({ candidateName: r.candidateName, reason: NO_CANONICAL_VENUE[r.candidateName], bucket: 'NO_CANONICAL_VENUE' })
      continue
    }
    if (UNRESOLVED_NO_RESULT[r.candidateName]) {
      excludedFromPatch.push({ candidateName: r.candidateName, reason: UNRESOLVED_NO_RESULT[r.candidateName], bucket: 'UNRESOLVED_NO_RESULT' })
      continue
    }
    if (!cached.topResult || cached.topResult.lat == null || cached.topResult.lng == null) {
      excludedFromPatch.push({ candidateName: r.candidateName, reason: 'No usable cached coordinates.', bucket: 'NO_USABLE_CACHE' })
      continue
    }
    const bucket = cached.matchTier === 'AMBIGUOUS_NEEDS_REVIEW' ? 'AMBIGUOUS_RESOLVED_FROM_CACHE' : cached.matchTier
    certified.push({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, result: cached.topResult, geoRadiusM: cached.proposedGeoRadiusM, bucket })
  }

  console.error(`Certified from cache: ${certified.length}. Excluded: ${excludedFromPatch.length}.`)
  console.error(`  EXACT: ${certified.filter((c) => c.bucket === 'EXACT').length}`)
  console.error(`  HIGH_CONFIDENCE_PARENT_VENUE: ${certified.filter((c) => c.bucket === 'HIGH_CONFIDENCE_PARENT_VENUE').length}`)
  console.error(`  AMBIGUOUS_RESOLVED_FROM_CACHE: ${certified.filter((c) => c.bucket === 'AMBIGUOUS_RESOLVED_FROM_CACHE').length}`)
  console.error(`  REJECTED_WRONG_MATCH: ${excludedFromPatch.filter((e) => e.bucket === 'REJECTED_WRONG_MATCH').length}`)
  console.error(`  NO_CANONICAL_VENUE: ${excludedFromPatch.filter((e) => e.bucket === 'NO_CANONICAL_VENUE').length}`)
  console.error(`  UNRESOLVED_NO_RESULT: ${excludedFromPatch.filter((e) => e.bucket === 'UNRESOLVED_NO_RESULT').length}`)
  const websitesReady = certified.filter((c) => c.result.websiteUri).length
  console.error(`Websites ready from cache: ${websitesReady} / ${certified.length} certified rows.`)

  // ── Write the certification report (no SQL yet) ──
  const reportPath = `scripts/output/san-diego-geo-website-certification-${new Date().toISOString().slice(0, 10)}.json`
  mkdirSync('scripts/output', { recursive: true })
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'cached dry run only — zero new Places API calls',
        totalItems: allRecords.length,
        certifiedCount: certified.length,
        excludedCount: excludedFromPatch.length,
        certified: certified.map((c) => ({ candidateName: c.candidateName, bucket: c.bucket, placeId: c.result.placeId, formattedAddress: c.result.formattedAddress, lat: c.result.lat, lng: c.result.lng, websiteUri: c.result.websiteUri, geoRadiusM: c.geoRadiusM })),
        excluded: excludedFromPatch,
      },
      null,
      2
    )
  )
  console.error(`Wrote ${reportPath}`)

  // ── Build the SQL patch ──
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`-- Chief M10 — San Diego/Tijuana GEO/WEBSITE PATCH (from cached Places dry run only).`)
  push(`-- GENERATED, NOT APPLIED. ZERO new Google Places API calls were made to produce`)
  push(`-- this file — every value below comes from scripts/output/san-diego-places-dry-run-`)
  push(`-- 2026-09-06.json, the already-paid-for research pass. ${certified.length} of ${allRecords.length} items`)
  push(`-- are certified and included; ${excludedFromPatch.length} are excluded (7 confirmed wrong cached`)
  push(`-- matches, 2 items with no single canonical venue, 1 event with zero Places`)
  push(`-- results) and left completely untouched — their google_place_id/`)
  push(`-- formatted_address/maps_lat/maps_lng/geo_location/website_url stay whatever they`)
  push(`-- already are (NULL, per the original field-state audit).`)
  push(`--`)
  push(`-- Writes ONLY: google_place_id, formatted_address, maps_lat, maps_lng, geo_location`)
  push(`-- (ST_SetSRID(ST_MakePoint(lng, lat), 4326) — the exact formula`)
  push(`-- update_item_location() RPC uses, supabase/migrations/20260811_update_item_`)
  push(`-- location_rpc.sql), geo_radius_m (left NULL except where cached Places viewport`)
  push(`-- data justified a specific value — NULL falls back to the app's existing 500m`)
  push(`-- default, lib/geoFence.js's DEFAULT_GEOFENCE_RADIUS_M, no new rule invented), and`)
  push(`-- website_url (from Places' websiteUri where the cache returned one).`)
  push(`--`)
  push(`-- Never touches body, category, neighborhood, catalog membership, is_active,`)
  push(`-- is_secret, metro_areas/curated_lists state, or the 5 separate metadata columns`)
  push(`-- (has_alcohol, difficulty, photo_required, checkin_type, visit_profile_key) —`)
  push(`-- all snapshotted and diffed post-mutation to prove it.`)
  push(``)
  push(`BEGIN;`)
  push(``)

  push(`-- ── Preflight ──────────────────────────────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE v_metro_id uuid; v_total_count int;`)
  push(`BEGIN`)
  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego';`)
  push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'Preflight failed: san-diego metro_areas row missing.'; END IF;`)
  push(`  SELECT count(*) INTO v_total_count FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_total_count <> ${EXPECTED_TOTAL} THEN`)
  push(`    RAISE EXCEPTION 'Preflight failed: expected exactly ${EXPECTED_TOTAL} San Diego/Tijuana items, found %. Catalog membership must be frozen before this geo/website-only patch runs.', v_total_count;`)
  push(`  END IF;`)
  push(`END $$;`)
  push(``)

  push(`-- ── Patch target — ${certified.length} certified rows (of ${allRecords.length} total; ${excludedFromPatch.length} excluded, see`)
  push(`-- header) — matched to live items by exact normalized maps_query. ──`)
  push(`CREATE TEMP TABLE _sd_geo_patch (`)
  push(`  maps_query text PRIMARY KEY,`)
  push(`  google_place_id text NOT NULL,`)
  push(`  formatted_address text,`)
  push(`  maps_lat double precision NOT NULL,`)
  push(`  maps_lng double precision NOT NULL,`)
  push(`  geo_radius_m int,`)
  push(`  website_url text`)
  push(`) ON COMMIT DROP;`)
  push(``)
  push(`INSERT INTO _sd_geo_patch (maps_query, google_place_id, formatted_address, maps_lat, maps_lng, geo_radius_m, website_url) VALUES`)
  certified.forEach((c, i) => {
    const comma = i < certified.length - 1 ? ',' : ';'
    const addr = c.result.formattedAddress ? dollarQuote(c.result.formattedAddress, 'addr') : 'NULL'
    const web = c.result.websiteUri ? dollarQuote(c.result.websiteUri, 'web') : 'NULL'
    const radius = c.geoRadiusM != null ? c.geoRadiusM : 'NULL'
    push(`  (${dollarQuote(c.mapsQuery, 'mq')}, ${dollarQuote(c.result.placeId!, 'pid')}, ${addr}, ${c.result.lat}, ${c.result.lng}, ${radius}, ${web})${comma}`)
  })
  push(``)

  push(`-- ── PRE-MUTATION INTEGRITY CERTIFICATION ─────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE v_unmatched int; v_ambiguous int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) INTO v_unmatched FROM _sd_geo_patch p`)
  push(`  WHERE NOT EXISTS (`)
  push(`    SELECT 1 FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`    WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`      AND lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  );`)
  push(`  IF v_unmatched > 0 THEN RAISE EXCEPTION '[PRE-MUTATION] Certification failed: % patch row(s) match no live item.', v_unmatched; END IF;`)
  push(`  SELECT count(*) INTO v_ambiguous FROM (`)
  push(`    SELECT p.maps_query, count(i.id) AS c FROM _sd_geo_patch p`)
  push(`    JOIN public.items i ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`    JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`    WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`    GROUP BY p.maps_query HAVING count(i.id) <> 1`)
  push(`  ) x;`)
  push(`  IF v_ambiguous > 0 THEN RAISE EXCEPTION '[PRE-MUTATION] Certification failed: % patch row(s) match more than one live item.', v_ambiguous; END IF;`)
  push(`  RAISE NOTICE '[PRE-MUTATION] CERTIFICATION: PASS — all ${certified.length} patch rows resolve to exactly one live item each.';`)
  push(`END $$;`)
  push(``)

  push(`-- ── Snapshot of every column this patch must NOT change ──`)
  push(`CREATE TEMP TABLE _sd_before_snapshot AS`)
  push(`SELECT i.id, i.body, i.category_id, i.neighborhood_id, i.is_active, i.is_secret, i.maps_query, i.is_universal,`)
  push(`       i.has_alcohol, i.difficulty, i.photo_required, i.checkin_type, i.visit_profile_key`)
  push(`FROM public.items i`)
  push(`JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego');`)
  push(``)

  push(`-- ── The geo/website UPDATE — ONLY these 6 columns. ──`)
  push(`UPDATE public.items i`)
  push(`SET google_place_id = p.google_place_id,`)
  push(`    formatted_address = p.formatted_address,`)
  push(`    maps_lat = p.maps_lat,`)
  push(`    maps_lng = p.maps_lng,`)
  push(`    geo_location = ST_SetSRID(ST_MakePoint(p.maps_lng, p.maps_lat), 4326),`)
  push(`    geo_radius_m = p.geo_radius_m,`)
  push(`    website_url = p.website_url`)
  push(`FROM _sd_geo_patch p`)
  push(`WHERE lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  AND i.id IN (SELECT id FROM _sd_before_snapshot);`)
  push(``)

  push(`-- ── POST-MUTATION INTEGRITY CERTIFICATION ────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_final_total int;`)
  push(`  v_untouched_violations int;`)
  push(`  v_wrong_value_count int;`)
  push(`  v_excluded_still_null int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) INTO v_final_total FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego');`)
  push(`  IF v_final_total <> ${EXPECTED_TOTAL} THEN RAISE EXCEPTION '[POST-MUTATION] Certification failed: expected exactly ${EXPECTED_TOTAL} items, found %.', v_final_total; END IF;`)
  push(``)
  push(`  SELECT count(*) INTO v_untouched_violations`)
  push(`  FROM public.items i JOIN _sd_before_snapshot s ON s.id = i.id`)
  push(`  WHERE i.body IS DISTINCT FROM s.body`)
  push(`     OR i.category_id IS DISTINCT FROM s.category_id`)
  push(`     OR i.neighborhood_id IS DISTINCT FROM s.neighborhood_id`)
  push(`     OR i.is_active IS DISTINCT FROM s.is_active`)
  push(`     OR i.is_secret IS DISTINCT FROM s.is_secret`)
  push(`     OR i.maps_query IS DISTINCT FROM s.maps_query`)
  push(`     OR i.is_universal IS DISTINCT FROM s.is_universal`)
  push(`     OR i.has_alcohol IS DISTINCT FROM s.has_alcohol`)
  push(`     OR i.difficulty IS DISTINCT FROM s.difficulty`)
  push(`     OR i.photo_required IS DISTINCT FROM s.photo_required`)
  push(`     OR i.checkin_type IS DISTINCT FROM s.checkin_type`)
  push(`     OR i.visit_profile_key IS DISTINCT FROM s.visit_profile_key;`)
  push(`  IF v_untouched_violations > 0 THEN`)
  push(`    RAISE EXCEPTION '[POST-MUTATION] Certification failed: % row(s) had an out-of-scope field change — this patch must ONLY touch google_place_id/formatted_address/maps_lat/maps_lng/geo_location/geo_radius_m/website_url.', v_untouched_violations;`)
  push(`  END IF;`)
  push(``)
  push(`  SELECT count(*) INTO v_wrong_value_count`)
  push(`  FROM public.items i`)
  push(`  JOIN _sd_geo_patch p ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(p.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  WHERE i.google_place_id IS DISTINCT FROM p.google_place_id`)
  push(`     OR i.formatted_address IS DISTINCT FROM p.formatted_address`)
  push(`     OR i.maps_lat IS DISTINCT FROM p.maps_lat`)
  push(`     OR i.maps_lng IS DISTINCT FROM p.maps_lng`)
  push(`     OR i.website_url IS DISTINCT FROM p.website_url`)
  push(`     OR ST_X(i.geo_location::geometry) IS DISTINCT FROM p.maps_lng`)
  push(`     OR ST_Y(i.geo_location::geometry) IS DISTINCT FROM p.maps_lat;`)
  push(`  IF v_wrong_value_count > 0 THEN`)
  push(`    RAISE EXCEPTION '[POST-MUTATION] Certification failed: % certified row(s) do not carry their intended geo/website values.', v_wrong_value_count;`)
  push(`  END IF;`)
  push(``)
  push(`  -- The ${excludedFromPatch.length} excluded items must remain untouched (still NULL google_place_id).`)
  push(`  SELECT count(*) INTO v_excluded_still_null FROM public.items i`)
  push(`  JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`  WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego')`)
  push(`    AND i.maps_query IN (${excludedFromPatch.map((e) => dollarQuote(allRecords.find((r) => r.candidateName === e.candidateName)!.mapsQuery, 'exq')).join(', ')})`)
  push(`    AND i.google_place_id IS NOT NULL;`)
  push(`  IF v_excluded_still_null > 0 THEN`)
  push(`    RAISE EXCEPTION '[POST-MUTATION] Certification failed: % excluded row(s) unexpectedly got a google_place_id — they must stay untouched.', v_excluded_still_null;`)
  push(`  END IF;`)
  push(``)
  push(`  RAISE NOTICE '[POST-MUTATION] CERTIFICATION: PASS — ${certified.length} rows patched, ${excludedFromPatch.length} correctly left untouched, 0 out-of-scope changes.';`)
  push(`END $$;`)
  push(``)

  push(`-- ── Final summary ──────────────────────────────────────────────────────`)
  push(`DO $$`)
  push(`DECLARE v_geocoded int; v_website int; v_us int; v_mx int;`)
  push(`BEGIN`)
  push(`  SELECT count(*) INTO v_geocoded FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.google_place_id IS NOT NULL;`)
  push(`  SELECT count(*) INTO v_website FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.website_url IS NOT NULL;`)
  push(`  SELECT count(*) INTO v_us FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.google_place_id IS NOT NULL AND nb.state = 'CA';`)
  push(`  SELECT count(*) INTO v_mx FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'san-diego') AND i.google_place_id IS NOT NULL AND nb.state = 'Baja California, Mexico';`)
  push(`  RAISE NOTICE '=== SAN DIEGO GEO/WEBSITE PATCH — FINAL RESULT ===';`)
  push(`  RAISE NOTICE 'Geocoded: % / ${EXPECTED_TOTAL}', v_geocoded;`)
  push(`  RAISE NOTICE 'Website populated: %', v_website;`)
  push(`  RAISE NOTICE 'Geocoded CA-side: %, Mexico-side: %', v_us, v_mx;`)
  push(`  RAISE NOTICE 'CERTIFICATION: PASS';`)
  push(`END $$;`)
  push(``)
  push(`COMMIT;`)
  push(``)
  push(`-- Excluded from this patch (left NULL for a future corrected/targeted pass):`)
  excludedFromPatch.forEach((e) => push(`--   [${e.bucket}] ${e.candidateName} — ${e.reason}`))

  mkdirSync('scripts/output', { recursive: true })
  const outPath = `scripts/output/san-diego-geo-website-patch-${new Date().toISOString().slice(0, 10)}.sql`
  writeFileSync(outPath, lines.join('\n'))
  console.error(`\nWrote ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
