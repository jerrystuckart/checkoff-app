-- ============================================================
-- Backfill check_ins.item_id for rows created without it
-- 2026-07-20
--
-- Root cause: 20260716_list_deletion_fk_fixes.sql added check_ins.item_id
-- and backfilled every row that existed at the time, but two check-off
-- insert call sites in ItemDetailScreen.jsx (the tap check-off paths,
-- with and without a list picker) never set item_id on INSERT — only
-- lib/useItems.js's checkOff and PhotoCheckInScreen.jsx's photo
-- check-off did. Both ItemDetailScreen call sites were fixed in the app
-- (2026-07-20) to always set item_id going forward; this migration
-- backfills every row inserted between the July 16 migration and that
-- app fix landing.
--
-- Impact of the gap: ProfileScreen.jsx and BadgesScreen.jsx both join
-- items(body) through check_ins.item_id for recent-activity and badge
-- detail display — rows with a null item_id render blank item names
-- there today. This is a live bug, independent of any other work.
--
-- No trigger changes needed here: prevent_expired_list_checkins()
-- already exempts updates that change only list_item_id/item_id with
-- every substantive check-in field unchanged (added in the July 16
-- migration), which is exactly what this UPDATE does.
--
-- Run the pre-check SELECT first to see how many rows are affected
-- before running the UPDATE.
-- ============================================================

-- ── Pre-check: how many rows need backfilling ───────────────────────
SELECT count(*) AS rows_missing_item_id
FROM check_ins
WHERE item_id IS NULL
  AND list_item_id IS NOT NULL;

-- ── Backfill — same pattern as 20260716_list_deletion_fk_fixes.sql ──
UPDATE check_ins ci
SET item_id = li.item_id
FROM list_items li
WHERE li.id = ci.list_item_id
  AND ci.item_id IS NULL;

-- ── Post-check: rows that still couldn't be resolved ────────────────
-- Expected to be non-zero: rows whose list_item_id is already null
-- (list deleted before this ran) or whose list_items row itself has a
-- null item_id. These can't be resolved from list_item_id at all.
SELECT count(*) AS rows_still_null
FROM check_ins
WHERE item_id IS NULL;
