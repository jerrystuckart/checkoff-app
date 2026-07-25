-- ============================================================
-- Add Tucson promotion for Willcox Wine Trail
-- 2026-07-21
--
-- Willcox's metro_destinations row for Tucson Metro already exists
-- (~67mi, ~80min drive) but was never linked via metro_destination_lists,
-- so Tucson users have had no path to the Wine Trail from their
-- Destinations screen while Phoenix users (~154mi, ~185min — objectively
-- the farther, less sensible drive) have since 2026-07-14. This mirrors
-- Phoenix's active row exactly, pointing at the same destination_lists
-- row (the "Willcox Wine Trail · Anytime 2026" list) so both metros
-- promote the identical experience.
--
-- sort_order = 0 is safe: confirmed Willcox is currently the ONLY
-- destination promoted to Tucson at all (no other metro_destinations
-- rows exist for Tucson Metro), so there is nothing to collide with.
--
-- Also confirmed while investigating: Willcox's metro_destinations row
-- for Milwaukee Metro (~1,405mi, bulk-generated distance/drive-time, not
-- curated) has zero metro_destination_lists rows referencing it — it was
-- never promoted/activated. Nothing to remove there; flagging only as
-- confirmation this insert doesn't need a companion cleanup.
-- ============================================================

-- ── Pre-check: confirm Phoenix's active row + the Tucson gap ────────
SELECT id, metro_destination_id, destination_list_id, sort_order, is_active
FROM metro_destination_lists
WHERE id = 'a15485ec-f21c-4c37-b1ba-1f24a134826f';
-- expected: metro_destination_id = c51e906f-... (Phoenix), destination_list_id = 10e83da7-...

SELECT *
FROM metro_destination_lists
WHERE metro_destination_id = 'df52ce5e-765f-40ea-adf1-62a1a0d174fd';
-- expected: zero rows (the gap this migration closes)

-- ── Insert the Tucson row ────────────────────────────────────────────
INSERT INTO metro_destination_lists (metro_destination_id, destination_list_id, sort_order, is_active)
VALUES (
  'df52ce5e-765f-40ea-adf1-62a1a0d174fd', -- Willcox x Tucson Metro (metro_destinations)
  '10e83da7-912b-4ca5-925f-8ef491c239ca', -- "Willcox Wine Trail · Anytime 2026" (destination_lists) — same list Phoenix's row points at
  0,
  true
);

-- ── Post-check ────────────────────────────────────────────────────────
SELECT mdl.id, mdl.sort_order, mdl.is_active, ma.name AS metro_name
FROM metro_destination_lists mdl
JOIN metro_destinations md ON md.id = mdl.metro_destination_id
JOIN metro_areas ma ON ma.id = md.metro_id
WHERE mdl.destination_list_id = '10e83da7-912b-4ca5-925f-8ef491c239ca';
-- expected: two rows now — Phoenix Metro and Tucson Metro, both is_active = true
