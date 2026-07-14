-- ============================================================
-- Freeze check-ins when a destination partner cancels
-- 2026-07-14
--
-- Server-side backstop for the new personal-copy Hub model: when a
-- personal list was copied from a destination's list
-- (lists.source_destination_list_id -> destination_lists.id) and that
-- destination_lists row is is_active = false (its owning partner
-- cancelled), block any NEW check-in on that list. This is a backstop,
-- not the primary UX — ListScreen already greys out the checkbox for
-- unchecked items client-side. This exists for the same reason the
-- list-window and item-active checks below are already enforced here:
-- a stale client shouldn't be able to write around it.
--
-- A list with no source_destination_list_id (manual lists, curated-
-- template adoptions, the original shared list, etc.) is completely
-- unaffected — the subquery below returns NULL for those, and
-- "NULL IS FALSE" is NULL, not TRUE, so the RAISE never fires. No
-- separate scoping logic needed; the FK itself is the boundary.
--
-- Only NEW check-ins are blocked. Un-checking an already-checked item
-- is also blocked once frozen (matching how the existing ended-list
-- check already freezes both directions, not just new check-ins) —
-- items checked before cancellation stay exactly as they are,
-- untouched, with no path to alter them afterward.
-- ============================================================

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
