BEGIN;

-- ============================================================
-- Platform-wide fix: metro-aware timezone for seasonal visibility
-- and list check-in boundary enforcement.
-- 2026-08-21 — NOT APPLIED. Generated for review only.
--
-- Root cause (docs/metro-launch-audit/01_current_schema_and_relationships.md,
-- docs/metro-launch-audit/02_app_metro_dependencies.md): four DB functions —
-- apply_seasonal_active_on_tag_change(), sync_seasonal_item_active(),
-- season_days_until_start(), prevent_expired_list_checkins() — and the
-- client file lib/seasonWindow.js all hardcode
-- `now() AT TIME ZONE 'America/Phoenix'`. Confirmed live in production.
-- Milwaukee and Tucson already have season_tag items exposed to this
-- today; Denver (which observes DST, unlike Phoenix) would be the first
-- metro where the resulting drift is large enough to flip check-in
-- accept/reject decisions near a list boundary, not just miscount a
-- display number.
--
-- Denver launches with season_tag=NULL items only (decision #2), so this
-- fix does not gate Denver's launch date — it ships so seasonal content
-- can be turned on for Denver later without another code round-trip.
-- ============================================================

-- ── STEP 1: metro_areas.timezone ─────────────────────────────────────────
-- NOT NULL, no default, added after backfill — a future metro's creator
-- must explicitly set this rather than silently inheriting Phoenix's
-- timezone by omission. JUDGMENT CALL: this is stricter than a
-- DEFAULT 'America/Phoenix' would be; the tradeoff is a required field
-- at metro-creation time in exchange for never silently mis-defaulting a
-- new metro's seasonal behavior. Reviewer: confirm this tradeoff is
-- wanted before applying.
ALTER TABLE public.metro_areas ADD COLUMN IF NOT EXISTS timezone text;

-- BUG CAUGHT AND FIXED IN A FOLLOW-UP REVIEW PASS (2026-08-21, same day):
-- the original version of this migration backfilled ALL THREE existing
-- metros — including Milwaukee — to 'America/Phoenix'. That was wrong.
-- Milwaukee, WI is in the Central time zone (America/Chicago, UTC-6/
-- UTC-5, DST-observing) — a genuinely different IANA zone from Phoenix's
-- America/Phoenix (UTC-7 year-round, no DST), not just a different
-- label for the same offset. Tucson, AZ correctly stays America/Phoenix
-- — Arizona has no DST, so Tucson and Phoenix share the exact same
-- offset at all times, making that one byte-for-byte equivalent, not a
-- coincidence.
--
-- "Preserve current behavior unchanged" was the right goal, but the
-- honest answer is that applying it to Milwaukee this way would have
-- preserved the current BUG for Milwaukee, not correct behavior — every
-- function this migration touches already hardcodes America/Phoenix
-- today, so Milwaukee's season/check-in boundary logic is CURRENTLY
-- being computed on Arizona's clock (this was finding #1 in the original
-- audit — Milwaukee already has 56 season_tag items exposed to exactly
-- this). Backfilling Milwaukee to 'America/Phoenix' again would have
-- shipped a timezone column specifically so this could be fixed, then
-- used it to re-encode the same bug. Milwaukee now gets its real
-- timezone — this is a genuine, intentional behavior change (a bug fix,
-- live in production today, not merely a Denver-readiness item), not a
-- "preserve exactly" backfill for that one metro.
UPDATE public.metro_areas SET timezone = 'America/Phoenix' WHERE slug = 'phoenix';
UPDATE public.metro_areas SET timezone = 'America/Chicago' WHERE slug = 'milwaukee';
UPDATE public.metro_areas SET timezone = 'America/Phoenix' WHERE slug = 'tucson';

-- Denver's row is created with timezone already set in
-- 20260821_denver_metro_foundation.sql (Part B) — no backfill needed
-- for it here. If any other metro_areas row exists beyond these four by
-- the time this is applied, it will be caught by the NOT NULL below and
-- must be backfilled by hand before this migration can complete.
ALTER TABLE public.metro_areas ALTER COLUMN timezone SET NOT NULL;

COMMENT ON COLUMN public.metro_areas.timezone IS
  'IANA timezone name (e.g. America/Denver). Required. Used by seasonal '
  'visibility and check-in boundary logic instead of a hardcoded zone.';

-- ── STEP 2: shared timezone-resolution helpers ───────────────────────────
-- Centralizes the join logic used by all four functions below instead of
-- repeating it four times. DESIGN NOTE, not a product decision: both
-- helpers fall back to 'America/Phoenix' — NOT metro_areas.timezone's
-- NOT NULL constraint, which only helps once a metro_id is known. The
-- fallback specifically covers items/checks that cannot be traced to any
-- metro_id at all (is_universal=true items with neighborhood_id NULL —
-- confirmed live: 318 of 1,068 items are universal, and universal items
-- are not required to have a neighborhood). JUDGMENT CALL: preserving
-- 'America/Phoenix' as that fallback keeps today's behavior byte-for-byte
-- identical for every currently-universal item across every metro; a
-- system-neutral fallback (e.g. UTC) would be more "correct" in the
-- abstract but would silently change behavior for existing Phoenix/
-- Milwaukee/Tucson universal items with no code change requested for
-- them. Reviewer: confirm this fallback choice before applying.

CREATE OR REPLACE FUNCTION public.resolve_metro_timezone(p_metro_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT timezone FROM public.metro_areas WHERE id = p_metro_id),
    'America/Phoenix'
  );
$$;

COMMENT ON FUNCTION public.resolve_metro_timezone(uuid) IS
  'Looks up a metro''s IANA timezone; falls back to America/Phoenix if the '
  'metro_id is null/unknown, preserving current behavior for that case.';

CREATE OR REPLACE FUNCTION public.resolve_item_timezone(p_item_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT public.resolve_metro_timezone(
    (SELECT n.metro_id
       FROM public.items i
       LEFT JOIN public.neighborhoods n ON n.id = i.neighborhood_id
      WHERE i.id = p_item_id)
  );
$$;

COMMENT ON FUNCTION public.resolve_item_timezone(uuid) IS
  'Resolves an item''s metro timezone via neighborhood_id -> '
  'neighborhoods.metro_id. Falls back to America/Phoenix for universal '
  'items (no neighborhood_id) or items with no neighborhood/metro link.';

-- ── STEP 3: apply_seasonal_active_on_tag_change() — trigger on items ────
CREATE OR REPLACE FUNCTION public.apply_seasonal_active_on_tag_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  item_tz text;
  current_month int;
BEGIN
  IF NEW.season_tag IS NOT NULL THEN
    item_tz := public.resolve_metro_timezone(
      (SELECT n.metro_id FROM public.neighborhoods n WHERE n.id = NEW.neighborhood_id)
    );
    current_month := EXTRACT(MONTH FROM (now() AT TIME ZONE item_tz))::int;
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

-- ── STEP 4: sync_seasonal_item_active() — monthly cron job body ─────────
-- Was a single UPDATE with one global current_month; now resolves each
-- item's own metro timezone via a per-row subquery so items in different
-- metros can land in different "current months" around a month boundary.
CREATE OR REPLACE FUNCTION public.sync_seasonal_item_active()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.items i
  SET is_active = CASE i.season_tag
    WHEN 'fall'   THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (9, 10, 11)
    WHEN 'winter' THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (12, 1, 2)
    WHEN 'spring' THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (3, 4, 5)
    WHEN 'summer' THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (6, 7, 8)
    ELSE i.is_active
  END
  WHERE i.season_tag IS NOT NULL
    AND i.is_active IS DISTINCT FROM CASE i.season_tag
      WHEN 'fall'   THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (9, 10, 11)
      WHEN 'winter' THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (12, 1, 2)
      WHEN 'spring' THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (3, 4, 5)
      WHEN 'summer' THEN EXTRACT(MONTH FROM (now() AT TIME ZONE public.resolve_item_timezone(i.id)))::int IN (6, 7, 8)
      ELSE i.is_active
    END;
END;
$function$;
-- PERFORMANCE NOTE (flag for reviewer, not a correctness issue): calling
-- resolve_item_timezone(i.id) per-row, up to 4x per row in this query, is
-- less efficient than the original single global current_month. Items
-- with season_tag set are a small subset of the table (56 for Milwaukee,
-- 68 for Phoenix, 4 for Tucson at last count), so this is very unlikely
-- to matter in practice, but a reviewer who wants this tighter could
-- rewrite as a single UPDATE ... FROM joining neighborhoods/metro_areas
-- once per row instead of calling the helper function repeatedly. Left
-- as the simpler, more obviously-correct version for this review pass.

-- ── STEP 5: season_days_until_start() — "coming soon" helper ────────────
-- SIGNATURE CHANGE, FLAGGED FOR REVIEW: the existing function takes only
-- p_season_tag text, with no item/list/metro context at all, so it
-- cannot be made metro-aware without changing its signature. Grepping
-- the app (screens/, lib/, components/) found ZERO call sites — this
-- function is defined but not currently wired up to any UI ("coming
-- soon helper for the UI" per its own migration comment). Because there
-- is no live caller to verify against, this fix is BEST-EFFORT, not
-- confirmed correct against real usage: p_metro_id is added as an
-- optional trailing parameter defaulting to NULL (falls back to
-- America/Phoenix, matching current global behavior) so any future
-- caller can opt into metro-awareness, and no caller needs to change to
-- keep working. Reviewer: if/when this function is actually wired up to
-- a UI, re-verify the call site passes a real metro_id.
DROP FUNCTION IF EXISTS public.season_days_until_start(text);

CREATE OR REPLACE FUNCTION public.season_days_until_start(p_season_tag text, p_metro_id uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
AS $function$
DECLARE
  tz            text := public.resolve_metro_timezone(p_metro_id);
  today         date := (now() AT TIME ZONE tz)::date;
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

-- ── STEP 6: prevent_expired_list_checkins() — check_ins trigger ─────────
-- List-attached branch resolves timezone via lists.metro_id directly
-- (clean, no fallback needed unless the list itself has no metro_id, in
-- which case the same America/Phoenix fallback applies). Standalone
-- branch resolves via the item's neighborhood/metro, same as items
-- generally, with the same universal-item fallback as Steps 3-4.
CREATE OR REPLACE FUNCTION public.prevent_expired_list_checkins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  list_starts date;
  list_ends   date;
  list_metro_id uuid;
  list_tz     text;
  item_is_active boolean;
  dest_list_active boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.user_id        IS NOT DISTINCT FROM OLD.user_id
     AND NEW.checkin_method IS NOT DISTINCT FROM OLD.checkin_method
     AND NEW.points_awarded IS NOT DISTINCT FROM OLD.points_awarded
     AND NEW.checked_at     IS NOT DISTINCT FROM OLD.checked_at
     AND NEW.personal_place IS NOT DISTINCT FROM OLD.personal_place
     AND NEW.personal_note  IS NOT DISTINCT FROM OLD.personal_note
     AND NEW.photo_url      IS NOT DISTINCT FROM OLD.photo_url
     AND NEW.photo_width    IS NOT DISTINCT FROM OLD.photo_width
     AND NEW.photo_height   IS NOT DISTINCT FROM OLD.photo_height
  THEN
    RETURN NEW;
  END IF;

  IF NEW.list_item_id IS NULL AND NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'A check-in must reference either a list item or an item.';
  END IF;

  -- ── Standalone check-in: validate the item directly, resolve tz via item's metro ──
  IF NEW.list_item_id IS NULL THEN
    SELECT i.is_active INTO item_is_active
    FROM items i
    WHERE i.id = NEW.item_id;

    IF item_is_active IS FALSE THEN
      RAISE EXCEPTION 'This item is no longer available.';
    END IF;

    IF item_is_active IS NULL THEN
      RAISE EXCEPTION 'This item does not exist.';
    END IF;

    RETURN NEW;
  END IF;

  -- ── List-attached check-in: resolve tz via the list's own metro_id ───────
  SELECT starts_at, ends_at, metro_id
  INTO list_starts, list_ends, list_metro_id
  FROM lists
  WHERE id = (
    SELECT list_id FROM list_items WHERE id = NEW.list_item_id
  );

  list_tz := public.resolve_metro_timezone(list_metro_id);

  IF list_ends IS NOT NULL AND (now() AT TIME ZONE list_tz)::date > list_ends THEN
    RAISE EXCEPTION 'This list has ended. Check-ins can no longer be changed.';
  END IF;

  IF list_starts IS NOT NULL AND (now() AT TIME ZONE list_tz)::date < list_starts THEN
    RAISE EXCEPTION 'This list hasn''t started yet. Check back on %.', to_char(list_starts, 'Month DD, YYYY');
  END IF;

  SELECT dl.is_active
  INTO dest_list_active
  FROM list_items li
  JOIN lists l ON l.id = li.list_id
  JOIN destination_lists dl ON dl.id = l.source_destination_list_id
  WHERE li.id = NEW.list_item_id;

  IF dest_list_active IS FALSE THEN
    RAISE EXCEPTION 'This partnership has ended. New check-ins are disabled.';
  END IF;

  SELECT i.is_active
  INTO item_is_active
  FROM items i
  JOIN list_items li ON li.item_id = i.id
  WHERE li.id = NEW.list_item_id;

  IF item_is_active IS FALSE THEN
    RAISE EXCEPTION 'This item is no longer available.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- NOT COMPLETED / FLAGGED — read before applying:
--
-- 1. season_days_until_start()'s metro-awareness is unverified against
--    any real caller (zero call sites found in the app). See Step 5.
-- 2. The universal-item / no-neighborhood timezone fallback is a
--    judgment call (America/Phoenix, matching current behavior) — see
--    Step 2's helper function comments. A reviewer who wants different
--    behavior for that case should change resolve_metro_timezone()'s
--    fallback before applying.
-- 3. sync_seasonal_item_active()'s per-row helper calls are less
--    efficient than the original single-pass UPDATE — flagged in Step 4,
--    not fixed here, on the judgment that the affected row count (double
--    digits to low hundreds) makes this a non-issue in practice.
-- 4. This migration does NOT touch lib/seasonWindow.js — see the
--    separate patch file at
--    docs/metro-launch-audit/patches/lib_seasonWindow.js.diff, which
--    must be applied together with this migration for the client and
--    server to agree on boundary-date logic again.
-- ============================================================

COMMIT;
