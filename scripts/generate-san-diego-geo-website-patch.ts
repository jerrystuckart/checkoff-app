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
// EXECUTION-COMPATIBILITY REWRITE (2026-09-06): same fix as the
// metadata patch — Jerry hit `relation "_sd_metadata_patch" does not
// exist` because Supabase SQL Editor doesn't reliably preserve a
// CREATE TEMP TABLE across multiple statements in that execution path.
// This version is ONE statement: a single `DO $$ ... $$;` block with
// the 139 certified target rows inlined as literal `VALUES (...)` data
// directly in every SQL statement that needs them — no CREATE TEMP
// TABLE, no session-persistent object, no statement depends on
// anything an earlier statement created. Any RAISE EXCEPTION rolls
// back the entire block automatically.
//
// Writes ONLY: google_place_id, formatted_address, maps_lat, maps_lng,
// geo_location (derived from maps_lat/maps_lng via the SAME formula as
// the existing update_item_location() RPC —
// ST_SetSRID(ST_MakePoint(lng, lat), 4326) — supabase/migrations/
// 20260811_update_item_location_rpc.sql), geo_radius_m (left NULL
// except where the cached Places viewport genuinely justified a
// specific value — the app's existing 500m fallback, per
// lib/geoFence.js's DEFAULT_GEOFENCE_RADIUS_M, covers everything else),
// website_url. Skips a before/after snapshot of unrelated columns for
// the same reason the metadata patch does — `public.items`'s only two
// triggers are both scoped to `season_tag` and
// `is_secret`/`active_cover_candidate_id`, neither of which this patch
// touches, so neither can fire.
//
// Match certification against the cache (no new API calls):
//   - REJECTED_WRONG_MATCHES (7): cached top result is a confirmed
//     wrong venue (named explicitly by Jerry) — excluded, left NULL.
//   - NO_CANONICAL_VENUE (2): an org address standing in for an event
//     site, or an explicitly "(various operators)" experience with no
//     single correct venue by design — excluded, left NULL.
//   - UNRESOLVED_NO_RESULT (1): Places returned zero results (a
//     touring event, not a fixed venue) — excluded, left NULL.
//   - Everything else (120 EXACT + 5 HIGH_CONFIDENCE_PARENT_VENUE + 14
//     ambiguous rows individually re-examined against their cached
//     address/neighborhood/country/parent-venue context and found
//     correct) is certified: 139 items total.
//
// Usage: npx tsx scripts/generate-san-diego-geo-website-patch.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { loadEnvFile, dollarQuote, buildFinalRecords } from './sanDiegoReconciliationShared'

loadEnvFile('.env')

const DRY_RUN_CACHE_PATH = 'scripts/output/san-diego-places-dry-run-2026-09-06.json'
const EXPECTED_TOTAL = 149

const REJECTED_WRONG_MATCHES: Record<string, string> = {
  'Tianguis de la Raza Artisan Market': 'Cached top result "Centro Cultural de la Raza" is a different institution, not the artisan market.',
  'Black Mizu Café': 'Cached top result "Caffe Italia" is an unrelated restaurant.',
  'Cageless Shark Diving (La Jolla Cove)': 'Cached top result "La Jolla Cove Guided Snorkeling Tour" is a different activity/operator entirely.',
  'Zip Line & Climbing Wall at Camp Bashor': 'Cached top result "Jump Around Now Trampoline & Adventure Park" is an unrelated venue.',
  'White Rice': 'Cached top result "Chopstix 2 Mira Mesa" is an unrelated restaurant.',
  "Tita's Kitchenette": 'Cached top result "R & B Filipino Cuisine" is an unrelated restaurant.',
  'Estación Federal': 'Cached top result "PedWest Garita Tijuana" is a border-crossing checkpoint, not a venue.',
}
const NO_CANONICAL_VENUE: Record<string, string> = {
  'San Diego Pride Parade & Festival': 'Cached result "San Diego Pride" (3620 30th St) is the organization\'s office address, not the parade route (Hillcrest) or festival site (Balboa Park).',
  'Whale Watching & Dolphin Cruises (various operators)': 'Item is explicitly "(various operators)" — the cached top result is one real operator among several; picking it as canonical would misrepresent the item.',
}
const UNRESOLVED_NO_RESULT: Record<string, string> = {
  'Damn Am San Diego (Skate Event)': 'Zero Places results — a touring/traveling skate contest, not a fixed business. Needs the existing event/location methodology, not a forced Places match.',
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

  const excludedFromPatch: Array<{ candidateName: string; mapsQuery: string; reason: string; bucket: string }> = []
  const certified: Array<{ candidateName: string; mapsQuery: string; result: CachedTopResult; geoRadiusM: number | null; bucket: string }> = []

  for (const r of allRecords) {
    const cached = cachedByName.get(r.candidateName)
    if (!cached) {
      console.error(`FATAL: "${r.candidateName}" is in the current 149-item catalog but not in the cached Places dry run — catalog has drifted since the cache was built.`)
      process.exitCode = 1
      return
    }
    if (REJECTED_WRONG_MATCHES[r.candidateName]) {
      excludedFromPatch.push({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, reason: REJECTED_WRONG_MATCHES[r.candidateName], bucket: 'REJECTED_WRONG_MATCH' })
      continue
    }
    if (NO_CANONICAL_VENUE[r.candidateName]) {
      excludedFromPatch.push({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, reason: NO_CANONICAL_VENUE[r.candidateName], bucket: 'NO_CANONICAL_VENUE' })
      continue
    }
    if (UNRESOLVED_NO_RESULT[r.candidateName]) {
      excludedFromPatch.push({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, reason: UNRESOLVED_NO_RESULT[r.candidateName], bucket: 'UNRESOLVED_NO_RESULT' })
      continue
    }
    if (!cached.topResult || cached.topResult.lat == null || cached.topResult.lng == null) {
      excludedFromPatch.push({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, reason: 'No usable cached coordinates.', bucket: 'NO_USABLE_CACHE' })
      continue
    }
    const bucket = cached.matchTier === 'AMBIGUOUS_NEEDS_REVIEW' ? 'AMBIGUOUS_RESOLVED_FROM_CACHE' : cached.matchTier
    certified.push({ candidateName: r.candidateName, mapsQuery: r.mapsQuery, result: cached.topResult, geoRadiusM: cached.proposedGeoRadiusM, bucket })
  }

  console.error(`Certified from cache: ${certified.length}. Excluded: ${excludedFromPatch.length}.`)
  console.error(`  EXACT: ${certified.filter((c) => c.bucket === 'EXACT').length}`)
  console.error(`  HIGH_CONFIDENCE_PARENT_VENUE: ${certified.filter((c) => c.bucket === 'HIGH_CONFIDENCE_PARENT_VENUE').length}`)
  console.error(`  AMBIGUOUS_RESOLVED_FROM_CACHE: ${certified.filter((c) => c.bucket === 'AMBIGUOUS_RESOLVED_FROM_CACHE').length}`)
  const websitesReady = certified.filter((c) => c.result.websiteUri).length
  console.error(`Websites ready from cache: ${websitesReady} / ${certified.length} certified rows.`)

  // ── Certification report (unchanged shape from before) ──
  mkdirSync('scripts/output', { recursive: true })
  const reportPath = `scripts/output/san-diego-geo-website-certification-${new Date().toISOString().slice(0, 10)}.json`
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

  // The literal VALUES(...) rows shared verbatim across every SQL statement in the block.
  const valuesRows = certified.map((c) => {
    const addr = c.result.formattedAddress ? dollarQuote(c.result.formattedAddress, 'addr') : 'NULL'
    const web = c.result.websiteUri ? dollarQuote(c.result.websiteUri, 'web') : 'NULL'
    const radius = c.geoRadiusM != null ? c.geoRadiusM : 'NULL'
    return `    (${dollarQuote(c.mapsQuery, 'mq')}, ${dollarQuote(c.result.placeId!, 'pid')}, ${addr}, ${c.result.lat}, ${c.result.lng}, ${radius}, ${web})`
  })
  const valuesBlock = valuesRows.join(',\n')

  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`-- Chief M10 — San Diego/Tijuana GEO/WEBSITE PATCH (from cached Places dry run only).`)
  push(`-- GENERATED, NOT APPLIED. ONE statement: a single DO $$ ... $$ block, no CREATE`)
  push(`-- TEMP TABLE, no session-persistent object. ZERO new Google Places API calls were`)
  push(`-- made to produce this file — every value comes from scripts/output/san-diego-`)
  push(`-- places-dry-run-2026-09-06.json, the already-paid-for research pass. ${certified.length} of`)
  push(`-- ${allRecords.length} items are certified and included; ${excludedFromPatch.length} are excluded (7 confirmed wrong`)
  push(`-- cached matches, 2 items with no single canonical venue, 1 event with zero`)
  push(`-- Places results) and left completely untouched.`)
  push(`--`)
  push(`-- Writes ONLY: google_place_id, formatted_address, maps_lat, maps_lng, geo_location`)
  push(`-- (ST_SetSRID(ST_MakePoint(lng, lat), 4326) — the exact formula`)
  push(`-- update_item_location() RPC uses), geo_radius_m (NULL unless cached viewport`)
  push(`-- data justified a value — falls back to the app's existing 500m default),`)
  push(`-- website_url (from Places' websiteUri where the cache returned one).`)
  push(``)
  push(`DO $$`)
  push(`DECLARE`)
  push(`  v_metro_id uuid;`)
  push(`  v_total_before int;`)
  push(`  v_unmatched int;`)
  push(`  v_ambiguous int;`)
  push(`  v_wrong_value_count int;`)
  push(`  v_excluded_wrongly_set int;`)
  push(`  v_total_after int;`)
  push(`  v_geocoded int; v_website int; v_ca int; v_mx int;`)
  push(`BEGIN`)

  push(`  SELECT id INTO v_metro_id FROM public.metro_areas WHERE slug = 'san-diego';`)
  push(`  IF v_metro_id IS NULL THEN RAISE EXCEPTION 'Certification failed: san-diego metro_areas row missing.'; END IF;`)
  push(``)

  push(`  SELECT count(*) INTO v_total_before FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_total_before <> ${EXPECTED_TOTAL} THEN`)
  push(`    RAISE EXCEPTION 'Certification failed: expected exactly ${EXPECTED_TOTAL} San Diego/Tijuana items, found %. Catalog membership must be frozen before this geo/website-only patch runs.', v_total_before;`)
  push(`  END IF;`)
  push(``)

  push(`  -- ${certified.length} certified target rows (inline VALUES, no temp table) — verify every`)
  push(`  -- target maps to exactly one live item before touching anything.`)
  push(`  SELECT count(*) INTO v_unmatched FROM (VALUES`)
  push(valuesBlock + ')')
  push(`  AS v(maps_query, google_place_id, formatted_address, maps_lat, maps_lng, geo_radius_m, website_url)`)
  push(`  WHERE NOT EXISTS (`)
  push(`    SELECT 1 FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`    WHERE nb.metro_id = v_metro_id`)
  push(`      AND lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  );`)
  push(`  IF v_unmatched > 0 THEN RAISE EXCEPTION 'Certification failed: % certified row(s) match no live item.', v_unmatched; END IF;`)
  push(``)

  push(`  SELECT count(*) INTO v_ambiguous FROM (`)
  push(`    SELECT v.maps_query, count(i.id) AS c FROM (VALUES`)
  push(valuesBlock + ')')
  push(`    AS v(maps_query, google_place_id, formatted_address, maps_lat, maps_lng, geo_radius_m, website_url)`)
  push(`    JOIN public.items i`)
  push(`      ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`    JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id AND nb.metro_id = v_metro_id`)
  push(`    GROUP BY v.maps_query HAVING count(i.id) <> 1`)
  push(`  ) x;`)
  push(`  IF v_ambiguous > 0 THEN RAISE EXCEPTION 'Certification failed: % certified row(s) match more than one live item.', v_ambiguous; END IF;`)
  push(``)

  push(`  -- The geo/website UPDATE — ONLY these 6 columns.`)
  push(`  UPDATE public.items i`)
  push(`  SET google_place_id = v.google_place_id,`)
  push(`      formatted_address = v.formatted_address,`)
  push(`      maps_lat = v.maps_lat,`)
  push(`      maps_lng = v.maps_lng,`)
  push(`      geo_location = ST_SetSRID(ST_MakePoint(v.maps_lng, v.maps_lat), 4326),`)
  push(`      geo_radius_m = v.geo_radius_m,`)
  push(`      website_url = v.website_url`)
  push(`  FROM (VALUES`)
  push(valuesBlock + ')')
  push(`  AS v(maps_query, google_place_id, formatted_address, maps_lat, maps_lng, geo_radius_m, website_url)`)
  push(`  WHERE lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`    AND i.neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id = v_metro_id);`)
  push(``)

  push(`  -- Verify all ${certified.length} certified rows now carry exactly their intended values.`)
  push(`  SELECT count(*) INTO v_wrong_value_count FROM (VALUES`)
  push(valuesBlock + ')')
  push(`  AS v(maps_query, google_place_id, formatted_address, maps_lat, maps_lng, geo_radius_m, website_url)`)
  push(`  JOIN public.items i`)
  push(`    ON lower(regexp_replace(btrim(i.maps_query), '[^a-zA-Z0-9]+', '', 'g')) = lower(regexp_replace(btrim(v.maps_query), '[^a-zA-Z0-9]+', '', 'g'))`)
  push(`  WHERE i.google_place_id IS DISTINCT FROM v.google_place_id`)
  push(`     OR i.formatted_address IS DISTINCT FROM v.formatted_address`)
  push(`     OR i.maps_lat IS DISTINCT FROM v.maps_lat`)
  push(`     OR i.maps_lng IS DISTINCT FROM v.maps_lng`)
  push(`     OR i.website_url IS DISTINCT FROM v.website_url`)
  push(`     OR ST_X(i.geo_location::geometry) IS DISTINCT FROM v.maps_lng`)
  push(`     OR ST_Y(i.geo_location::geometry) IS DISTINCT FROM v.maps_lat;`)
  push(`  IF v_wrong_value_count > 0 THEN`)
  push(`    RAISE EXCEPTION 'Certification failed: % certified row(s) do not carry their intended geo/website values.', v_wrong_value_count;`)
  push(`  END IF;`)
  push(``)

  push(`  -- Verify all ${excludedFromPatch.length} excluded items remain without a newly assigned google_place_id.`)
  push(`  SELECT count(*) INTO v_excluded_wrongly_set FROM public.items i`)
  push(`  JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id`)
  push(`  WHERE nb.metro_id = v_metro_id`)
  push(`    AND i.maps_query IN (${excludedFromPatch.map((e) => dollarQuote(e.mapsQuery, 'exq')).join(', ')})`)
  push(`    AND i.google_place_id IS NOT NULL;`)
  push(`  IF v_excluded_wrongly_set > 0 THEN`)
  push(`    RAISE EXCEPTION 'Certification failed: % excluded row(s) unexpectedly got a google_place_id — they must stay untouched.', v_excluded_wrongly_set;`)
  push(`  END IF;`)
  push(``)

  push(`  SELECT count(*) INTO v_total_after FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id;`)
  push(`  IF v_total_after <> ${EXPECTED_TOTAL} THEN RAISE EXCEPTION 'Certification failed: expected exactly ${EXPECTED_TOTAL} items after this patch, found %.', v_total_after; END IF;`)
  push(``)

  push(`  SELECT count(*) INTO v_geocoded FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.google_place_id IS NOT NULL;`)
  push(`  SELECT count(*) INTO v_website FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.website_url IS NOT NULL;`)
  push(`  SELECT count(*) INTO v_ca FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.google_place_id IS NOT NULL AND nb.state = 'CA';`)
  push(`  SELECT count(*) INTO v_mx FROM public.items i JOIN public.neighborhoods nb ON nb.id = i.neighborhood_id WHERE nb.metro_id = v_metro_id AND i.google_place_id IS NOT NULL AND nb.state = 'Baja California, Mexico';`)
  push(``)
  push(`  RAISE NOTICE '=== SAN DIEGO GEO/WEBSITE PATCH — FINAL RESULT ===';`)
  push(`  RAISE NOTICE 'Geocoded: % / ${EXPECTED_TOTAL}', v_geocoded;`)
  push(`  RAISE NOTICE 'Website populated: %', v_website;`)
  push(`  RAISE NOTICE 'Geocoded CA-side: %, Mexico-side: %', v_ca, v_mx;`)
  push(`  RAISE NOTICE 'total items: % (unchanged from before: %)', v_total_after, v_total_before;`)
  push(`  RAISE NOTICE 'CERTIFICATION: PASS';`)
  push(`END $$;`)
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
