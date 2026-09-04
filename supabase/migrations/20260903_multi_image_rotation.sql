-- Multi-Image Rotation for Item Covers (2026-09-03).
--
-- Additive schema change to item_cover_candidates — no new table, no
-- duplicate image system. Three DISTINCT, previously-conflated concepts
-- now have their own columns, per the explicit product requirement:
--   status (existing)   -- safe/relevant/allowed (moderation lifecycle)
--   display_eligible     -- good enough to actually show publicly
--   is_primary           -- the one preferred/weighted image, if any
-- `status = 'selected'` keeps its existing meaning (this candidate is/was
-- chosen as the item's primary) — it is NOT removed or repurposed, just
-- no longer the ONLY signal display code reads. display_eligible is the
-- new gate every resolver/RLS check actually uses, so a future item can
-- have several display_eligible candidates with only one status='selected'
-- (the current primary).
--
-- BACKWARD COMPATIBILITY / LEAST DISRUPTIVE PATH: items.active_cover_
-- candidate_id remains the primary pointer (not deprecated) — the
-- migration below backfills exactly the rows it currently points to as
-- display_eligible + is_primary, so the 3 real production covers (Red
-- Zone, Doaky, 85 Local) migrate with zero behavior change. Every future
-- primary change (agent-service's setPrimaryImage) keeps both in sync in
-- the same transaction — there is deliberately no DB trigger for this;
-- the sync logic lives in one reviewable place (setPrimaryImage), same
-- style as this codebase's other mutation code (see mutations.ts).
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration file in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260903_multi_image_rotation.sql --linked

BEGIN;

ALTER TABLE item_cover_candidates
  ADD COLUMN IF NOT EXISTS display_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  -- Simple positive integer weight — NOT a ranking/ML score. Primary
  -- preference is applied as a multiplier on top of this in the resolver
  -- (lib/whatsGoodImageSource.js), not stored as a separate "is_primary
  -- weight" column, so there is exactly one weight number per row to
  -- reason about.
  ADD COLUMN IF NOT EXISTS display_weight integer NOT NULL DEFAULT 1;

ALTER TABLE item_cover_candidates
  ADD CONSTRAINT item_cover_candidates_display_weight_positive CHECK (display_weight > 0);

-- Primary implies display-eligible — a row can never be the preferred
-- image while also being excluded from the pool it's supposedly
-- preferred within.
ALTER TABLE item_cover_candidates
  ADD CONSTRAINT item_cover_candidates_primary_requires_display_eligible
  CHECK (NOT is_primary OR display_eligible);

-- At most one primary per item — declarative, not application-enforced
-- only. A partial unique index (not a full UNIQUE(item_id, is_primary),
-- which would also force at most one is_primary=false row per item,
-- which is not what's wanted).
CREATE UNIQUE INDEX IF NOT EXISTS item_cover_candidates_one_primary_per_item
  ON item_cover_candidates (item_id) WHERE is_primary;

-- Fast pool lookups ("give me every display-eligible row for these item
-- ids") — the query every Home-rail load will run.
CREATE INDEX IF NOT EXISTS item_cover_candidates_display_pool_idx
  ON item_cover_candidates (item_id) WHERE display_eligible;

-- Backfill: every candidate currently pointed to by an item's
-- active_cover_candidate_id becomes display_eligible + is_primary. This
-- is the ONLY backfill — no other existing row (needs_review, approved,
-- cover_eligible-but-never-selected, rejected) becomes display_eligible
-- automatically. "Approved does NOT automatically mean display eligible"
-- is enforced from the very first migration run, not just in future code.
UPDATE item_cover_candidates c
SET display_eligible = true, is_primary = true
FROM items i
WHERE i.active_cover_candidate_id = c.id;

-- ---------------------------------------------------------------------------
-- RLS — narrow, targeted update. The existing "selected covers are public"
-- policies (added 2026-09-03, see 20260903_selected_cover_public_read.sql)
-- checked status = 'selected'. That's now too narrow: a display-eligible
-- ROTATION-POOL image that is NOT (yet, or ever) the primary must also be
-- publicly readable, or resolvedItemImages() would only ever be able to
-- resolve one image per item regardless of how many are in the pool.
-- Replaced with display_eligible = true — a strict superset of the old
-- check (every 'selected' row is backfilled display_eligible=true above),
-- so no currently-public image becomes newly private. Pending/rejected/
-- approved-but-not-yet-display-eligible rows remain exactly as private as
-- before — this does not touch the submitter/admin-only policies at all.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS item_cover_candidates_select_selected_public ON item_cover_candidates;
CREATE POLICY item_cover_candidates_select_selected_public ON item_cover_candidates
  FOR SELECT USING (display_eligible = true);

DROP POLICY IF EXISTS "anyone can view selected cover photos" ON storage.objects;
CREATE POLICY "anyone can view selected cover photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'submission-photos'
    AND EXISTS (
      SELECT 1 FROM item_cover_candidates
      WHERE item_cover_candidates.storage_path = storage.objects.name
        AND item_cover_candidates.display_eligible = true
    )
  );

COMMIT;
