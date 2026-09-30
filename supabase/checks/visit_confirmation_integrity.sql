-- Rolled-back check (run as a real tester; replace the user id): duplicate protection for a confirmed recovery, and the
-- server guard that never creates a candidate for an item the user already checked off.
-- Expected: ROLLED BACK: dupConfirm=blocked(...) dupItemConfirm=blocked(...) guard=already_checked_off
DO $$
DECLARE r text := ''; cand record; ven record; o jsonb; sid uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11275026-65be-4421-80a4-46c57195408b","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- (1) a second confirmation of an already-confirmed candidate / item is rejected
  SELECT c.id AS cid, c.item_id AS iid INTO cand FROM candidate_visits c WHERE c.user_id='11275026-65be-4421-80a4-46c57195408b' AND c.status='confirmed' AND c.converted_checkoff_id IS NOT NULL ORDER BY c.confirmed_at DESC LIMIT 1;
  BEGIN
    INSERT INTO check_ins (user_id, item_id, list_item_id, checkin_method, verification_method, matched_candidate_visit_id, points_awarded)
      VALUES ('11275026-65be-4421-80a4-46c57195408b', cand.iid, NULL, 'tap', 'historical_visit_confirmed', cand.cid, 1);
    r := r || 'dupConfirm=ALLOWED(BUG) ';
  EXCEPTION WHEN OTHERS THEN r := r || 'dupConfirm=blocked(' || left(SQLERRM, 60) || ') ';
  END;
  -- (2) a fresh "confirm" for a candidate of an item the user already checked off by hand is also blocked
  SELECT c.id AS cid, c.item_id AS iid INTO ven FROM candidate_visits c WHERE c.user_id='11275026-65be-4421-80a4-46c57195408b' AND c.status='medium_confidence' AND EXISTS (SELECT 1 FROM check_ins k WHERE k.user_id=c.user_id AND k.item_id=c.item_id) LIMIT 1;
  IF ven.cid IS NOT NULL THEN
    BEGIN
      INSERT INTO check_ins (user_id, item_id, list_item_id, checkin_method, verification_method, matched_candidate_visit_id, points_awarded)
        VALUES ('11275026-65be-4421-80a4-46c57195408b', ven.iid, NULL, 'tap', 'historical_visit_confirmed', ven.cid, 1);
      r := r || 'dupItemConfirm=ALLOWED(no error; see note) ';
    EXCEPTION WHEN OTHERS THEN r := r || 'dupItemConfirm=blocked(' || left(SQLERRM, 60) || ') ';
    END;
  END IF;
  -- (3) server guard: a qualifying stay at a place already checked off yields no candidate
  SELECT i.id, i.maps_lat, i.maps_lng INTO ven FROM items i WHERE EXISTS (SELECT 1 FROM check_ins k WHERE k.user_id='11275026-65be-4421-80a4-46c57195408b' AND k.item_id=i.id)
     AND i.visit_profile_key IN ('attraction','restaurant') AND i.maps_lat IS NOT NULL AND i.is_active ORDER BY i.id LIMIT 1;
  -- clear the tester's real open sessions INSIDE this rolled-back transaction so travel feasibility does not mask the guard
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET status='discarded', outcome='test_isolation', closed_at=now() WHERE user_id='11275026-65be-4421-80a4-46c57195408b' AND status='open';
  UPDATE visit_presence_sessions SET entered_at = entered_at - interval '2 days', closed_at = closed_at - interval '2 days', created_at = created_at - interval '2 days' WHERE user_id='11275026-65be-4421-80a4-46c57195408b';
  PERFORM set_config('request.jwt.claims', '{"sub":"11275026-65be-4421-80a4-46c57195408b","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_enter(ven.id, ven.maps_lat, ven.maps_lng, 10);
  r := r || 'enter=' || COALESCE(o->>'status','?') || '/' || COALESCE(o->>'reason','-') || ' ';
  EXECUTE 'RESET ROLE';
  UPDATE visit_presence_sessions SET entered_at = now() - interval '40 minutes' WHERE user_id='11275026-65be-4421-80a4-46c57195408b' AND item_id=ven.id AND status='open';
  PERFORM set_config('request.jwt.claims', '{"sub":"11275026-65be-4421-80a4-46c57195408b","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  o := visit_presence_exit(ven.id, ven.maps_lat, ven.maps_lng, 10, 0.3, NULL);
  r := r || 'guard=' || COALESCE(o->>'reason', o->>'outcome');
  RAISE EXCEPTION 'ROLLED BACK: %', r;
END $$;
