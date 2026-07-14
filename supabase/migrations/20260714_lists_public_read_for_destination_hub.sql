-- ============================================================
-- lists: public read for Destination Hub content
-- 2026-07-14
--
-- Willcox's shared list (and any list like it) isn't covered by any
-- existing lists RLS policy: the current public-read gate is
-- is_public = true (confirmed empirically — an unfiltered anon read
-- of lists returns only is_public=true rows, and Willcox's list
-- returns zero rows under any column selection), and this list was
-- deliberately created with is_public = false, since the old design
-- only ever exposed it via list_members membership after an explicit
-- join. Now that HubScreen reads a destination's linked list directly
-- (title, to render the list card) before anyone has joined or copied
-- it, that list needs to be readable independent of is_public.
--
-- This is purely additive: a new SELECT policy, not a change to any
-- existing one. RLS policies OR together, so this can only widen
-- visibility, never narrow it. It's scoped narrowly to lists that are
-- actually backing a currently-visible Destination Hub entry — the
-- EXISTS subquery mirrors destination_lists' own existing visibility
-- condition (is_active = true + visibility window) exactly, so a list
-- only becomes readable this way for as long as its destination_lists
-- row would itself be visible in the Hub. A personal list, a curated-
-- template adoption, or any other list with no destination_lists row
-- pointing at it is completely untouched — the EXISTS clause is false
-- for all of them, so every existing protection stays exactly as it
-- is today.
--
-- Note: RLS is row-level, not column-level — this makes the whole
-- lists row readable (not just title) once the condition is met, same
-- as every other "publicly readable" policy in this schema. Nothing
-- on lists is sensitive enough to warrant column-level restriction
-- here (invite_code becomes visible too, but it's meant to be
-- shareable for joining and grants no elevated access beyond what the
-- existing join-list flow already does).
-- ============================================================

CREATE POLICY "lists: publicly viewable when backing a visible Destination Hub entry"
ON lists FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM destination_lists dl
    WHERE dl.list_id = lists.id
      AND dl.is_active = true
      AND (dl.visible_from IS NULL OR dl.visible_from <= now())
      AND (dl.visible_until IS NULL OR dl.visible_until >= now())
  )
);
