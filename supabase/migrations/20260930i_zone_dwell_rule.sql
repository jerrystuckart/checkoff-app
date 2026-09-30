-- Clarified product rule (2026-09-30): CheckOff is an honor system. Time inside an item's configured zone for the configured
-- dwell earns a chance to CONFIRM an experience. It does not award anything, check anything off, or require proof of the precise
-- activity. This migration aligns detection with that rule without loosening the location checks.
--
-- 1. Overlap no longer suppresses. `overlapping_venues` (-25) made a dwell-qualified stay in a dense cluster fall under the ignore
--    band (50): the 8 Amalfi-piazza stays of 2026-09-30 (32-42 min each) scored 30-45 and were discarded. Weight set to 0. Competing
--    venues are still counted and stored (candidate metadata + the "several places are close together" wording); several nearby
--    experiences may be offered and the user confirms only what they did. A qualified stay scores inside(30)+dwell(25) = 55 >= 50;
--    poor accuracy (-20) and a drive-by (-30) can still drop a stay below the band, so bad location data still suppresses.
-- 2. The zone is the configured zone. Acceptance of a fix = distance <= visit_geofence_radius_m(geo_radius_m) + visit_zone_tolerance_m()
--    (15 m, for catalogue geocode placement error, a named constant, NOT a per-request slack) and accuracy <= 65 m; 'outside' when
--    even the most favourable point of the fix's uncertainty disc is beyond that. The old +100 m server slack is gone (20260930g).
-- 3. Old clients cannot skip the fix-age check by omitting p_fix_age_s. Until visit_legacy_fix_cutoff() a missing age is accepted
--    only for a strictly inside, accurate fix (accuracy <= 30 m, distance <= the zone with no tolerance) so the one installed older
--    build keeps working; from the cutoff a missing age is 'stale'. A negative or absurd age is 'stale'. (A modified client can still
--    lie about the age, exactly as it can about coordinates; this stops stale positions, not forged ones.)
-- 4. "Do not count unobserved time as proven continuous presence": when a session is closed WITHOUT an observed exit, its proven
--    minimum is the sum over consecutive inside-samples of min(gap, 15 min) (visit_presence_sessions.proven_inside_s), not
--    last_inside_at - entered_at. Two samples an hour apart prove 15 minutes, not 60. Sessions with an observed enter AND exit
--    keep the existing dwell (the OS observed both edges).
-- 5. Recorded evidence may be re-evaluated under the clarified rule (visit_reevaluate_sessions): closed sessions discarded only as
--    'below_ignore_band' whose stored enter fix is inside the zone by the rule above, with the observed enter/exit times, produce a
--    candidate flagged metadata.reevaluated = true (rule, original outcome, timestamp). Already-checked-off and duplicate-pending
--    guards apply; newest stay per place wins; nothing is backdated or invented.
-- Reversible: UPDATE visit_confidence_weights SET weight = -25 WHERE key = 'overlapping_venues'; recreate the functions from
-- 20260930g; candidates created by re-evaluation carry metadata.reevaluated and can be deleted by that marker.
BEGIN;

UPDATE visit_confidence_weights SET weight = 0, description = 'Multiple nearby CheckOff venues overlap. Recorded for wording only: does not reduce confidence (honor-system rule 2026-09-30)', updated_at = now()
 WHERE key = 'overlapping_venues';

ALTER TABLE public.visit_presence_sessions ADD COLUMN IF NOT EXISTS proven_inside_s integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.visit_presence_sessions.proven_inside_s IS 'Seconds of presence PROVEN by inside-samples: sum over consecutive samples of min(gap, 900 s). Used only when a session is closed without an observed exit.';

CREATE OR REPLACE FUNCTION public.visit_zone_tolerance_m() RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$ SELECT 15 $fn$;
CREATE OR REPLACE FUNCTION public.visit_legacy_fix_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $fn$ SELECT timestamptz '2026-10-03 00:00:00+02' $fn$;

CREATE OR REPLACE FUNCTION public.visit_fix_presence(p_dist double precision, p_radius double precision, p_acc double precision, p_age_s double precision DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE AS $fn$
DECLARE acc_eff double precision := COALESCE(GREATEST(p_acc, 0), 50); tol double precision := visit_zone_tolerance_m();
BEGIN
  IF p_age_s IS NOT NULL AND (p_age_s > 180 OR p_age_s < -5) THEN RETURN 'stale'; END IF;
  IF p_age_s IS NULL THEN
    -- Age unknown (older client). After the cutoff: unusable. Before it: only an unmistakably inside, accurate fix.
    IF now() >= visit_legacy_fix_cutoff() THEN RETURN 'stale'; END IF;
    IF p_acc IS NOT NULL AND p_acc <= 30 AND p_dist <= p_radius THEN RETURN 'inside'; END IF;
    IF p_dist - LEAST(acc_eff, 100) > p_radius + tol THEN RETURN 'outside'; END IF;
    RETURN 'uncertain';
  END IF;
  IF p_dist - LEAST(acc_eff, 100) > p_radius + tol THEN RETURN 'outside'; END IF;
  IF p_dist <= p_radius + tol AND acc_eff <= 65 THEN RETURN 'inside'; END IF;
  RETURN 'uncertain';
END $fn$;

CREATE OR REPLACE FUNCTION public.visit_touch_inside(p_uid uuid, p_lat double precision, p_lng double precision, p_acc double precision, p_age_s double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF p_uid IS NULL OR p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RETURN; END IF;
  UPDATE visit_presence_sessions s
     SET proven_inside_s = s.proven_inside_s + LEAST(GREATEST(extract(epoch FROM (now() - COALESCE(s.last_inside_at, s.entered_at))), 0), 900)::int,
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
  v_lb := CASE WHEN s.proven_inside_s >= 60 THEN round(s.proven_inside_s / 60.0, 1) END;
  UPDATE visit_presence_sessions SET status = 'discarded', outcome = p_reason, closed_at = now(), dwell_lower_bound_min = v_lb WHERE id = s.id;
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
                            'dwellBound', 'lower', 'lastSeenAt', s.last_inside_at, 'closedBecause', p_reason, 'provenSeconds', s.proven_inside_s)
    FROM items i WHERE i.id = s.item_id
  RETURNING id INTO v_cand;
  UPDATE visit_presence_sessions SET outcome = 'missed_exit_lower_bound', candidate_visit_id = v_cand WHERE id = s.id;
  RETURN v_cand;
END $fn$;
REVOKE ALL ON FUNCTION public.visit_close_uncertain(uuid, text) FROM PUBLIC, anon, authenticated;

-- Re-evaluate recorded sessions under the clarified rule. Not callable by clients.
CREATE OR REPLACE FUNCTION public.visit_reevaluate_sessions(p_user uuid, p_since interval DEFAULT interval '6 days')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE s record; v_dwell numeric; v_need numeric; v_comp int; v_ev jsonb; v_cand uuid; v_made int := 0; v_today int;
BEGIN
  FOR s IN
    SELECT ps.*, i.maps_lat, i.maps_lng, i.geo_radius_m, i.visit_profile_key
      FROM visit_presence_sessions ps JOIN items i ON i.id = ps.item_id
     WHERE ps.user_id = p_user AND ps.status = 'closed' AND ps.outcome = 'below_ignore_band' AND ps.created_at > now() - p_since
       AND ps.candidate_visit_id IS NULL
     ORDER BY ps.closed_at DESC                      -- newest stay per place wins
  LOOP
    v_dwell := extract(epoch FROM (s.closed_at - s.entered_at)) / 60.0;                 -- observed enter AND exit
    SELECT p.candidate_dwell_minutes INTO v_need FROM visit_detection_profiles p WHERE p.key = s.visit_profile_key AND NOT p.manual_only AND p.is_active;
    CONTINUE WHEN v_need IS NULL OR v_dwell < v_need;
    -- the stored enter fix must satisfy the zone rule on distance and accuracy (its age was not recorded)
    CONTINUE WHEN s.enter_lat IS NULL OR visit_distance_m(s.enter_lat, s.enter_lng, s.maps_lat, s.maps_lng) > visit_geofence_radius_m(s.geo_radius_m) + visit_zone_tolerance_m()
                  OR COALESCE(s.enter_accuracy_m, 999) > 65;
    CONTINUE WHEN EXISTS (SELECT 1 FROM check_ins k WHERE k.user_id = s.user_id AND k.item_id = s.item_id);
    CONTINUE WHEN EXISTS (SELECT 1 FROM candidate_visits c WHERE c.user_id = s.user_id AND c.item_id = s.item_id AND c.status IN ('candidate','medium_confidence','high_confidence') AND c.expires_at > now());
    SELECT count(*) INTO v_today FROM candidate_visits WHERE user_id = s.user_id AND created_at > now() - interval '24 hours';
    CONTINUE WHEN v_today >= 30;
    v_comp := visit_competing_count(s.item_id);
    v_ev := visit_evaluate(s.item_id, v_dwell, NULL, NULL, v_comp);
    CONTINUE WHEN v_ev->>'outcome' <> 'candidate';
    INSERT INTO candidate_visits (user_id, item_id, visit_profile_key, arrival_at, departure_at, dwell_minutes, detection_method, confidence_score, status, expires_at, metadata)
    VALUES (s.user_id, s.item_id, s.visit_profile_key, s.entered_at, s.closed_at, round(v_dwell, 1), 'geofence_dwell', (v_ev->>'score')::int,
            CASE WHEN v_ev->>'status' = 'high_confidence' THEN 'medium_confidence' ELSE v_ev->>'status' END, s.closed_at + interval '168 hours',
            jsonb_build_object('profileKey', s.visit_profile_key, 'competingVenueCount', v_comp, 'source', 'presence_session', 'sessionId', s.id,
                               'reevaluated', true, 'rule', 'zone_dwell_2026-09-30', 'originalOutcome', 'below_ignore_band', 'reevaluatedAt', now()))
    RETURNING id INTO v_cand;
    UPDATE visit_presence_sessions SET outcome = 'candidate_reevaluated', candidate_visit_id = v_cand WHERE id = s.id;
    v_made := v_made + 1;
  END LOOP;
  RETURN v_made;
END $fn$;
REVOKE ALL ON FUNCTION public.visit_reevaluate_sessions(uuid, interval) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE expected_legacy text;
BEGIN
  expected_legacy := CASE WHEN now() >= visit_legacy_fix_cutoff() THEN 'stale' ELSE 'inside' END;
  IF (SELECT weight FROM visit_confidence_weights WHERE key = 'overlapping_venues') <> 0 THEN RAISE EXCEPTION 'overlap weight not zero'; END IF;
  IF visit_fix_presence(206, 100, 10.4, 5) <> 'outside' THEN RAISE EXCEPTION 'lodging fix must stay outside'; END IF;
  IF visit_fix_presence(125, 120, 6.2, 5) <> 'inside' THEN RAISE EXCEPTION 'Rufolo entry must stay inside'; END IF;
  IF visit_fix_presence(60, 100, 10, -1000) <> 'stale' THEN RAISE EXCEPTION 'negative age must be stale'; END IF;
  IF visit_fix_presence(60, 100, 10, NULL) <> expected_legacy THEN RAISE EXCEPTION 'legacy null-age handling'; END IF;
  IF visit_fix_presence(118, 100, 10, NULL) = 'inside' THEN RAISE EXCEPTION 'legacy null-age fix outside the zone must not be inside'; END IF;
END $$;

COMMIT;
