-- ============================================================
-- lists.source_destination_list_id
-- 2026-07-14
--
-- Tags a personal list as having been copied from a specific
-- destination_lists row (the "official" shared list a Destination
-- Hub points at, e.g. Willcox Wine Trail). This replaces the
-- shared-list-membership model HubScreen currently uses
-- (list_members upsert onto the one shared list) with a
-- personal-copy model: each visitor gets their own list, auto-named
-- and dated, with items bulk-copied in — no manual steps.
--
-- This single nullable FK is what makes everything downstream work
-- without extra scoping logic:
--   - Re-visit detection: look up an existing list where
--     source_destination_list_id = this destination_lists.id,
--     creator_id = the user, and ends_at is still in the future.
--   - Check-in freezing on partner cancellation: resolve a list's
--     source_destination_list_id -> destination_lists.is_active.
--     A list without this pointer (manual lists, curated-template
--     adoptions, etc.) can never be reached by this check — the FK
--     itself is the scope boundary, no separate carve-out needed.
--   - ListScreen's "View Destination Hub" button: personal copies
--     get their own new list_id, so the button's existing direct
--     list_id -> destination_lists lookup no longer resolves for
--     them. It should resolve via source_destination_list_id ->
--     destination_lists.destination_id instead once the code lands.
--
-- No backfill needed: nothing existing should have this set. The
-- one live shared list (Willcox Wine Trail, bbd16ea1-...) stays
-- exactly as it is -- it is not itself a personal copy, it is the
-- destination_lists-linked source that future personal copies will
-- be copied FROM.
--
-- Both statements use IF NOT EXISTS: the ALTER TABLE below already
-- succeeded on an earlier run of this file (confirmed via a
-- read-only query — the column exists and returns null on the one
-- existing list), before something interrupted the run before the
-- CREATE INDEX line executed. Made idempotent so this file is safe
-- to run again regardless of exactly where the earlier run stopped.
-- ============================================================

ALTER TABLE lists
ADD COLUMN IF NOT EXISTS source_destination_list_id uuid REFERENCES destination_lists(id);

CREATE INDEX IF NOT EXISTS idx_lists_source_destination_list_id ON lists(source_destination_list_id);
