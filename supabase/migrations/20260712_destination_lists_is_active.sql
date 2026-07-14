-- ============================================================
-- destination_lists.is_active — soft-deactivation support
-- 2026-07-12
--
-- destination_lists had no way to represent "this list linkage is
-- currently deactivated" separately from visible_from/visible_until,
-- which are for scheduled/seasonal content, not partner-cancellation
-- state. Conflating the two would make it impossible to later
-- distinguish "seasonally hidden" from "deactivated because the
-- owning partner cancelled" — so this adds a dedicated column
-- instead of repurposing the visibility-window fields.
--
-- This is the storage this migration adds; it does not wire up the
-- actual soft-deactivation flow. A future admin-tool action
-- (cancelling a destination_partners row) is expected to set
-- is_active = false on the destination_lists rows it owns
-- (owner_partner_id) — no trigger/automation is added here, and no
-- destination_partners/destinations/app-code changes are made by
-- this migration.
--
-- No backfill needed beyond the column default: the existing Willcox
-- row ends up is_active = true, identical to its current effective
-- (fully visible) state.
-- ============================================================

ALTER TABLE destination_lists
ADD COLUMN is_active boolean NOT NULL DEFAULT true;

DROP POLICY "Visible destination_lists rows are viewable by everyone" ON destination_lists;

CREATE POLICY "Visible destination_lists rows are viewable by everyone"
ON destination_lists FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND (visible_from IS NULL OR visible_from <= now())
  AND (visible_until IS NULL OR visible_until >= now())
);
