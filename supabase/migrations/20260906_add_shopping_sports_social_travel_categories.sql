-- Chief M7 — add the 4 canonical Winston taxonomy categories the real
-- `categories` table doesn't yet have (Shopping, Sports, Social, Travel),
-- so San Diego/Tijuana candidates in these categories are not silently
-- remapped into "Play"/"Misc". See the read-only dependency audit below
-- for why this is confirmed safe.
--
-- AUDIT FINDINGS (read-only, 2026-09-06 — agent_service has no SELECT
-- grant on `categories` itself, so this was done entirely via app/admin
-- code + existing migrations, not a live schema read):
--   - No CREATE TABLE for `categories` exists in supabase/migrations/ —
--     it predates the tracked migration history (same as `items`).
--   - The ONLY confirmed columns, from every real app/admin query
--     (screens/HomeScreen.jsx, ListScreen.jsx, DiscoverScreen.jsx,
--     NearbyScreen.jsx, ItemDetailScreen.jsx, CreateListScreen.jsx,
--     CuratedListPreviewScreen.jsx, PartnerPreviewScreen.jsx, and the
--     admin tool at /Users/jerrystuckart/Downloads/checkoff_admin.html
--     lines 1650, 1775, 3309, 4717, 5289, 5472): `id`, `name`, `color_hex`.
--     No icon/image/sort_order column is referenced anywhere.
--   - EVERY app screen renders category color via
--     `item.categories?.color_hex ?? '#888780'` — a safe, universal
--     fallback. A new category with a placeholder color never breaks
--     rendering; at worst it shows the same neutral gray every
--     already-live item with a null category shows today.
--   - No screen, component, or the admin tool hardcodes an enumerated
--     list of category names anywhere (grepped across screens/, lib/,
--     components/, and the full admin HTML) — every category chip/label/
--     dropdown is built by iterating whatever rows `categories` actually
--     has. The admin tool's own item-editor dropdown
--     (checkoff_admin.html:1775) is a live `categories.map(...)` — adding
--     a row makes it appear there automatically, no admin code change.
--   - No CHECK constraint or enum type ties `items.category_id` (or
--     anything else) to a fixed set of category names — the existing 8
--     values are current data, not a schema restriction
--     (docs/metro-launch-audit/08_future_metro_build_sequence.md:22
--     explicitly names "confirm no new categories needed" as an open,
--     per-metro decision, implying adding one is an anticipated,
--     supported path, not a special case).
--   - No SQL function or view found anywhere in supabase/migrations/ or
--     docs/metro-launch-audit/ that enumerates category names/ids other
--     than the Denver catalog insert's own preflight check (which
--     verifies the 8 categories it depends on haven't drifted — adding
--     4 unrelated new rows doesn't touch what it checks).
--   - CONCLUSION: categories are fully data-driven end-to-end (DB -> app
--     -> admin). Adding these 4 rows requires ZERO app or admin code
--     changes.
--
-- color_hex — RESOLVED 2026-09-06. agent_service has no SELECT grant on
--   `categories` (confirmed via information_schema.role_table_grants —
--   zero rows for this table, no visibility at all), so this migration
--   could not read the live palette itself; Jerry supplied the real,
--   current production values directly. The full live palette (for
--   context — only the 4 new rows below are inserted by this file):
--     Adventure #0F6E56, Arts & Culture #9B4F96, Bar & drinks #BA7517,
--     Food & drink #D85A30, Misc #888780, Nightlife #1A1A2E, Play #534AB7,
--     Shopping #378ADD, Social #D4537E, Spa & self-care #B77AE0,
--     Sports #1D9E75, Travel #185FA5.
--
-- Uses the exact, unchanged canonical Winston taxonomy names
-- (agent-service/playbooks/categoryNormalization.ts) — never remapped.
-- Idempotent via WHERE NOT EXISTS rather than ON CONFLICT, since this
-- migration cannot confirm a UNIQUE constraint exists on `categories.name`
-- (agent_service has no information_schema visibility into a table it
-- has zero grants on). Review-ready, NOT applied automatically — run
-- manually once reviewed, same convention as every other migration here.

BEGIN;

-- Real production values (Jerry, 2026-09-06) — see the RESOLVED note above.
INSERT INTO public.categories (name, color_hex)
SELECT 'Shopping', '#378ADD'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Shopping');

INSERT INTO public.categories (name, color_hex)
SELECT 'Sports', '#1D9E75'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Sports');

INSERT INTO public.categories (name, color_hex)
SELECT 'Social', '#D4537E'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Social');

INSERT INTO public.categories (name, color_hex)
SELECT 'Travel', '#185FA5'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Travel');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.categories WHERE name IN ('Shopping', 'Sports', 'Social', 'Travel')) <> 4 THEN
    RAISE EXCEPTION 'Postflight failed: expected all 4 of Shopping/Sports/Social/Travel to exist in public.categories after this migration.';
  END IF;
END $$;

COMMIT;
