-- ============================================================
-- update_item_location() RPC — admin geocode-confirm feature
-- 2026-08-11
--
-- checkoff_admin.html's new "Find & confirm location" control needs to
-- write maps_lat/maps_lng AND geo_location together, atomically, so the
-- two can never drift apart the way they were allowed to before this
-- whole remediation effort (see 20260804_standalone_checkins.sql and the
-- Pass 1-3 geocode corrections). PostgREST PATCH/POST bodies are plain
-- JSON — there's no way to send a raw SQL expression like
-- ST_SetSRID(ST_MakePoint(...)) through them. This RPC keeps that
-- coordinate math server-side instead of duplicating it in browser JS.
--
-- Called via POST /rest/v1/rpc/update_item_location with the service-role
-- key (checkoff_admin.html's existing SERVICE_KEY, which already bypasses
-- RLS for this tool). google_place_id/formatted_address are plain columns
-- and continue to be written via the normal items PATCH alongside this —
-- only the geography math is pulled out into this function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_item_location(
  item_id uuid,
  new_lat float8,
  new_lng float8
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF new_lat IS NULL OR new_lng IS NULL THEN
    RAISE EXCEPTION 'update_item_location: new_lat and new_lng are required';
  END IF;

  UPDATE items
  SET
    maps_lat     = new_lat,
    maps_lng     = new_lng,
    geo_location = ST_SetSRID(ST_MakePoint(new_lng, new_lat), 4326)
  WHERE id = item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_item_location: no item found with id %', item_id;
  END IF;
END;
$function$;

-- service_role already bypasses RLS/grants in Supabase by default, but
-- granting explicitly for the same reason every other admin RPC in this
-- schema does (see 20260708_email_automation_rpcs.sql's pattern) — makes
-- the intended caller visible in the function definition itself, not just
-- implied by role defaults.
GRANT EXECUTE ON FUNCTION public.update_item_location(uuid, float8, float8) TO service_role;
