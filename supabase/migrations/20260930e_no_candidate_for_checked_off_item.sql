-- Actionable candidates (2026-09-30).
-- 2026-09-30 field test: a stay at Villa Rufolo (12:51-14:37) produced a candidate AFTER the user had already checked the
-- place off by hand at 14:03. The inbox correctly hid it (the item was checked off) but the Home/Profile badges counted it,
-- so the badge said 3 while the inbox showed 2, and 2 versus 1 after a confirmation. The badge logic is fixed in the app;
-- this migration stops such candidates being created at all: visit_presence_exit discards a session for an item the user
-- has already checked off (outcome 'already_checked_off'). Everything else in the function is unchanged.
-- Reversible: recreate the function from 20260930_visit_presence_hardening.sql.
BEGIN;

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

  -- The user already checked this place off (any path, any time, including DURING this very stay): there is nothing to
  -- recover. Same rule the inbox and the badges apply (lib/visitDetection/actionableCandidates.js), enforced where the
  -- candidate would otherwise be created (and its notification sent).
  IF EXISTS (SELECT 1 FROM check_ins k WHERE k.user_id = v_uid AND k.item_id = p_item_id) THEN
    UPDATE visit_presence_sessions SET outcome = 'already_checked_off' WHERE id = s.id;
    RETURN jsonb_build_object('outcome','discard','reason','already_checked_off');
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

COMMIT;
