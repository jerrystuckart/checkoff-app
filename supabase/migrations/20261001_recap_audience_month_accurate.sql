-- Monthly recap campaign: month accurate audience, narrow suppression, crash safe send claims.
--
-- Forward only. Replaces get_recap_campaign_audience (same signature and result columns, so grants
-- and the TypeScript row type stay compatible) and adds get_recap_campaign_cities.
--
-- What this fixes (from the 2026-09-30 readiness audit):
--   1. Checkoffs are now read through ONE normalized relation: check_ins.item_id when present,
--      otherwise check_ins.list_item_id -> list_items.item_id. Before, only the list_item path was
--      visible, so 84 of 152 September checkoffs were invisible to the audience.
--      One row per check_ins record, so nothing is counted twice when both references exist.
--   2. Month boundaries are explicit UTC instants derived from the arguments. "As of" values (season
--      window, days remaining, days since last checkoff) are derived from p_month_end, not
--      CURRENT_DATE, so a month can be recalculated identically on any day.
--   3. The month specific segment ACTIVE_AUGUST is now ACTIVE_MONTH.
--   4. points_this_month sums check_ins.points_awarded (NULL counts as 0). This is the established
--      product truth: users.lifetime_points equals SUM(points_awarded) for every user with
--      checkoffs (36 of 36 on 2026-10-01). It used to sum items.difficulty.
--   5. Metro resolution only ever returns an ACTIVE metro. No tier invents or defaults a metro.
--   6. NULL season ends_at stays NULL (it used to become 0 days remaining).
--   7. Suppression: internal accounts are matched by email DOMAIN (not a substring), known test
--      accounts live in campaign_suppressions by explicit user id, invalid email addresses are
--      excluded, and users created after the recap month closes are too new.
--   8. campaign_sends gets a 'sending' status plus a unique index over (sending, sent) so a send
--      is claimed BEFORE Resend is called. A retry can never produce a second email.

-- ── 1. Narrow suppression records ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_suppressions (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE campaign_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON campaign_suppressions FROM PUBLIC, anon, authenticated;
GRANT ALL ON campaign_suppressions TO service_role;

-- Seed the two known test accounts by explicit id, found with narrow predicates that were checked
-- against production before this migration was written (exactly two rows match).
INSERT INTO campaign_suppressions (user_id, reason, note)
SELECT u.id, 'test_account', 'seeded 2026-10-01 from the recap readiness audit'
FROM users u
WHERE split_part(lower(u.email), '@', 2) = 'checkoff-test.com'
   OR (split_part(lower(u.email), '@', 1) ~ '^test'
       AND u.display_name ILIKE '%test%'
       AND split_part(lower(u.email), '@', 2) <> 'getcheckoff.com')
ON CONFLICT (user_id) DO NOTHING;

-- ── 2. campaign_sends: month neutral segment, claim status, claim uniqueness ─
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'campaign_sends'::regclass AND contype = 'c'
      AND (pg_get_constraintdef(oid) LIKE '%ACTIVE_AUGUST%' OR pg_get_constraintdef(oid) LIKE '%dry_run%')
  LOOP
    EXECUTE format('ALTER TABLE campaign_sends DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_segment_check CHECK (segment IN (
  'ACTIVE_AUGUST', 'ACTIVE_MONTH', 'FALL_CONTINUATION', 'RETURNING_INACTIVE', 'NEVER_CHECKED_OFF', 'EXCLUDED'
));
ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_status_check CHECK (status IN (
  'pending', 'sending', 'sent', 'failed', 'suppressed', 'dry_run'
));

-- A production send first claims (campaign_id, user_id) with status 'sending'. If Resend accepts the
-- message the row becomes 'sent'; if Resend rejects it the row becomes 'failed', which frees the claim.
-- A row stuck in 'sending' means "outcome unknown": it blocks a retry on purpose until a human reconciles.
CREATE UNIQUE INDEX IF NOT EXISTS campaign_sends_unique_live_claim
  ON campaign_sends (campaign_id, user_id)
  WHERE status IN ('sending', 'sent') AND is_test_send = false;

-- ── 3. Audience RPC ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_recap_campaign_audience(p_month_start date, p_month_end date)
RETURNS TABLE(
  user_id uuid, email text, display_name text, platform text, segment text, exclusion_reason text,
  metro_id uuid, metro_name text, metro_source text,
  checkins_this_month integer, points_this_month integer, lifetime_points integer,
  completed_item_names jsonb, most_active_hood text, current_streak_weeks integer,
  last_checkin_at timestamp with time zone, last_checkin_item_name text,
  days_since_last_checkin integer, new_items_since_last_checkin integer, lifetime_checkins integer,
  season_list_id uuid, season_name text, season_ends_at date,
  season_total_items integer, season_checked_count integer, season_days_remaining integer,
  recommended_items jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH
  bounds AS (
    SELECT (p_month_start::timestamp AT TIME ZONE 'UTC') AS t0,
           (p_month_end::timestamp   AT TIME ZONE 'UTC') AS t1,
           p_month_end                                   AS as_of
  ),
  active_metro AS (
    SELECT id AS metro_id, name AS metro_name FROM metro_areas WHERE is_active = true
  ),
  -- One row per check_ins record. Prefer the direct item_id; fall back through list_items.
  -- The LEFT JOIN is on list_items' primary key, so it can never multiply rows.
  ci_norm AS (
    SELECT ci.id AS check_in_id, ci.user_id, ci.checked_at, ci.points_awarded,
           COALESCE(ci.item_id, li.item_id) AS item_id
    FROM check_ins ci
    LEFT JOIN list_items li ON li.id = ci.list_item_id
  ),
  ci_item AS (
    SELECT cn.check_in_id, cn.user_id, cn.checked_at, cn.points_awarded,
           i.id AS item_id, i.body, i.difficulty,
           n.name AS neighborhood_name, am.metro_id
    FROM ci_norm cn
    JOIN items i ON i.id = cn.item_id
    LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
    LEFT JOIN active_metro am ON am.metro_id = n.metro_id
  ),
  month_ci AS (
    SELECT c.* FROM ci_item c, bounds b WHERE c.checked_at >= b.t0 AND c.checked_at < b.t1
  ),
  month_summary AS (
    SELECT user_id, COUNT(*) AS checkins_this_month,
           COALESCE(SUM(COALESCE(points_awarded, 0)), 0) AS points_this_month
    FROM month_ci GROUP BY user_id
  ),
  month_items AS (
    SELECT user_id, jsonb_agg(jsonb_build_object('id', item_id, 'body', body) ORDER BY checked_at DESC, check_in_id) AS names
    FROM month_ci GROUP BY user_id
  ),
  month_metro_counts AS (
    SELECT user_id, metro_id, COUNT(*) AS cnt FROM month_ci WHERE metro_id IS NOT NULL GROUP BY user_id, metro_id
  ),
  month_top_metro AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id FROM month_metro_counts ORDER BY user_id, cnt DESC, metro_id
  ),
  month_hood_counts AS (
    SELECT user_id, neighborhood_name, COUNT(*) AS cnt FROM month_ci
    WHERE neighborhood_name IS NOT NULL GROUP BY user_id, neighborhood_name
  ),
  month_top_hood AS (
    SELECT DISTINCT ON (user_id) user_id, neighborhood_name FROM month_hood_counts ORDER BY user_id, cnt DESC, neighborhood_name
  ),
  lifetime_counts AS (
    SELECT user_id, COUNT(*) AS lifetime_checkins FROM ci_item GROUP BY user_id
  ),
  last_ci AS (
    SELECT DISTINCT ON (user_id) user_id, checked_at AS last_checkin_at, body AS last_checkin_item_name
    FROM ci_item ORDER BY user_id, checked_at DESC, check_in_id
  ),
  last_ci_metro AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id
    FROM ci_item WHERE metro_id IS NOT NULL ORDER BY user_id, checked_at DESC, check_in_id
  ),
  user_checked_items AS (
    SELECT DISTINCT user_id, item_id FROM ci_norm WHERE item_id IS NOT NULL
  ),
  -- Tier 1, "checkoff_history": this month's busiest active metro, else the most recent active metro.
  resolved_metro AS (
    SELECT u.id AS user_id, COALESCE(mtm.metro_id, lm.metro_id) AS metro_id
    FROM users u
    LEFT JOIN month_top_metro mtm ON mtm.user_id = u.id
    LEFT JOIN last_ci_metro   lm  ON lm.user_id  = u.id
  ),
  -- Tier 2, "explicit_profile": a user stated home area. Wired up, currently empty app wide.
  explicit_profile AS (
    SELECT u.id AS user_id, am.metro_id
    FROM users u
    JOIN neighborhoods n ON n.id = u.neighborhood_id
    JOIN active_metro am ON am.metro_id = n.metro_id
  ),
  -- Tier 3, "list_history": the user joined or created a list tied to an active metro.
  list_history_raw AS (
    SELECT lm.user_id, l.metro_id, lm.joined_at AS occurred_at
    FROM list_members lm JOIN lists l ON l.id = lm.list_id
    JOIN active_metro am ON am.metro_id = l.metro_id
    UNION ALL
    SELECT l.creator_id AS user_id, l.metro_id, l.created_at AS occurred_at
    FROM lists l JOIN active_metro am ON am.metro_id = l.metro_id
    WHERE l.creator_id IS NOT NULL
  ),
  list_history AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id FROM (
      SELECT user_id, metro_id, COUNT(*) AS cnt, MAX(occurred_at) AS last_at
      FROM list_history_raw GROUP BY user_id, metro_id
    ) r ORDER BY user_id, cnt DESC, last_at DESC, metro_id
  ),
  -- Tier 4, "interaction_history": lower confidence browse signals through an active metro.
  interaction_history AS (
    SELECT DISTINCT ON (user_id) user_id, metro_id FROM (
      SELECT ie.user_id, am.metro_id, COUNT(*) AS cnt, MAX(ie.occurred_at) AS last_at
      FROM interaction_events ie
      LEFT JOIN items i         ON i.id = ie.item_id
      LEFT JOIN neighborhoods n ON n.id = i.neighborhood_id
      LEFT JOIN lists l2        ON l2.id = ie.list_id
      JOIN active_metro am ON am.metro_id = COALESCE(n.metro_id, l2.metro_id)
      GROUP BY ie.user_id, am.metro_id
    ) r ORDER BY user_id, cnt DESC, last_at DESC, metro_id
  ),
  effective_metro AS (
    SELECT u.id AS user_id,
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
  -- Flagship seasonal list per metro, evaluated as of the recap reference date (p_month_end).
  seasonal_candidates AS (
    SELECT l.id AS season_list_id, l.metro_id, l.title AS season_name, l.starts_at, l.ends_at,
           (SELECT COUNT(*) FROM list_items WHERE list_id = l.id) AS item_count
    FROM lists l, bounds b
    WHERE l.is_official = true AND l.is_public = true
      AND l.title ~* 'Fall\s*20\d\d'
      AND (l.starts_at IS NULL OR l.starts_at::date <= b.as_of)
      AND (l.ends_at   IS NULL OR l.ends_at::date   >= b.as_of)
  ),
  seasonal AS (
    SELECT DISTINCT ON (metro_id) season_list_id, metro_id, season_name, starts_at, ends_at
    FROM seasonal_candidates ORDER BY metro_id, item_count DESC, season_list_id
  ),
  season_totals AS (
    SELECT list_id, COUNT(*) AS total_items FROM list_items GROUP BY list_id
  ),
  -- Progress on a flagship list mirrors the app (ListScreen / seasonWindowPure.isWithinWindow): distinct
  -- items the user checked, by item_id (either storage path), whose check date falls inside the list's own
  -- season window in the metro's timezone. A summer checkoff does not count toward a Fall list.
  season_user_counts AS (
    SELECT cn.user_id, s.season_list_id AS list_id, COUNT(DISTINCT cn.item_id) AS checked_count
    FROM ci_norm cn
    JOIN list_items li ON li.item_id = cn.item_id
    JOIN seasonal s    ON s.season_list_id = li.list_id
    JOIN metro_areas ma ON ma.id = s.metro_id
    WHERE (s.starts_at IS NULL OR (cn.checked_at AT TIME ZONE COALESCE(ma.timezone, 'America/Phoenix'))::date >= s.starts_at::date)
      AND (s.ends_at   IS NULL OR (cn.checked_at AT TIME ZONE COALESCE(ma.timezone, 'America/Phoenix'))::date <= s.ends_at::date)
    GROUP BY cn.user_id, s.season_list_id
  ),
  classified AS (
    SELECT
      u.id AS uid, u.email AS uemail, u.display_name AS uname, u.platform AS uplatform,
      em.metro_id AS em_metro_id, em.metro_source AS em_metro_source, am.metro_name AS em_metro_name,
      COALESCE(ms.checkins_this_month, 0)::int AS c_month,
      COALESCE(ms.points_this_month, 0)::int   AS p_month,
      COALESCE(lc2.lifetime_checkins, 0)::int  AS c_life,
      COALESCE(suc.checked_count, 0)::int      AS c_season,
      CASE
        WHEN u.email IS NULL OR btrim(u.email) = '' THEN 'no_email'
        WHEN split_part(lower(u.email), '@', 2) = 'getcheckoff.com'
          OR split_part(lower(u.email), '@', 2) LIKE '%.getcheckoff.com' THEN 'internal_account'
        WHEN sup.user_id IS NOT NULL THEN 'test_account'
        WHEN u.is_deleted IS TRUE THEN 'deleted_account'
        WHEN u.email_opt_out IS TRUE THEN 'opted_out'
        WHEN u.email_bounced IS TRUE THEN 'bounced'
        WHEN u.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN 'invalid_email'
        WHEN COALESCE(lc2.lifetime_checkins, 0) = 0
             AND u.created_at > (b.t1 - INTERVAL '14 days') THEN 'account_too_new'
        WHEN COALESCE(ms.checkins_this_month, 0) = 0 AND COALESCE(lc2.lifetime_checkins, 0) > 0
             AND COALESCE(suc.checked_count, 0) = 0 AND em.metro_id IS NULL THEN 'no_resolvable_metro'
        ELSE NULL
      END AS excl
    FROM users u
    CROSS JOIN bounds b
    LEFT JOIN effective_metro   em  ON em.user_id = u.id
    LEFT JOIN active_metro      am  ON am.metro_id = em.metro_id
    LEFT JOIN month_summary     ms  ON ms.user_id = u.id
    LEFT JOIN lifetime_counts   lc2 ON lc2.user_id = u.id
    LEFT JOIN seasonal          s   ON s.metro_id = em.metro_id
    LEFT JOIN season_user_counts suc ON suc.user_id = u.id AND suc.list_id = s.season_list_id
    LEFT JOIN campaign_suppressions sup ON sup.user_id = u.id
  )
  SELECT
    cl.uid::uuid                                         AS user_id,
    cl.uemail::text                                      AS email,
    cl.uname::text                                       AS display_name,
    cl.uplatform::text                                   AS platform,
    (CASE
       WHEN cl.excl IS NOT NULL THEN 'EXCLUDED'
       WHEN cl.c_month > 0 THEN 'ACTIVE_MONTH'
       WHEN cl.c_life = 0 THEN 'NEVER_CHECKED_OFF'
       WHEN cl.c_season > 0 THEN 'FALL_CONTINUATION'
       ELSE 'RETURNING_INACTIVE'
     END)::text                                          AS segment,
    cl.excl::text                                        AS exclusion_reason,
    cl.em_metro_id::uuid                                 AS metro_id,
    cl.em_metro_name::text                               AS metro_name,
    cl.em_metro_source::text                             AS metro_source,
    cl.c_month                                           AS checkins_this_month,
    cl.p_month                                           AS points_this_month,
    u2.lifetime_points::int                              AS lifetime_points,
    COALESCE(mi.names, '[]'::jsonb)                      AS completed_item_names,
    mth.neighborhood_name::text                          AS most_active_hood,
    u2.current_streak::int                               AS current_streak_weeks,
    lc.last_checkin_at                                   AS last_checkin_at,
    lc.last_checkin_item_name::text                      AS last_checkin_item_name,
    CASE WHEN lc.last_checkin_at IS NOT NULL
         THEN (b.as_of - lc.last_checkin_at::date)::int END AS days_since_last_checkin,
    (CASE WHEN cl.em_metro_id IS NULL OR lc.last_checkin_at IS NULL THEN 0 ELSE (
       SELECT COUNT(*) FROM items i2 JOIN neighborhoods n2 ON n2.id = i2.neighborhood_id
       WHERE n2.metro_id = cl.em_metro_id AND i2.created_at > lc.last_checkin_at
         AND i2.is_active = true AND i2.is_approved = true
     ) END)::int                                         AS new_items_since_last_checkin,
    cl.c_life                                            AS lifetime_checkins,
    s.season_list_id::uuid                               AS season_list_id,
    s.season_name::text                                  AS season_name,
    s.ends_at::date                                      AS season_ends_at,
    COALESCE(st.total_items, 0)::int                     AS season_total_items,
    cl.c_season                                          AS season_checked_count,
    (CASE WHEN s.season_list_id IS NULL OR s.ends_at IS NULL THEN NULL
          ELSE GREATEST(s.ends_at::date - b.as_of, 0) END)::int AS season_days_remaining,
    (CASE WHEN cl.em_metro_id IS NULL THEN NULL ELSE (
      SELECT jsonb_agg(
        jsonb_build_object('id', rec.id, 'body', rec.body, 'difficulty', rec.difficulty,
                           'popularity', rec.popularity, 'url', rec.url)
        ORDER BY rec.popularity DESC, rec.id)
      FROM (
        SELECT i2.id, i2.body, i2.difficulty,
               'checkoff://item?id=' || i2.id::text AS url,
               COUNT(cn.check_in_id) AS popularity
        FROM items i2
        JOIN neighborhoods n2 ON n2.id = i2.neighborhood_id
        LEFT JOIN ci_norm cn  ON cn.item_id = i2.id
        WHERE n2.metro_id    = cl.em_metro_id
          AND i2.is_active   = true
          AND i2.is_approved = true
          AND i2.is_universal = false
          AND NOT EXISTS (SELECT 1 FROM user_checked_items uci WHERE uci.user_id = cl.uid AND uci.item_id = i2.id)
        GROUP BY i2.id, i2.body, i2.difficulty
        ORDER BY COUNT(cn.check_in_id) DESC, i2.id
        LIMIT 3
      ) rec
    ) END)::jsonb                                        AS recommended_items
  FROM classified cl
  CROSS JOIN bounds b
  JOIN users u2 ON u2.id = cl.uid
  LEFT JOIN month_items      mi  ON mi.user_id  = cl.uid
  LEFT JOIN month_top_hood   mth ON mth.user_id = cl.uid
  LEFT JOIN last_ci          lc  ON lc.user_id  = cl.uid
  LEFT JOIN seasonal         s   ON s.metro_id  = cl.em_metro_id
  LEFT JOIN season_totals    st  ON st.list_id  = s.season_list_id;
$function$;

REVOKE ALL ON FUNCTION get_recap_campaign_audience(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_recap_campaign_audience(date, date) TO service_role;

-- ── 4. Live city data for the email (one deterministic query) ───────────────
-- Active metros with their approved item count, public official list count, the flagship Fall list
-- if one is current, and a "destination" list (Fall list, else the largest official public list).
CREATE OR REPLACE FUNCTION get_recap_campaign_cities(p_as_of date)
RETURNS TABLE(
  metro_id uuid, name text, slug text, created_at timestamp with time zone,
  active_items integer, public_official_lists integer,
  season_list_id uuid, season_name text,
  destination_list_id uuid, destination_list_title text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH lists_pub AS (
    SELECT l.id, l.metro_id, l.title, l.starts_at, l.ends_at,
           (SELECT COUNT(*) FROM list_items WHERE list_id = l.id) AS item_count
    FROM lists l
    WHERE l.is_official = true AND l.is_public = true AND l.metro_id IS NOT NULL
  ),
  fall AS (
    SELECT DISTINCT ON (metro_id) id, metro_id, title
    FROM lists_pub
    WHERE title ~* 'Fall\s*20\d\d'
      AND (starts_at IS NULL OR starts_at::date <= p_as_of)
      AND (ends_at   IS NULL OR ends_at::date   >= p_as_of)
    ORDER BY metro_id, item_count DESC, id
  ),
  biggest AS (
    SELECT DISTINCT ON (metro_id) id, metro_id, title
    FROM lists_pub WHERE item_count > 0
    ORDER BY metro_id, item_count DESC, id
  )
  SELECT ma.id, ma.name::text, ma.slug::text, ma.created_at,
         (SELECT COUNT(*) FROM items i JOIN neighborhoods n ON n.id = i.neighborhood_id
           WHERE n.metro_id = ma.id AND i.is_active = true AND i.is_approved = true)::int,
         (SELECT COUNT(*) FROM lists_pub lp WHERE lp.metro_id = ma.id)::int,
         f.id, f.title::text,
         COALESCE(f.id, bg.id), COALESCE(f.title, bg.title)::text
  FROM metro_areas ma
  LEFT JOIN fall f    ON f.metro_id  = ma.id
  LEFT JOIN biggest bg ON bg.metro_id = ma.id
  WHERE ma.is_active = true
  ORDER BY ma.name;
$function$;

REVOKE ALL ON FUNCTION get_recap_campaign_cities(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_recap_campaign_cities(date) TO service_role;
