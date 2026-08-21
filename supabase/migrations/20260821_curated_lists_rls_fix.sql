BEGIN;

-- ============================================================
-- Platform-wide fix: curated_lists double-RLS-policy gap
-- 2026-08-21 — NOT APPLIED. Generated for review only.
--
-- Root cause (docs/metro-launch-audit/01_current_schema_and_relationships.md):
-- curated_lists currently has THREE relevant policies:
--   1. "curated_lists: admin write"        ALL    admin-only
--   2. "Public read active curated lists"  SELECT  USING (is_active = true)
--   3. "curated_lists: public read"        SELECT  USING (true)
-- Postgres RLS policies of the same command are OR'd together for a
-- given role, so policy 3's unconditional USING(true) makes policy 2's
-- is_active gate a no-op — every curated_lists row is publicly readable
-- today regardless of is_active.
--
-- Dependency check performed before proposing this fix (per instruction):
-- grepped the app (screens/, lib/, components/) and supabase/functions/
-- for any admin-preview-as-metro flow, or any other mechanism that reads
-- curated_lists while relying on inactive rows being publicly visible.
-- FOUND NOTHING — no such flow exists. fetchCuratedLists() and every
-- other read path (lib/useItems.js) explicitly filters
-- .eq('is_active', true) at the query level already, meaning the app
-- was never relying on the RLS layer to expose inactive rows — it was
-- filtering client-side redundantly on top of an RLS layer that already
-- allowed everything through. Dropping the permissive policy changes
-- nothing about what the app itself shows; it only closes direct
-- anon-key API access to inactive rows (e.g. a raw REST/PostgREST call
-- bypassing the app's own query filters).
--
-- Fix: drop the redundant permissive policy. The is_active-gated policy
-- alone is sufficient and correctly restrictive.
-- ============================================================

DROP POLICY IF EXISTS "curated_lists: public read" ON public.curated_lists;

-- "Public read active curated lists" (USING (is_active = true)) and
-- "curated_lists: admin write" (admin-only ALL) are left untouched —
-- together they now correctly gate public read on is_active=true while
-- preserving full admin access regardless of is_active.

-- ============================================================
-- VERIFICATION QUERY (run after applying, not now):
--
-- SELECT policyname, cmd, qual FROM pg_policies
-- WHERE schemaname='public' AND tablename='curated_lists'
-- ORDER BY policyname;
--
-- Expected result: exactly 2 rows — "Public read active curated lists"
-- (SELECT, is_active = true) and "curated_lists: admin write" (ALL,
-- admin-only). If "curated_lists: public read" still appears, the DROP
-- did not take effect (e.g. wrong policy name — re-check exact name via
-- the query above before retrying).
-- ============================================================

COMMIT;
