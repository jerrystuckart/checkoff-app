-- Fix: users.visit_detection_tester (added by 20260828_visit_detection_phase1.sql)
-- was missing from the column-level SELECT allowlist established by
-- 20260712_crew_picker_and_users_email_lockdown.sql, which REVOKEd
-- table-wide SELECT on public.users and re-GRANTs it column-by-column
-- since RLS can't restrict by column. Any client query listing this column
-- alongside others (e.g. ProfileScreen.jsx's users select) was rejected in
-- full by Postgres, silently returning { data: null, error } — supabase-js
-- doesn't throw on this, so the profile screen fell back to defaults across
-- the board (0 points, no streak, no founder number) with no visible error.
--
-- Already applied directly against the linked project on 2026-08-29 in
-- response to a live bug report from TestFlight build 1.1.6; this file
-- exists so the fix is captured in migration history, not to be re-run
-- destructively (GRANT is idempotent — safe either way).

BEGIN;

GRANT SELECT (visit_detection_tester) ON public.users TO authenticated, anon;

COMMIT;
