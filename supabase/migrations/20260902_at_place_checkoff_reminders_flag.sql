-- Visit Reminder V1.5: separate, independently rollout-able flag for
-- scheduled at-place "Still Here" local reminders — deliberately NOT the
-- same flag as realtime_nearby_checkoff_notifications (V1's exit-recovery
-- push), since these are different behaviors that may need independent
-- testing/rollout. Review-ready, NOT applied automatically — same
-- convention as 20260828_visit_detection_phase1.sql:
--   supabase db query -f supabase/migrations/20260902_at_place_checkoff_reminders_flag.sql --linked

BEGIN;

INSERT INTO feature_flags (key, description, enabled_globally) VALUES
  ('at_place_checkoff_reminders', 'V1.5 "Still Here" scheduled local reminder when the app is opened at-place and the item is not checked off within its profile''s candidate_dwell_minutes. Separate from realtime_nearby_checkoff_notifications on purpose.', false)
ON CONFLICT (key) DO NOTHING;

COMMIT;
