-- ============================================================
-- Automatic seasonal visibility for items.season_tag
-- 2026-08-09
--
-- Replaces manual is_active toggling for seasonal businesses with a
-- server-side sync driven by items.season_tag. Items with
-- season_tag IS NULL are never touched by anything in this file —
-- is_active continues to work exactly as it does today for them.
--
-- Windows (non-overlapping, matches the client-side stopgap already
-- shipped in lib/seasonFilter.js for Priorities 1-2):
--   fall   = Sep, Oct, Nov   (9, 10, 11)
--   winter = Dec, Jan, Feb   (12, 1, 2)
--   spring = Mar, Apr, May   (3, 4, 5)
--   summer = Jun, Jul, Aug   (6, 7, 8)
--
-- All "current month" checks use America/Phoenix, matching the
-- timezone convention already established by prevent_expired_list_checkins()
-- and lib/seasonWindow.js elsewhere in this codebase.
--
-- Four pieces:
--   1. sync_seasonal_item_active() — bulk sync, run by cron.
--   2. apply_seasonal_active_on_tag_change() — BEFORE INSERT OR UPDATE OF
--      season_tag trigger so a newly tagged item doesn't wait for cron.
--   3. season_days_until_start(text) — "coming soon" helper for the UI.
--   4. pg_cron schedule — monthly safety net (season boundaries are the
--      only moment sync_seasonal_item_active() can change anything that
--      the trigger hasn't already caught, since nothing else about a row
--      changes at midnight on the 1st).
-- ============================================================

-- 1. Bulk sync — updates every season-tagged item's is_active to match
-- today's date. Items with season_tag NOT IN ('fall','winter','spring','summer')
-- (e.g. the 5 existing 'all' rows) fall through the CASE unchanged —
-- 'all' was never part of the windowed system and isn't being reinterpreted
-- here.
CREATE OR REPLACE FUNCTION public.sync_seasonal_item_active()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  current_month int := EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Phoenix'))::int;
BEGIN
  UPDATE items
  SET is_active = CASE season_tag
    WHEN 'fall'   THEN current_month IN (9, 10, 11)
    WHEN 'winter' THEN current_month IN (12, 1, 2)
    WHEN 'spring' THEN current_month IN (3, 4, 5)
    WHEN 'summer' THEN current_month IN (6, 7, 8)
    ELSE is_active
  END
  WHERE season_tag IS NOT NULL
    AND is_active IS DISTINCT FROM CASE season_tag
      WHEN 'fall'   THEN current_month IN (9, 10, 11)
      WHEN 'winter' THEN current_month IN (12, 1, 2)
      WHEN 'spring' THEN current_month IN (3, 4, 5)
      WHEN 'summer' THEN current_month IN (6, 7, 8)
      ELSE is_active
    END;
END;
$function$;

-- 2. Immediate application on insert/tag change — so setting season_tag on
-- an item takes effect the moment it's saved, not on the next cron tick.
-- Only fires the seasonal calculation when NEW.season_tag IS NOT NULL;
-- clearing season_tag back to NULL leaves is_active exactly as the caller
-- set it (manual control resumes, per the agreed null-behaves-as-today rule).
CREATE OR REPLACE FUNCTION public.apply_seasonal_active_on_tag_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  current_month int := EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Phoenix'))::int;
BEGIN
  IF NEW.season_tag IS NOT NULL THEN
    NEW.is_active := CASE NEW.season_tag
      WHEN 'fall'   THEN current_month IN (9, 10, 11)
      WHEN 'winter' THEN current_month IN (12, 1, 2)
      WHEN 'spring' THEN current_month IN (3, 4, 5)
      WHEN 'summer' THEN current_month IN (6, 7, 8)
      ELSE NEW.is_active  -- unrecognized tag (e.g. 'all') — leave caller's value alone
    END;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_apply_seasonal_active_on_tag_change ON items;

CREATE TRIGGER trg_apply_seasonal_active_on_tag_change
BEFORE INSERT OR UPDATE OF season_tag ON items
FOR EACH ROW
EXECUTE FUNCTION public.apply_seasonal_active_on_tag_change();

-- 3. "Coming soon" helper — days until the given season's next start date,
-- 0 if currently in season. Returns NULL for an unrecognized tag (e.g.
-- 'all') rather than raising, so a UI call site can't crash on bad data —
-- it should just skip rendering a "coming soon" badge.
CREATE OR REPLACE FUNCTION public.season_days_until_start(p_season_tag text)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
DECLARE
  today         date := (now() AT TIME ZONE 'America/Phoenix')::date;
  current_month int  := EXTRACT(MONTH FROM today)::int;
  start_month   int;
  season_months int[];
  next_start    date;
BEGIN
  CASE p_season_tag
    WHEN 'fall'   THEN start_month := 9;  season_months := ARRAY[9, 10, 11];
    WHEN 'winter' THEN start_month := 12; season_months := ARRAY[12, 1, 2];
    WHEN 'spring' THEN start_month := 3;  season_months := ARRAY[3, 4, 5];
    WHEN 'summer' THEN start_month := 6;  season_months := ARRAY[6, 7, 8];
    ELSE RETURN NULL;
  END CASE;

  IF current_month = ANY(season_months) THEN
    RETURN 0;
  END IF;

  next_start := make_date(EXTRACT(YEAR FROM today)::int, start_month, 1);
  IF next_start <= today THEN
    next_start := next_start + INTERVAL '1 year';
  END IF;

  RETURN (next_start - today);
END;
$function$;

-- 4. Monthly safety net. sync_seasonal_item_active() is pure SQL (no
-- external HTTP call needed), so — unlike streak-reminder/send-dormant-
-- reminders, which proxy through an edge function because they send push
-- notifications — pg_cron can invoke it directly. cron.schedule() upserts
-- by job name, so re-running this migration is idempotent.
SELECT cron.schedule(
  'sync-seasonal-item-active-monthly',
  '0 6 1 * *',  -- 06:00 UTC on the 1st of every month
  $$SELECT public.sync_seasonal_item_active();$$
);
