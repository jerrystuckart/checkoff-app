-- Presence evidence quality, missed exits and lower-bound dwell (2026-09-30).
--
-- Field evidence (2026-09-30): at 18:30:40 the phone was at its Laurito lodging when iOS re-determined region state after a
-- sentinel refresh and reported ENTER for Ceramiche Casola and Da Adolfo. The phone's own fix was 206 m / 173 m from their
-- centres with 10 m reported accuracy, yet the server opened sessions, because ENTER accepted any fix within
-- circle radius + 100 m + min(accuracy, 50) (i.e. up to ~210 m for a 100 m circle). Location age was never checked: the phone
-- could fall back to an arbitrarily old "last known" position and the server had no way to know.
--
-- 1. visit_fix_presence(distance, radius, accuracy, age): one classification used everywhere a fix is judged:
--      stale      fix older than 180 s (only when the phone reports the age)
--      outside    even the most favourable point of the fix's uncertainty disc (distance - min(accuracy,100)) is beyond radius + 15 m
--      inside     the fix centre is within radius + 15 m (catalogue geocode tolerance) AND accuracy <= 65 m
--      uncertain  everything else (coarse fix, or borderline): presence is NOT established, nothing is concluded either way
--    Recorded 2026-09-30 cases: Rufolo 125 m/6 m acc/r120 inside, Duomo 88/16/r100 inside, Cosimo 85/17 inside, Casola 206/10 outside,
--    Da Adolfo 173/10/r150 uncertain, Il Pirata 130/9/r100 outside, spa 285/58/r150 outside.
-- 2. ENTER uses it (new optional p_fix_age_s). Rejections say why: stale_fix / fix_outside_venue / fix_uncertain. The
--    phone retries with a fresh fix later, so a genuine visit to a neighbour of the lodging stays possible (no blanket exclusion).
-- 3. Every accepted fix (enter, re-delivered enter, exit, reconcile) also stamps last_inside_at on the user's OTHER open
--    sessions whose circle it is inside of: real, observed evidence of presence.
-- 4. Missed exits: a session is closed ONLY on evidence that the phone is outside ('outside'); an uncertain or stale fix
--    leaves it open. When a session is closed without having seen the exit, visit_close_uncertain() looks at last_inside_at:
--    if it proves a stay of at least the profile's candidate dwell, a candidate is created with departure_at = last seen
--    inside, dwell = the proven LOWER BOUND, metadata.dwellBound = 'lower', and never above medium confidence. The exit time
--    is never invented, arrival is never moved, and unobserved time is never counted. No later evidence -> 0 lower bound -> no
--    candidate; the session stays 'missed_exit' (uncertain).
-- 5. Same guards as a normal exit: already checked off, duplicate pending, daily cap.
-- Reversible: recreate visit_presence_enter/reconcile/exit from 20260930_visit_presence_hardening.sql and
-- 20260930e_no_candidate_for_checked_off_item.sql; drop the two columns and helper functions.
BEGIN;

ALTER TABLE public.visit_presence_sessions ADD COLUMN IF NOT EXISTS last_inside_at timestamptz;
ALTER TABLE public.visit_presence_sessions ADD COLUMN IF NOT EXISTS dwell_lower_bound_min numeric;
COMMENT ON COLUMN public.visit_presence_sessions.last_inside_at IS 'Last time a trustworthy fix (visit_fix_presence = inside) placed the phone in this venue. Starts at entered_at.';
COMMENT ON COLUMN public.visit_presence_sessions.dwell_lower_bound_min IS 'Minutes between entered_at and last_inside_at, recorded when a session was closed without an observed exit.';

CREATE OR REPLACE FUNCTION public.visit_fix_presence(p_dist double precision, p_radius double precision, p_acc double precision, p_age_s double precision DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE acc_eff double precision := COALESCE(GREATEST(p_acc, 0), 50);
BEGIN
  IF p_age_s IS NOT NULL AND p_age_s > 180 THEN RETURN 'stale'; END IF;
  IF p_dist - LEAST(acc_eff, 100) > p_radius + 15 THEN RETURN 'outside'; END IF;
  IF p_dist <= p_radius + 15 AND acc_eff <= 65 THEN RETURN 'inside'; END IF;
  RETURN 'uncertain';
END $fn$;

-- Stamp last_inside_at on the user's open sessions that this fix places inside.
CREATE OR REPLACE FUNCTION public.visit_touch_inside(p_uid uuid, p_lat double precision, p_lng double precision, p_acc double precision, p_age_s double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF p_uid IS NULL OR p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RETURN; END IF;
  UPDATE visit_presence_sessions s SET last_inside_at = now()
    FROM items i
   WHERE s.user_id = p_uid AND s.status = 'open' AND i.id = s.item_id AND i.maps_lat IS NOT NULL
     AND visit_fix_presence(visit_distance_m(p_lat, p_lng, i.maps_lat, i.maps_lng), visit_geofence_radius_m(i.geo_radius_m), p_acc, p_age_s) = 'inside';
END $fn$;
REVOKE ALL ON FUNCTION public.visit_touch_inside(uuid, double precision, double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;

-- Close a session whose exit was never observed. Returns the candidate id when the PROVEN lower bound qualifies, else NULL.
CREATE OR REPLACE FUNCTION public.visit_close_uncertain(p_session uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record; v_lb numeric; v_need numeric; v_comp int; v_ev jsonb; v_today int; v_status text; v_cand uuid;
BEGIN
  SELECT * INTO s FROM visit_presence_sessions WHERE id = p_session AND status = 'open' FOR UPDATE;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  v_lb := CASE WHEN s.last_inside_at IS NOT NULL AND s.last_inside_at > s.entered_at + interval '1 minute'
               THEN round(extract(epoch FROM (s.last_inside_at - s.entered_at)) / 60.0, 1) END;
  UPDATE visit_presence_sessions SET status = 'discarded', outcome = p_reason, closed_at = now(), dwell_lower_bound_min = v_lb WHERE id = s.id;
  IF v_lb IS NULL THEN RETURN NULL; END IF;
  SELECT p.candidate_dwell_minutes INTO v_need FROM items i JOIN visit_detection_profiles p ON p.key = i.visit_profile_key AND NOT p.manual_only AND p.is_active WHERE i.id = s.item_id;
  IF v_need IS NULL OR v_lb < v_need THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM check_ins k WHERE k.user_id = s.user_id AND k.item_id = s.item_id) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM candidate_visits c WHERE c.user_id = s.user_id AND c.item_id = s.item_id AND c.status IN ('candidate','medium_confidence','high_confidence') AND c.expires_at > now()) THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_today FROM candidate_visits WHERE user_id = s.user_id AND created_at > now() - interval '24 hours';
  IF v_today >= 30 THEN RETURN NULL; END IF;
  v_comp := visit_competing_count(s.item_id);
  v_ev := visit_evaluate(s.item_id, v_lb, NULL, NULL, v_comp);   -- dwell evidence only: no exit fix, no speed
  IF v_ev->>'outcome' <> 'candidate' THEN RETURN NULL; END IF;
  v_status := CASE WHEN v_ev->>'status' = 'high_confidence' THEN 'medium_confidence' ELSE v_ev->>'status' END; -- an unobserved exit never notifies
  INSERT INTO candidate_visits (user_id, item_id, visit_profile_key, arrival_at, departure_at, dwell_minutes, detection_method,
                                confidence_score, status, expires_at, metadata)
  SELECT s.user_id, s.item_id, i.visit_profile_key, s.entered_at, s.last_inside_at, v_lb, 'geofence_dwell',
         (v_ev->>'score')::int, v_status, s.last_inside_at + interval '168 hours',
         jsonb_build_object('profileKey', i.visit_profile_key, 'competingVenueCount', v_comp, 'source', 'presence_session', 'sessionId', s.id,
                            'dwellBound', 'lower', 'lastSeenAt', s.last_inside_at, 'closedBecause', p_reason)
    FROM items i WHERE i.id = s.item_id
  RETURNING id INTO v_cand;
  UPDATE visit_presence_sessions SET outcome = 'missed_exit_lower_bound', candidate_visit_id = v_cand WHERE id = s.id;
  RETURN v_cand;
END $fn$;
REVOKE ALL ON FUNCTION public.visit_close_uncertain(uuid, text) FROM PUBLIC, anon, authenticated;

-- ENTER: new optional fix age; classification-based acceptance; last_inside_at bookkeeping.
DROP FUNCTION IF EXISTS public.visit_presence_enter(uuid, double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION public.visit_presence_enter(p_item_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL, p_fix_age_s double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  it record; v_radius int; v_existing record; v_open int; v_today int; v_prev record; v_speed double precision; o record; v_id uuid; v_entered timestamptz; v_class text;
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

  FOR o IN SELECT id FROM visit_presence_sessions WHERE user_id = v_uid AND status = 'open' AND entered_at < now() - interval '8 hours' LOOP
    PERFORM visit_close_uncertain(o.id, 'stale_open');
  END LOOP;

  v_radius := visit_geofence_radius_m(it.geo_radius_m);
  v_class := visit_fix_presence(visit_distance_m(p_lat, p_lng, it.maps_lat, it.maps_lng), v_radius, p_accuracy, p_fix_age_s);
  IF v_class = 'stale' THEN RETURN jsonb_build_object('status','rejected','reason','stale_fix'); END IF;
  IF v_class = 'outside' THEN RETURN jsonb_build_object('status','rejected','reason','fix_outside_venue'); END IF;
  IF v_class = 'uncertain' THEN RETURN jsonb_build_object('status','rejected','reason','fix_uncertain'); END IF;

  -- This trustworthy fix is evidence for every open session it is inside of.
  PERFORM visit_touch_inside(v_uid, p_lat, p_lng, p_accuracy, p_fix_age_s);

  SELECT id, entered_at INTO v_existing FROM visit_presence_sessions WHERE user_id = v_uid AND item_id = p_item_id AND status = 'open';
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_open','session_id',v_existing.id,'entered_at',v_existing.entered_at);
  END IF;

  -- Another open session whose venue this trustworthy fix is clearly OUTSIDE of: its exit was missed. Close it; credit only a proven lower bound.
  FOR o IN SELECT s.id, i.maps_lat, i.maps_lng, i.geo_radius_m FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id WHERE s.user_id = v_uid AND s.status = 'open' LOOP
    IF visit_fix_presence(visit_distance_m(p_lat, p_lng, o.maps_lat, o.maps_lng), visit_geofence_radius_m(o.geo_radius_m), p_accuracy, p_fix_age_s) = 'outside' THEN
      PERFORM visit_close_uncertain(o.id, 'missed_exit');
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
    INSERT INTO visit_presence_sessions (user_id, item_id, enter_lat, enter_lng, enter_accuracy_m, last_inside_at)
    VALUES (v_uid, p_item_id, p_lat, p_lng, p_accuracy, now()) RETURNING id, entered_at INTO v_id, v_entered;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, entered_at INTO v_existing FROM visit_presence_sessions WHERE user_id = v_uid AND item_id = p_item_id AND status = 'open';
    RETURN jsonb_build_object('status','already_open','session_id',v_existing.id,'entered_at',v_existing.entered_at);
  END;
  RETURN jsonb_build_object('status','opened','session_id',v_id,'entered_at',v_entered);
END $fn$;
REVOKE ALL ON FUNCTION public.visit_presence_enter(uuid, double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visit_presence_enter(uuid, double precision, double precision, double precision, double precision) TO authenticated;

-- RECONCILE: same classification; only clear evidence of being outside closes a session.
DROP FUNCTION IF EXISTS public.visit_presence_reconcile(double precision, double precision, double precision);
CREATE OR REPLACE FUNCTION public.visit_presence_reconcile(p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL, p_fix_age_s double precision DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_uid uuid := auth.uid(); o record; v_closed int := 0; v_cands int := 0; v_c uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'P0001'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('closed', 0, 'open_item_ids', '[]'::jsonb, 'reason', 'bad_fix');
  END IF;
  IF p_fix_age_s IS NOT NULL AND p_fix_age_s > 180 THEN
    RETURN jsonb_build_object('closed', 0, 'open_item_ids', COALESCE((SELECT jsonb_agg(item_id) FROM visit_presence_sessions WHERE user_id = v_uid AND status = 'open'), '[]'::jsonb), 'reason', 'stale_fix');
  END IF;
  FOR o IN SELECT id FROM visit_presence_sessions WHERE user_id = v_uid AND status = 'open' AND entered_at < now() - interval '8 hours' LOOP
    PERFORM visit_close_uncertain(o.id, 'stale_open');
  END LOOP;
  PERFORM visit_touch_inside(v_uid, p_lat, p_lng, p_accuracy, p_fix_age_s);
  FOR o IN SELECT s.id, i.maps_lat, i.maps_lng, i.geo_radius_m FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id WHERE s.user_id = v_uid AND s.status = 'open' LOOP
    IF visit_fix_presence(visit_distance_m(p_lat, p_lng, o.maps_lat, o.maps_lng), visit_geofence_radius_m(o.geo_radius_m), p_accuracy, p_fix_age_s) = 'outside' THEN
      v_c := visit_close_uncertain(o.id, 'missed_exit');
      v_closed := v_closed + 1;
      IF v_c IS NOT NULL THEN v_cands := v_cands + 1; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('closed', v_closed, 'lower_bound_candidates', v_cands,
    'open_item_ids', COALESCE((SELECT jsonb_agg(item_id) FROM visit_presence_sessions WHERE user_id = v_uid AND status = 'open'), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.visit_presence_reconcile(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visit_presence_reconcile(double precision, double precision, double precision, double precision) TO authenticated;

-- EXIT: unchanged except that its fix also refreshes last_inside_at of the user's other open sessions.
CREATE OR REPLACE FUNCTION public.visit_presence_exit(p_item_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy double precision DEFAULT NULL::double precision, p_speed double precision DEFAULT NULL::double precision, p_client_departed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- This fix is also a location sample for the user's OTHER open sessions: refresh their last-seen-inside evidence.
  PERFORM visit_touch_inside(v_uid, p_lat, p_lng, p_accuracy, NULL);

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
END $function$;

DO $$
BEGIN
  IF visit_fix_presence(206, 100, 10.4, 5) <> 'outside' THEN RAISE EXCEPTION 'Casola 18:30 case must be outside'; END IF;
  IF visit_fix_presence(125, 120, 6.2, 5) <> 'inside' THEN RAISE EXCEPTION 'Rufolo entry must be inside'; END IF;
  IF visit_fix_presence(88, 100, 16.4, 5) <> 'inside' THEN RAISE EXCEPTION 'Duomo entry must be inside'; END IF;
  IF visit_fix_presence(40, 100, 120, 5) <> 'uncertain' THEN RAISE EXCEPTION 'coarse fix must be uncertain'; END IF;
  IF visit_fix_presence(40, 100, 10, 600) <> 'stale' THEN RAISE EXCEPTION 'old fix must be stale'; END IF;
END $$;

COMMIT;
