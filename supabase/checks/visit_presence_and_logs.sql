-- Rolled-back check as the real user: new log columns/states, sentinel debug event types, server clock for an already-inside venue, reconcile without credit. Replace the user id with a visit_detection_tester.
-- Expected: ROLLED BACK: logs_ok badtype=rejected enter=opened startsWithinSeconds~0 redeliver=already_open sameStamp=true stillOpenAfterReconcileInside=1 candidatesCreatedByReconcile=0
DO $$
DECLARE r text := ''; chez uuid; cl float8; cn float8; e1 jsonb; e2 jsonb; t0 timestamptz; s1 timestamptz; s2 timestamptz; n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11275026-65be-4421-80a4-46c57195408b","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- (a) instrumentation inserts pass RLS + CHECKs
  INSERT INTO geofence_registration_log (user_id, selection_lat, selection_lng, monitored_items, excluded_items, geofencing_started, registration_state, refresh_cause, coverage, client_build)
    VALUES ('11275026-65be-4421-80a4-46c57195408b', 40.628, 14.488, '[]', '[]', false, 'kept_previous_set', 'sentinel_exit', '{"reason":"cache_outside_area_offline"}', 'test');
  INSERT INTO geofence_debug_events (user_id, item_id, event_type, detail) VALUES ('11275026-65be-4421-80a4-46c57195408b', NULL, 'sentinel_exit', '{}'), ('11275026-65be-4421-80a4-46c57195408b', NULL, 'sentinel_ignored', '{}'), ('11275026-65be-4421-80a4-46c57195408b', NULL, 'sentinel_born_outside', '{}');
  r := r || 'logs_ok ';
  BEGIN
    INSERT INTO geofence_debug_events (user_id, item_id, event_type, detail) VALUES ('11275026-65be-4421-80a4-46c57195408b', NULL, 'not_a_type', '{}');
    r := r || 'badtype=ACCEPTED(BUG) ';
  EXCEPTION WHEN check_violation THEN r := r || 'badtype=rejected ';
  END;
  -- (b) already inside a venue when it is (re-)registered: the server clock starts when the phone reports, never earlier
  SELECT id, maps_lat, maps_lng INTO chez, cl, cn FROM items WHERE body LIKE '%Chez Black%' LIMIT 1;
  t0 := clock_timestamp();
  e1 := visit_presence_enter(chez, cl, cn, 15);
  SELECT entered_at INTO s1 FROM visit_presence_sessions WHERE user_id='11275026-65be-4421-80a4-46c57195408b' AND item_id=chez AND status='open';
  r := r || 'enter=' || (e1->>'status') || ' startsWithinSeconds=' || round(extract(epoch from (s1 - t0))::numeric,1) || ' ';
  PERFORM pg_sleep(1.2);
  e2 := visit_presence_enter(chez, cl, cn, 15);   -- re-delivered enter after a region replacement
  SELECT entered_at INTO s2 FROM visit_presence_sessions WHERE user_id='11275026-65be-4421-80a4-46c57195408b' AND item_id=chez AND status='open';
  r := r || 'redeliver=' || (e2->>'status') || ' sameStamp=' || (s1 = s2)::text || ' ';
  -- (c) reconcile with a fix still inside the venue keeps the session open (administrative re-registration is not a departure)
  PERFORM visit_presence_reconcile(cl, cn, 15);
  SELECT count(*) INTO n FROM visit_presence_sessions WHERE user_id='11275026-65be-4421-80a4-46c57195408b' AND item_id=chez AND status='open';
  r := r || 'stillOpenAfterReconcileInside=' || n || ' ';
  -- ... and with a fix far away closes it WITHOUT credit (no candidate)
  PERFORM visit_presence_reconcile(cl + 0.02, cn, 15);
  SELECT count(*) INTO n FROM candidate_visits WHERE user_id='11275026-65be-4421-80a4-46c57195408b' AND item_id=chez AND created_at > t0;
  r := r || 'candidatesCreatedByReconcile=' || n;
  RAISE EXCEPTION 'ROLLED BACK: %', r;
END $$;
