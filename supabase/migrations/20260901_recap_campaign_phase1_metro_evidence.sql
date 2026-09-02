-- ============================================================
-- Recap campaign — remove false Phoenix personalization
-- 2026-09-01 (follow-up to 20260901_recap_campaign_phase1.sql)
--
-- The first version of get_recap_campaign_audience() defaulted every
-- zero-lifetime-checkin user with no derivable metro to Phoenix
-- (metro_is_default_fallback=true), matching the already-shipped
-- get_never_checkin_users() behavior. On review this is exactly the kind
-- of fabricated personalization the campaign must not send: a technical
-- default is not the same as knowing where someone actually is.
--
-- This migration:
--   1. Adds two more evidence sources beyond check-in history — list
--      membership/creation (list_history) and interaction_events
--      (interaction_history) — plus a placeholder explicit_profile source
--      (users.neighborhood_id -> neighborhoods.metro_id; currently 0%
--      populated app-wide, wired up for when/if that changes).
--   2. Replaces the boolean metro_is_default_fallback output with a
--      metro_source text column: 'checkoff_history' | 'explicit_profile'
--      | 'list_history' | 'interaction_history' | 'unknown'. There is no
--      more silent default — metro_id is NULL and metro_source is
--      'unknown' when no real evidence exists, for every segment.
--   3. NEVER_CHECKED_OFF users stay eligible either way (segment
--      assignment was never metro-gated) — the difference is the caller
--      now sees metro_source='unknown' truthfully instead of a fake
--      Phoenix Metro row, and can render a general "CheckOff got bigger"
--      variant instead of Phoenix-specific content.
--   4. RETURNING_INACTIVE-eligible users previously EXCLUDED as
--      no_resolvable_metro now also get the benefit of list_history and
--      interaction_history — some of the 7 seen in the first dry run may
--      now resolve to a real metro instead of being excluded.
-- ============================================================

DROP FUNCTION IF EXISTS get_recap_campaign_audience(date, date);

CREATE OR REPLACE FUNCTION get_recap_campaign_audience(p_month_start date, p_month_end date)
RETURNS TABLE (
  user_id                     uuid,
  email                       text,
  display_name                text,
  platform                    text,
  segment                     text,
  exclusion_reason            text,
  metro_id                    uuid,
  metro_name                  text,
  metro_source                text,
  checkins_this_month         int,
  points_this_month           int,
  lifetime_points             int,
  completed_item_names        jsonb,
  most_active_hood            text,
  current_streak_weeks        int,
  last_checkin_at             timestamptz,
  last_checkin_item_name      text,
  days_since_last_checkin     int,
  new_items_since_last_checkin int,
  lifetime_checkins           int,
  season_list_id              uuid,
  season_name                 text,
  season_ends_at              date,
  season_total_items          int,
  season_checked_count        int,
  season_days_remaining       int,
  recommended_items           jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  month_ci AS (
    SELECT
      ci.user_id, ci.checked_at, ci.list_item_id,
      i.id AS item_id, i.body, i.difficulty,
      n.name AS neighborhood_name, n.metro_id
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    JOIN items      i  ON i.id  = li.item_id
    LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
    WHERE ci.checked_at >= p_month_start AND ci.checked_at < p_month_end
  ),
  month_summary AS (
    SELECT user_id, COUNT(*) AS checkins_this_month, SUM(COALESCE(difficulty, 0)) AS points_this_month
    FROM month_ci GROUP BY user_id
  ),
  month_items AS (
    SELECT user_id, jsonb_agg(jsonb_build_object('id', item_id, 'body', body) ORDER BY checked_at DESC) AS names
    FROM month_ci GROUP BY user_id
  ),
  month_metro_counts AS (
    SELECT user_id, metro_id, COUNT(*) AS cnt FROM month_ci WHERE metro_id IS NOT NULL GROUP BY user_id, metro_id
  ),
  month_top_metro AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id FROM month_metro_counts ORDER BY user_id, cnt DESC
  ),
  month_hood_counts AS (
    SELECT user_id, neighborhood_name, COUNT(*) AS cnt FROM month_ci
    WHERE neighborhood_name IS NOT NULL GROUP BY user_id, neighborhood_name
  ),
  month_top_hood AS (
    SELECT DISTINCT ON (user_id) user_id, neighborhood_name FROM month_hood_counts ORDER BY user_id, cnt DESC
  ),
  all_ci AS (
    SELECT ci.user_id, ci.checked_at, i.body, n.metro_id
    FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    JOIN items      i  ON i.id  = li.item_id
    LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
  ),
  lifetime_counts AS (
    SELECT user_id, COUNT(*) AS lifetime_checkins FROM all_ci GROUP BY user_id
  ),
  last_ci AS (
    SELECT DISTINCT ON (user_id) user_id, checked_at AS last_checkin_at, body AS last_checkin_item_name, metro_id
    FROM all_ci ORDER BY user_id, checked_at DESC
  ),
  -- fallback metro: most recent lifetime metro, used when the user has no
  -- check-ins this month (so month_top_metro is null). Still real
  -- check-in-derived evidence — tier 1, "checkoff_history".
  fallback_metro AS (
    SELECT user_id, metro_id FROM last_ci WHERE metro_id IS NOT NULL
  ),
  resolved_metro AS (
    SELECT u.id AS user_id, COALESCE(mtm.metro_id, fm.metro_id) AS metro_id
    FROM users u
    LEFT JOIN month_top_metro mtm ON mtm.user_id = u.id
    LEFT JOIN fallback_metro  fm  ON fm.user_id  = u.id
  ),
  -- Tier 2, "explicit_profile": a user-stated home location. Currently
  -- always empty (users.neighborhood_id is 0% populated app-wide, per the
  -- Sept 1 campaign audit) but wired up so this activates automatically
  -- the moment that data exists, without another migration.
  explicit_profile AS (
    SELECT u.id AS user_id, n.metro_id
    FROM users u
    JOIN neighborhoods n ON n.id = u.neighborhood_id
    WHERE n.metro_id IS NOT NULL
  ),
  -- Tier 3, "list_history": the user joined or created a real list tied to
  -- a metro. Real behavioral evidence even with zero check-ins.
  list_history_raw AS (
    SELECT lm.user_id, l.metro_id, lm.joined_at AS occurred_at
    FROM list_members lm JOIN lists l ON l.id = lm.list_id
    WHERE l.metro_id IS NOT NULL
    UNION ALL
    SELECT l.creator_id AS user_id, l.metro_id, l.created_at AS occurred_at
    FROM lists l
    WHERE l.creator_id IS NOT NULL AND l.metro_id IS NOT NULL
  ),
  list_history_ranked AS (
    SELECT user_id, metro_id, COUNT(*) AS cnt, MAX(occurred_at) AS last_at
    FROM list_history_raw GROUP BY user_id, metro_id
  ),
  list_history AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id
    FROM list_history_ranked ORDER BY user_id, cnt DESC, last_at DESC
  ),
  -- Tier 4, "interaction_history": lower-confidence browse/click signals
  -- (list_view, item_view, url_click, etc. — see trackEvent.js) resolved
  -- through the viewed item's neighborhood or the viewed list's metro.
  interaction_history_raw AS (
    SELECT ie.user_id, COALESCE(n.metro_id, l2.metro_id) AS metro_id, ie.occurred_at
    FROM interaction_events ie
    LEFT JOIN items i         ON i.id = ie.item_id
    LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
    LEFT JOIN lists l2        ON l2.id = ie.list_id
    WHERE COALESCE(n.metro_id, l2.metro_id) IS NOT NULL
  ),
  interaction_history_ranked AS (
    SELECT user_id, metro_id, COUNT(*) AS cnt, MAX(occurred_at) AS last_at
    FROM interaction_history_raw GROUP BY user_id, metro_id
  ),
  interaction_history AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id
    FROM interaction_history_ranked ORDER BY user_id, cnt DESC, last_at DESC
  ),
  -- Priority chain, strongest evidence first. No tier ever defaults to an
  -- arbitrary metro — metro_id is NULL and metro_source is 'unknown' when
  -- nothing real is found, full stop.
  effective_metro AS (
    SELECT
      u.id AS user_id,
      COALESCE(rm.metro_id, ep.metro_id, lh.metro_id, ih.metro_id) AS metro_id,
      CASE
        WHEN rm.metro_id IS NOT NULL THEN 'checkoff_history'
        WHEN ep.metro_id IS NOT NULL THEN 'explicit_profile'
        WHEN lh.metro_id IS NOT NULL THEN 'list_history'
        WHEN ih.metro_id IS NOT NULL THEN 'interaction_history'
        ELSE 'unknown'
      END AS metro_source
    FROM users u
    LEFT JOIN resolved_metro      rm ON rm.user_id = u.id
    LEFT JOIN explicit_profile    ep ON ep.user_id = u.id
    LEFT JOIN list_history        lh ON lh.user_id = u.id
    LEFT JOIN interaction_history ih ON ih.user_id = u.id
  ),
  -- The flagship seasonal list per metro. is_official=true is no longer a
  -- unique-per-metro flag as of Aug 2026 — themed sub-lists (e.g. "Hidden
  -- Bars", "Wisconsin Weird") are also marked is_official=true alongside the
  -- actual flagship season list, so an unfiltered join fans out to multiple
  -- rows per user. Flagship lists follow an established "Fall <year>" naming
  -- convention across every metro that has one; DISTINCT ON collapses any
  -- remaining ties deterministically.
  seasonal_candidates AS (
    SELECT
      l.id AS season_list_id, l.metro_id, l.title AS season_name, l.ends_at,
      (l.ends_at::date - CURRENT_DATE) AS days_remaining,
      (SELECT COUNT(*) FROM list_items WHERE list_id = l.id) AS item_count
    FROM lists l
    WHERE l.is_official = true
      AND l.is_public   = true
      AND l.title ~* 'Fall\s*20\d\d'
      AND (l.starts_at IS NULL OR l.starts_at <= CURRENT_DATE)
      AND (l.ends_at   IS NULL OR l.ends_at   >= CURRENT_DATE)
  ),
  seasonal AS (
    SELECT DISTINCT ON (metro_id) season_list_id, metro_id, season_name, ends_at, days_remaining
    FROM seasonal_candidates
    ORDER BY metro_id, item_count DESC
  ),
  season_totals AS (
    SELECT list_id, COUNT(*) AS total_items FROM list_items GROUP BY list_id
  ),
  season_user_counts AS (
    SELECT ci.user_id, li.list_id, COUNT(DISTINCT li.item_id) AS checked_count
    FROM check_ins ci JOIN list_items li ON li.id = ci.list_item_id
    GROUP BY ci.user_id, li.list_id
  ),
  user_checked_items AS (
    SELECT DISTINCT ci.user_id, li.item_id
    FROM check_ins ci JOIN list_items li ON li.id = ci.list_item_id
  ),
  new_items AS (
    SELECT lc.user_id,
      (SELECT COUNT(*)::int FROM items i2 JOIN neighborhoods n2 ON n2.id = i2.neighborhood_id
        WHERE n2.metro_id = lc.metro_id AND i2.created_at > lc.last_checkin_at
          AND i2.is_active = true AND i2.is_approved = true) AS new_items_since_last_checkin
    FROM last_ci lc
  )
  SELECT
    u.id::uuid                                          AS user_id,
    u.email::text                                       AS email,
    u.display_name::text                                AS display_name,
    u.platform::text                                    AS platform,
    CASE
      WHEN u.email IS NULL OR u.email LIKE '%getcheckoff.com%'
        THEN 'EXCLUDED'
      WHEN u.is_deleted IS TRUE
        THEN 'EXCLUDED'
      WHEN u.email_opt_out IS TRUE OR u.email_bounced IS TRUE
        THEN 'EXCLUDED'
      WHEN COALESCE(ms.checkins_this_month, 0) > 0
        THEN 'ACTIVE_AUGUST'
      WHEN COALESCE(lc2.lifetime_checkins, 0) = 0 AND u.created_at <= p_month_end - INTERVAL '14 days'
        THEN 'NEVER_CHECKED_OFF'  -- eligible regardless of metro_source; see effective_metro
      WHEN COALESCE(lc2.lifetime_checkins, 0) = 0
        THEN 'EXCLUDED'  -- too new to call "never checked off" yet, no August activity either
      WHEN COALESCE(suc.checked_count, 0) > 0
        THEN 'FALL_CONTINUATION'
      WHEN em.metro_id IS NULL
        THEN 'EXCLUDED'  -- older history but no resolvable metro from ANY evidence tier
      ELSE 'RETURNING_INACTIVE'
    END::text                                           AS segment,
    CASE
      WHEN u.email IS NULL THEN 'no_email'
      WHEN u.email LIKE '%getcheckoff.com%' THEN 'internal_account'
      WHEN u.is_deleted IS TRUE THEN 'deleted_account'
      WHEN u.email_opt_out IS TRUE THEN 'opted_out'
      WHEN u.email_bounced IS TRUE THEN 'bounced'
      WHEN COALESCE(lc2.lifetime_checkins, 0) = 0 AND u.created_at > p_month_end - INTERVAL '14 days' THEN 'account_too_new'
      WHEN COALESCE(ms.checkins_this_month, 0) = 0 AND COALESCE(lc2.lifetime_checkins, 0) > 0
           AND COALESCE(suc.checked_count, 0) = 0 AND em.metro_id IS NULL THEN 'no_resolvable_metro'
      ELSE NULL
    END::text                                           AS exclusion_reason,
    em.metro_id::uuid                                   AS metro_id,
    ma.name::text                                       AS metro_name,
    em.metro_source::text                               AS metro_source,
    COALESCE(ms.checkins_this_month, 0)::int            AS checkins_this_month,
    COALESCE(ms.points_this_month, 0)::int              AS points_this_month,
    u.lifetime_points::int                              AS lifetime_points,
    COALESCE(mi.names, '[]'::jsonb)                     AS completed_item_names,
    mth.neighborhood_name::text                         AS most_active_hood,
    u.current_streak::int                               AS current_streak_weeks,
    lc.last_checkin_at                                  AS last_checkin_at,
    lc.last_checkin_item_name::text                     AS last_checkin_item_name,
    CASE WHEN lc.last_checkin_at IS NOT NULL
         THEN (CURRENT_DATE - lc.last_checkin_at::date)::int END AS days_since_last_checkin,
    COALESCE(ni.new_items_since_last_checkin, 0)::int   AS new_items_since_last_checkin,
    COALESCE(lc2.lifetime_checkins, 0)::int             AS lifetime_checkins,
    s.season_list_id::uuid                              AS season_list_id,
    s.season_name::text                                 AS season_name,
    s.ends_at::date                                     AS season_ends_at,
    COALESCE(st.total_items, 0)::int                    AS season_total_items,
    COALESCE(suc.checked_count, 0)::int                 AS season_checked_count,
    GREATEST(COALESCE(s.days_remaining, 0), 0)::int     AS season_days_remaining,
    CASE WHEN em.metro_id IS NULL THEN NULL ELSE (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', rec.id, 'body', rec.body, 'difficulty', rec.difficulty,
          'popularity', rec.popularity, 'url', rec.url
        ) ORDER BY rec.popularity DESC
      )
      FROM (
        SELECT i2.id, i2.body, i2.difficulty,
          'checkoff://item?id=' || i2.id::text AS url,
          COUNT(ci2.id) AS popularity
        FROM items i2
        JOIN neighborhoods n2    ON n2.id = i2.neighborhood_id
        LEFT JOIN list_items li2 ON li2.item_id = i2.id
        LEFT JOIN check_ins  ci2 ON ci2.list_item_id = li2.id
        WHERE n2.metro_id     = em.metro_id
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
    ) END::jsonb                                        AS recommended_items
  FROM users u
  LEFT JOIN effective_metro      em  ON em.user_id = u.id
  LEFT JOIN metro_areas          ma  ON ma.id      = em.metro_id
  LEFT JOIN month_summary        ms  ON ms.user_id = u.id
  LEFT JOIN month_items          mi  ON mi.user_id = u.id
  LEFT JOIN month_top_hood       mth ON mth.user_id = u.id
  LEFT JOIN lifetime_counts      lc2 ON lc2.user_id = u.id
  LEFT JOIN last_ci              lc  ON lc.user_id = u.id
  LEFT JOIN new_items            ni  ON ni.user_id = u.id
  LEFT JOIN seasonal              s   ON s.metro_id  = em.metro_id
  LEFT JOIN season_totals         st  ON st.list_id  = s.season_list_id
  LEFT JOIN season_user_counts    suc ON suc.user_id = u.id AND suc.list_id = s.season_list_id;
$$;

REVOKE ALL ON FUNCTION get_recap_campaign_audience(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_recap_campaign_audience(date, date) TO service_role;
