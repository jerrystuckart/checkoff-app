-- Visit-detection readiness as a property of item intake (2026-09-29).
--
-- Why: an item is only monitored on a phone when it has coordinates AND a visit_profile_key. The 2026-09-28 rule_v1
-- backfill was a one-time pass, so every item created afterwards through any path (admin, CSV/bulk intake, direct SQL,
-- Winston) silently stayed unmonitored (the Amalfi launch: 46 geocoded items, 0 monitored). This puts the same
-- conservative rule at the database, where every creation path passes, and adds a view that separates
-- "intentionally excluded" (manual_only) from "incomplete" (nothing was decided).
--
-- 1. classify_visit_profile(body, category): SQL port of lib/visitDetection/profileClassifier.js classifyVisitProfile.
--    Parity with the JS reference is checked over the whole live catalog by scripts/verify-visit-profile-parity.mjs.
-- 2. trigger: on INSERT/UPDATE of an active, geocoded, non-universal, non-secret item with a metro and NO profile,
--    fill the profile ONLY when the rule is confident (visit_profile_source = 'auto_v1'). Never overwrites a profile
--    (including manual_only), never assigns to universal/secret/un-geocoded/metro-less rows, never guesses.
-- 3. item_visit_readiness: one row per item with a state and the list of what is missing.
-- Reversible: DROP TRIGGER trg_zz_items_default_visit_profile ON items; then
--   UPDATE items SET visit_profile_key = NULL, visit_profile_source = NULL WHERE visit_profile_source = 'auto_v1';
BEGIN;

CREATE OR REPLACE FUNCTION public.classify_visit_profile(p_body text, p_category text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  -- JavaScript's \b, exactly (ASCII \w only), so accented keywords such as "café" behave the same in both implementations.
  b text := '(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))';
  quick_stop text := b || '(gelato|gelateria|ice[- ]cream|soft[- ]serve|cafe|café|caffè|coffee|espresso|latte|cappuccino|roaster(?:s|y)?|donut|doughnut|bakery|pastry|pastries|croissant|bagel|boba|smoothie|juice bar|cookie|scoop)' || b;
  outdoor text := b || '(park|trail|hike|hiking|beach|garden|gardens|lake|river|creek|pier|canyon|summit|overlook|viewpoint|lookout|tide pools?|kayak|paddle|nature reserve|botanical|dunes?|waterfall|boardwalk)' || b;
  attraction text := b || '(museum|zoo|aquarium|gallery|exhibit|observatory|planetarium|escape room|arcade|climbing|bouldering|theme park|cruise|tour|castle|palace|cathedral|basilica|church)' || b;
  brief_stop text := b || '(wine window|buchetta|walk-?up window|take-?away window|drive[- ]?thru|drive[- ]?through|through the [\w'' -]{0,40}window)' || b;
  event text := b || '(festival|tournament|marathon|parade|fireworks|concert|game|match|derby|race|regatta|rodeo)' || b;
  event_verb text := b || '(watch|attend|catch|join|cheer)' || b;
  named_venue text := '[''‘’"“”]\s*[A-Z0-9À-Ý][^''‘’"“”]{1,60}[''‘’"“”]';
  v_body text := COALESCE(p_body, '');
BEGIN
  IF v_body ~* brief_stop THEN RETURN NULL; END IF;
  IF v_body !~ named_venue THEN RETURN NULL; END IF;
  RETURN CASE p_category
    WHEN 'Bar & drinks' THEN 'bar'
    WHEN 'Nightlife' THEN CASE WHEN v_body ~* attraction THEN 'attraction' ELSE 'bar' END
    WHEN 'Arts & Culture' THEN 'attraction'
    WHEN 'Shopping' THEN 'retail'
    WHEN 'Food & drink' THEN CASE WHEN v_body ~* quick_stop THEN 'quick_stop' ELSE 'restaurant' END
    WHEN 'Spa & self-care' THEN 'attraction'
    WHEN 'Play' THEN 'attraction'
    WHEN 'Travel' THEN CASE WHEN v_body ~* outdoor THEN 'outdoor' ELSE 'attraction' END
    WHEN 'Sports' THEN CASE WHEN v_body ~* event AND v_body ~* event_verb THEN 'event' ELSE NULL END
    ELSE NULL
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.items_default_visit_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_category text;
  v_profile text;
BEGIN
  IF NEW.visit_profile_key IS NOT NULL THEN RETURN NEW; END IF;
  IF NOT COALESCE(NEW.is_active, false) OR COALESCE(NEW.is_universal, false) OR COALESCE(NEW.is_secret, false) THEN RETURN NEW; END IF;
  IF NEW.maps_lat IS NULL OR NEW.maps_lng IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM neighborhoods n WHERE n.id = NEW.neighborhood_id AND n.metro_id IS NOT NULL) THEN RETURN NEW; END IF;

  SELECT c.name INTO v_category FROM categories c WHERE c.id = NEW.category_id;
  v_profile := classify_visit_profile(NEW.body, v_category);
  IF v_profile IS NOT NULL AND EXISTS (SELECT 1 FROM visit_detection_profiles p WHERE p.key = v_profile AND p.is_active) THEN
    NEW.visit_profile_key := v_profile;
    NEW.visit_profile_source := 'auto_v1';
  END IF;
  RETURN NEW;
END;
$fn$;

-- Named trg_zz_ so it runs after the seasonal-activation trigger, which can flip is_active in the same statement.
DROP TRIGGER IF EXISTS trg_zz_items_default_visit_profile ON items;
CREATE TRIGGER trg_zz_items_default_visit_profile
  BEFORE INSERT OR UPDATE OF body, category_id, maps_lat, maps_lng, is_active, is_universal, is_secret, neighborhood_id, visit_profile_key
  ON items
  FOR EACH ROW EXECUTE FUNCTION items_default_visit_profile();

-- ---------------------------------------------------------------------------------------------------------------
-- Readiness: what the phone needs, per item.
--   monitored_ready        coordinates + a real (non-manual_only) profile: the phone can monitor it.
--   intentionally_excluded profile = manual_only: a decision was made that this place is never auto-detected.
--   incomplete             a place that should be decided but is not: no profile and/or no coordinates.
--   not_applicable         universal (no place) or secret without a profile.
--   inactive               not live.
-- ---------------------------------------------------------------------------------------------------------------
-- The profile table is not readable by every role that may read the view (anon: import scripts), and a join through
-- RLS would silently turn "has a profile" into "missing profile". This helper answers from the table regardless of role
-- and reveals nothing but whether a key is a live profile and whether it is manual_only.
CREATE OR REPLACE FUNCTION public.visit_profile_status(p_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN p.manual_only THEN 'manual_only' ELSE 'active' END
  FROM visit_detection_profiles p WHERE p.key = p_key AND p.is_active
$fn$;
REVOKE ALL ON FUNCTION public.visit_profile_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visit_profile_status(text) TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.item_visit_readiness
WITH (security_invoker = true) AS
SELECT
  i.id AS item_id,
  i.body,
  m.slug AS metro_slug,
  n.name AS neighborhood,
  c.name AS category,
  i.visit_profile_key,
  i.visit_profile_source,
  (i.maps_lat IS NOT NULL AND i.maps_lng IS NOT NULL) AS has_coords,
  CASE
    WHEN NOT i.is_active THEN 'inactive'
    WHEN i.is_universal THEN 'not_applicable'
    WHEN i.is_secret AND i.visit_profile_key IS NULL THEN 'not_applicable'
    WHEN s.status = 'manual_only' THEN 'intentionally_excluded'
    WHEN s.status IS NULL OR i.maps_lat IS NULL OR i.maps_lng IS NULL THEN 'incomplete'
    ELSE 'monitored_ready'
  END AS readiness,
  array_remove(ARRAY[
    CASE WHEN s.status IS NULL THEN 'profile' END,
    CASE WHEN (i.maps_lat IS NULL OR i.maps_lng IS NULL) AND s.status IS DISTINCT FROM 'manual_only' THEN 'coordinates' END
  ], NULL) AS missing
FROM items i
LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
LEFT JOIN metro_areas m ON m.id = n.metro_id
LEFT JOIN categories c ON c.id = i.category_id
CROSS JOIN LATERAL (SELECT visit_profile_status(i.visit_profile_key) AS status) s;

COMMENT ON VIEW public.item_visit_readiness IS 'Per-item visit-detection readiness: monitored_ready | intentionally_excluded (manual_only) | incomplete (missing profile and/or coordinates) | not_applicable | inactive.';

DO $$
BEGIN
  IF classify_visit_profile('Order the tagliatelle at ''Trattoria Da Mario''', 'Food & drink') IS DISTINCT FROM 'restaurant' THEN RAISE EXCEPTION 'classifier self-check 1'; END IF;
  IF classify_visit_profile('Get a gelato at ''Gelateria Rossi''', 'Food & drink') IS DISTINCT FROM 'quick_stop' THEN RAISE EXCEPTION 'classifier self-check 2'; END IF;
  IF classify_visit_profile('Hike the 8 km ''Sentiero degli Dei''', 'Adventure') IS NOT NULL THEN RAISE EXCEPTION 'classifier self-check 3'; END IF;
  IF classify_visit_profile('Go shopping in Kenosha', 'Shopping') IS NOT NULL THEN RAISE EXCEPTION 'classifier self-check 4'; END IF;
END $$;

COMMIT;
