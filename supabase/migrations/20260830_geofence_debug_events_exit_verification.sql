-- Adds a new geofence_debug_events event_type for the exit-verification fix:
-- exit callbacks were found (via live field testing on 2026-08-29/30) to
-- fire spuriously while the user is still physically inside a venue —
-- almost certainly GPS noise indoors, or a state re-check triggered by
-- re-registering the full geofence list on every refresh. The tracker now
-- verifies a fresh location fix before treating an exit as a real
-- departure; when verification shows the user is still inside, that gets
-- logged as 'exit_ignored_still_inside' instead of silently discarding the
-- arrival record (which was the root cause of every candidate_visits row
-- being lost during today's pilot test, including a real ~2 hour bar visit).

BEGIN;

ALTER TABLE geofence_debug_events DROP CONSTRAINT IF EXISTS geofence_debug_events_event_type_check;
ALTER TABLE geofence_debug_events ADD CONSTRAINT geofence_debug_events_event_type_check
  CHECK (event_type IN (
    'enter', 'exit', 'exit_ignored_still_inside', 'discarded_below_candidate_dwell',
    'discarded_manual_only_or_no_profile', 'discarded_no_arrival_record',
    'candidate_created', 'task_error'
  ));

COMMIT;
