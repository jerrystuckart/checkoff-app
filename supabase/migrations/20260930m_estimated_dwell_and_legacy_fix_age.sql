-- 20260930m: estimated dwell is labelled as an estimate; legacy (no fix-age) clients get a permanent strict rule + telemetry.
--
-- 1. Sparse inside-samples do NOT prove continuous presence between them, even with the 15-minute per-gap cap. What the server
--    computes from them is an ESTIMATE of the stay, good enough to offer an honor-system suggestion, never a proven minimum.
--    Columns/metadata are renamed so the two cannot be confused:
--      visit_presence_sessions.proven_inside_s        -> sampled_inside_s   (seconds credited from inside-samples, gap capped at 900 s)
--      visit_presence_sessions.dwell_lower_bound_min  -> dwell_estimate_min
--      candidate_visits.metadata.dwellBound='lower'   -> dwellBasis='estimated' (+ sampledSeconds); outcome missed_exit_estimated
--    Observed stays (an enter AND an exit event) carry no dwellBasis (= observed). Re-evaluated stays carry reevaluated=true.
--    "At least" is reserved for evidence that establishes a minimum; nothing in the system does today.
-- 2. Old clients omit p_fix_age_s. Instead of a cutoff after which every such enter is silently rejected as stale, a missing age is
--    ALWAYS handled by the strict legacy rule (accuracy <= 30 m and inside the circle; no tolerance, no uncertainty credit), and every
--    user that sends it is logged (geofence_debug_events 'presence_legacy_fix', at most one per user per 6 h) so it is visible.

ALTER TABLE public.visit_presence_sessions RENAME COLUMN proven_inside_s TO sampled_inside_s;
ALTER TABLE public.visit_presence_sessions RENAME COLUMN dwell_lower_bound_min TO dwell_estimate_min;
COMMENT ON COLUMN public.visit_presence_sessions.sampled_inside_s IS 'Seconds CREDITED from consecutive inside-samples (gap capped at 900 s). An estimate: samples do not prove presence between them.';
COMMENT ON COLUMN public.visit_presence_sessions.dwell_estimate_min IS 'Estimated stay (minutes) recorded when a session was closed without an observed exit; derived from sampled_inside_s.';

ALTER TABLE geofence_debug_events DROP CONSTRAINT IF EXISTS geofence_debug_events_event_type_check;
ALTER TABLE geofence_debug_events ADD CONSTRAINT geofence_debug_events_event_type_check
  CHECK (event_type = ANY (ARRAY['enter','exit','exit_ignored_still_inside','discarded_below_candidate_dwell','discarded_manual_only_or_no_profile',
    'discarded_no_arrival_record','candidate_created','task_error','discarded_implausible_dwell','discarded_below_ignore_band','candidate_insert_failed',
    'presence_enter_result','presence_exit_result','presence_rpc_failed','sentinel_exit','sentinel_ignored','sentinel_born_outside',
    'movement_update','movement_ignored','presence_legacy_fix']));

-- strict legacy handling is permanent: no cutoff after which legacy clients fail silently
CREATE OR REPLACE FUNCTION public.visit_legacy_fix_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $fn$ SELECT NULL::timestamptz $fn$;

CREATE OR REPLACE FUNCTION public.visit_fix_presence(p_dist double precision, p_radius double precision, p_acc double precision, p_age_s double precision DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE acc_eff double precision := COALESCE(GREATEST(p_acc, 0), 50); tol double precision := visit_zone_tolerance_m(); uid uuid := auth.uid();
BEGIN
  IF p_age_s IS NOT NULL AND (p_age_s > 180 OR p_age_s < -5) THEN RETURN 'stale'; END IF;
  IF p_age_s IS NULL THEN
    -- Age unknown (client older than the fix-age OTA): strict rule, always. Logged so a legacy client is never invisible.
    IF uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM geofence_debug_events e WHERE e.user_id = uid AND e.event_type = 'presence_legacy_fix' AND e.occurred_at > now() - interval '6 hours') THEN
      INSERT INTO geofence_debug_events (user_id, event_type, detail) VALUES (uid, 'presence_legacy_fix', jsonb_build_object('note', 'client did not send p_fix_age_s: strict legacy rule applied', 'distM', round(p_dist::numeric), 'accuracyM', p_acc));
    END IF;
    IF p_acc IS NOT NULL AND p_acc <= 30 AND p_dist <= p_radius THEN RETURN 'inside'; END IF;
    IF p_dist - LEAST(acc_eff, 100) > p_radius + tol THEN RETURN 'outside'; END IF;
    RETURN 'uncertain';
  END IF;
  IF p_dist - LEAST(acc_eff, 100) > p_radius + tol THEN RETURN 'outside'; END IF;
  IF p_dist <= p_radius + tol AND acc_eff <= 65 THEN RETURN 'inside'; END IF;
  RETURN 'uncertain';
END $fn$;
REVOKE ALL ON FUNCTION public.visit_fix_presence(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.visit_touch_inside(p_uid uuid, p_lat double precision, p_lng double precision, p_acc double precision, p_age_s double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF p_uid IS NULL OR p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RETURN; END IF;
  UPDATE visit_presence_sessions s
     SET sampled_inside_s = s.sampled_inside_s + LEAST(GREATEST(extract(epoch FROM (now() - COALESCE(s.last_inside_at, s.entered_at))), 0), 900)::int,
         last_inside_at = now()
    FROM items i
   WHERE s.user_id = p_uid AND s.status = 'open' AND i.id = s.item_id AND i.maps_lat IS NOT NULL
     AND visit_fix_presence(visit_distance_m(p_lat, p_lng, i.maps_lat, i.maps_lng), visit_geofence_radius_m(i.geo_radius_m), p_acc, p_age_s) = 'inside';
END $fn$;

CREATE OR REPLACE FUNCTION public.visit_close_uncertain(p_session uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record; v_lb numeric; v_need numeric; v_comp int; v_ev jsonb; v_today int; v_status text; v_cand uuid;
BEGIN
  SELECT * INTO s FROM visit_presence_sessions WHERE id = p_session AND status = 'open' FOR UPDATE;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  v_lb := CASE WHEN s.sampled_inside_s >= 60 THEN round(s.sampled_inside_s / 60.0, 1) END;
  UPDATE visit_presence_sessions SET status = 'discarded', outcome = p_reason, closed_at = now(), dwell_estimate_min = v_lb WHERE id = s.id;
  IF v_lb IS NULL THEN RETURN NULL; END IF;
  SELECT p.candidate_dwell_minutes INTO v_need FROM items i JOIN visit_detection_profiles p ON p.key = i.visit_profile_key AND NOT p.manual_only AND p.is_active WHERE i.id = s.item_id;
  IF v_need IS NULL OR v_lb < v_need THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM check_ins k WHERE k.user_id = s.user_id AND k.item_id = s.item_id) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM candidate_visits c WHERE c.user_id = s.user_id AND c.item_id = s.item_id AND c.status IN ('candidate','medium_confidence','high_confidence') AND c.expires_at > now()) THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_today FROM candidate_visits WHERE user_id = s.user_id AND created_at > now() - interval '24 hours';
  IF v_today >= 30 THEN RETURN NULL; END IF;
  v_comp := visit_competing_count(s.item_id);
  v_ev := visit_evaluate(s.item_id, v_lb, NULL, NULL, v_comp);
  IF v_ev->>'outcome' <> 'candidate' THEN RETURN NULL; END IF;
  v_status := CASE WHEN v_ev->>'status' = 'high_confidence' THEN 'medium_confidence' ELSE v_ev->>'status' END;
  INSERT INTO candidate_visits (user_id, item_id, visit_profile_key, arrival_at, departure_at, dwell_minutes, detection_method,
                                confidence_score, status, expires_at, metadata)
  SELECT s.user_id, s.item_id, i.visit_profile_key, s.entered_at, s.last_inside_at, v_lb, 'geofence_dwell',
         (v_ev->>'score')::int, v_status, s.last_inside_at + interval '168 hours',
         jsonb_build_object('profileKey', i.visit_profile_key, 'competingVenueCount', v_comp, 'source', 'presence_session', 'sessionId', s.id,
                            'dwellBasis', 'estimated', 'lastSeenAt', s.last_inside_at, 'closedBecause', p_reason, 'sampledSeconds', s.sampled_inside_s)
    FROM items i WHERE i.id = s.item_id
  RETURNING id INTO v_cand;
  UPDATE visit_presence_sessions SET outcome = 'missed_exit_estimated', candidate_visit_id = v_cand WHERE id = s.id;
  RETURN v_cand;
END $fn$;

-- notify trigger: estimated / re-evaluated / overlapped stays stay inbox-only (legacy dwellBound kept for rows written before this migration)
CREATE OR REPLACE FUNCTION public.__m_patch_notify() RETURNS void LANGUAGE plpgsql AS $x$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_trigger t ON t.tgfoid = p.oid WHERE t.tgrelid = 'public.candidate_visits'::regclass AND pg_get_functiondef(p.oid) LIKE '%dwellBound%' LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'notify trigger function not found'; END IF;
  d := replace(d, $$NEW.metadata->>'dwellBound' = 'lower'$$, $$(NEW.metadata->>'dwellBound' = 'lower' OR NEW.metadata->>'dwellBasis' = 'estimated')$$);
  IF d NOT LIKE '%dwellBasis%' THEN RAISE EXCEPTION 'notify trigger patch did not apply'; END IF;
  EXECUTE d;
END $x$;
SELECT public.__m_patch_notify();
DROP FUNCTION public.__m_patch_notify();

-- existing rows: relabel, never claim a minimum
UPDATE candidate_visits
   SET metadata = (metadata - 'dwellBound' - 'provenSeconds') || jsonb_build_object('dwellBasis', 'estimated') || CASE WHEN metadata ? 'provenSeconds' THEN jsonb_build_object('sampledSeconds', metadata->'provenSeconds') ELSE '{}'::jsonb END
 WHERE metadata->>'dwellBound' = 'lower';
UPDATE visit_presence_sessions SET outcome = 'missed_exit_estimated' WHERE outcome = 'missed_exit_lower_bound';
