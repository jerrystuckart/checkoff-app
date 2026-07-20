-- ============================================================
-- Curated overlay Phase 3 — single-market list -> curated_list_metros
-- 2026-07-17
--
-- 11 genuinely single-market lists (no Phoenix/Milwaukee duplicate to
-- merge with) get exactly one curated_list_metros row each, marking
-- them visible only in their existing metro. No item changes.
-- ============================================================

BEGIN;

INSERT INTO curated_list_metros (curated_list_id, city_slug) VALUES
  ('81572b9b-4eb2-4a2c-b395-63f9cf741517', 'milwaukee'),  -- ☀️ Lake Effect Locals · Summer 2026
  ('1cc1a75c-b869-42cf-b809-cc8ef386b97d', 'milwaukee'),  -- Madison State Street Drift
  ('d45bf430-3b25-44ae-8fd6-97724f750f86', 'tucson'),     -- Mercado District
  ('a0ab709f-3b4f-4efc-b2b7-8813178f035b', 'phoenix'),    -- Phoenix Hidden Gems
  ('186e6c04-19f8-4093-ae6b-d5cf5ae2f627', 'phoenix'),    -- Rediscover Downtown Peoria
  ('6d369d28-26dc-476e-8a43-34b50703a3d4', 'milwaukee'),  -- The Dells Dive-In
  ('0abc58b1-48f2-4454-9f23-5f686572a6a5', 'milwaukee'),  -- The Door County Detour
  ('56789554-8c13-4af5-a826-67a9b77b4c4b', 'milwaukee'),  -- The Green Bay Leap
  ('a1000000-0000-0000-0000-000000000011', 'phoenix'),    -- The Heat Refugees · Summer 2026
  ('e91911da-5d53-47ed-b8a5-b3c57b5e81c8', 'tucson'),     -- Tucson Hidden Bars
  ('c79e270f-b342-4fb8-b99d-097c18713255', 'phoenix')     -- West Valley's Best
ON CONFLICT (curated_list_id, city_slug) DO NOTHING;

COMMIT;
