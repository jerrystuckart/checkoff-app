-- Native movement (significant-location-change) coverage refresh: diagnostics + independent flag (2026-09-30). Additive only.
--  * geofence_debug_events accepts 'movement_update' (a movement hint led to a refresh request) and 'movement_ignored' (with the reason).
--  * feature flag candidate_visit_movement_refresh exists, OFF globally (independent of candidate_visit_sentinel_refresh). A per-user ON
--    override is set for the single tester so the next TestFlight build exercises it; it has no effect on any binary without the
--    native module (JS cannot start the OS service on a binary that does not contain it).
-- Reversible: delete the flag row/override and restore the event-type CHECK from 20260930b_sentinel_instrumentation.sql.
BEGIN;
ALTER TABLE geofence_debug_events DROP CONSTRAINT IF EXISTS geofence_debug_events_event_type_check;
ALTER TABLE geofence_debug_events ADD CONSTRAINT geofence_debug_events_event_type_check
  CHECK (event_type = ANY (ARRAY['enter','exit','exit_ignored_still_inside','discarded_below_candidate_dwell','discarded_manual_only_or_no_profile',
    'discarded_no_arrival_record','candidate_created','task_error','discarded_implausible_dwell','discarded_below_ignore_band','candidate_insert_failed',
    'presence_enter_result','presence_exit_result','presence_rpc_failed','sentinel_exit','sentinel_ignored','sentinel_born_outside',
    'movement_update','movement_ignored']));
INSERT INTO feature_flags (key, description, enabled_globally)
VALUES ('candidate_visit_movement_refresh', 'Native significant-location-change wake-ups refresh venue coverage while the app is backgrounded. Needs the native module (new binary). Coverage refresh only: never dwell, visits, check-offs or points.', false)
ON CONFLICT (key) DO NOTHING;
INSERT INTO feature_flag_overrides (flag_key, user_id, enabled)
SELECT 'candidate_visit_movement_refresh', '11275026-65be-4421-80a4-46c57195408b', true
WHERE NOT EXISTS (SELECT 1 FROM feature_flag_overrides WHERE flag_key = 'candidate_visit_movement_refresh' AND user_id = '11275026-65be-4421-80a4-46c57195408b');
DO $$ BEGIN
  IF (SELECT enabled_globally FROM feature_flags WHERE key = 'candidate_visit_movement_refresh') IS DISTINCT FROM false THEN RAISE EXCEPTION 'movement flag must be off globally'; END IF;
END $$;
COMMIT;
