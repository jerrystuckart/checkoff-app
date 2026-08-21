BEGIN;

-- ============================================================
-- Platform-wide fix: get_never_checkin_users() hardcoded Phoenix UUID
-- 2026-08-21 — NOT APPLIED. Generated for review only.
--
-- Root cause (docs/metro-launch-audit/02_app_metro_dependencies.md,
-- README finding #2): the function hardcodes Phoenix's metro_areas.id
-- and always suggests 3 high-difficulty Phoenix items to every
-- zero-activity user, regardless of their real metro.
--
-- COULD NOT BE FULLY RESOLVED AS ORIGINALLY REQUESTED — read before
-- applying. The instruction was "derive each user's own metro, however
-- the rest of the app determines a user's current metro." Checked for a
-- consistent existing pattern before proposing anything new:
--   - get_monthly_recap_users()/get_inactive_users() derive top_metro
--     from the user's OWN CHECK-IN HISTORY (metro_counts CTE over
--     check_ins). This doesn't apply here — a "never checked in" user
--     has zero check_ins by definition, so there is no history to
--     derive from.
--   - users.neighborhood_id and users.city_id both exist on the users
--     table and would be the obvious signal, but a live query confirms
--     BOTH are 0% populated across all 112 current users (COUNT(neighborhood_id)=0,
--     COUNT(city_id)=0). Nothing writes to these columns anywhere in the
--     app (grepped screens/, lib/, components/ for `.update(...)`/
--     `.upsert(...)` against the users table — found preference/points/
--     streak writes only, never neighborhood_id or city_id).
--   - Client-side, the user's resolved metro (HomeScreen's selectedMetro)
--     exists only as in-memory component state — never persisted to
--     AsyncStorage or the users row anywhere in the codebase (grepped,
--     confirmed absent).
-- Conclusion: there is currently NO stored, reliable per-user metro
-- signal available to a server-side/edge-function context for a user
-- who has never checked in. True per-user derivation is not possible
-- without new product work (e.g. capturing a "home metro" at signup/
-- onboarding and writing it to users.neighborhood_id or a new column —
-- flagged as a genuine follow-up, not attempted here since it's schema
-- + onboarding-flow work beyond this fix's scope).
--
-- BEST-AVAILABLE COMPROMISE IMPLEMENTED INSTEAD (judgment call, flagged
-- for review): replace the single hardcoded Phoenix metro with a
-- metro-blind selection that is no longer wrong-by-default for every
-- non-Phoenix user:
--   1. Prefer is_universal=true items (available in every metro,
--      genuinely relevant regardless of the recipient's real metro) —
--      confirmed live: 6 such items exist at difficulty 10/25 today.
--   2. If fewer than 3 universal high-difficulty items exist, backfill
--      the remainder with the most globally-popular high-difficulty
--      items across ALL active metros combined (not filtered to one),
--      ranked by total check-in count exactly as before.
-- This does not target each user's real metro, but it stops
-- systematically sending every Denver (and Milwaukee/Tucson) user
-- Phoenix-specific suggestions, and prioritizes items that are correct
-- for 100% of recipients over items that are only correct for Phoenix
-- users. Reviewer: if capturing a real per-user home-metro signal at
-- signup is wanted instead, that's a larger, separate change — this
-- fix does not block or preclude it; resolve_metro_timezone-style
-- per-user derivation can replace this function body later without
-- touching its signature.
-- ============================================================

DROP FUNCTION IF EXISTS get_never_checkin_users();

CREATE OR REPLACE FUNCTION get_never_checkin_users()
RETURNS TABLE (
  user_id           uuid,
  email             text,
  display_name      text,
  days_since_signup int,
  suggested_items   jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  popularity AS (
    SELECT li.item_id, COUNT(*) AS cnt
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    GROUP BY li.item_id
  ),
  -- Tier 1: universal items (correct for every metro) first, ranked by popularity.
  universal_candidates AS (
    SELECT i.id, i.body, i.difficulty, COALESCE(pop.cnt, 0) AS popularity
    FROM items i
    LEFT JOIN popularity pop ON pop.item_id = i.id
    WHERE i.is_universal   = true
      AND i.difficulty     IN (10, 25)
      AND i.is_active      = true
      AND i.is_approved    = true
    ORDER BY COALESCE(pop.cnt, 0) DESC
    LIMIT 3
  ),
  -- Tier 2: backfill from the globally most-popular high-difficulty items
  -- (any metro) if Tier 1 didn't produce 3 — excludes anything already chosen.
  global_candidates AS (
    SELECT i.id, i.body, i.difficulty, pop.cnt AS popularity
    FROM popularity pop
    JOIN items i ON i.id = pop.item_id
    WHERE i.difficulty  IN (10, 25)
      AND i.is_active   = true
      AND i.is_approved = true
      AND i.id NOT IN (SELECT id FROM universal_candidates)
    ORDER BY pop.cnt DESC
    LIMIT 3
  ),
  suggestions AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',         c.id,
        'body',       c.body,
        'difficulty', c.difficulty,
        'popularity', c.popularity
      ) ORDER BY c.popularity DESC
    ) AS suggested_items
    FROM (
      SELECT 0 AS tier, * FROM universal_candidates
      UNION ALL
      SELECT 1 AS tier, * FROM global_candidates
      ORDER BY tier, popularity DESC
      LIMIT 3
    ) c
  )
  SELECT
    u.id::uuid                                      AS user_id,
    u.email::text                                   AS email,
    u.display_name::text                            AS display_name,
    (CURRENT_DATE - u.created_at::date)::int        AS days_since_signup,
    s.suggested_items::jsonb                        AS suggested_items
  FROM users u
  LEFT JOIN check_ins ci ON ci.user_id = u.id
  CROSS JOIN suggestions s
  WHERE u.is_deleted IS NOT TRUE
    AND u.email      IS NOT NULL
    AND u.email      NOT LIKE '%getcheckoff.com%'
    AND u.created_at <= NOW() - INTERVAL '14 days'
    AND ci.user_id   IS NULL
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION get_never_checkin_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_never_checkin_users() TO service_role;

-- ============================================================
-- FOLLOW-UP NOT DONE HERE (flagged, not attempted): capturing a real
-- per-user "home metro" at signup/onboarding (e.g. writing
-- users.neighborhood_id from the metro resolved during onboarding) would
-- let this function derive genuine per-user metro suggestions instead of
-- the metro-blind compromise above. That's an onboarding-flow + schema
-- change, out of scope for this platform-fix pass.
-- ============================================================

COMMIT;
