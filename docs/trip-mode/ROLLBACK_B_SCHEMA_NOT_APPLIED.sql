-- =============================================================================
-- ROLLBACK B — SCHEMA ROLLBACK. DESTRUCTIVE. Only run if Trip Mode has
-- NEVER been used for real (zero trip_list_retroactive rows). This script
-- aborts itself (via RAISE EXCEPTION inside a DO block, before any DDL
-- runs) if that condition isn't met — but treat that as a safety NET, not
-- a substitute for checking first. Do NOT run this after anyone has used
-- Trip Mode — use ROLLBACK_A_SOFT_NOT_APPLIED.sql instead in that case,
-- which is always safe.
--
-- Restores the trigger function to the EXACT original production body
-- (captured live via pg_get_functiondef this same session, reproduced
-- verbatim below — not a placeholder, not reconstructed from memory),
-- restores the original verification_method constraint, and drops every
-- additive column this release introduced.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM public.check_ins WHERE verification_method = 'trip_list_retroactive';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'ROLLBACK B ABORTED: % check_ins row(s) with verification_method = ''trip_list_retroactive'' exist. Use ROLLBACK_A_SOFT_NOT_APPLIED.sql instead — this destructive rollback is only safe when Trip Mode has never been used.', v_count;
  END IF;
  RAISE NOTICE 'Preflight OK: 0 trip_list_retroactive rows exist. Proceeding with schema rollback.';
END $$;

-- Restore the original verification_method constraint (drops the
-- 'trip_list_retroactive' allowed value).
ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS check_ins_verification_method_check;
ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_verification_method_check
  CHECK (verification_method = ANY (ARRAY['live_location'::text, 'qr_scan'::text, 'historical_visit_confirmed'::text, 'photo'::text, 'admin'::text, 'legacy'::text]));

-- Restore the EXACT original trigger function — captured live via
-- `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname =
-- 'prevent_expired_list_checkins'` this same session, reproduced
-- byte-for-byte below (not a placeholder).
CREATE OR REPLACE FUNCTION public.prevent_expired_list_checkins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

-- Drop the additive columns (safe now that the preflight above confirmed
-- zero rows depend on them).
ALTER TABLE public.lists DROP COLUMN IF EXISTS trip_mode_enabled;
ALTER TABLE public.lists DROP COLUMN IF EXISTS trip_mode_grace_days;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS experienced_at;
ALTER TABLE public.check_ins DROP COLUMN IF EXISTS matched_candidate_visit_id;

COMMIT;

-- Verification (read-only, safe to run any time after applying):
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'prevent_expired_list_checkins';
-- SELECT column_name FROM information_schema.columns WHERE table_schema='public'
--   AND (column_name LIKE 'trip_mode%' OR column_name IN ('experienced_at','matched_candidate_visit_id'));
-- expect 0 rows.
