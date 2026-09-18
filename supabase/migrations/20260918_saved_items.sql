-- Saved Items V1 (2026-09-18) — APPLIED.
--
-- This file is the historical record of a migration that was already
-- applied directly against the CheckOff production Supabase project
-- (uggusbbswybyplypkbxz), OUTSIDE of `supabase db push`, because this
-- project's historical migration-tracking table is incomplete (several
-- earlier migrations in this directory predate tracking — see the
-- schema-convention notes below, which cite migrations that were never
-- recorded in supabase_migrations.schema_migrations). Per this repo's
-- established convention for that situation — the same one used to apply
-- the prior `20260917_items_fallback_art_key.sql` migration — this was run
-- with `supabase db query --linked -f <file>` rather than the bulk push
-- command, so it could be applied and verified independently of the
-- incomplete tracking table.
--
-- THIS PASS DOES NOT RE-RUN THIS SQL. This is a documentation-only
-- rename + content-sync of the prior proposal file
-- (`20260918_saved_items_proposal_NOT_APPLIED.sql`, never committed) to
-- exactly match what was already applied by a human/prior process and
-- independently confirmed live: a read-only anon-key REST call against
-- `public.saved_items` returned `permission denied for table saved_items`,
-- which proves the table exists with RLS enabled and no anon grant —
-- exactly the expected production state. No SQL was executed as part of
-- writing this file. No production data was read, written, or otherwise
-- touched.
--
-- WHY A NEW TABLE, NOT A REPURPOSED `lists`/`list_items` ROW
-- (investigation performed before proposing this, per instruction):
--   - Grepped lib/, screens/, components/, supabase/migrations/ for
--     'saved'/'favorite'/'bookmark' — no existing Saved/favorites
--     mechanism exists anywhere in this codebase today. "Saved crew"
--     (screens/SavedCrewScreen.jsx, the saved_crew table) is an unrelated
--     feature (crew/friend picker for private-list invites), not item
--     bookmarking.
--   - Read every ALTER TABLE touching `lists`/`list_items` in
--     supabase/migrations/ (no CREATE TABLE for either exists there —
--     both predate migration tracking). Confirmed columns:
--       lists: id, creator_id, title, city_id, metro_id, starts_at,
--         ends_at, is_public, is_official, cover_emoji, invite_code,
--         checkoff_creator_id, is_creator_list, goes_public_at,
--         is_featured_eligible, source_destination_list_id
--       list_items: id, list_id, item_id, sort_order, is_partner_item
--   - No column on `lists` (is_system / is_private / kind / list_type /
--     owner_id / visibility, etc.) exists to safely mark a per-user
--     private "Saved" collection as structurally distinct from an
--     ordinary user-created list with is_public=false. Reusing `lists`
--     for Saved would create a row indistinguishable, by schema alone,
--     from a real user list — exactly the "fabricated list" / "misused
--     list membership" outcome the implementation instructions for this
--     pass explicitly ruled out. Adding a discriminator column to `lists`
--     to make Architecture B viable would ITSELF be a new-column
--     migration on a load-bearing, already-in-production table, so
--     Architecture B is not actually lower migration risk than a new,
--     empty, dedicated table — it is higher risk (touches a table every
--     other list feature depends on) for a semantically worse result
--     (saved items aren't really "a list": no title, no members, no
--     invite code, no public/private toggle meaning, and every existing
--     list-count / list-limit / ranking / analytics query that keys off
--     `lists` would need an explicit exclusion for the Saved row or it
--     silently contaminates those numbers).
--   - The one confirmed RLS policy on `lists`
--     (20260714_lists_public_read_for_destination_hub.sql) documents,
--     as an empirical finding, that the pre-existing SELECT gate is
--     `is_public = true`, with `list_members` membership as the other
--     visibility path for a private list. The FULL current policy set
--     on `lists`/`list_items`/`list_members` is not visible in this
--     migrations directory (predates tracking) — this migration does
--     not depend on it, precisely because that RLS surface can't be
--     fully verified from the repo alone.
--   - A dedicated `saved_items` table sidesteps all of the above: it
--     can't be confused with a real list, can't count against any
--     list-creation limit/analytics/ranking that keys off `lists`, needs
--     no `list_members` semantics, and gets its own narrow, fully-owned
--     RLS policy defined in the same migration that creates it.
--
-- SCHEMA CONVENTIONS VERIFIED AGAINST THIS REPO (not assumed):
--   - public.items.id is uuid — confirmed via existing FK usage, e.g.
--     supabase/migrations/20260902_item_cover_candidates.sql:
--       "item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE"
--     (same pattern in 20260828_visit_detection_phase1.sql and
--     20260902_business_confirmation_flow.sql).
--   - auth.users(id) is the correct FK target for an authenticated
--     user_id column — confirmed via
--     supabase/migrations/20260628_creator_attribution.sql:
--       "user_id uuid references auth.users,"
--     This migration adds an explicit ON DELETE CASCADE (that prior
--     migration didn't specify one), which is the correct behavior for
--     a purely personal, non-shared row like a saved-item bookmark: if
--     the user's auth row is ever deleted, their saved-item rows should
--     go with it rather than orphan.
--   - `public.items` is used as the explicit schema-qualified form,
--     matching the most recent prior migration's own convention
--     (20260917_items_fallback_art_key.sql: "ALTER TABLE public.items").
--
-- PRIMARY KEY DESIGN: composite (user_id, item_id), no surrogate id
-- column. A user can save a given item at most once by construction —
-- the primary key IS the uniqueness constraint, so a duplicate save is
-- structurally impossible rather than merely rejected by a separate
-- UNIQUE constraint. This also means the primary key's own index is
-- already exactly the index the target query pattern needs (see below),
-- so no additional index is added — a second index on
-- (user_id, item_id) or just (user_id) would be redundant with the PK's
-- own btree, which already has user_id as its leading column.
--
-- QUERY PLAN this table is designed for:
--   - isSaved(itemId) for one item:
--       select 1 from saved_items where user_id = auth.uid() and item_id = :itemId
--     Served directly by the primary key index (leading column
--     user_id, then item_id — an exact-match lookup on both columns).
--   - Batched "which of these N item ids are saved" for a whole Home
--     screen load (no-per-card-query requirement):
--       select item_id from saved_items where user_id = auth.uid()
--         and item_id = any($1)
--     Also served by the same primary key index (user_id equality plus
--     an index-assisted membership test on item_id) — one query per
--     screen load, not N.
--   - Saved-count for the Lists tab (if ever cheaply needed):
--       select count(*) from saved_items where user_id = auth.uid()
--     Also an index-only scan on the same primary key.
--
-- RLS: owner-only in every direction. No UPDATE policy is defined
-- because there is nothing on this table a user should ever update in
-- place — a save is either present or absent; "changing" one is a
-- delete of the old row plus an insert of the new one (or simply not
-- meaningful, since the row has no mutable fields beyond the key
-- itself). Omitting UPDATE is a deliberate minimal-surface choice, not
-- an oversight.
--
-- GRANTS: every role's grant is explicitly revoked before the single
-- intended grant is applied, so this file is a complete, self-contained
-- statement of the final privilege state rather than an incremental
-- diff against whatever a role happened to have before. `authenticated`
-- gets exactly SELECT, INSERT, DELETE — no UPDATE, no TRUNCATE.
-- `anon` and `PUBLIC` get nothing.
--
-- ADDITIVE ONLY: created one new, previously-unreferenced table. Did
-- not alter, backfill, or read any existing table (`lists`, `list_items`,
-- `items`, or anything else). No seed data. No data mutation of any
-- kind beyond the table's own creation. Confirmed row count is 0 as of
-- the last live check.
--
-- ROLLBACK (documentation only — do not run automatically; this file
-- intentionally contains no executable DROP statement, so re-running it
-- can never itself tear the table back down):
--   DROP TABLE IF EXISTS public.saved_items;
--   Fully reversible with zero cascading impact: no other table
--   references saved_items via foreign key, and no view/function/trigger
--   in this migration set depends on it.
--
-- VERIFICATION QUERIES (already run once, live, to confirm the state
-- documented above — recorded here for future reference, not to be
-- re-run as part of this pass):
--
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'saved_items';
-- SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.saved_items'::regclass;
-- SELECT count(*) FROM public.saved_items;
-- ============================================================

BEGIN;

CREATE TABLE public.saved_items (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id    uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

COMMENT ON TABLE public.saved_items IS
  'Per-user item bookmarks ("Saved" on Item Detail / Home). Not a `lists`/`list_items` row: deliberately a separate, dedicated table so a save can never be mistaken for a real user list, never counts against any list-creation limit/ranking/analytics that keys off `lists`, and needs no `list_members` semantics. Composite primary key (user_id, item_id) makes a duplicate save structurally impossible. Additive-only table; nothing else references it via foreign key.';

COMMENT ON COLUMN public.saved_items.user_id IS
  'The saving user. References auth.users(id) ON DELETE CASCADE so a deleted auth user''s saved-item rows are cleaned up automatically. Leading column of the primary key, so it serves as the index for both the per-item isSaved() lookup and the batched "which of these item ids are saved" query.';

COMMENT ON COLUMN public.saved_items.item_id IS
  'The saved item. References public.items(id) ON DELETE CASCADE so a deleted item''s saved-item rows are cleaned up automatically rather than orphaning.';

COMMENT ON COLUMN public.saved_items.created_at IS
  'When the save was created. Surfaced as the sort key for the Lists tab "Saved" entry (most recently saved first) — see screens/SavedItemsScreen.jsx.';

ALTER TABLE public.saved_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.saved_items FROM anon;
REVOKE ALL ON TABLE public.saved_items FROM PUBLIC;
REVOKE ALL ON TABLE public.saved_items FROM authenticated;

GRANT SELECT, INSERT, DELETE
ON TABLE public.saved_items
TO authenticated;

-- Owner-only, in every direction — a user can only ever see/create/delete
-- their OWN saved rows. No sharing, no admin override needed for this
-- feature; unlike `lists`, there is no public-read case at all. No
-- UPDATE policy is defined (see header comment) — SELECT/INSERT/DELETE
-- are the complete set this table needs. No grants to anon/public are
-- added; service_role keeps its normal implicit RLS bypass with no
-- special-casing needed here.
CREATE POLICY "saved_items: owner read"
ON public.saved_items FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- WITH CHECK (not USING) is the correct clause for INSERT — it validates
-- the row being written, which is what must be pinned to the caller's
-- own auth.uid() to prevent a user from saving an item under someone
-- else's user_id.
CREATE POLICY "saved_items: owner insert"
ON public.saved_items FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "saved_items: owner delete"
ON public.saved_items FOR DELETE
TO authenticated
USING (user_id = auth.uid());

COMMIT;
