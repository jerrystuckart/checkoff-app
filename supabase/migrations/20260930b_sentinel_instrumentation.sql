-- Coverage-sentinel refresh: diagnostics + flag (2026-09-30). Additive only; nothing here changes existing behavior.
--  * geofence_registration_log gains refresh_cause + coverage (jsonb) so a real walk can be reconstructed, and a
--    'kept_previous_set' state for attempts that deliberately left the registered set alone (offline, gated, no fix...).
--  * geofence_debug_events accepts the three sentinel event types.
--  * feature flag candidate_visit_sentinel_refresh exists, OFF globally. It is also tester-gated in the client
--    (lib/featureFlags.js TESTER_GATED_FLAGS), so a per-user override only takes effect for visit_detection_tester users.
-- Reversible: drop the columns/flag row; restore the two CHECK constraints from 20260925_geofence_registration_state.sql and 20260930_visit_presence_hardening.sql.
BEGIN;

ALTER TABLE geofence_registration_log ADD COLUMN IF NOT EXISTS refresh_cause text;
ALTER TABLE geofence_registration_log ADD COLUMN IF NOT EXISTS coverage jsonb;
COMMENT ON COLUMN geofence_registration_log.refresh_cause IS 'Why this refresh ran: app_start | foreground | opt_in_change | manual | sentinel_exit | sentinel_retry | sentinel_born_outside. NULL = classic path.';
COMMENT ON COLUMN geofence_registration_log.coverage IS 'Sentinel path only: venues, eligibleNearby, farthestVenueM, nextUnmonitoredM, sentinelRadiusM, tight, openPreserved, cacheStatus/Source/AgeMs, profileSource, fixAccuracyM, durationMs, or a reason when the set was kept.';

ALTER TABLE geofence_registration_log DROP CONSTRAINT IF EXISTS geofence_registration_log_registration_state_check;
ALTER TABLE geofence_registration_log ADD CONSTRAINT geofence_registration_log_registration_state_check
  CHECK (registration_state = ANY (ARRAY['ok_monitored','ok_none_eligible','query_error','os_registration_error','kept_previous_set']));

ALTER TABLE geofence_debug_events DROP CONSTRAINT IF EXISTS geofence_debug_events_event_type_check;
ALTER TABLE geofence_debug_events ADD CONSTRAINT geofence_debug_events_event_type_check
  CHECK (event_type = ANY (ARRAY['enter','exit','exit_ignored_still_inside','discarded_below_candidate_dwell','discarded_manual_only_or_no_profile',
    'discarded_no_arrival_record','candidate_created','task_error','discarded_implausible_dwell','discarded_below_ignore_band','candidate_insert_failed',
    'presence_enter_result','presence_exit_result','presence_rpc_failed','sentinel_exit','sentinel_ignored','sentinel_born_outside']));

INSERT INTO feature_flags (key, description, enabled_globally)
VALUES ('candidate_visit_sentinel_refresh', 'Background coverage refresh: one large sentinel geofence re-chooses the nearest venues when the user leaves it. Tester-only.', false)
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF (SELECT enabled_globally FROM feature_flags WHERE key = 'candidate_visit_sentinel_refresh') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'sentinel flag must be off globally';
  END IF;
END $$;
COMMIT;
