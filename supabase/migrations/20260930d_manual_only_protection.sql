-- Explicit exclusions survive automation (2026-09-30).
-- items.visit_profile_key = 'manual_only' is a recorded decision that a place is never auto-detected. Enrichment, rule
-- backfills, Winston and any script must not be able to overwrite it (or blank it) by accident. Only a person's action may
-- change it: the admin tool (source 'admin'), a CSV column (source 'csv_import'), or a reviewed migration (source 'curated_*').
-- Making the item universal is also allowed (universal items must have no profile: items_universal_no_visit_profile).
-- Clearing it to NULL is never a person's action (an undecided place is not an exclusion) and raises. Everything else raises,
-- loudly, instead of silently reverting the decision. Known limit: a writer that changes the key but leaves the row's old
-- source ('admin') in place looks like a person; every automated writer here (auto_v1, rule_v1, winston_v1) sets its own
-- source or only fills NULLs.
-- Reversible: recreate items_default_visit_profile() from 20260929b_visit_profile_intake_guard.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.items_default_visit_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_category text;
  v_profile text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.visit_profile_key = 'manual_only' AND NEW.visit_profile_key IS DISTINCT FROM 'manual_only'
     AND NOT COALESCE(NEW.is_universal, false)
     AND NOT (NEW.visit_profile_key IS NOT NULL
              AND (COALESCE(NEW.visit_profile_source, '') IN ('admin', 'csv_import') OR COALESCE(NEW.visit_profile_source, '') LIKE 'curated\_%')) THEN
    RAISE EXCEPTION 'items.visit_profile_key manual_only is an explicit exclusion (item %); only a person (admin, csv_import or a curated migration) may change it', OLD.id
      USING ERRCODE = 'P0001';
  END IF;

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

COMMIT;
