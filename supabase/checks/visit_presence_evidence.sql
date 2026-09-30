-- Rolled-back regression check for presence evidence quality (20260930g), using the 2026-09-30 recorded cases.
-- Run: supabase db query -f supabase/checks/visit_presence_evidence.sql --linked   (replace the tester id below)
-- Expected: ROLLED BACK: casola206=outside rufolo125=inside duomo88=inside coarse=uncertain stale=stale |
--   lodging=rejected/fix_outside_venue stale=rejected/stale_fix coarse=rejected/fix_uncertain neighbour=opened |
--   lb_none=no_candidate(missed_exit) lb_cand=candidate(lower,30.0min) status=... departure_is_last_seen=true
--   (an overlapped venue such as Rufolo, proven 30 min on dwell alone, scores 30 < 50 and yields no candidate by design)
--   uncertain_keeps_open=1 checked_off=no_candidate
DO $$
DECLARE r text := ''; o jsonb; casola record; rufolo record; duomo record; cand record; n int; uid uuid := '11275026-65be-4421-80a4-46c57195408b';
BEGIN
  -- (1) the classification on the recorded fixes (distance m, circle m, accuracy m, age s)
  r := r || 'casola206=' || visit_fix_presence(206, 100, 10.4, 5) || ' rufolo125=' || visit_fix_presence(125, 120, 6.2, 5) || ' duomo88=' || visit_fix_presence(88, 100, 16.4, 5)
         || ' coarse=' || visit_fix_presence(40, 100, 120, 5) || ' stale=' || visit_fix_presence(40, 100, 10, 600) || ' | ';

  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  SELECT id, maps_lat, maps_lng INTO casola FROM items WHERE id::text LIKE '8fe5beb8-%';
  SELECT id, maps_lat, maps_lng INTO rufolo FROM items WHERE id::text LIKE 'e49d440e-%';
  SELECT id, maps_lat, maps_lng INTO duomo  FROM items WHERE id::text LIKE '337a9a7f-%';

  -- isolate from the tester's real data INSIDE this rolled-back transaction
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  UPDATE visit_presence_sessions SET entered_at=entered_at - interval '3 days', closed_at=closed_at - interval '3 days', created_at=created_at - interval '3 days', last_inside_at=last_inside_at - interval '3 days' WHERE user_id=uid;  -- no 'impossible travel' from the previous step
  UPDATE visit_presence_sessions SET entered_at=entered_at - interval '3 days', closed_at=closed_at - interval '3 days', created_at=created_at - interval '3 days' WHERE user_id=uid;
  DELETE FROM check_ins WHERE user_id=uid AND item_id IN (casola.id, rufolo.id, duomo.id);
  DELETE FROM candidate_visits WHERE user_id=uid AND item_id IN (casola.id, rufolo.id, duomo.id);

  EXECUTE 'SET LOCAL ROLE authenticated';
  -- (2) lodging: 206 m from Casola with 10 m accuracy (today's 18:30 fix) is rejected; old / coarse fixes are rejected with a reason
  o := visit_presence_enter(casola.id, casola.maps_lat + 206.0/111320, casola.maps_lng, 10.4, 5);  r := r || 'lodging=' || (o->>'status') || '/' || COALESCE(o->>'reason','-') || ' ';
  o := visit_presence_enter(casola.id, casola.maps_lat, casola.maps_lng, 8, 600);                   r := r || 'stale=' || (o->>'status') || '/' || COALESCE(o->>'reason','-') || ' ';
  o := visit_presence_enter(casola.id, casola.maps_lat, casola.maps_lng, 120, 5);                   r := r || 'coarse=' || (o->>'status') || '/' || COALESCE(o->>'reason','-') || ' ';
  -- a genuine visit to that neighbour, a few steps from its door, is still accepted
  o := visit_presence_enter(casola.id, casola.maps_lat + 40.0/111320, casola.maps_lng, 8, 5);       r := r || 'neighbour=' || (o->>'status') || ' | ';

  -- (3) missed exit WITHOUT later evidence: no lower bound, no candidate, the session stays uncertain
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id=uid AND status='open';
  UPDATE visit_presence_sessions SET entered_at=entered_at - interval '3 days', closed_at=closed_at - interval '3 days', created_at=created_at - interval '3 days', last_inside_at=last_inside_at - interval '3 days' WHERE user_id=uid;  -- no 'impossible travel' from the previous step
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(rufolo.id, rufolo.maps_lat, rufolo.maps_lng, 6, 3);
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET entered_at = now() - interval '50 minutes', last_inside_at = now() - interval '50 minutes' WHERE user_id=uid AND item_id=rufolo.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_reconcile(rufolo.maps_lat + 0.02, rufolo.maps_lng, 8, 3);   -- the phone is clearly elsewhere
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM candidate_visits WHERE user_id=uid AND item_id=rufolo.id;
  SELECT outcome INTO cand FROM visit_presence_sessions WHERE user_id=uid AND item_id=rufolo.id ORDER BY created_at DESC LIMIT 1;
  r := r || 'lb_none=' || CASE WHEN n=0 THEN 'no_candidate' ELSE 'CANDIDATE(BUG)' END || '(' || cand.outcome || ') ';

  -- (4) missed exit WITH proven later evidence: a lower-bound candidate, departure = last seen inside, never above medium (a venue WITH close neighbours scores below the ignore band on dwell alone and produces nothing: Rufolo, Duomo)
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(casola.id, casola.maps_lat, casola.maps_lng, 6, 3);
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET entered_at = now() - interval '50 minutes', last_inside_at = now() - interval '20 minutes', proven_inside_s = 1800 WHERE user_id=uid AND item_id=casola.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_reconcile(casola.maps_lat + 0.02, casola.maps_lng, 8, 3);
  EXECUTE 'RESET ROLE';
  SELECT c.metadata->>'dwellBound' AS b, c.dwell_minutes AS d, c.status AS st, c.departure_at, c.arrival_at, s.last_inside_at INTO cand
    FROM candidate_visits c JOIN visit_presence_sessions s ON s.candidate_visit_id = c.id WHERE c.user_id=uid AND c.item_id=casola.id;
  r := r || 'lb_cand=' || CASE WHEN cand.b IS NULL THEN 'NONE(BUG)' ELSE 'candidate(' || cand.b || ',' || cand.d || 'min) status=' || cand.st || ' departure_is_last_seen=' || (cand.departure_at = cand.last_inside_at)::text END || ' ';

  -- (5) an UNCERTAIN fix (borderline, coarse) never closes a session
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(duomo.id, duomo.maps_lat, duomo.maps_lng, 10, 3);
  o := visit_presence_reconcile(duomo.maps_lat + 125.0/111320, duomo.maps_lng, 30, 3);  -- 125 m from a 100 m circle, 30 m accuracy: closest point 95 m -> uncertain
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM visit_presence_sessions WHERE user_id=uid AND item_id=duomo.id AND status='open';
  r := r || 'uncertain_keeps_open=' || n || ' ';

  -- (6) a place already checked off yields no lower-bound candidate either
  INSERT INTO check_ins (user_id, item_id, list_item_id, checkin_method, points_awarded) VALUES (uid, duomo.id, NULL, 'tap', 1);
  UPDATE visit_presence_sessions SET entered_at = now() - interval '50 minutes', last_inside_at = now() - interval '20 minutes', proven_inside_s = 1800 WHERE user_id=uid AND item_id=duomo.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"' || uid || '","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_reconcile(duomo.maps_lat + 0.02, duomo.maps_lng, 8, 3);
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM candidate_visits WHERE user_id=uid AND item_id=duomo.id;
  r := r || 'checked_off=' || CASE WHEN n=0 THEN 'no_candidate' ELSE 'CANDIDATE(BUG)' END;
  RAISE EXCEPTION 'ROLLED BACK: %', r;
END $$;
