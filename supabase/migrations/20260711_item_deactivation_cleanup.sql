-- ============================================================
-- Fix item deactivation so it cleanly "retires" an item
-- 2026-07-11
--
-- Previously, setting items.is_active = false silently blanked the
-- item's content for EVERYONE via RLS -- including users who had
-- already checked it off -- rather than cleanly retiring it. It also
-- didn't reduce a list's item count/cap, and nothing blocked a fresh
-- check-in on an already-inactive item.
--
-- Three fixes:
--   1. New SELECT policy on items: a user can still read full item
--      content for an inactive item if they have a check_ins row
--      referencing it (combines via OR with the existing
--      "public read active" policy).
--   2. (App-side, not in this file) useItems.js now selects is_active
--      and filters out inactive+unchecked rows, so the list's total
--      count/cap only reflects active-or-checked items.
--   3. prevent_expired_list_checkins() now also rejects a check-in
--      if the referenced item is inactive. Marked SECURITY DEFINER so
--      the guard sees the item's true is_active value regardless of
--      the caller's own RLS visibility into items (a user who's never
--      checked off an inactive item can't normally read it at all).
-- ============================================================

CREATE POLICY "items: read own checked-off history even if inactive"
ON items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM check_ins ci
    JOIN list_items li ON li.id = ci.list_item_id
    WHERE li.item_id = items.id AND ci.user_id = auth.uid()
  )
);

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
