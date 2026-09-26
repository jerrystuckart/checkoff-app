-- =============================================================================
-- Server-attested visit qualification (2026-09-29).
--
-- PROBLEM: candidate_visits was client-writable. A client could INSERT a
-- plausible row (or UPDATE its own row's expires_at/status/score) and the
-- confirm trigger would treat that row as authorization to check off the item
-- from anywhere. Plausibility checks on the row's own fields prove nothing —
-- the client wrote them.
--
-- DESIGN: a candidate visit can only be created by the server, from a presence
-- SESSION whose timing the SERVER measured:
--   visit_presence_enter()  the client reports "I entered this item's geofence"
--                           with a location fix. The server validates the fix
--                           against the item, and stamps entered_at with ITS OWN
--                           clock. The client cannot supply or backdate it.
--   visit_presence_exit()   the client reports departure. The server computes
--                           dwell = (departure - entered_at), where departure is
--                           the client's claimed time CLAMPED into
--                           [entered_at, now()], so dwell can never exceed the
--                           real wall-clock time since the server saw the enter.
--                           Threshold, confidence, band, ambiguity (competing
--                           venues) and expiry are all computed here. Only then
--                           does the server insert the candidate_visits row.
--   Direct INSERT/UPDATE/DELETE on candidate_visits is REVOKED for clients, and
--   its client INSERT/UPDATE policies dropped. Dismissal is an RPC.
--
-- WHAT THIS DOES AND DOES NOT PROVE (be honest):
--   * It removes the "invent a row in one API call" attack and the "edit my own
--     row" attack; a qualifying visit now costs real elapsed time at the server
--     (5+ minutes for a coffee stop) per item, with feasibility limits below.
--   * It does NOT prove the phone was physically there. A client that spoofs GPS
--     can still call enter with the venue's coordinates and wait. Proving
--     presence against a hostile client needs device attestation (Apple App
--     Attest / Play Integrity) plus signed location evidence — a different
--     architecture, not done here. Note also that the ORDINARY live check-off has
--     no server-side distance check at all today (its gate is client-side), so
--     recovery is already stricter than the baseline it recovers from.
--   Limits that make bulk faking expensive: opt-in required; max 8 concurrent
--   open sessions and 60 entries/day; open sessions must be geographically
--   compatible with each other; travel between consecutive fixes may not exceed
--   70 m/s; max 30 candidates/day; one pending candidate per item.
--
-- Rules mirror lib/visitDetection/visitPipeline.js (radius 120/200, competing
-- venue 25-80 m, accuracy 20/65 m, speed 1.5 m/s, dwell cap 480 min); a drift
-- test compares the constants and a parity run compares outcomes.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.visit_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

CREATE OR REPLACE FUNCTION public.visit_geofence_radius_m(p_geo_radius double precision)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT LEAST(COALESCE(NULLIF(p_geo_radius, 0), 120), 200)::integer
$$;

-- Other visit-capable, DIFFERENT venues within 25-80 m: the attribution is ambiguous.
CREATE OR REPLACE FUNCTION public.visit_competing_count(p_item_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int
  FROM items a
  JOIN items b ON b.id <> a.id
  WHERE a.id = p_item_id
    AND b.is_active AND NOT b.is_universal AND b.maps_lat IS NOT NULL AND b.maps_lng IS NOT NULL
    AND abs(b.maps_lat - a.maps_lat) < 0.004 AND abs(b.maps_lng - a.maps_lng) < 0.006
    AND EXISTS (SELECT 1 FROM visit_detection_profiles p WHERE p.key = b.visit_profile_key AND NOT p.manual_only AND p.is_active)
    AND visit_distance_m(a.maps_lat, a.maps_lng, b.maps_lat, b.maps_lng) >= 25
    AND visit_distance_m(a.maps_lat, a.maps_lng, b.maps_lat, b.maps_lng) < 80
$$;

-- The departure decision (mirror of evaluateDeparture in visitPipeline.js).
CREATE OR REPLACE FUNCTION public.visit_evaluate(p_item_id uuid, p_dwell_min numeric, p_accuracy double precision, p_speed double precision, p_competing integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_key text; v_cand int; v_strong int; v_manual boolean;
  w jsonb; b record; v_score int := 0; v_band text;
BEGIN
  SELECT visit_profile_key INTO v_key FROM items WHERE id = p_item_id;
  SELECT candidate_dwell_minutes, strong_dwell_minutes, manual_only INTO v_cand, v_strong, v_manual
    FROM visit_detection_profiles WHERE key = v_key AND is_active;
  IF v_key IS NULL OR v_manual IS NOT FALSE OR v_cand IS NULL THEN RETURN jsonb_build_object('outcome','discard','reason','manual_only_or_no_profile'); END IF;
  IF p_dwell_min < 0 THEN RETURN jsonb_build_object('outcome','discard','reason','negative_dwell'); END IF;
  IF p_dwell_min > 480 THEN RETURN jsonb_build_object('outcome','discard','reason','implausible_dwell'); END IF;
  IF p_dwell_min < v_cand THEN RETURN jsonb_build_object('outcome','discard','reason','below_candidate_dwell'); END IF;

  SELECT jsonb_object_agg(key, weight) INTO w FROM visit_confidence_weights;
  v_score := COALESCE((w->>'inside_venue_radius')::int, 0) + COALESCE((w->>'exceeds_candidate_dwell')::int, 0);
  IF p_dwell_min >= v_strong THEN v_score := v_score + COALESCE((w->>'exceeds_strong_dwell')::int, 0); END IF;
  IF p_accuracy IS NOT NULL AND p_accuracy >= 0 AND p_accuracy <= 20 THEN v_score := v_score + COALESCE((w->>'good_location_accuracy')::int, 0); END IF;
  IF p_accuracy IS NOT NULL AND p_accuracy > 65 THEN v_score := v_score + COALESCE((w->>'poor_location_accuracy')::int, 0); END IF;
  IF p_speed IS NOT NULL AND p_speed >= 0 AND p_speed < 1.5 THEN v_score := v_score + COALESCE((w->>'stopped_not_driving')::int, 0); END IF;
  IF p_competing = 0 THEN v_score := v_score + COALESCE((w->>'no_competing_venue_nearby')::int, 0); END IF;
  IF p_competing > 0 THEN v_score := v_score + COALESCE((w->>'overlapping_venues')::int, 0); END IF;
  v_score := GREATEST(0, LEAST(100, v_score));

  SELECT ignore_below, medium_confidence_below, strong_candidate_below INTO b FROM visit_confidence_bands WHERE id = 1;
  v_band := CASE WHEN v_score < b.ignore_below THEN 'ignore'
                 WHEN v_score < b.medium_confidence_below THEN 'medium_confidence'
                 WHEN v_score < b.strong_candidate_below THEN 'high_confidence'
                 ELSE 'notify_eligible' END;
  IF v_band = 'ignore' THEN RETURN jsonb_build_object('outcome','discard','reason','below_ignore_band','score',v_score); END IF;
  RETURN jsonb_build_object('outcome','candidate','score',v_score,'band',v_band,
    'status', CASE WHEN v_band = 'notify_eligible' THEN 'high_confidence' ELSE v_band END);
END $$;
REVOKE ALL ON FUNCTION public.visit_evaluate(uuid, numeric, double precision, double precision, integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Presence sessions: written ONLY by the RPCs below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visit_presence_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  entered_at         timestamptz NOT NULL DEFAULT now(),
  enter_lat          double precision NOT NULL,
  enter_lng          double precision NOT NULL,
  enter_accuracy_m   double precision,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','discarded')),
  closed_at          timestamptz,
  exit_lat           double precision,
  exit_lng           double precision,
  outcome            text,
  candidate_visit_id uuid REFERENCES public.candidate_visits(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS visit_presence_one_open_per_item ON public.visit_presence_sessions (user_id, item_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS visit_presence_user_idx ON public.visit_presence_sessions (user_id, entered_at DESC);

ALTER TABLE public.visit_presence_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visit_presence_select_own ON public.visit_presence_sessions;
CREATE POLICY visit_presence_select_own ON public.visit_presence_sessions FOR SELECT USING (user_id = auth.uid());
REVOKE ALL ON public.visit_presence_sessions FROM anon, authenticated;
GRANT SELECT ON public.visit_presence_sessions TO authenticated;

-- ---------------------------------------------------------------------------
-- ENTER
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.visit_presence_enter(p_item_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  it record; v_radius int; v_existing record; v_open int; v_today int; v_prev record; v_speed double precision; o record; v_id uuid; v_entered timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM visit_recovery_settings s WHERE s.user_id = v_uid AND s.opted_in) THEN
    RETURN jsonb_build_object('status','rejected','reason','not_opted_in');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('status','rejected','reason','bad_fix');
  END IF;

  SELECT i.id, i.maps_lat, i.maps_lng, i.geo_radius_m, i.is_active, i.is_universal, i.visit_profile_key INTO it FROM items i WHERE i.id = p_item_id;
  IF it.id IS NULL OR NOT it.is_active OR it.is_universal OR it.maps_lat IS NULL
     OR NOT EXISTS (SELECT 1 FROM visit_detection_profiles p WHERE p.key = it.visit_profile_key AND NOT p.manual_only AND p.is_active) THEN
    RETURN jsonb_build_object('status','rejected','reason','item_not_eligible');
  END IF;

  -- Sessions that never closed (app killed, phone off) are stale after 8h.
  UPDATE visit_presence_sessions SET status = 'discarded', outcome = 'stale_open', closed_at = now()
   WHERE user_id = v_uid AND status = 'open' AND entered_at < now() - interval '8 hours';

  v_radius := visit_geofence_radius_m(it.geo_radius_m);
  IF visit_distance_m(p_lat, p_lng, it.maps_lat, it.maps_lng) > v_radius + LEAST(GREATEST(COALESCE(p_accuracy, 0), 0), 50) THEN
    RETURN jsonb_build_object('status','rejected','reason','fix_outside_venue');
  END IF;

  -- Re-delivered "enter" (iOS does this on every geofence re-registration): keep the ORIGINAL server timestamp.
  SELECT id, entered_at INTO v_existing FROM visit_presence_sessions WHERE user_id = v_uid AND item_id = p_item_id AND status = 'open';
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_open','session_id',v_existing.id,'entered_at',v_existing.entered_at);
  END IF;

  SELECT count(*) INTO v_open FROM visit_presence_sessions WHERE user_id = v_uid AND status = 'open';
  IF v_open >= 8 THEN RETURN jsonb_build_object('status','rejected','reason','too_many_open'); END IF;
  SELECT count(*) INTO v_today FROM visit_presence_sessions WHERE user_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_today >= 60 THEN RETURN jsonb_build_object('status','rejected','reason','daily_entry_cap'); END IF;

  -- One phone is in one place: every other open session must be a venue this fix could also be inside.
  FOR o IN SELECT s.item_id, i.maps_lat, i.maps_lng, i.geo_radius_m FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id WHERE s.user_id = v_uid AND s.status = 'open' LOOP
    IF visit_distance_m(it.maps_lat, it.maps_lng, o.maps_lat, o.maps_lng) > v_radius + visit_geofence_radius_m(o.geo_radius_m) + 100 THEN
      RETURN jsonb_build_object('status','rejected','reason','incompatible_open_session');
    END IF;
  END LOOP;

  -- Travel feasibility against the user's most recent reported position (enter or exit) in the last 6h.
  SELECT lat, lng, at INTO v_prev FROM (
    SELECT enter_lat AS lat, enter_lng AS lng, entered_at AS at FROM visit_presence_sessions WHERE user_id = v_uid AND entered_at > now() - interval '6 hours'
    UNION ALL
    SELECT exit_lat, exit_lng, closed_at FROM visit_presence_sessions WHERE user_id = v_uid AND exit_lat IS NOT NULL AND closed_at > now() - interval '6 hours'
  ) e ORDER BY at DESC LIMIT 1;
  IF v_prev.at IS NOT NULL THEN
    v_speed := visit_distance_m(p_lat, p_lng, v_prev.lat, v_prev.lng) / GREATEST(extract(epoch FROM (now() - v_prev.at)), 1);
    IF v_speed > 70 THEN RETURN jsonb_build_object('status','rejected','reason','travel_infeasible'); END IF;
  END IF;

  INSERT INTO visit_presence_sessions (user_id, item_id, enter_lat, enter_lng, enter_accuracy_m)
  VALUES (v_uid, p_item_id, p_lat, p_lng, p_accuracy) RETURNING id, entered_at INTO v_id, v_entered;
  RETURN jsonb_build_object('status','opened','session_id',v_id,'entered_at',v_entered);
END $$;

-- ---------------------------------------------------------------------------
-- EXIT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.visit_presence_exit(p_item_id uuid, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL,
                                                      p_accuracy double precision DEFAULT NULL, p_speed double precision DEFAULT NULL,
                                                      p_client_departed_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record; it record; v_departed timestamptz; v_dwell numeric; v_ev jsonb; v_competing int; v_cand uuid; v_today int; v_radius int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO s FROM visit_presence_sessions WHERE user_id = v_uid AND item_id = p_item_id AND status = 'open' FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('outcome','none','reason','no_open_session'); END IF;

  -- The client's claimed departure is only ever allowed to SHORTEN the stay.
  v_departed := LEAST(now(), GREATEST(s.entered_at, COALESCE(p_client_departed_at, now())));
  v_dwell := extract(epoch FROM (v_departed - s.entered_at)) / 60.0;

  SELECT id, maps_lat, maps_lng, geo_radius_m INTO it FROM items WHERE id = p_item_id;
  v_radius := visit_geofence_radius_m(it.geo_radius_m);

  UPDATE visit_presence_sessions SET status = 'closed', closed_at = v_departed,
         exit_lat = CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lat END,
         exit_lng = CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lng END
   WHERE id = s.id;

  -- An exit fix that could not have been reached from the venue in the time claimed is rejected.
  IF p_lat IS NOT NULL AND p_lng IS NOT NULL AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
     AND visit_distance_m(p_lat, p_lng, it.maps_lat, it.maps_lng) > 70 * GREATEST(extract(epoch FROM (v_departed - s.entered_at)), 1) + v_radius + 100 THEN
    UPDATE visit_presence_sessions SET outcome = 'exit_infeasible' WHERE id = s.id;
    RETURN jsonb_build_object('outcome','discard','reason','exit_infeasible');
  END IF;

  v_competing := visit_competing_count(p_item_id);
  v_ev := visit_evaluate(p_item_id, v_dwell, p_accuracy, p_speed, v_competing);
  IF v_ev->>'outcome' <> 'candidate' THEN
    UPDATE visit_presence_sessions SET outcome = v_ev->>'reason' WHERE id = s.id;
    RETURN v_ev;
  END IF;

  IF EXISTS (SELECT 1 FROM candidate_visits c WHERE c.user_id = v_uid AND c.item_id = p_item_id AND c.status IN ('candidate','medium_confidence','high_confidence') AND c.expires_at > now()) THEN
    UPDATE visit_presence_sessions SET outcome = 'duplicate_pending' WHERE id = s.id;
    RETURN jsonb_build_object('outcome','discard','reason','duplicate_pending');
  END IF;
  SELECT count(*) INTO v_today FROM candidate_visits WHERE user_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_today >= 30 THEN
    UPDATE visit_presence_sessions SET outcome = 'daily_candidate_cap' WHERE id = s.id;
    RETURN jsonb_build_object('outcome','discard','reason','daily_candidate_cap');
  END IF;

  INSERT INTO candidate_visits (user_id, item_id, visit_profile_key, arrival_at, departure_at, dwell_minutes, detection_method,
                                confidence_score, status, expires_at, metadata)
  SELECT v_uid, p_item_id, i.visit_profile_key, s.entered_at, v_departed, round(v_dwell, 1), 'geofence_dwell',
         (v_ev->>'score')::int, v_ev->>'status', v_departed + interval '7 days',
         jsonb_build_object('profileKey', i.visit_profile_key, 'competingVenueCount', v_competing, 'source', 'presence_session', 'sessionId', s.id)
    FROM items i WHERE i.id = p_item_id
  RETURNING id INTO v_cand;

  UPDATE visit_presence_sessions SET outcome = 'candidate', candidate_visit_id = v_cand WHERE id = s.id;
  RETURN jsonb_build_object('outcome','candidate','candidate_visit_id',v_cand,'score',(v_ev->>'score')::int,'band',v_ev->>'band','dwell_minutes',round(v_dwell,1));
END $$;

-- ---------------------------------------------------------------------------
-- Dismiss (replaces the client UPDATE on candidate_visits).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dismiss_candidate_visit(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'P0001'; END IF;
  UPDATE candidate_visits SET status = 'rejected', rejected_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND confirmed_at IS NULL AND rejected_at IS NULL
     AND status IN ('candidate','medium_confidence','high_confidence');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;

REVOKE ALL ON FUNCTION public.visit_presence_enter(uuid, double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visit_presence_exit(uuid, double precision, double precision, double precision, double precision, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_candidate_visit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visit_presence_enter(uuid, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visit_presence_exit(uuid, double precision, double precision, double precision, double precision, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_candidate_visit(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Close the direct-write loophole: clients can no longer create or edit candidates.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS candidate_visits_insert_own ON public.candidate_visits;
DROP POLICY IF EXISTS candidate_visits_update_own ON public.candidate_visits;
REVOKE INSERT, UPDATE, DELETE ON public.candidate_visits FROM anon, authenticated;

-- Debug event types for the new flow.
ALTER TABLE geofence_debug_events DROP CONSTRAINT IF EXISTS geofence_debug_events_event_type_check;
ALTER TABLE geofence_debug_events ADD CONSTRAINT geofence_debug_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'enter','exit','exit_ignored_still_inside','discarded_below_candidate_dwell',
    'discarded_manual_only_or_no_profile','discarded_no_arrival_record','candidate_created','task_error',
    'discarded_implausible_dwell','discarded_below_ignore_band','candidate_insert_failed',
    'presence_enter_result','presence_exit_result','presence_rpc_failed'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- Turn-off and retention now also cover presence sessions; expiry marking moves server-side.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.turn_off_visit_recovery()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_cv int; v_reg int; v_dbg int; v_ps int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO visit_recovery_settings (user_id, opted_in, opted_in_at, updated_at) VALUES (v_uid, false, NULL, now())
  ON CONFLICT (user_id) DO UPDATE SET opted_in = false, opted_in_at = NULL, updated_at = now();
  DELETE FROM visit_presence_sessions WHERE user_id = v_uid;     GET DIAGNOSTICS v_ps = ROW_COUNT;
  DELETE FROM candidate_visits WHERE user_id = v_uid;            GET DIAGNOSTICS v_cv = ROW_COUNT;
  DELETE FROM geofence_registration_log WHERE user_id = v_uid;   GET DIAGNOSTICS v_reg = ROW_COUNT;
  DELETE FROM geofence_debug_events WHERE user_id = v_uid;       GET DIAGNOSTICS v_dbg = ROW_COUNT;
  RETURN jsonb_build_object('candidate_visits', v_cv, 'presence_sessions', v_ps, 'registration_log', v_reg, 'debug_events', v_dbg);
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_visit_recovery_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_exp int; v_open int; v_confirmed int; v_reg int; v_dbg int; v_ps int;
BEGIN
  UPDATE candidate_visits SET status = 'expired'
   WHERE status IN ('candidate','medium_confidence','high_confidence') AND expires_at < now();
  GET DIAGNOSTICS v_exp = ROW_COUNT;
  DELETE FROM candidate_visits WHERE status <> 'confirmed' AND expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_open = ROW_COUNT;
  DELETE FROM candidate_visits WHERE status = 'confirmed' AND COALESCE(confirmed_at, created_at) < now() - interval '30 days';
  GET DIAGNOSTICS v_confirmed = ROW_COUNT;
  DELETE FROM visit_presence_sessions WHERE created_at < now() - interval '3 days';
  GET DIAGNOSTICS v_ps = ROW_COUNT;
  DELETE FROM geofence_registration_log WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS v_reg = ROW_COUNT;
  DELETE FROM geofence_debug_events WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS v_dbg = ROW_COUNT;
  RETURN jsonb_build_object('marked_expired', v_exp, 'unconfirmed', v_open, 'confirmed', v_confirmed, 'presence_sessions', v_ps, 'registration_log', v_reg, 'debug_events', v_dbg);
END $$;
REVOKE ALL ON FUNCTION public.cleanup_visit_recovery_data() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.candidate_visits'::regclass AND polcmd IN ('a','w','d')) THEN
    RAISE EXCEPTION 'candidate_visits still has a client write policy';
  END IF;
  IF has_table_privilege('authenticated', 'public.candidate_visits', 'INSERT') OR has_table_privilege('authenticated', 'public.candidate_visits', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated still has write privileges on candidate_visits';
  END IF;
END $$;

COMMIT;
