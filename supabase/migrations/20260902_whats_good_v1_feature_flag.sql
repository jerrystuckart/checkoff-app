-- What's Good V1 — feature flag. Reuses the existing feature_flags /
-- feature_flag_overrides mechanism (supabase/migrations/20260828_visit_detection_phase1.sql)
-- rather than inventing a new flag system. Additive INSERT only, no schema
-- change. Disabled globally — Jerry can enable himself via a
-- feature_flag_overrides row (existing mechanism) without a global
-- rollout. Run manually via:
--   supabase db query -f supabase/migrations/20260902_whats_good_v1_feature_flag.sql --linked

BEGIN;

INSERT INTO feature_flags (key, description, enabled_globally) VALUES
  ('whats_good_v1', 'What''s Good V1 HomeScreen module + What''s the Thing? foreground state. Overnight-implementation build, disabled globally pending tester review.', false)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  flag_enabled boolean;
BEGIN
  SELECT enabled_globally INTO flag_enabled FROM feature_flags WHERE key = 'whats_good_v1';
  IF flag_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SELFTEST FAILED: whats_good_v1 must be enabled_globally = false';
  END IF;
END $$;

COMMIT;
