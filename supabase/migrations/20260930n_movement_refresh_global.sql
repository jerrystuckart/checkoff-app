-- Movement (significant-location-change) coverage refresh is no longer tester-only.
-- Effective only on binaries that contain the native CheckoffMovement module (1.1.10+); older binaries have no module, the JS
-- wrapper reports 'not_installed' and their existing sentinel / region-monitoring behaviour is unchanged. Users still need the
-- visit-recovery opt-in and Always location permission; turning this flag off stops the service at the next wake-up or app open.
UPDATE feature_flags SET enabled_globally = true, description = 'Native significant-location-change wake-ups re-choose the nearest monitored venues (coverage refresh only; never dwell, visits, check-offs or points). Requires the 1.1.10+ binary, opt-in and Always location.' WHERE key = 'candidate_visit_movement_refresh';
DELETE FROM feature_flag_overrides WHERE flag_key = 'candidate_visit_movement_refresh';
