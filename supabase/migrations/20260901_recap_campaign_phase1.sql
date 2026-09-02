-- ============================================================
-- August Monthly CheckOff Recap — campaign infrastructure
-- 2026-09-01
--
-- Additive, reversible. Extends the July 8 email-automation
-- system (get_monthly_recap_users / get_inactive_users /
-- get_never_checkin_users) rather than replacing it — those
-- three RPCs and their edge functions are untouched and keep
-- working. This adds:
--   1. Suppression columns on users (opt-out + bounce)
--   2. campaign_sends — idempotency + send/attribution log
--   3. Two columns on interaction_events for email-click attribution
--   4. get_recap_campaign_audience(month_start, month_end) — the
--      calendar-month, 4-segment audience RPC for this campaign
-- ============================================================


-- ── 1. Suppression columns ──────────────────────────────────────────────────
-- No preference-management project is being built here (out of scope).
-- These are the minimum columns needed to respect opt-out/bounce and to
-- stop emailing an address that complained or hard-bounced.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out    boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bounced    boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bounced_at timestamptz;


-- ── 2. campaign_sends ────────────────────────────────────────────────────────
-- One row per (campaign_id, user_id). Unique constraint is the idempotency
-- guard — re-running a send for the same campaign+user is a no-op once a
-- row with status='sent' exists. Also the audit trail: segment, rendered
-- snapshot, recommendation ids, Resend message id, failure reason.

CREATE TABLE IF NOT EXISTS campaign_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         text NOT NULL,               -- e.g. 'recap_2026-08'
  campaign_month      date NOT NULL,                -- first-of-month, the calendar month being recapped
  user_id             uuid NOT NULL REFERENCES users(id),
  segment             text NOT NULL CHECK (segment IN (
                        'ACTIVE_AUGUST', 'FALL_CONTINUATION',
                        'RETURNING_INACTIVE', 'NEVER_CHECKED_OFF', 'EXCLUDED'
                      )),
  template_version    text NOT NULL DEFAULT 'v1',
  subject             text,
  recommendation_ids  jsonb,
  rendered_snapshot    jsonb,                        -- enough to reproduce what was sent (section flags, key stats)
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'sent', 'failed', 'suppressed', 'dry_run'
                      )),
  suppression_reason  text,
  failure_reason      text,
  resend_message_id   text,
  is_test_send        boolean NOT NULL DEFAULT false,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: only one non-test 'sent' row per campaign+user. Test sends
-- (is_test_send=true, e.g. previews redirected to an internal address) are
-- excluded from the uniqueness guard so preview runs don't block the real send.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_sends_unique_live_send
  ON campaign_sends (campaign_id, user_id)
  WHERE status = 'sent' AND is_test_send = false;

CREATE INDEX IF NOT EXISTS campaign_sends_campaign_idx ON campaign_sends (campaign_id);
CREATE INDEX IF NOT EXISTS campaign_sends_user_idx     ON campaign_sends (user_id);

ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated — service_role (edge functions) only,
-- same convention as notification_log / the July 8 RPCs.


-- ── 3. interaction_events — email-click attribution columns ────────────────
-- Additive/nullable. Existing rows and existing callers (trackEvent.js) are
-- unaffected. Lets a click through the campaign-link redirect endpoint be
-- correlated back to a specific campaign send.

ALTER TABLE interaction_events ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE interaction_events ADD COLUMN IF NOT EXISTS metadata    jsonb;


-- ── 4. get_recap_campaign_audience ──────────────────────────────────────────
-- Calendar-month-aware (not rolling 30-day) audience + 4-way segmentation.
-- p_month_start inclusive, p_month_end exclusive — e.g. for August 2026:
--   p_month_start = '2026-08-01', p_month_end = '2026-09-01'
--
-- Every eligible user resolves to exactly one segment. Suppressed/opted-out/
-- bounced users, and users with no derivable metro, are returned as
-- segment='EXCLUDED' with exclusion_reason set (never silently dropped —
-- callers can still report exclusion counts by reason).

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
  metro_is_default_fallback   boolean,
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
  -- check-ins this month (so month_top_metro is null)
  fallback_metro AS (
    SELECT user_id, metro_id FROM last_ci WHERE metro_id IS NOT NULL
  ),
  resolved_metro AS (
    SELECT u.id AS user_id, COALESCE(mtm.metro_id, fm.metro_id) AS metro_id
    FROM users u
    LEFT JOIN month_top_metro mtm ON mtm.user_id = u.id
    LEFT JOIN fallback_metro  fm  ON fm.user_id  = u.id
  ),
  -- Users with zero lifetime check-ins have no derivable metro at all
  -- (users.neighborhood_id/city_id are ~0% populated app-wide — confirmed
  -- during the Sept 1 campaign audit). Rather than excluding the entire
  -- NEVER_CHECKED_OFF segment for this reason, this defaults THOSE users
  -- (and only those — anyone with real check-in history keeps using it,
  -- or is correctly EXCLUDED as no_resolvable_metro if it's truly absent)
  -- to Phoenix, matching the already-shipped get_never_checkin_users()
  -- behavior. metro_is_default_fallback flags it so the caller/template
  -- never claims this as real personalization.
  effective_metro AS (
    SELECT
      u.id AS user_id,
      CASE WHEN rm.metro_id IS NOT NULL THEN rm.metro_id
           WHEN COALESCE(lc2.lifetime_checkins, 0) = 0 THEN phx.id
           ELSE NULL END AS metro_id,
      (rm.metro_id IS NULL AND COALESCE(lc2.lifetime_checkins, 0) = 0) AS metro_is_default_fallback
    FROM users u
    LEFT JOIN resolved_metro  rm  ON rm.user_id = u.id
    LEFT JOIN lifetime_counts lc2 ON lc2.user_id = u.id
    CROSS JOIN (SELECT id FROM metro_areas WHERE name = 'Phoenix Metro') phx
  ),
  -- The flagship seasonal list per metro. is_official=true is no longer a
  -- unique-per-metro flag as of Aug 2026 — themed sub-lists (e.g. "Hidden
  -- Bars", "Wisconsin Weird") are also marked is_official=true alongside the
  -- actual flagship season list, so an unfiltered join fans out to multiple
  -- rows per user. Flagship lists follow an established "Fall <year>" naming
  -- convention across every metro that has one; DISTINCT ON collapses any
  -- remaining ties deterministically. Metros with no such list (Phoenix has
  -- none in `lists` as of this migration — its content lives only in
  -- curated_lists, still tagged "Summer 2026") correctly get no season row
  -- here rather than an arbitrary themed list standing in for it.
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
        THEN 'NEVER_CHECKED_OFF'
      WHEN COALESCE(lc2.lifetime_checkins, 0) = 0
        THEN 'EXCLUDED'  -- too new to call "never checked off" yet, no August activity either
      WHEN COALESCE(suc.checked_count, 0) > 0
        THEN 'FALL_CONTINUATION'
      WHEN rm.metro_id IS NULL
        THEN 'EXCLUDED'  -- older history but no resolvable metro; nothing safe to personalize
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
           AND COALESCE(suc.checked_count, 0) = 0 AND rm.metro_id IS NULL THEN 'no_resolvable_metro'
      ELSE NULL
    END::text                                           AS exclusion_reason,
    em.metro_id::uuid                                   AS metro_id,
    ma.name::text                                       AS metro_name,
    COALESCE(em.metro_is_default_fallback, false)       AS metro_is_default_fallback,
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
    (
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
    )::jsonb                                            AS recommended_items
  FROM users u
  LEFT JOIN resolved_metro       rm  ON rm.user_id = u.id
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
