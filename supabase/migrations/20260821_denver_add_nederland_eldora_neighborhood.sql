BEGIN;

-- ============================================================
-- Add Nederland / Eldora neighborhood to the staged Denver Metro
-- 2026-08-21
--
-- Denver Metro (metro_areas.id b00f7f91-3176-48c5-aaf1-6ded7426f756,
-- slug 'denver') is currently staged with is_active=false and 19
-- neighborhoods (supabase/migrations/20260821_denver_metro_foundation.sql).
-- This migration adds a 20th: Nederland / Eldora, covering the mountain
-- town of Nederland and nearby Eldora Mountain Resort. It does NOT touch
-- metro_areas.is_active, cities, tags, items, list_items,
-- curated_list_items, audience_groups, or the official-list shell — the
-- new neighborhood row is exactly as reachable/unreachable by real users
-- as the other 19: not at all, while the parent metro stays inactive.
--
-- Coordinate source: live Google Places API call (places:searchText),
-- same request shape as scripts/geocode-items.js and the same method
-- used for the original 19 neighborhoods in the foundation migration.
-- Query: "Nederland, CO", biased toward Denver's own center per the same
-- 20km-radius bias convention. Result: "Nederland" / "Nederland, CO
-- 80466, USA" / lat 39.9613759, lng -105.5108312. A second Places call
-- for "Eldora Mountain Resort, CO" (lat 39.9372203, lng -105.5826786)
-- was made for distance-checking only, NOT as the neighborhood center —
-- per the task, Nederland (the town) is the center; Eldora is the
-- combined-geography case the ring radii need to cover. Both raw
-- responses are appended to
-- docs/metro-launch-audit/patches/denver_neighborhood_places_results.json
-- alongside the original 19.
--
-- Distance check: straight-line Nederland center -> Eldora Mountain
-- Resort = 4.16 mi (6,688 m) — close to the "approximately five miles"
-- estimate in the task, confirmed via haversine over the two live
-- Places coordinates above, not estimated.
--
-- Ring radii — NOT the standard 1200/2400/4000 "spread" tier used for
-- Boulder/Golden/Lakewood/Longmont in the foundation migration. Chosen
-- specifically for this neighborhood's own geography:
--   ring_0 = 2000m (~1.2mi)  — Nederland town core
--   ring_1 = 4500m (~2.8mi)  — most of the town + partway to Eldora
--   ring_2 = 8500m (~5.3mi)  — comfortably covers Eldora Mountain Resort
--                              (6,688m from center) with ~1,800m margin,
--                              without being larger than the combined
--                              geography actually calls for
-- Why these fit the application's resolution behavior: per
-- supabase/migrations/20260811_update_neighborhood_center_rpc.sql's own
-- documentation, neighborhoods.center_geo "doubles as the check-off
-- anchor for neighborhood-scoped items (they copy this center into their
-- own maps_lat/maps_lng with a wide radius)" — so a future Eldora-area
-- item, if created without its own precise coordinates, would inherit
-- Nederland's center and needs ring_2 wide enough to plausibly cover a
-- check-in actually happening at the resort. Confirmed via repo-wide
-- grep that ring_0/1/2/3_radius_m are not read by any live query in this
-- codebase today (same as the other 19) — they are reference values for
-- that future item-intake step and for the external admin tool
-- (checkoff_admin.html, not in this repo), not runtime-enforced here.
--
-- Overlap invariant: the foundation migration established "no two
-- ring_2 circles overlap anywhere in the Denver set," verified
-- programmatically. Nederland's nearest existing Denver-metro neighbor
-- is Boulder, 21,108m away (its ring_2 is 4,000m) — even at this
-- migration's much larger 8,500m ring_2, the sum (12,500m) is well
-- under the 21,108m gap, so the invariant holds with a wide margin
-- against every one of the 19 existing rows (Boulder is the nearest;
-- every other existing neighborhood is farther away with an equal or
-- smaller ring_2). Re-verified against the live table after this
-- migration is applied, not just precomputed here — see the
-- post-migration verification queries.
--
-- Idempotency: neighborhoods has a real UNIQUE (metro_id, slug)
-- constraint (neighborhoods_metro_id_slug_key, confirmed via
-- pg_constraint before writing this migration) — ON CONFLICT targets it
-- directly. An explicit WHERE NOT EXISTS guard (checking both slug and
-- name, scoped to Denver's metro_id) is layered on top rather than
-- relying on the constraint alone, matching this chain's established
-- practice of not depending solely on a constraint for idempotency.
-- gen_random_uuid() supplies the row's id — no literal UUID is written
-- anywhere in this file.
-- ============================================================

-- metro_id is resolved by subquery (WHERE slug='denver'), not a literal
-- UUID, even though it was verified above — matches the convention
-- established in 20260821_denver_metro_foundation.sql, avoiding any
-- transcription risk from hand-copying the id.
WITH denver AS (SELECT id FROM public.metro_areas WHERE slug = 'denver')
INSERT INTO public.neighborhoods (
  id, metro_id, name, slug, state, center_geo,
  ring_0_radius_m, ring_1_radius_m, ring_2_radius_m, ring_3_radius_m,
  is_active
)
SELECT
  gen_random_uuid(),
  denver.id,
  'Nederland / Eldora',
  'nederland-eldora',
  'CO',
  ST_SetSRID(ST_MakePoint(-105.5108312, 39.9613759), 4326),
  2000, 4500, 8500, NULL,
  true
FROM denver
WHERE NOT EXISTS (
  SELECT 1 FROM public.neighborhoods n
  WHERE n.metro_id = denver.id
    AND (n.slug = 'nederland-eldora' OR n.name ILIKE 'nederland%')
)
ON CONFLICT (metro_id, slug) DO NOTHING;

COMMIT;
