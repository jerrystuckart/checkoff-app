-- ============================================================
-- Metro Day-Trips foundation: destinations coordinates,
-- metro_destinations (standing geographic fact),
-- metro_destination_lists (manually-curated rendering slot)
-- 2026-07-14
--
-- metro_areas already has center_lat/center_lng (confirmed live) —
-- no change needed there. destinations has no coordinates at all
-- today; this adds them, named center_lat/center_lng to match the
-- existing convention already used on metro_areas and
-- destination_zones (not latitude/longitude).
--
-- Two-table split:
--   - metro_destinations: the standing geographic fact — is this
--     destination within relevant range of this metro. Auto-populated
--     by the two trigger functions below (one per insert direction),
--     not manually curated, not itself end-user-visible content.
--     distance_miles is a real haversine calculation; drive_time_minutes
--     is a rough estimate derived from it (assumed 50 mph average),
--     explicitly not a real routing calculation. relationship_type is
--     left NULL on insert — deliberate, not an oversight: real survey
--     data showed distance doesn't predict getaway relevance (a nearby
--     destination went unmentioned while a farther one ranked highly,
--     driven by directional/cultural appeal no distance calculation
--     captures). It's populated only through manual review later.
--   - metro_destination_lists: the actual rendering slot — which
--     specific destination_lists row shows in which metro's
--     day-trips rail. Stays fully manually curated, mirrors
--     destination_lists' own shape and RLS pattern exactly.
--     References metro_destination_id (not metro_id directly) — the
--     geographic fact must exist before a rendering slot can be
--     curated on top of it.
--
-- owner_partner_id / show_partner_credit are not duplicated onto
-- metro_destination_lists — each row points at exactly one
-- destination_lists row via destination_list_id, which already
-- carries ownership/credit. Restating it here would just be a second
-- copy of the same fact with a drift risk.
--
-- Trigger functions mirror this codebase's existing DB-level-
-- invariant pattern (auto_add_creator_as_member,
-- prevent_expired_list_checkins) — they fire unconditionally on
-- insert regardless of entry point, rather than depending on
-- application/admin-tool code remembering to call them. Neither is
-- SECURITY DEFINER: every current entry point (the admin tool)
-- already writes via service_role, which bypasses RLS regardless, so
-- there's no privilege gap to bridge today.
-- ============================================================

ALTER TABLE destinations
ADD COLUMN center_lat numeric,
ADD COLUMN center_lng numeric;

CREATE TABLE metro_destinations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metro_id            uuid NOT NULL REFERENCES metro_areas(id),
  destination_id      uuid NOT NULL REFERENCES destinations(id),
  distance_miles      numeric,
  drive_time_minutes  integer,
  relationship_type   text CHECK (relationship_type IN ('day_trip', 'weekend_getaway', 'road_trip', 'seasonal_escape')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metro_id, destination_id)
);

CREATE INDEX idx_metro_destinations_metro_id       ON metro_destinations(metro_id);
CREATE INDEX idx_metro_destinations_destination_id ON metro_destinations(destination_id);

ALTER TABLE metro_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metro_destinations rows are viewable by everyone"
ON metro_destinations FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Jerry can view all metro_destinations rows for testing"
ON metro_destinations FOR SELECT
TO authenticated
USING (auth.uid() = '11275026-65be-4421-80a4-46c57195408b');


CREATE TABLE metro_destination_lists (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metro_destination_id  uuid NOT NULL REFERENCES metro_destinations(id),
  destination_list_id   uuid NOT NULL REFERENCES destination_lists(id),
  sort_order            integer NOT NULL DEFAULT 0,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metro_destination_id, destination_list_id)
);

CREATE INDEX idx_metro_destination_lists_metro_destination_id ON metro_destination_lists(metro_destination_id);
CREATE INDEX idx_metro_destination_lists_destination_list_id  ON metro_destination_lists(destination_list_id);

ALTER TABLE metro_destination_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Visible metro_destination_lists rows are viewable by everyone"
ON metro_destination_lists FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Jerry can view all metro_destination_lists rows for testing"
ON metro_destination_lists FOR SELECT
TO authenticated
USING (auth.uid() = '11275026-65be-4421-80a4-46c57195408b');

-- No write policies on either table — implicit deny for
-- anon/authenticated, service_role (admin tool) only, matching the
-- convention used everywhere else in this schema.


-- ────────────────────────────────────────────────────────────
-- Trigger functions
-- ────────────────────────────────────────────────────────────

-- New destination -> pair it against every currently active metro.
-- Skips entirely if the new destination has no coordinates. Distance
-- is a standard haversine great-circle calculation in miles;
-- drive_time_minutes assumes a flat 50 mph average — a rough
-- placeholder, not a real routing-API result.
CREATE OR REPLACE FUNCTION public.sync_metro_destinations_new_destination()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.center_lat IS NULL OR NEW.center_lng IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO metro_destinations (metro_id, destination_id, distance_miles, drive_time_minutes)
  SELECT
    m.id,
    NEW.id,
    d.dist_miles,
    round(d.dist_miles / 50.0 * 60)::integer
  FROM metro_areas m
  CROSS JOIN LATERAL (
    SELECT 3959 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians(m.center_lat)) * cos(radians(NEW.center_lat)) * cos(radians(NEW.center_lng) - radians(m.center_lng))
        + sin(radians(m.center_lat)) * sin(radians(NEW.center_lat))
      ))
    ) AS dist_miles
  ) d
  WHERE m.is_active = true
    AND m.center_lat IS NOT NULL
    AND m.center_lng IS NOT NULL
  ON CONFLICT (metro_id, destination_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_sync_metro_destinations_new_destination
AFTER INSERT ON destinations
FOR EACH ROW
EXECUTE FUNCTION public.sync_metro_destinations_new_destination();


-- New metro -> pair it against every existing destination (not
-- filtered by destinations.is_active — this is geographic fact/
-- plumbing, not display content, so an inactive destination still
-- gets its distance computed). Mirrors the function above exactly,
-- direction reversed.
CREATE OR REPLACE FUNCTION public.sync_metro_destinations_new_metro()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.center_lat IS NULL OR NEW.center_lng IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO metro_destinations (metro_id, destination_id, distance_miles, drive_time_minutes)
  SELECT
    NEW.id,
    dest.id,
    d.dist_miles,
    round(d.dist_miles / 50.0 * 60)::integer
  FROM destinations dest
  CROSS JOIN LATERAL (
    SELECT 3959 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians(NEW.center_lat)) * cos(radians(dest.center_lat)) * cos(radians(dest.center_lng) - radians(NEW.center_lng))
        + sin(radians(NEW.center_lat)) * sin(radians(dest.center_lat))
      ))
    ) AS dist_miles
  ) d
  WHERE dest.center_lat IS NOT NULL
    AND dest.center_lng IS NOT NULL
  ON CONFLICT (metro_id, destination_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_sync_metro_destinations_new_metro
AFTER INSERT ON metro_areas
FOR EACH ROW
EXECUTE FUNCTION public.sync_metro_destinations_new_metro();
