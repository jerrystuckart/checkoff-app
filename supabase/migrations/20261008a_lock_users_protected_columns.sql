-- Close the self-admin hole: clients may only write an explicit allowlist of users columns.
-- (2026-10-08) REVIEW BEFORE APPLYING.
--
-- BEFORE: `authenticated` held table-level INSERT/UPDATE/DELETE/TRUNCATE on public.users, and the
-- owner policies only check id = auth.uid(). Any signed-in user could therefore run
--   UPDATE users SET is_admin = true WHERE id = <self>
-- (proved with a rolled-back production test), or delete their own row and re-INSERT it with
-- is_admin = true. Every admin RLS policy in the database keys on users.is_admin.
--
-- AFTER: no client INSERT/DELETE on users at all (rows are created by the handle_new_user trigger and
-- removed by the delete_my_account function, both SECURITY DEFINER owned by postgres, unaffected).
-- UPDATE is allowed ONLY on the columns the app genuinely writes / user-owned profile fields:
--   display_name, avatar_url, city_id, neighborhood_id, pref_show_alcohol, notif_check_ins,
--   notif_invites, notif_nudges, share_channels, app_version, build_number, platform,
--   last_app_open_at, last_version_check_at, lifetime_points, referred_by
-- KNOWN RESIDUAL (kept for app compatibility, flagged for follow-up): lifetime_points and
-- referred_by are written by the shipped client (lib/points.js, lib/referral.js), so they stay
-- client-writable until points move server-side.
-- PROTECTED (server/service-role only): id, email, is_admin, is_pro, is_deleted, created_at, updated_at,
--   founding_number, insider_tier, current_streak, longest_streak, last_checkin_week,
--   visit_detection_tester, email_opt_out, email_opt_out_at, email_bounced, email_bounced_at.
-- Column-level SELECT grants are deliberately NOT touched (only write privileges are revoked).
-- service_role / postgres (Admin tool, edge functions, agent) keep full access.
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users FROM PUBLIC, anon, authenticated;

GRANT UPDATE (
  display_name, avatar_url, city_id, neighborhood_id,
  pref_show_alcohol, notif_check_ins, notif_invites, notif_nudges, share_channels,
  app_version, build_number, platform, last_app_open_at, last_version_check_at,
  lifetime_points, referred_by
) ON public.users TO authenticated;

COMMIT;
