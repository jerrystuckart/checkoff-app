-- REVIEW ONLY — NOT A MIGRATION. Do not run with `supabase db query --linked`
-- against production without reading the counts/caveats below and editing
-- the CASE branches you disagree with. This file proposes an initial
-- items.visit_profile_key backfill across the FULL catalog (all metros —
-- there is nothing city-conditional here, matching the app-wide feature).
--
-- Prerequisite: 20260828_visit_detection_phase1.sql must already be applied
-- (visit_detection_profiles + items.visit_profile_key must exist).
--
-- Rule followed throughout: when in doubt, leave NULL (manual_only). Every
-- row this file would touch is confidently mapped; rows this file does NOT
-- touch (see the "needs manual review" counts below) are left for you to
-- classify by hand, because guessing on a broad/ambiguous item is worse than
-- leaving it manual_only.
--
-- Photo-required status is untouched by this mapping and stays enforced by
-- existing logic regardless of visit_profile_key (screens/PhotoCheckInScreen.jsx,
-- items.photo_required) — a photo-required item can still be auto-detected
-- as a candidate visit, it just can't be *recovered* without the photo.

-- =============================================================================
-- COUNTS, computed against the live catalog on 2026-08-29 (1,280 total items):
--
--   is_universal (never geofenced regardless of profile) ......... 318
--   non-universal, missing maps_lat/lng (can't be geofenced) .......16
--   -----------------------------------------------------------------
--   Proposed auto-assignment (this file, if run as-is):
--     bar          (category = Bar & drinks, Nightlife) ........... 189
--     attraction   (category = Arts & Culture) .....................88
--     fast_casual  (category = Food & drink, keyword match) .........56
--     quick_stop   (category = Food & drink, keyword match) .........53
--     retail       (category = Shopping) ............................38
--     restaurant   (category = Food & drink, keyword match) ..........20
--                                                          subtotal: 444
--   -----------------------------------------------------------------
--   Needs manual review (left NULL / manual_only by this file) .... 502
--     Food & drink (no keyword match)  ............................117
--     Adventure (whole category — too ambiguous: could be a trail,
--       an escape room, a zip line, a broad outdoor area) ..........113
--     Misc (whole category, by definition ambiguous) .................51
--     Play (arcade/mini-golf/kids venue vs. broad "play" activity) ...51
--     Sports (participate vs. spectate vs. broad activity) ...........49
--     Travel (landmark vs. transit hub vs. broad destination) ........47
--     Social (bar-adjacent vs. broad meetup/community activity) ......45
--     Spa & self-care (no matching profile shape in the 10 seeded
--       profiles — closest is "attraction" but dwell doesn't fit a
--       typical spa visit well; flagged rather than force-fit) .......29
--
-- The Food & drink keyword split is a heuristic over item "body" text
-- (a flavor-copy dare, e.g. "Order the beer brat at 'State Street Brats'"),
-- not a structured venue-type field — the catalog has no such field
-- (confirmed: no venue_type/place_type column, and google_place_id doesn't
-- have its Google Places `types` array persisted). Expect some misses in
-- both directions; spot-check before running.
-- =============================================================================

BEGIN;

UPDATE items i
SET visit_profile_key = 'bar'
FROM categories c
WHERE c.id = i.category_id
  AND c.name IN ('Bar & drinks', 'Nightlife')
  AND NOT i.is_universal
  AND i.maps_lat IS NOT NULL AND i.maps_lng IS NOT NULL
  AND i.visit_profile_key IS NULL;

UPDATE items i
SET visit_profile_key = 'attraction'
FROM categories c
WHERE c.id = i.category_id
  AND c.name = 'Arts & Culture'
  AND NOT i.is_universal
  AND i.maps_lat IS NOT NULL AND i.maps_lng IS NOT NULL
  AND i.visit_profile_key IS NULL;

UPDATE items i
SET visit_profile_key = 'retail'
FROM categories c
WHERE c.id = i.category_id
  AND c.name = 'Shopping'
  AND NOT i.is_universal
  AND i.maps_lat IS NOT NULL AND i.maps_lng IS NOT NULL
  AND i.visit_profile_key IS NULL;

UPDATE items i
SET visit_profile_key = 'quick_stop'
FROM categories c
WHERE c.id = i.category_id
  AND c.name = 'Food & drink'
  AND NOT i.is_universal
  AND i.maps_lat IS NOT NULL AND i.maps_lng IS NOT NULL
  AND i.visit_profile_key IS NULL
  AND i.body ~* '(coffee|caf[eé]|espresso|latte|bakery|donut|doughnut|bagel|ice cream|gelato|boba|juice bar|tea house)';

UPDATE items i
SET visit_profile_key = 'fast_casual'
FROM categories c
WHERE c.id = i.category_id
  AND c.name = 'Food & drink'
  AND NOT i.is_universal
  AND i.maps_lat IS NOT NULL AND i.maps_lng IS NOT NULL
  AND i.visit_profile_key IS NULL
  AND i.body ~* '(taco|pizza|bbq|barbecue|sandwich|deli|burger|wings|noodle|food truck|biscuit|chili|hot dog)';

UPDATE items i
SET visit_profile_key = 'restaurant'
FROM categories c
WHERE c.id = i.category_id
  AND c.name = 'Food & drink'
  AND NOT i.is_universal
  AND i.maps_lat IS NOT NULL AND i.maps_lng IS NOT NULL
  AND i.visit_profile_key IS NULL
  AND i.body ~* '(restaurant|bistro|steakhouse|sushi|dining|brasserie|kitchen|eatery|supper club)';

-- Sanity check before committing — compare against the counts documented
-- above; if these numbers drift a lot from what's printed there, the
-- catalog has changed since this file was written and you should re-derive
-- counts before trusting the UPDATEs.
DO $$
DECLARE assigned_count int;
BEGIN
  SELECT count(*) INTO assigned_count FROM items WHERE visit_profile_key IS NOT NULL;
  RAISE NOTICE 'Total items now carrying a visit_profile_key: %', assigned_count;
END $$;

-- Left as a ROLLBACK, not COMMIT — flip manually once you've reviewed the
-- NOTICE output and are ready to apply.
ROLLBACK;
