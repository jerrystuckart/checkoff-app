-- Read-only pre-flight for the all-user iOS rollout of seven-day visit recovery.
-- Run:  supabase db query -f docs/visit-recovery/rollout_preflight.sql --linked
-- Every row in the first result must have ok = true before flipping the switch.
SELECT check_name, ok, detail FROM (
  SELECT 1 AS n, 'master switch is still OFF (flip is the LAST step)' AS check_name,
         COALESCE((SELECT enabled_globally FROM feature_flags WHERE key = 'candidate_visit_detection'), false) = false AS ok,
         'candidate_visit_detection.enabled_globally' AS detail
  UNION ALL SELECT 2, 'clients cannot write candidate_visits',
         NOT has_table_privilege('authenticated','public.candidate_visits','INSERT')
         AND NOT has_table_privilege('authenticated','public.candidate_visits','UPDATE')
         AND NOT has_table_privilege('authenticated','public.candidate_visits','DELETE')
         AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.candidate_visits'::regclass AND polcmd IN ('a','w','d')),
         'no INSERT/UPDATE/DELETE privilege or policy for authenticated'
  UNION ALL SELECT 3, 'presence sessions are server-written only',
         NOT has_table_privilege('authenticated','public.visit_presence_sessions','INSERT')
         AND NOT has_table_privilege('authenticated','public.visit_presence_sessions','UPDATE'),
         'authenticated has SELECT only'
  UNION ALL SELECT 4, 'server functions present and scorer not client-callable',
         (SELECT count(*) FROM pg_proc WHERE proname IN ('visit_presence_enter','visit_presence_exit','dismiss_candidate_visit','turn_off_visit_recovery','cleanup_visit_recovery_data','visit_evaluate')) = 6
         AND NOT has_function_privilege('authenticated','public.visit_evaluate(uuid,numeric,double precision,double precision,integer)','EXECUTE'),
         '6 functions; visit_evaluate revoked from clients'
  UNION ALL SELECT 5, 'retention job scheduled',
         EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-visit-recovery-data' AND active),
         'daily 03:20 UTC'
  UNION ALL SELECT 6, 'profile coverage applied with no guard violations',
         (SELECT count(*) FROM items WHERE visit_profile_source = 'rule_v1') > 800
         AND (SELECT count(*) FROM items WHERE visit_profile_source = 'rule_v1' AND (NOT is_active OR is_universal OR coalesce(is_secret,false) OR maps_lat IS NULL OR visit_profile_key = 'manual_only')) = 0,
         (SELECT count(*)::text FROM items WHERE visit_profile_source = 'rule_v1') || ' rule_v1 rows'
  UNION ALL SELECT 7, 'pushes remain tester-only (trigger gate present)',
         (SELECT prosrc FROM pg_proc WHERE proname = 'notify_high_confidence_candidate_visit') ILIKE '%visit_detection_tester%',
         'notify_high_confidence_candidate_visit checks users.visit_detection_tester'
  UNION ALL SELECT 8, 'nobody but testers can be pushed even if flags flip (silent mode + realtime flag)',
         COALESCE((SELECT enabled_globally FROM feature_flags WHERE key='realtime_nearby_checkoff_notifications'), false) = false
         AND COALESCE((SELECT enabled_globally FROM feature_flags WHERE key='candidate_visit_silent_mode'), true) = true,
         'realtime_nearby_checkoff_notifications=false, candidate_visit_silent_mode=true'
) c ORDER BY n;

-- EVIDENCE of a passed field test (not pass/fail; read these before flipping):
--   1. a presence session opened + closed on the tester's phone,
--   2. a server-built candidate (metadata.source = 'presence_session'),
--   3. a confirmation away from the venue (verification_method = 'historical_visit_confirmed').
-- SELECT s.entered_at, s.closed_at, s.outcome, i.body FROM visit_presence_sessions s JOIN items i ON i.id = s.item_id
--   WHERE s.user_id = (SELECT id FROM users WHERE visit_detection_tester LIMIT 1) ORDER BY s.entered_at DESC LIMIT 10;
-- SELECT created_at, status, dwell_minutes, confidence_score, metadata FROM candidate_visits
--   WHERE user_id = (SELECT id FROM users WHERE visit_detection_tester LIMIT 1) ORDER BY created_at DESC LIMIT 10;
-- SELECT checked_at, points_awarded, verification_method FROM check_ins
--   WHERE verification_method = 'historical_visit_confirmed' ORDER BY checked_at DESC LIMIT 10;
