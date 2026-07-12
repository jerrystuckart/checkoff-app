-- ============================================================
-- Lock down users.email + fix +Crew picker scoping
-- 2026-07-12
--
-- ISSUE 1 — "users: public read" (USING (true)) let ANY authenticated
-- (or anon) request read every column of every user row, including
-- email, regardless of what the app's own queries happened to filter
-- by. This is the same class of bug as city_partnerships and
-- featured_experiences fixed earlier today, but RLS can't restrict by
-- COLUMN (only by row), so the real fix is column-level privileges:
-- revoke the whole-table SELECT grant and re-grant every column
-- except email. Row-level policies (own profile, public read) are
-- untouched and still govern which ROWS are visible; this only
-- changes which COLUMNS can ever come back.
--
-- Two legitimate consumers of email needed updating to not regress:
--   - ProfileScreen.jsx read the current user's own email from this
--     table; changed to read it from the Supabase Auth session
--     (supabase.auth.getUser()) instead, which already carries it.
--   - AdminScreen.jsx's "recent signups" admin metric read email
--     directly; replaced with admin_recent_signups(), a
--     SECURITY DEFINER RPC that checks is_admin server-side before
--     returning email data. (This screen's admin gate was previously
--     UI-only -- the component is always mounted for any signed-in
--     user, only the tab button was hidden for non-admins -- so this
--     RPC is the first real server-side enforcement for this feature,
--     not just a workaround for the column revoke.)
--
-- ISSUE 2 — the +Crew picker (SavedCrewScreen.jsx via
-- lib/useCrewInvite.js) sourced its member list from the saved_crew
-- table, which is populated by sync_saved_crew() on any shared list
-- membership -- including official/seasonal lists with hundreds of
-- members. Quantified against real data: one user's saved_crew had 41
-- entries, only 11 of which shared an actual non-official list with
-- them -- the other 30 were strangers who happened to join the same
-- seasonal list. Fixed at the application layer (lib/useCrewInvite.js)
-- to reuse the exact non-official-list-sharing pattern already
-- established today for dare recipient scoping, so "who you know"
-- means the same thing consistently across both features. No schema
-- change was needed for this half of the fix (saved_crew itself is
-- left in place but is no longer read by this feature; it may be
-- worth retiring separately).
-- ============================================================

REVOKE SELECT ON public.users FROM authenticated, anon;

GRANT SELECT (
  id, display_name, avatar_url, city_id, is_pro, created_at, updated_at,
  is_admin, neighborhood_id, share_channels, notif_check_ins, notif_invites,
  notif_nudges, current_streak, longest_streak, last_checkin_week,
  pref_show_alcohol, is_deleted, founding_number, referred_by,
  lifetime_points, insider_tier, app_version, build_number, platform,
  last_app_open_at, last_version_check_at
) ON public.users TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.admin_recent_signups()
RETURNS TABLE (id uuid, created_at timestamptz, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT u.id, u.created_at, u.email
  FROM users u
  ORDER BY u.created_at DESC
  LIMIT 8;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_recent_signups() TO authenticated;
