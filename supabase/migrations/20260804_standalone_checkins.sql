-- ============================================================
-- Standalone check-ins — P0 fix
-- 2026-08-04
--
-- Root cause: ItemDetailScreen.jsx / PhotoCheckInScreen.jsx required an
-- active, joined list_item_id before a check-off would even be attempted
-- ("Join a list first"), even though check_ins.list_item_id has been
-- nullable since 20260716_list_deletion_fk_fixes.sql and check_ins.item_id
-- has been the canonical item reference since the same migration. That
-- app-layer gate is fixed separately (screens/ItemDetailScreen.jsx,
-- screens/PhotoCheckInScreen.jsx, lib/checkInFanOut.js,
-- lib/joinListCredit.js) — this migration closes the two DB-level gaps
-- that fix exposes:
--
-- 1. Duplicate prevention gap: fan-out/dedup relies on a unique index on
--    (user_id, list_item_id). Postgres unique indexes treat every NULL as
--    distinct from every other NULL, so that index does NOT stop a user
--    from repeatedly inserting standalone (list_item_id IS NULL) check-ins
--    for the same item — unlimited point farming today, once the app can
--    insert them at all. Fixed with a partial unique index scoped to
--    exactly the null-list_item_id case.
--
-- 2. Validation gap: prevent_expired_list_checkins() resolves list/item
--    active-status entirely through list_items via NEW.list_item_id. With
--    list_item_id NULL, every one of those subqueries returns NULL, and
--    every guard below is written as "IF x IS NOT NULL AND ..." — so they
--    all silently no-op. A standalone check-in today would bypass the
--    is_active check on the item entirely. Fixed by adding a standalone
--    branch that validates items.is_active directly via NEW.item_id, plus
--    a NOT NULL guard so a row with neither reference can't be inserted at
--    all (a row that resolves to no item is meaningless and must be
--    rejected, not silently accepted).
--
-- Nothing here changes column nullability or existing data — both changes
-- below are new constraints/logic layered on top of the existing schema.
-- ============================================================

-- ── STEP 0 (READ-ONLY — RUN THIS FIRST, BEFORE STEP 1) ──────────────────
-- The partial unique index in step 1 will fail to create if any duplicate
-- standalone rows already exist. This is a pure SELECT — it changes
-- nothing. If it returns zero rows, step 1 is safe to run as-is. If it
-- returns rows, STOP: do not run step 1 until those duplicates are
-- reviewed and resolved by hand (this migration deliberately does not
-- delete or modify any existing row).
SELECT
  user_id,
  item_id,
  count(*)          AS duplicate_count,
  array_agg(id ORDER BY checked_at) AS check_in_ids,
  array_agg(checked_at ORDER BY checked_at) AS checked_at_values,
  sum(points_awarded) AS total_points_awarded_across_duplicates
FROM check_ins
WHERE list_item_id IS NULL
GROUP BY user_id, item_id
HAVING count(*) > 1;

-- ── STEP 1: partial unique index — standalone duplicate prevention ──────
-- Only applies to list_item_id IS NULL rows; the existing (user_id,
-- list_item_id) uniqueness for list-attached rows is untouched.
CREATE UNIQUE INDEX IF NOT EXISTS check_ins_standalone_user_item_unique
ON check_ins (user_id, item_id)
WHERE list_item_id IS NULL;

-- ── STEP 2: prevent_expired_list_checkins() — standalone branch ─────────
CREATE OR REPLACE FUNCTION public.prevent_expired_list_checkins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  list_starts date;
  list_ends   date;
  item_is_active boolean;
  dest_list_active boolean;
BEGIN
  -- System-driven reference changes (item_id backfills, and defensively,
  -- any future cascade-driven list_item_id nulling) are not a check-in
  -- action and must never be blocked by these checks. Exempt any UPDATE
  -- where every substantive check-in field is unchanged -- only
  -- list_item_id/item_id may differ.
  IF TG_OP = 'UPDATE'
     AND NEW.user_id        IS NOT DISTINCT FROM OLD.user_id
     AND NEW.checkin_method IS NOT DISTINCT FROM OLD.checkin_method
     AND NEW.points_awarded IS NOT DISTINCT FROM OLD.points_awarded
     AND NEW.checked_at     IS NOT DISTINCT FROM OLD.checked_at
     AND NEW.personal_place IS NOT DISTINCT FROM OLD.personal_place
     AND NEW.personal_note  IS NOT DISTINCT FROM OLD.personal_note
  THEN
    RETURN NEW;
  END IF;

  -- A row that resolves to no item at all is meaningless -- reject it
  -- outright rather than silently accepting an orphaned check-in. Every
  -- real check-in path (standalone or list-attached) always sets item_id.
  IF NEW.list_item_id IS NULL AND NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'A check-in must reference either a list item or an item.';
  END IF;

  -- ── Standalone check-in (no list context): validate the item directly ──
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

  -- ── List-attached check-in: existing list/partnership/item checks ──────
  SELECT starts_at, ends_at
  INTO list_starts, list_ends
  FROM lists
  WHERE id = (
    SELECT list_id FROM list_items WHERE id = NEW.list_item_id
  );

  IF list_ends IS NOT NULL AND (now() AT TIME ZONE 'America/Phoenix')::date > list_ends THEN
    RAISE EXCEPTION 'This list has ended. Check-ins can no longer be changed.';
  END IF;

  IF list_starts IS NOT NULL AND (now() AT TIME ZONE 'America/Phoenix')::date < list_starts THEN
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
