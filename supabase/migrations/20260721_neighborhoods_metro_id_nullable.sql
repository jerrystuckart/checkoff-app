-- ============================================================
-- Make neighborhoods.metro_id nullable; null it for Willcox
-- 2026-07-21
--
-- Destinations (Willcox, and future ones) own their own content and are
-- promoted to metros via metro_destinations / metro_destination_lists —
-- a neighborhood belonging to a destination rather than one of the three
-- core metros correctly has no metro_id. Willcox's neighborhood was
-- previously (incorrectly) tagged metro_id = Phoenix Metro, which folded
-- its 26 items into Phoenix's item pool everywhere neighborhoods are
-- joined to metro_areas: CreateListScreen's per-metro item browser, the
-- admin Items tab metro filter, and — most consequentially — the admin
-- partner/pipeline "metro summary strip" (checkoff_admin.html), which
-- silently counted Willcox's partner pipeline as Phoenix's ahead of the
-- Willcox chamber conversation.
--
-- Every consuming surface already handles a missing metro gracefully
-- (optional chaining / explicit "No metro" fallback — confirmed via a
-- full-codebase pass before this migration was written), so this is a
-- data change, not a code change. See the investigation findings from
-- 2026-07-21 for the full surface-by-surface trace.
-- ============================================================

-- ── Pre-check: confirm the target row and its item count ────────────
SELECT id, name, metro_id
FROM neighborhoods
WHERE id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1';
-- expected: name = 'Willcox', metro_id = 43e9fba2-4a26-4941-817f-db860265ea51 (Phoenix Metro)

SELECT count(*) AS willcox_item_count
FROM items
WHERE neighborhood_id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1';
-- expected: 26

-- ── 1. Drop NOT NULL so a neighborhood can belong to no metro ───────
-- Idempotent-safe: if metro_id is already nullable, this is a no-op.
ALTER TABLE neighborhoods
ALTER COLUMN metro_id DROP NOT NULL;

COMMENT ON COLUMN neighborhoods.metro_id IS
  'Nullable. Destinations own their own content and are promoted to metros via metro_destinations / metro_destination_lists. A neighborhood belonging to a destination rather than one of the core metros correctly has no metro_id here — do not assume metro_id is always present.';

-- ── 2. Null it for Willcox ───────────────────────────────────────────
UPDATE neighborhoods
SET metro_id = NULL
WHERE id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1';

-- ── Post-check ────────────────────────────────────────────────────────
SELECT id, name, metro_id
FROM neighborhoods
WHERE id = 'e35e8947-92ad-44ad-80f6-633a65d94dc1';
-- expected: metro_id is now NULL
