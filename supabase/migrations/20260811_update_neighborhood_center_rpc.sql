-- ============================================================
-- update_neighborhood_center() RPC — admin geocode-confirm feature
-- 2026-08-11
--
-- checkoff_admin.html's new Neighborhoods panel needs to write
-- center_geo from a lat/lng pair confirmed via Google Places. Confirmed
-- via pg_trigger that, unlike items.geo_location (trg_sync_item_geo_location),
-- neighborhoods.center_geo has no auto-sync trigger — it must be written
-- explicitly. PostgREST PATCH bodies are plain JSON with no way to send a
-- raw ST_SetSRID(ST_MakePoint(...)) expression, so this RPC keeps that
-- coordinate math server-side, mirroring update_item_location() from
-- 20260811_update_item_location_rpc.sql.
--
-- neighborhood center_geo now doubles as the check-off anchor for
-- neighborhood-scoped items (they copy this center into their own
-- maps_lat/maps_lng with a wide radius), so accuracy here matters beyond
-- admin reference — this is why the admin panel confirms centers via
-- Places rather than accepting hand-typed coordinates.
--
-- Only used for editing an EXISTING neighborhood's center. A brand-new
-- neighborhood writes center_geo inline in its INSERT instead, so there's
-- no window where the row exists without a center.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_neighborhood_center(
  neighborhood_id uuid,
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
    RAISE EXCEPTION 'update_neighborhood_center: new_lat and new_lng are required';
  END IF;

  UPDATE neighborhoods
  SET center_geo = ST_SetSRID(ST_MakePoint(new_lng, new_lat), 4326)
  WHERE id = neighborhood_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_neighborhood_center: no neighborhood found with id %', neighborhood_id;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_neighborhood_center(uuid, float8, float8) TO service_role;
