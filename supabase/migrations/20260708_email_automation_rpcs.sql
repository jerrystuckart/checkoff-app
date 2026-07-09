-- ============================================================
-- Email automation RPC functions
-- 2026-07-08
--
-- Three audience queries for Resend email automation.
-- All functions use SECURITY DEFINER to bypass RLS on
-- check_ins (which is restricted to the owning user).
-- Internal @getcheckoff.com accounts are excluded from
-- all three audiences.
--
-- Call from edge functions:
--   supabase.rpc('get_monthly_recap_users')
--   supabase.rpc('get_inactive_users')
--   supabase.rpc('get_never_checkin_users')
-- ============================================================


-- ── 1. get_monthly_recap_users ────────────────────────────────────────────────
-- Active users: ≥1 check-in in the past 30 days.
-- Returns engagement data + 3 recommended unchecked items per user.

DROP FUNCTION IF EXISTS get_monthly_recap_users();

CREATE OR REPLACE FUNCTION get_monthly_recap_users()
RETURNS TABLE (
  user_id               uuid,
  email                 text,
  display_name          text,
  checkins_this_month   int,
  total_lifetime_points int,
  most_active_hood      text,
  current_streak_weeks  int,
  metro_name            text,
  season_list_id        uuid,
  season_total_items    int,
  season_checked_count  int,
  season_days_remaining int,
  recommended_items     jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  recent_ci AS (
    SELECT
      ci.user_id,
      ci.checked_at,
      i.id              AS item_id,
      i.neighborhood_id,
      n.name            AS neighborhood_name,
      n.metro_id
    FROM check_ins ci
    JOIN list_items li  ON li.id = ci.list_item_id
    JOIN items      i   ON i.id  = li.item_id
    LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
    WHERE ci.checked_at >= NOW() - INTERVAL '30 days'
  ),
  user_summary AS (
    SELECT user_id, COUNT(*) AS checkins_this_month
    FROM recent_ci
    GROUP BY user_id
  ),
  metro_counts AS (
    SELECT user_id, metro_id, COUNT(*) AS cnt
    FROM recent_ci
    WHERE metro_id IS NOT NULL
    GROUP BY user_id, metro_id
  ),
  top_metro AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id
    FROM metro_counts
    ORDER BY user_id, cnt DESC
  ),
  hood_counts AS (
    SELECT user_id, neighborhood_name, COUNT(*) AS cnt
    FROM recent_ci
    WHERE neighborhood_name IS NOT NULL
    GROUP BY user_id, neighborhood_name
  ),
  top_hood AS (
    SELECT DISTINCT ON (user_id) user_id, neighborhood_name
    FROM hood_counts
    ORDER BY user_id, cnt DESC
  ),
  seasonal AS (
    SELECT
      l.id    AS season_list_id,
      l.metro_id,
      l.ends_at,
      (l.ends_at::date - CURRENT_DATE) AS days_remaining
    FROM lists l
    WHERE l.is_official = true
      AND l.is_public   = true
      AND (l.starts_at IS NULL OR l.starts_at <= CURRENT_DATE)
      AND (l.ends_at   IS NULL OR l.ends_at   >= CURRENT_DATE)
  ),
  season_totals AS (
    SELECT list_id, COUNT(*) AS total_items
    FROM list_items
    GROUP BY list_id
  ),
  season_user_counts AS (
    SELECT ci.user_id, li.list_id, COUNT(DISTINCT li.item_id) AS checked_count
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    GROUP BY ci.user_id, li.list_id
  ),
  user_checked_items AS (
    SELECT DISTINCT ci.user_id, li.item_id
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
  )
  SELECT
    u.id::uuid                                          AS user_id,
    u.email::text                                       AS email,
    u.display_name::text                                AS display_name,
    us.checkins_this_month::int                         AS checkins_this_month,
    u.lifetime_points::int                              AS total_lifetime_points,
    th.neighborhood_name::text                          AS most_active_hood,
    u.current_streak::int                               AS current_streak_weeks,
    ma.name::text                                       AS metro_name,
    s.season_list_id::uuid                              AS season_list_id,
    COALESCE(st.total_items,    0)::int                 AS season_total_items,
    COALESCE(suc.checked_count, 0)::int                 AS season_checked_count,
    GREATEST(COALESCE(s.days_remaining, 0), 0)::int     AS season_days_remaining,
    -- 3 most popular unchecked items in the user's metro
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         rec.id,
          'body',       rec.body,
          'difficulty', rec.difficulty,
          'popularity', rec.popularity,
          'url',        rec.url
        ) ORDER BY rec.popularity DESC
      )
      FROM (
        SELECT
          i2.id, i2.body, i2.difficulty,
          'checkoff://item?id=' || i2.id::text AS url,
          COUNT(ci2.id) AS popularity
        FROM items i2
        JOIN neighborhoods n2    ON n2.id = i2.neighborhood_id
        LEFT JOIN list_items li2 ON li2.item_id = i2.id
        LEFT JOIN check_ins  ci2 ON ci2.list_item_id = li2.id
        WHERE n2.metro_id     = tm.metro_id
          AND i2.is_active    = true
          AND i2.is_approved  = true
          AND i2.is_universal = false
          AND NOT EXISTS (
            SELECT 1 FROM user_checked_items uci
            WHERE uci.user_id = u.id AND uci.item_id = i2.id
          )
        GROUP BY i2.id, i2.body, i2.difficulty
        ORDER BY COUNT(ci2.id) DESC
        LIMIT 3
      ) rec
    )::jsonb                                            AS recommended_items
  FROM user_summary us
  JOIN users        u   ON u.id      = us.user_id
  JOIN top_metro    tm  ON tm.user_id = u.id
  JOIN metro_areas  ma  ON ma.id     = tm.metro_id
  LEFT JOIN top_hood          th  ON th.user_id  = u.id
  LEFT JOIN seasonal           s   ON s.metro_id  = tm.metro_id
  LEFT JOIN season_totals      st  ON st.list_id  = s.season_list_id
  LEFT JOIN season_user_counts suc ON suc.user_id = u.id
                                  AND suc.list_id  = s.season_list_id
  WHERE u.is_deleted IS NOT TRUE
    AND u.email      IS NOT NULL
    AND u.email      NOT LIKE '%getcheckoff.com%'
  ORDER BY us.checkins_this_month DESC;
$$;


-- ── 2. get_inactive_users ─────────────────────────────────────────────────────
-- Lapsed users: ≥1 lifetime check-in, zero in the past 30 days.
-- Returns last activity data + count/preview of new items since they lapsed.

DROP FUNCTION IF EXISTS get_inactive_users();

CREATE OR REPLACE FUNCTION get_inactive_users()
RETURNS TABLE (
  user_id                       uuid,
  email                         text,
  display_name                  text,
  last_checkin_date             date,
  days_since_last_checkin       int,
  metro_name                    text,
  new_items_since_last_checkin  int,
  new_item_previews             jsonb,
  season_list_id                uuid,
  season_days_remaining         int,
  season_checked_count          int,
  season_total_items            int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  all_ci AS (
    SELECT
      ci.user_id,
      MAX(ci.checked_at) AS last_checkin_at,
      n.metro_id
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    JOIN items      i  ON i.id  = li.item_id
    LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
    WHERE n.metro_id IS NOT NULL
    GROUP BY ci.user_id, n.metro_id
  ),
  user_last_metro AS (
    SELECT DISTINCT ON (user_id)
      user_id,
      metro_id,
      last_checkin_at
    FROM all_ci
    ORDER BY user_id, last_checkin_at DESC
  ),
  recent_active AS (
    SELECT DISTINCT user_id
    FROM check_ins
    WHERE checked_at >= NOW() - INTERVAL '30 days'
  ),
  seasonal AS (
    SELECT
      l.id    AS season_list_id,
      l.metro_id,
      l.ends_at,
      (l.ends_at::date - CURRENT_DATE) AS days_remaining
    FROM lists l
    WHERE l.is_official = true
      AND l.is_public   = true
      AND (l.starts_at IS NULL OR l.starts_at <= CURRENT_DATE)
      AND (l.ends_at   IS NULL OR l.ends_at   >= CURRENT_DATE)
  ),
  season_totals AS (
    SELECT list_id, COUNT(*) AS total_items
    FROM list_items
    GROUP BY list_id
  ),
  season_user_counts AS (
    SELECT ci.user_id, li.list_id, COUNT(DISTINCT li.item_id) AS checked_count
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    GROUP BY ci.user_id, li.list_id
  )
  SELECT
    u.id::uuid                                          AS user_id,
    u.email::text                                       AS email,
    u.display_name::text                                AS display_name,
    ulm.last_checkin_at::date                           AS last_checkin_date,
    (CURRENT_DATE - ulm.last_checkin_at::date)::int     AS days_since_last_checkin,
    ma.name::text                                       AS metro_name,
    -- Count of new items in their metro since they went inactive
    (
      SELECT COUNT(*)::int
      FROM items i2
      JOIN neighborhoods n2 ON n2.id = i2.neighborhood_id
      WHERE n2.metro_id    = ulm.metro_id
        AND i2.created_at  > ulm.last_checkin_at
        AND i2.is_active   = true
        AND i2.is_approved = true
    )                                                   AS new_items_since_last_checkin,
    -- 3 sample new item bodies for the email
    (
      SELECT jsonb_agg(jsonb_build_object('body', i2.body) ORDER BY i2.created_at DESC)
      FROM (
        SELECT i2.body, i2.created_at
        FROM items i2
        JOIN neighborhoods n2 ON n2.id = i2.neighborhood_id
        WHERE n2.metro_id    = ulm.metro_id
          AND i2.created_at  > ulm.last_checkin_at
          AND i2.is_active   = true
          AND i2.is_approved = true
        ORDER BY i2.created_at DESC
        LIMIT 3
      ) i2
    )::jsonb                                            AS new_item_previews,
    s.season_list_id::uuid                              AS season_list_id,
    GREATEST(COALESCE(s.days_remaining, 0), 0)::int     AS season_days_remaining,
    COALESCE(suc.checked_count, 0)::int                 AS season_checked_count,
    COALESCE(st.total_items,    0)::int                 AS season_total_items
  FROM user_last_metro ulm
  JOIN users       u   ON u.id  = ulm.user_id
  JOIN metro_areas ma  ON ma.id = ulm.metro_id
  LEFT JOIN recent_active      ra  ON ra.user_id  = ulm.user_id
  LEFT JOIN seasonal            s   ON s.metro_id  = ulm.metro_id
  LEFT JOIN season_totals       st  ON st.list_id  = s.season_list_id
  LEFT JOIN season_user_counts  suc ON suc.user_id = ulm.user_id
                                   AND suc.list_id  = s.season_list_id
  WHERE ra.user_id  IS NULL
    AND u.is_deleted IS NOT TRUE
    AND u.email      IS NOT NULL
    AND u.email      NOT LIKE '%getcheckoff.com%'
  ORDER BY ulm.last_checkin_at DESC;
$$;


-- ── 3. get_never_checkin_users ────────────────────────────────────────────────
-- Zero-activity users: no check-ins ever, account older than 14 days.
-- Suggests 3 high-difficulty Phoenix items as a prompt to get started.

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
  phoenix_id AS (
    SELECT '43e9fba2-4a26-4941-817f-db860265ea51'::uuid AS id
  ),
  -- 3 most-checked high-value items from Phoenix (difficulty 10 or 25)
  suggestions AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',         i.id,
        'body',       i.body,
        'difficulty', i.difficulty,
        'popularity', pop.cnt
      ) ORDER BY pop.cnt DESC
    ) AS suggested_items
    FROM (
      SELECT li.item_id, COUNT(*) AS cnt
      FROM check_ins ci
      JOIN list_items li ON li.id = ci.list_item_id
      GROUP BY li.item_id
      ORDER BY COUNT(*) DESC
    ) pop
    JOIN items i ON i.id = pop.item_id
    JOIN neighborhoods n ON n.id = i.neighborhood_id
    WHERE n.metro_id   = (SELECT id FROM phoenix_id)
      AND i.difficulty IN (10, 25)
      AND i.is_active   = true
      AND i.is_approved = true
    LIMIT 3
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


-- ── Grant execute to service_role only ────────────────────────────────────────
-- anon and authenticated roles intentionally excluded — these functions
-- return all users' emails and must only be called from edge functions
-- that authenticate with the service role key.

REVOKE ALL ON FUNCTION get_monthly_recap_users()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_inactive_users()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_never_checkin_users()   FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION get_monthly_recap_users()  TO service_role;
GRANT EXECUTE ON FUNCTION get_inactive_users()        TO service_role;
GRANT EXECUTE ON FUNCTION get_never_checkin_users()   TO service_role;
