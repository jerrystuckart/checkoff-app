-- ============================================================
-- Curated list metro-overlay model — Phase 1: schema
-- 2026-07-17
--
-- One curated list can be universal (no curated_list_metros rows) or
-- scoped to specific metros (one row per metro). Within any list, each
-- item is universal (city_slug NULL) or metro-specific (city_slug set).
--
-- Additive only — no data touched, no existing behavior changes.
-- With city_slug NULL everywhere and no curated_list_metros rows yet,
-- every Phase 4 filter added on top of this degrades to "show
-- everything," identical to today, until Phase 3 populates real values.
--
-- RLS on curated_list_metros mirrors curated_lists' admin-write policy
-- exactly (auth.uid() -> public.users.is_admin check). For the public
-- read side, curated_lists actually carries two overlapping SELECT
-- policies today (one gated on is_active=true, one USING(true) that
-- makes the gate a no-op since permissive RLS policies OR together) —
-- curated_list_metros has no is_active column to gate on in the first
-- place, so it gets the single USING(true) form, matching the
-- practical (not just literal) effect of curated_lists' read access.
-- ============================================================

ALTER TABLE curated_list_items ADD COLUMN IF NOT EXISTS city_slug text DEFAULT NULL;
ALTER TABLE list_items         ADD COLUMN IF NOT EXISTS city_slug text DEFAULT NULL;

CREATE TABLE IF NOT EXISTS curated_list_metros (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curated_list_id  uuid NOT NULL REFERENCES curated_lists(id),
  city_slug        text NOT NULL,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (curated_list_id, city_slug)
);

ALTER TABLE curated_list_metros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "curated_list_metros: public read"
ON curated_list_metros FOR SELECT
USING (true);

CREATE POLICY "curated_list_metros: admin write"
ON curated_list_metros FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid() AND users.is_admin = true
  )
);

CREATE INDEX IF NOT EXISTS idx_curated_list_items_list_city
  ON curated_list_items (curated_list_id, city_slug);

CREATE INDEX IF NOT EXISTS idx_curated_list_metros_list
  ON curated_list_metros (curated_list_id);
