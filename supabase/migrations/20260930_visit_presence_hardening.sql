-- =============================================================================
-- Presence-session hardening against real iOS geofence behaviour (2026-09-30).
--
-- Audited against expo-location's iOS EXGeofencingTaskConsumer:
--   * every (re-)registration resets each region's state to Unknown and calls
--     requestStateForRegion, so didDetermineState fires ENTER for every region
--     the phone is inside AND EXIT for every region it is outside — on every
--     refresh, not just the first. (Client handles this; see presenceClient.js.)
--   * enter is delivered on boundary crossing with delay, so the fix taken when
--     the callback runs can be a little outside the circle.
--   * an exit can be missed entirely (app killed, region dropped from the
--     19-region set, phone off), leaving a session open.
--
-- Changes (all server-side rules; nothing here lets a client create or edit a
-- candidate — that closed in 20260929):
--  1. ENTER tolerates a fix up to radius + 100 m + accuracy (was radius +
--     accuracy): a callback-time fix a few steps past the boundary no longer
--     loses a real visit. A spoofer is unaffected (they send exact coordinates).
--  2. ENTER no longer REJECTS when another session is open at a far venue (a
--     stale session from a missed exit would have blocked every later visit).
--     It closes such sessions as 'missed_exit' — no candidate, no credit — which
--     also keeps one phone from holding parallel far-apart sessions.
--  3. Open-session cap 8 -> 12 (dense Florence: up to 10 circles can contain one
--     position) and daily entry cap 60 -> 400 (every pass through a circle is an
--     entry; the 30-candidates/day cap and 5+ minute thresholds do the limiting).
--  4. A concurrent duplicate ENTER (unique index race) returns already_open
--     instead of an error.
--  5. visit_presence_reconcile(fix): the phone reports where it is on
--     foreground; sessions whose venue does not contain the fix are closed as
--     'missed_exit' (never credited); sessions older than 8 h as 'stale_open'.
--  6. EXIT can reconcile a LATE exit for a session that was auto-closed as
--     missed_exit / stale_open in the last 24 h — but only with a client-supplied
--     departure time, clamped to [entered_at, closed_at], so the credited stay
--     can never exceed the time the server actually observed.
--  7. Expiry is departure + 168 hours (not "7 days"): identical in every time
--     zone and across DST changes.
--  8. Retention: presence sessions 3 -> 2 days; open sessions older than 8 h are
--     marked stale by the retention job too.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.visit_presence_enter(p_item_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  it record; v_radius int; v_existing record; v_open int; v_today int; v_prev record; v_speed double precision; o record; v_id uuid; v_entered timestamptz;
  v_slack double precision := LEAST(GREATEST(COALESCE(p_accuracy, 0), 0), 50) + 100;
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

  UPDATE visit_presence_sessions SET status = 'discarded', outcome = 'stale_open', closed_at = now()
   WHERE user_id = v_uid AND status = 'open' AND entered_at < now() - interval '8 hours';

  v_radius := visit_geofence_radius_m(it.geo_radius_m);
  IF visit_distance_m(p_lat, p_lng, it.maps_lat, it.maps_lng) > v_radius + v_slack THEN
    RETURN jsonb_build_object('status','rejected','reason','fix_outside_venue');
  END IF;

  -- Re-delivered "enter" (every geofence re-registration): keep the ORIGINAL server timestamp.
  SELECT id, entered_at INTO v_existing FROM visit_presence_sessions WHERE user_id = v_uid AND item_id = p_item_id AND status = 'open';
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_open','session_id',v_existing.id,'entered_at',v_existing.entered_at);
  END IF;

  -- This fix is not inside another open session's venue: that exit was missed. Close it WITHOUT credit.
  FOR o IN SELECT s.id, i.maps_lat, i.maps_lng, i.geo_radius_m FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id WHERE s.user_id = v_uid AND s.status = 'open' LOOP
    IF visit_distance_m(p_lat, p_lng, o.maps_lat, o.maps_lng) > visit_geofence_radius_m(o.geo_radius_m) + v_slack THEN
      UPDATE visit_presence_sessions SET status = 'discarded', outcome = 'missed_exit', closed_at = now() WHERE id = o.id;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_open FROM visit_presence_sessions WHERE user_id = v_uid AND status = 'open';
  IF v_open >= 12 THEN RETURN jsonb_build_object('status','rejected','reason','too_many_open'); END IF;
  SELECT count(*) INTO v_today FROM visit_presence_sessions WHERE user_id = v_uid AND created_at > now() - interval '24 hours';
  IF v_today >= 400 THEN RETURN jsonb_build_object('status','rejected','reason','daily_entry_cap'); END IF;

  SELECT lat, lng, at INTO v_prev FROM (
    SELECT enter_lat AS lat, enter_lng AS lng, entered_at AS at FROM visit_presence_sessions WHERE user_id = v_uid AND entered_at > now() - interval '6 hours'
    UNION ALL
    SELECT exit_lat, exit_lng, closed_at FROM visit_presence_sessions WHERE user_id = v_uid AND exit_lat IS NOT NULL AND closed_at > now() - interval '6 hours'
  ) e ORDER BY at DESC LIMIT 1;
  IF v_prev.at IS NOT NULL THEN
    v_speed := visit_distance_m(p_lat, p_lng, v_prev.lat, v_prev.lng) / GREATEST(extract(epoch FROM (now() - v_prev.at)), 1);
    IF v_speed > 70 THEN RETURN jsonb_build_object('status','rejected','reason','travel_infeasible'); END IF;
  END IF;

  BEGIN
    INSERT INTO visit_presence_sessions (user_id, item_id, enter_lat, enter_lng, enter_accuracy_m)
    VALUES (v_uid, p_item_id, p_lat, p_lng, p_accuracy) RETURNING id, entered_at INTO v_id, v_entered;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, entered_at INTO v_existing FROM visit_presence_sessions WHERE user_id = v_uid AND item_id = p_item_id AND status = 'open';
    RETURN jsonb_build_object('status','already_open','session_id',v_existing.id,'entered_at',v_existing.entered_at);
  END;
  RETURN jsonb_build_object('status','opened','session_id',v_id,'entered_at',v_entered);
END $$;

CREATE OR REPLACE FUNCTION public.visit_presence_exit(p_item_id uuid, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL,
                                                      p_accuracy double precision DEFAULT NULL, p_speed double precision DEFAULT NULL,
                                                      p_client_departed_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record; it record; v_upper timestamptz; v_departed timestamptz; v_dwell numeric; v_ev jsonb; v_competing int; v_cand uuid; v_today int; v_radius int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'P0001'; END IF;

  -- The open session, else (only when the phone supplies its real departure time) a session the server
  -- auto-closed as a missed exit / stale in the last 24 h.
  SELECT * INTO s FROM visit_presence_sessions
   WHERE user_id = v_uid AND item_id = p_item_id
     AND (status = 'open'
          OR (status = 'discarded' AND outcome IN ('missed_exit','stale_open') AND p_client_departed_at IS NOT NULL AND created_at > now() - interval '24 hours'))
   ORDER BY (status = 'open') DESC, entered_at DESC LIMIT 1 FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('outcome','none','reason','no_open_session'); END IF;

  v_upper := CASE WHEN s.status = 'open' THEN now() ELSE s.closed_at END;
  -- The claimed departure can only SHORTEN the stay; it can never exceed what the server observed.
  v_departed := LEAST(v_upper, GREATEST(s.entered_at, COALESCE(p_client_departed_at, v_upper)));
  v_dwell := extract(epoch FROM (v_departed - s.entered_at)) / 60.0;

  SELECT id, maps_lat, maps_lng, geo_radius_m INTO it FROM items WHERE id = p_item_id;
  v_radius := visit_geofence_radius_m(it.geo_radius_m);

  UPDATE visit_presence_sessions SET status = 'closed', closed_at = v_departed,
         exit_lat = CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lat END,
         exit_lng = CASE WHEN p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN p_lng END
   WHERE id = s.id;

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
         (v_ev->>'score')::int, v_ev->>'status', v_departed + interval '168 hours',
         jsonb_build_object('profileKey', i.visit_profile_key, 'competingVenueCount', v_competing, 'source', 'presence_session', 'sessionId', s.id)
    FROM items i WHERE i.id = p_item_id
  RETURNING id INTO v_cand;

  UPDATE visit_presence_sessions SET outcome = 'candidate', candidate_visit_id = v_cand WHERE id = s.id;
  RETURN jsonb_build_object('outcome','candidate','candidate_visit_id',v_cand,'score',(v_ev->>'score')::int,'band',v_ev->>'band','dwell_minutes',round(v_dwell,1));
END $$;

-- Foreground reconciliation: where is the phone now? Sessions it is not inside any more were exited without a callback.
CREATE OR REPLACE FUNCTION public.visit_presence_reconcile(p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); o record; v_closed int := 0; v_slack double precision := LEAST(GREATEST(COALESCE(p_accuracy, 0), 0), 50) + 100; v_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'P0001'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('closed', 0, 'open_item_ids', '[]'::jsonb, 'reason', 'bad_fix');
  END IF;
  UPDATE visit_presence_sessions SET status = 'discarded', outcome = 'stale_open', closed_at = now()
   WHERE user_id = v_uid AND status = 'open' AND entered_at < now() - interval '8 hours';
  FOR o IN SELECT s.id, i.maps_lat, i.maps_lng, i.geo_radius_m FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id WHERE s.user_id = v_uid AND s.status = 'open' LOOP
    IF visit_distance_m(p_lat, p_lng, o.maps_lat, o.maps_lng) > visit_geofence_radius_m(o.geo_radius_m) + v_slack THEN
      UPDATE visit_presence_sessions SET status = 'discarded', outcome = 'missed_exit', closed_at = now() WHERE id = o.id;
      v_closed := v_closed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('closed', v_closed,
    'open_item_ids', COALESCE((SELECT jsonb_agg(item_id) FROM visit_presence_sessions WHERE user_id = v_uid AND status = 'open'), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.visit_presence_reconcile(double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visit_presence_reconcile(double precision, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_visit_recovery_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_exp int; v_open int; v_confirmed int; v_reg int; v_dbg int; v_ps int; v_stale int;
BEGIN
  UPDATE visit_presence_sessions SET status = 'discarded', outcome = 'stale_open', closed_at = now()
   WHERE status = 'open' AND entered_at < now() - interval '8 hours';
  GET DIAGNOSTICS v_stale = ROW_COUNT;
  UPDATE candidate_visits SET status = 'expired'
   WHERE status IN ('candidate','medium_confidence','high_confidence') AND expires_at < now();
  GET DIAGNOSTICS v_exp = ROW_COUNT;
  DELETE FROM candidate_visits WHERE status <> 'confirmed' AND expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_open = ROW_COUNT;
  DELETE FROM candidate_visits WHERE status = 'confirmed' AND COALESCE(confirmed_at, created_at) < now() - interval '30 days';
  GET DIAGNOSTICS v_confirmed = ROW_COUNT;
  DELETE FROM visit_presence_sessions WHERE created_at < now() - interval '2 days';
  GET DIAGNOSTICS v_ps = ROW_COUNT;
  DELETE FROM geofence_registration_log WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS v_reg = ROW_COUNT;
  DELETE FROM geofence_debug_events WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS v_dbg = ROW_COUNT;
  RETURN jsonb_build_object('stale_sessions', v_stale, 'marked_expired', v_exp, 'unconfirmed', v_open, 'confirmed', v_confirmed, 'presence_sessions', v_ps, 'registration_log', v_reg, 'debug_events', v_dbg);
END $$;
REVOKE ALL ON FUNCTION public.cleanup_visit_recovery_data() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'visit_presence_exit') NOT ILIKE '%interval ''168 hours''%' THEN RAISE EXCEPTION '168h expiry missing'; END IF;
  IF has_function_privilege('anon', 'public.visit_presence_reconcile(double precision,double precision,double precision)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can execute reconcile'; END IF;
END $$;

COMMIT;
