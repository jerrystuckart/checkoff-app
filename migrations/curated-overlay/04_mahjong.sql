-- ============================================================
-- Curated overlay Phase 3 — Mahjong Starter Pack item classification
-- 2026-07-17
--
-- Already list-level universal (no city_slug on the curated_lists row,
-- no curated_list_metros rows). 12 of 13 items are is_universal=true
-- and stay city_slug NULL by default (no-op, already NULL). The one
-- Phoenix-specific item ('85 Local' game store, resolves via
-- neighborhood_id -> metro_areas.slug='phoenix') gets tagged.
-- ============================================================

BEGIN;

UPDATE curated_list_items
SET city_slug = 'phoenix'
WHERE id = '949d0455-c988-4734-bb97-97197be7134b';

COMMIT;
