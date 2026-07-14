-- ============================================================
-- Destination / Zone / Hub foundation
-- 2026-07-12
--
-- ⚠️  BEFORE APPLYING: take a database snapshot / point-in-time
-- backup checkpoint. This migration is additive-only and should be
-- safely reversible on its own (see the approved architecture plan),
-- but always checkpoint before a structural change touching
-- destination_zones.
--
-- Introduces the Destination/Hub layer above destination_zones, per
-- the approved architecture plan and sign-off decisions:
--
--   - destinations: new parent entity above zones. is_active is a
--     plain flag — NOT derived/rolled up from destination_partners.
--     destination_zones.is_active remains the sole visibility gate
--     for the GPS banner; nothing in this migration changes that.
--   - destination_partners: chamber/city/individual sponsorship
--     records per destination. Deny-all RLS from day one — same
--     lesson as the city_partnerships lockdown (see
--     20260712_city_partnerships_lockdown.sql), since this table
--     holds contract_status/billing_tier, comparable in sensitivity.
--     Carries a nullable city_partnership_id FK so a destination
--     partner can optionally link to the existing internal sales
--     record in city_partnerships, without duplicating any
--     contact/billing/stripe fields onto this table.
--   - destination_lists: many-to-many between destinations and
--     lists, replacing the single scalar destination_zones.list_id.
--   - destination_zones gains a nullable destination_id FK,
--     backfilled from existing rows, then tightened to NOT NULL.
--     destination_zones.list_id is intentionally left in place and
--     UNTOUCHED — dropping it is a separate, later migration, once
--     HomeScreen.jsx / ListScreen.jsx have been updated and verified
--     to read through destination_lists instead.
--
-- No application code changes ship with this migration. Willcox's
-- current single-list behavior is carried forward unchanged: its one
-- destination_zones row gets exactly one destinations row and
-- exactly one destination_lists row pointing at the same list it
-- points at today. Zero destination_partners rows are fabricated —
-- none exist for Willcox today.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. destinations
-- ────────────────────────────────────────────────────────────

CREATE TABLE destinations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  description     text,
  hero_image_url  text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE destinations ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 2. destination_partners
-- ────────────────────────────────────────────────────────────

CREATE TABLE destination_partners (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id        uuid NOT NULL REFERENCES destinations(id),
  -- Assumes city_partnerships.id is a uuid PK, matching the
  -- convention used by every other table in this schema.
  city_partnership_id   uuid REFERENCES city_partnerships(id),
  org_name              text NOT NULL,
  org_type              text NOT NULL CHECK (org_type IN ('chamber', 'city', 'interest_group', 'individual')),
  contract_status       text NOT NULL DEFAULT 'active' CHECK (contract_status IN ('active', 'cancelled', 'lapsed')),
  billing_tier          text,
  start_date            date,
  end_date              date
);

CREATE INDEX idx_destination_partners_destination_id      ON destination_partners(destination_id);
CREATE INDEX idx_destination_partners_city_partnership_id ON destination_partners(city_partnership_id);

ALTER TABLE destination_partners ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 3. destination_lists
-- ────────────────────────────────────────────────────────────

CREATE TABLE destination_lists (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id      uuid NOT NULL REFERENCES destinations(id),
  list_id             uuid NOT NULL REFERENCES lists(id),
  owner_partner_id    uuid REFERENCES destination_partners(id),
  relationship_type   text NOT NULL DEFAULT 'primary' CHECK (relationship_type IN ('primary', 'featured', 'seasonal', 'nearby', 'cross_promoted')),
  sort_order          integer NOT NULL DEFAULT 0,
  is_featured         boolean NOT NULL DEFAULT false,
  visible_from        timestamptz,
  visible_until       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (destination_id, list_id)
);

CREATE INDEX idx_destination_lists_destination_id   ON destination_lists(destination_id);
CREATE INDEX idx_destination_lists_list_id          ON destination_lists(list_id);
CREATE INDEX idx_destination_lists_owner_partner_id ON destination_lists(owner_partner_id);

ALTER TABLE destination_lists ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- 4/5. Backfill
--
-- One destinations row per existing destination_zones row, one
-- destination_lists row per existing destination_zones.list_id.
-- Zero destination_partners rows are fabricated.
--
-- _migration_source_zone_id is a temporary scratch column used only
-- to correlate freshly-inserted destinations rows back to their
-- source destination_zones rows within this migration. It is dropped
-- at the end of this section, before destination_id is added to
-- destination_zones — it is not part of the final schema.
-- ────────────────────────────────────────────────────────────

ALTER TABLE destinations ADD COLUMN _migration_source_zone_id uuid;

INSERT INTO destinations (name, slug, is_active, _migration_source_zone_id)
SELECT dz.name, dz.slug, true, dz.id
FROM destination_zones dz;

INSERT INTO destination_lists (destination_id, list_id, relationship_type, is_featured, sort_order)
SELECT d.id, dz.list_id, 'primary', true, 0
FROM destination_zones dz
JOIN destinations d ON d._migration_source_zone_id = dz.id
WHERE dz.list_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────
-- 6. destination_zones.destination_id
--
-- Added nullable, backfilled, then tightened to NOT NULL.
-- destination_zones.list_id is left in place, untouched (see header).
-- ────────────────────────────────────────────────────────────

ALTER TABLE destination_zones ADD COLUMN destination_id uuid REFERENCES destinations(id);

UPDATE destination_zones dz
SET destination_id = d.id
FROM destinations d
WHERE d._migration_source_zone_id = dz.id;

ALTER TABLE destination_zones ALTER COLUMN destination_id SET NOT NULL;

CREATE INDEX idx_destination_zones_destination_id ON destination_zones(destination_id);

-- Scratch column no longer needed now that the backfill is complete.
ALTER TABLE destinations DROP COLUMN _migration_source_zone_id;


-- ────────────────────────────────────────────────────────────
-- 7. RLS policies
-- ────────────────────────────────────────────────────────────

-- destinations: mirrors the existing destination_zones is_active=true
-- pattern, including Jerry's testing bypass. is_active here is a
-- plain flag with no rollup logic — nothing recomputes it from
-- destination_partners.contract_status (sign-off decision).
CREATE POLICY "Active destinations are viewable by everyone"
ON destinations FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Jerry can view all destinations for testing"
ON destinations FOR SELECT
TO authenticated
USING (auth.uid() = '11275026-65be-4421-80a4-46c57195408b');

-- destination_lists: visible only within its own visibility window.
-- Deliberately not gated on destinations.is_active or
-- destination_zones.is_active — destination_zones.is_active alone
-- still gates the GPS banner; this table isn't in that read path yet.
CREATE POLICY "Visible destination_lists rows are viewable by everyone"
ON destination_lists FOR SELECT
TO anon, authenticated
USING (
  (visible_from IS NULL OR visible_from <= now())
  AND (visible_until IS NULL OR visible_until >= now())
);

CREATE POLICY "Jerry can view all destination_lists rows for testing"
ON destination_lists FOR SELECT
TO authenticated
USING (auth.uid() = '11275026-65be-4421-80a4-46c57195408b');

-- destination_partners: deny-all for anon/authenticated, matching the
-- city_partnerships convention exactly. service_role (the admin tool)
-- bypasses RLS entirely and is unaffected.
CREATE POLICY "destination_partners: service role only"
ON destination_partners FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);
