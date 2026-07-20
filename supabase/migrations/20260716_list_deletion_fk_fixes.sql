-- ============================================================
-- Fix user list deletion — FK constraints + check-in continuity
-- 2026-07-16
--
-- Root cause of the original bug: interaction_events_list_id_fkey is
-- ON DELETE NO ACTION, blocking deletion of any list that was ever
-- simply viewed (trackEvent.js logs a debounced 'list_view' event on
-- open, independent of check-ins).
--
-- A full information_schema audit of every FK referencing lists(id)
-- found that 5 of the other tables originally suspected as broken
-- (dares, item_flags, list_items, list_members,
-- user_suggestion_list_items) are ALREADY correctly configured
-- (SET NULL / CASCADE as appropriate) — not touched here, changing
-- them would be pure churn against constraints that are already
-- right. destination_zones/destination_lists are also confirmed
-- NO ACTION and deliberately left that way — they're the intentional
-- guard protecting Destination Hub content from deletion via a
-- user-owned-list path. A previously-undiscovered season_waitlist
-- table is also already correctly CASCADE; not touched.
--
-- Two things ARE necessary beyond interaction_events:
--
-- 1. check_ins_list_item_id_fkey is currently CASCADE (confirmed via
--    the same audit) — meaning today, deleting a list cascades through
--    list_items and DELETES every check_ins row for it outright,
--    destroying check-in history and points. Changed to SET NULL so
--    check-in history and points survive; only the list_item
--    reference is severed. list_item_id must become nullable for this
--    (it was never previously nullable — CASCADE never needed to null
--    it, it deleted the row instead).
--
-- 2. check_ins never had a direct item_id column — only list_item_id
--    (-> list_items -> items, two hops). Once list_item_id can go
--    null, that indirect path to "what item was this" breaks. Adds a
--    direct check_ins.item_id -> items.id column (ON DELETE NO ACTION
--    -- items are never hard-deleted, per the existing item
--    deactivation model, so this should never actually fire) and
--    backfills it from the current list_items join before anything
--    else changes, while all existing list_item_id values still
--    resolve.
--
-- prevent_expired_list_checkins() also needs one addition: the
-- backfill UPDATE above (and, defensively, any future system-driven
-- reference change) must not be blocked by the ended-list check --
-- confirmed empirically, the backfill failed against check_ins rows
-- on already-ended lists before this fix. Added an exemption: an
-- UPDATE that changes only list_item_id/item_id, with every
-- substantive check-in field (user_id, checkin_method, points_awarded,
-- checked_at, personal_place, personal_note) unchanged, skips all
-- validation and returns immediately. A genuine check/uncheck action
-- always changes at least one of those fields, so this can't be used
-- to sneak a real check-in past the guards -- it only exempts changes
-- that aren't a check-in action at all.
-- ============================================================

-- ── 1. interaction_events: the actual reported bug ──────────────────

ALTER TABLE interaction_events
DROP CONSTRAINT interaction_events_list_id_fkey;

ALTER TABLE interaction_events
ADD CONSTRAINT interaction_events_list_id_fkey
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE SET NULL;

-- ── 2. check_ins.item_id: new direct column, backfilled ─────────────

ALTER TABLE check_ins
ADD COLUMN item_id uuid REFERENCES items(id);

-- ── 3. Trigger exemption — must land before the backfill runs ───────

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
  -- System-driven reference changes (the item_id backfill below, and
  -- defensively, any future cascade-driven list_item_id nulling) are
  -- not a check-in action and must never be blocked by these checks.
  -- Exempt any UPDATE where every substantive check-in field is
  -- unchanged -- only list_item_id/item_id may differ.
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

-- ── 4. Backfill item_id from the current list_items join ────────────
-- Safe now: no list has been deleted yet (that's the whole bug this
-- migration fixes), so every existing list_item_id still resolves.

UPDATE check_ins ci
SET item_id = li.item_id
FROM list_items li
WHERE li.id = ci.list_item_id
  AND ci.item_id IS NULL;

-- ── 5. check_ins_list_item_id_fkey: CASCADE -> SET NULL ──────────────
-- Must come after the backfill (needs the join above intact) and
-- after the trigger fix (this ALTER itself doesn't fire the trigger,
-- but every future list deletion's cascade will).

ALTER TABLE check_ins
ALTER COLUMN list_item_id DROP NOT NULL;

ALTER TABLE check_ins
DROP CONSTRAINT check_ins_list_item_id_fkey;

ALTER TABLE check_ins
ADD CONSTRAINT check_ins_list_item_id_fkey
  FOREIGN KEY (list_item_id) REFERENCES list_items(id) ON DELETE SET NULL;
