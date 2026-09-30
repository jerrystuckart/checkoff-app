-- Rolled-back regression check for the honor-system zone + dwell rule (20260930i / j).
-- Run: supabase db query -f supabase/checks/visit_zone_dwell_rule.sql --linked   (replace the tester id below)
-- Expected: ROLLED BACK: overlap_weight=0 | legacy_noage_inside=opened legacy_noage_marginal=rejected/fix_uncertain
--   post_cutoff_noage=rejected/stale_fix negative_age=rejected/stale_fix | gap_cap=proven_900s,candidate_credited_15.0min_not_50 continuous=proven_1800s(candidate,lower)
--   | reeval=made_1,provenance_ok,second_run_made_0 | notify_trigger_skips_overlapped=true
DO $$
DECLARE r text := ''; o jsonb; v record; w record; cand record; n int; uid uuid := '11275026-65be-4421-80a4-46c57195408b'; made int; s1 uuid;
BEGIN
  r := r || 'overlap_weight=' || (SELECT weight FROM visit_confidence_weights WHERE key = 'overlapping_venues') || ' | ';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  SELECT id, maps_lat, maps_lng INTO v FROM items WHERE id::text LIKE '8fe5beb8-%';      -- Ceramiche Casola (retail, no close neighbours)

  -- isolate from the tester's real data inside this rolled-back transaction
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  UPDATE visit_presence_sessions SET entered_at=entered_at - interval '3 days', closed_at=closed_at - interval '3 days', created_at=created_at - interval '3 days',
         last_inside_at=last_inside_at - interval '3 days' WHERE user_id=uid;
  DELETE FROM check_ins WHERE user_id=uid AND item_id = v.id;
  DELETE FROM candidate_visits WHERE user_id=uid AND item_id = v.id;

  EXECUTE 'SET LOCAL ROLE authenticated';
  -- (1) an OLDER client omits p_fix_age_s (named 4-arg call): before the cutoff only an unmistakably inside, accurate fix is accepted
  o := visit_presence_enter(p_item_id := v.id, p_lat := v.maps_lat + 20.0/111320, p_lng := v.maps_lng, p_accuracy := 8);
  r := r || 'legacy_noage_inside=' || (o->>'status') || ' ';
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(p_item_id := v.id, p_lat := v.maps_lat + 110.0/111320, p_lng := v.maps_lng, p_accuracy := 8);   -- 110 m from a 100 m zone, no age
  r := r || 'legacy_noage_marginal=' || (o->>'status') || '/' || COALESCE(o->>'reason','-') || ' ';
  -- (2) after the cutoff a missing age is unusable (simulated by moving the cutoff into the past, rolled back)
  EXECUTE 'RESET ROLE';
  EXECUTE 'CREATE OR REPLACE FUNCTION public.visit_legacy_fix_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $f$ SELECT timestamptz ''2020-01-01 00:00:00+00'' $f$';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(p_item_id := v.id, p_lat := v.maps_lat, p_lng := v.maps_lng, p_accuracy := 5);
  r := r || 'post_cutoff_noage=' || (o->>'status') || '/' || COALESCE(o->>'reason','-') || ' ';
  o := visit_presence_enter(p_item_id := v.id, p_lat := v.maps_lat, p_lng := v.maps_lng, p_accuracy := 5, p_fix_age_s := -1000);
  r := r || 'negative_age=' || (o->>'status') || '/' || COALESCE(o->>'reason','-') || ' | ';

  -- (3) proven presence is capped per gap: two samples 50 min apart prove 15 min, not 50
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  UPDATE visit_presence_sessions SET entered_at=entered_at - interval '3 days', closed_at=closed_at - interval '3 days', created_at=created_at - interval '3 days', last_inside_at=last_inside_at - interval '3 days' WHERE user_id=uid;
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(p_item_id := v.id, p_lat := v.maps_lat, p_lng := v.maps_lng, p_accuracy := 6, p_fix_age_s := 2);
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET entered_at = now() - interval '60 minutes', last_inside_at = now() - interval '50 minutes' WHERE user_id=uid AND item_id=v.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_reconcile(v.maps_lat, v.maps_lng, 6, 2);      -- inside sample 50 min after the previous one: credits only 900 s
  EXECUTE 'RESET ROLE';
  SELECT proven_inside_s INTO n FROM visit_presence_sessions WHERE user_id=uid AND item_id=v.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_reconcile(v.maps_lat + 0.02, v.maps_lng, 6, 2);   -- phone clearly elsewhere: closes the session
  EXECUTE 'RESET ROLE';
  SELECT c.dwell_minutes AS d INTO cand FROM candidate_visits c WHERE c.user_id=uid AND c.item_id=v.id;
  r := r || 'gap_cap=proven_' || n || 's,candidate_credited_' || COALESCE(cand.d::text, 'none') || 'min_not_50 ';
  -- ... whereas samples at least every 15 min prove the whole stay
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  UPDATE visit_presence_sessions SET entered_at=entered_at - interval '3 days', closed_at=closed_at - interval '3 days', created_at=created_at - interval '3 days', last_inside_at=last_inside_at - interval '3 days' WHERE user_id=uid;
  DELETE FROM candidate_visits WHERE user_id=uid AND item_id=v.id;
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(p_item_id := v.id, p_lat := v.maps_lat, p_lng := v.maps_lng, p_accuracy := 6, p_fix_age_s := 2);
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET entered_at = now() - interval '40 minutes', last_inside_at = now() - interval '25 minutes', proven_inside_s = 900 WHERE user_id=uid AND item_id=v.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_reconcile(v.maps_lat, v.maps_lng, 6, 2);      -- sample 25 min later: +900 s cap -> 1800 s proven
  EXECUTE 'RESET ROLE';
  SELECT proven_inside_s INTO n FROM visit_presence_sessions WHERE user_id=uid AND item_id=v.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_reconcile(v.maps_lat + 0.02, v.maps_lng, 6, 2);
  EXECUTE 'RESET ROLE';
  SELECT c.metadata->>'dwellBound' AS b, c.dwell_minutes AS d INTO cand FROM candidate_visits c WHERE c.user_id=uid AND c.item_id=v.id;
  r := r || 'continuous=proven_' || n || 's(' || COALESCE('candidate,' || cand.b || ',' || cand.d || 'min', 'NONE(BUG)') || ') | ';

  -- (4) re-evaluation: a closed session discarded only as below_ignore_band, with an in-zone accurate enter fix and an observed exit
  SELECT id, maps_lat, maps_lng INTO w FROM items WHERE id::text LIKE 'eef9a888-%';    -- Pasticceria Andrea Pansa (dense Amalfi piazza)
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  DELETE FROM check_ins WHERE user_id=uid AND item_id = w.id;
  DELETE FROM candidate_visits WHERE user_id=uid AND item_id = w.id;
  INSERT INTO visit_presence_sessions (user_id, item_id, entered_at, enter_lat, enter_lng, enter_accuracy_m, status, closed_at, outcome, created_at)
    VALUES (uid, w.id, now() - interval '70 minutes', w.maps_lat + 30.0/111320, w.maps_lng, 9, 'closed', now() - interval '30 minutes', 'below_ignore_band', now() - interval '70 minutes');
  made := visit_reevaluate_sessions(uid);
  SELECT c.metadata AS m, c.dwell_minutes AS d, c.status AS st INTO cand FROM candidate_visits c WHERE c.user_id=uid AND c.item_id=w.id;
  r := r || 'reeval=made_' || made || ',' || CASE WHEN cand.m->>'reevaluated' = 'true' AND cand.m->>'rule' IS NOT NULL AND cand.m->>'sessionId' IS NOT NULL AND cand.d = 40.0 THEN 'provenance_ok' ELSE 'PROVENANCE_BUG' END
         || ',second_run_made_' || visit_reevaluate_sessions(uid) || ' ';
  -- (5) the notify trigger ignores overlapped / re-evaluated candidates
  SELECT notification_sent_at INTO cand FROM candidate_visits WHERE user_id=uid AND item_id=w.id;
  r := r || '| notify_trigger_skips_overlapped=' || (cand.notification_sent_at IS NULL);
  RAISE EXCEPTION 'ROLLED BACK: %', r;
END $$;
