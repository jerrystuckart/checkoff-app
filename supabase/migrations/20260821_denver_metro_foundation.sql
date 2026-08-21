BEGIN;

-- ============================================================
-- Denver/Boulder metro foundation
-- 2026-08-21 — NOT APPLIED. Generated for review only.
--
-- Staged inactive (metro_areas.is_active = false) per
-- docs/metro-launch-audit/07_denver_metro_manifest_draft.md — confirmed
-- as the working "hidden from city selector" mechanism. Flip to true as
-- the actual launch trigger, once Part A's platform fixes are applied
-- (this file assumes 20260821_metro_timezone_platform_fix.sql has
-- already been applied, since it references metro_areas.timezone).
--
-- All ids use gen_random_uuid() — no literal UUIDs anywhere in this file.
-- Coordinates below were NOT guessed — each one was confirmed via a live
-- call to the Google Places API (places:searchText), using the exact
-- same request shape as scripts/geocode-items.js's existing
-- searchText()/buildBiasResolver() pattern (same endpoint, same field
-- mask, same locationBias-with-20km-radius convention), run against the
-- GOOGLE_PLACES_API_KEY already present in this repo's .env. Raw results
-- are preserved for review at
-- docs/metro-launch-audit/patches/denver_neighborhood_places_results.json.
-- ============================================================

-- ── SECTION 1: metro_areas row (B1) ──────────────────────────────────────
-- Display name: DEFAULT to the established "{City} Metro" single-word
-- convention used by all 3 existing metros (Phoenix/Milwaukee/Tucson
-- Metro) — "Denver Metro" below. JUDGMENT CALL, flagged: a compound name
-- ("Denver / Boulder Metro") would better represent Longmont/Boulder's
-- first-class-coverage requirement (decision brief, coverage statement),
-- and no code path found anywhere in the app assumes a single-word
-- display name (confirmed in docs/metro-launch-audit/07 — metro_areas.name
-- is plain text, no format constraint). Defaulting to the established
-- convention here on the principle of least surprise; change the literal
-- string below before applying if the compound name is preferred instead.
INSERT INTO public.metro_areas (id, name, slug, state, timezone, is_active, center_lat, center_lng, hero_images, center_geo)
VALUES (
  gen_random_uuid(),
  'Denver Metro',              -- JUDGMENT CALL — see comment above
  'denver',                    -- decision #1, locked
  'CO',
  'America/Denver',            -- decision #2 context: set now so seasonal content can be turned on later without a code round-trip
  false,                       -- staged hidden; flip at coordinated launch
  39.7451998, -104.9921849,    -- Downtown Denver, confirmed via Places API (same convention as existing metros' center = principal downtown)
  '{}',                        -- hero_images — see docs/metro-launch-audit/10_denver_followups_not_done.md, B8: none generated in this pass
  ST_SetSRID(ST_MakePoint(-104.9921849, 39.7451998), 4326)
);

-- ── SECTION 2: neighborhoods rows (B2) ───────────────────────────────────
-- Full 19-area list per decision #5, not consolidated. Ring radii are
-- individually tiered by nearest-neighbor distance, NOT the schema's
-- 20mi/40mi defaults (sized for Phoenix/Milwaukee's spread-out geography
-- — confirmed too wide for Denver in
-- docs/metro-launch-audit/01_current_schema_and_relationships.md).
--
-- Tiering method: computed the real haversine distance between every
-- pair of the 19 confirmed coordinates, then verified programmatically
-- that ring_2 (the widest tier used) never sums to more than the actual
-- distance between any two neighborhoods sharing that tier or an
-- adjacent one — i.e. no two ring_2 circles overlap anywhere in this set.
-- ring_3_radius_m is left NULL for all 19 (nullable, no default in the
-- schema) — the audit found no evidence this "destination tier" ring
-- applies to core-metro neighborhoods in any existing metro; flag if a
-- Denver-specific destination-tier use is wanted later.
--
--   Tier            ring_0 / ring_1 / ring_2 (meters)   Members
--   tight_core       150 /  300 /  420                  Denver Central, RiNo/Five Points, LoDo/Union Station, Capitol Hill/Uptown, Highlands/Sunnyside
--   medium           400 /  800 / 1200                  Cherry Creek, Washington Park/South Denver, Berkeley/Tennyson
--   boulder_tight    400 /  800 / 1600                  Louisville/Superior, Lafayette
--   moderate_suburb  800 / 1600 / 2400                  Arvada, Westminster, Thornton/Northglenn, Broomfield, Erie
--   spread          1200 / 2400 / 4000                  Lakewood, Golden, Boulder, Longmont
--
-- JUDGMENT CALL, flagged: the exact meter values within each tier are my
-- own calibration (targeting "ring_2 circles never overlap a real
-- neighbor," not any documented CheckOff design rule — no such rule was
-- found anywhere in the audit). A reviewer with local knowledge of where
-- people actually expect a check-off to register may want to adjust
-- individual values; the invariant worth preserving if you do is
-- re-running the overlap check, not matching these numbers exactly.

WITH denver AS (SELECT id FROM public.metro_areas WHERE slug = 'denver')
INSERT INTO public.neighborhoods (id, metro_id, name, slug, state, center_geo, ring_0_radius_m, ring_1_radius_m, ring_2_radius_m, ring_3_radius_m, is_active)
SELECT gen_random_uuid(), denver.id, v.name, v.slug, 'CO',
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326),
       v.ring_0, v.ring_1, v.ring_2, NULL, true
FROM denver, (VALUES
  -- tight_core (150/300/420)
  ('Denver Central',              'denver-central',          39.7451998, -104.9921849, 150, 300, 420),
  ('RiNo / Five Points',          'rino-five-points',        39.7594926, -104.9848447, 150, 300, 420),
  ('LoDo / Union Station',        'lodo-union-station',       39.7514972, -104.9979721, 150, 300, 420),
  ('Capitol Hill / Uptown',       'capitol-hill-uptown',      39.7336946, -104.9822970, 150, 300, 420),
  ('Highlands / Sunnyside',       'highlands-sunnyside',      39.7632186, -105.0111788, 150, 300, 420),
  -- medium (400/800/1200)
  ('Cherry Creek',                'cherry-creek',             39.7177954, -104.9502150, 400, 800, 1200),
  ('Washington Park / South Denver','washington-park-south-denver', 39.7002435, -104.9687106, 400, 800, 1200),
  ('Berkeley / Tennyson',         'berkeley-tennyson',        39.7766775, -105.0392527, 400, 800, 1200),
  -- boulder_tight (400/800/1600)
  ('Louisville / Superior',       'louisville-superior',      39.9777630, -105.1319296, 400, 800, 1600),
  ('Lafayette',                   'lafayette',                39.9935959, -105.0897058, 400, 800, 1600),
  -- moderate_suburb (800/1600/2400)
  ('Arvada',                      'arvada',                   39.8027644, -105.0874842, 800, 1600, 2400),
  ('Westminster',                 'westminster',              39.8366528, -105.0372046, 800, 1600, 2400),
  ('Thornton / Northglenn',       'thornton-northglenn',      39.8680412, -104.9719243, 800, 1600, 2400),
  ('Broomfield',                  'broomfield',               39.9205411, -105.0866504, 800, 1600, 2400),
  ('Erie',                        'erie',                     40.0502623, -105.0499817, 800, 1600, 2400),
  -- spread (1200/2400/4000)
  ('Lakewood',                    'lakewood',                 39.7047095, -105.0813734, 1200, 2400, 4000),
  ('Golden',                      'golden',                   39.7555430, -105.2210997, 1200, 2400, 4000),
  ('Boulder',                     'boulder',                  40.0189728, -105.2747406, 1200, 2400, 4000),
  ('Longmont',                    'longmont',                 40.1672068, -105.1019275, 1200, 2400, 4000)
) AS v(name, slug, lat, lng, ring_0, ring_1, ring_2);

-- ── SECTION 3: audience_groups (mechanical implementation of B5) ────────
-- REVIEW docs/metro-launch-audit/09_denver_audience_groups_draft.md
-- BEFORE applying this section — the group names/count/theming there are
-- an explicit product-judgment draft, not a verified finding. This
-- section implements that draft as-is; edit the VALUES below (or skip
-- this section entirely) if the draft is rejected or changed.
-- emoji/tagline/description/image_url are intentionally left NULL —
-- copywriting was explicitly out of scope for the draft.
WITH denver AS (SELECT id FROM public.metro_areas WHERE slug = 'denver')
INSERT INTO public.audience_groups (id, name, city_slug, is_active, display_order)
SELECT gen_random_uuid(), v.name, 'denver', true, v.display_order
FROM (VALUES
  ('Trail Mix Crew',          0),
  ('Main Character Cardio',   0),
  ('Soft Launch Season',      0),
  ('Snack Pack Survivors',    0),
  ('Powder Day People',       0),
  ('Hoptimists',              0),
  ('RiNo Rats',               0),
  ('Pearl Street Regulars',   0)
) AS v(name, display_order)
CROSS JOIN denver;

-- ── SECTION 4: official/public seasonal list shell + curated_lists (B7) ─
-- One official/public seasonal list TEMPLATE — item staging is
-- explicitly out of scope (B6, see doc 10), so this list is created with
-- zero list_items. Per docs/metro-launch-audit/04_list_model_and_seasonal_selection.md's
-- traced HomeScreen selection logic (earliest-ends_at-among-active wins,
-- ties broken by most-recently-created — NOT title matching): only ONE
-- official+public list should exist per active window for Denver, so
-- this migration creates exactly one, not the 8-concurrent pattern
-- Phoenix has today.
--
-- VERIFIED against real data in a follow-up review pass (2026-08-21,
-- see docs/metro-launch-audit/12_followup_timezone_and_placeholder_review.md) —
-- creator_id and the title format below are no longer guesses:
--
-- creator_id: queried all 17 current is_official=true AND is_public=true
-- lists across Phoenix/Milwaukee/Tucson. Every single one — 100%, no
-- exceptions — has creator_id = the one and only is_admin=true user in
-- the entire users table (jerrystuckart@hotmail.com,
-- 11275026-65be-4421-80a4-46c57195408b). The original placeholder
-- ("oldest admin user by created_at") would have resolved to the same
-- row today by coincidence (there is only one admin), but that was an
-- unverified guess, not a confirmed pattern — fixed to match by email
-- instead of a fragile "oldest of however many admins exist" ordering,
-- which would silently pick the wrong one if a second admin is ever
-- added before this is applied.
--
-- title: of those same 17 rows, the subset that are each metro's actual
-- SEASONAL HERO list (as opposed to a themed list like "Roosevelt Row"
-- or "Wisconsin Weird" that also happens to be is_official/is_public)
-- follows "{Season} {Year} — {Metro} Metro" with zero exceptions:
-- "Summer 2026 — Phoenix Metro", "Fall 2026 — Phoenix Metro",
-- "Summer 2026 — Milwaukee Metro", "Fall 2026 — Milwaukee Metro",
-- "Summer 2026 — Tucson Metro", "Fall 2026 — Tucson Metro". This
-- confirms doc 04/03's documented convention exactly — no correction
-- needed here, unlike creator_id. Fixed the placeholder's actual season
-- word from the invented "Launch" to an explicit, unmistakable
-- placeholder token instead, so this can't be applied by accident with a
-- fake season name baked in.
--
-- starts_at/ends_at and the real {SEASON}/{YEAR} values are intentionally
-- STILL a placeholder — which season Denver launches in, and its exact
-- dates, is a product decision for Jerry, not something to invent here.
WITH denver AS (SELECT id FROM public.metro_areas WHERE slug = 'denver')
INSERT INTO public.lists (id, creator_id, title, metro_id, starts_at, ends_at, is_public, is_official, cover_emoji)
SELECT gen_random_uuid(),
       (SELECT id FROM public.users WHERE email = 'jerrystuckart@hotmail.com' AND is_admin = true), -- VERIFIED, not a guess — see comment above
       '{SEASON} {YEAR} — Denver Metro',   -- PLACEHOLDER — real season/year is a product decision, not invented here; format itself is verified correct
       denver.id,
       NULL, NULL,                      -- PLACEHOLDER dates — set before applying, once a launch season is chosen
       true, true, NULL
FROM denver;

-- curated_lists rows for each Section 3 audience group, each with an
-- explicit curated_list_metros row (per docs/metro-launch-audit/04 —
-- zero curated_list_metros rows means universal/visible-everywhere,
-- confirmed via direct read of fetchCuratedLists(); Denver-exclusive
-- audience-group lists need an explicit row, not the fallback).
-- Zero curated_list_items rows — item staging out of scope (B6).
WITH denver AS (SELECT id FROM public.metro_areas WHERE slug = 'denver'),
     groups AS (SELECT id, name FROM public.audience_groups WHERE city_slug = 'denver'),
     new_lists AS (
       INSERT INTO public.curated_lists (id, title, audience_group_id, city_slug, is_active, slug)
       SELECT gen_random_uuid(), groups.name || ' · Denver', groups.id, 'denver', false, -- is_active=false: BLOCKED by the curated_lists RLS gap until 20260821_curated_lists_rls_fix.sql is applied — see that migration's header
              lower(regexp_replace(groups.name, '[^a-zA-Z0-9]+', '-', 'g'))
       FROM groups
       RETURNING id
     )
INSERT INTO public.curated_list_metros (id, curated_list_id, city_slug)
SELECT gen_random_uuid(), new_lists.id, 'denver'
FROM new_lists;

-- ============================================================
-- NOT COMPLETED / FLAGGED — read before applying:
--
-- 1. Section 1's display name: SETTLED as "Denver Metro" (confirmed in a
--    follow-up pass) — no longer an open judgment call, already what
--    this file generates.
-- 2. Section 4's list creator_id: RESOLVED in a follow-up review pass —
--    now a verified query (matches the exact account used by 100% of
--    Phoenix/Milwaukee/Tucson's real official lists), not a guess. See
--    the comment directly above Section 4's INSERT and
--    docs/metro-launch-audit/12_followup_timezone_and_placeholder_review.md.
-- 3. Section 4's list title format: RESOLVED — verified to match the
--    documented "{Season} {Year} — {Metro} Metro" convention exactly
--    against real data, no correction needed. The literal season/year
--    and starts_at/ends_at remain an explicit open placeholder — that's
--    a product decision (which season Denver launches in), not
--    something this pass invents.
-- 4. Section 3's audience-group names/count are explicitly a draft — see
--    doc 09 — not a verified/locked decision despite being implemented
--    as ready-to-apply SQL here.
-- 5. cities row: intentionally SKIPPED per decision (B3) — confirmed
--    non-essential by the audit.
-- 6. tags: intentionally NOT touched per decision (B4) — global table
--    used as-is.
-- ============================================================

COMMIT;
