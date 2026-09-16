-- Community Cover Photos V1 — global enable. Companion to the client-side
-- fix that removed `community_cover_photos` from TESTER_GATED_FLAGS (see
-- lib/featureFlags.js). Backend RLS/storage already support any
-- authenticated user submitting a candidate (item_cover_candidates_insert_own,
-- supabase/migrations/20260902_item_cover_candidates.sql) — this migration
-- only flips the global flag row so isFlagEnabled('community_cover_photos')
-- resolves true for every authenticated user, not just testers/overrides.
-- The flag itself is KEPT (not removed) so it still works as a kill switch:
-- flipping enabled_globally back to false hides the CoverCandidateCTA app-wide
-- with no app update required.
--
-- Does NOT touch item_cover_candidates RLS (already correct: any
-- authenticated user may INSERT their own row; only admins may
-- SELECT-others/UPDATE/DELETE) and does NOT touch storage.objects policies
-- on the submission-photos bucket — see the separate storage-policy audit
-- finding reported alongside this migration; any change there needs its own
-- reviewed migration.
--
-- Run manually via:
--   supabase db query -f supabase/migrations/20260916_community_cover_photos_global_enable.sql --linked

BEGIN;

UPDATE feature_flags
SET enabled_globally = true
WHERE key = 'community_cover_photos';

DO $$
DECLARE
  flag_enabled boolean;
  row_exists boolean;
BEGIN
  SELECT enabled_globally INTO flag_enabled FROM feature_flags WHERE key = 'community_cover_photos';
  row_exists := FOUND;
  IF NOT row_exists THEN
    RAISE EXCEPTION 'SELFTEST FAILED: community_cover_photos flag row does not exist — run 20260902_item_cover_candidates.sql first';
  END IF;
  IF flag_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SELFTEST FAILED: community_cover_photos must be enabled_globally = true after this migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS self-check — exercises the REAL item_cover_candidates table end-to-end
-- (same technique as supabase/migrations/20260902_whats_good_momentum_rpc.sql's
-- self-check: borrows existing real user/item IDs read-only, fakes
-- auth.uid() via a transaction-local request.jwt.claim.sub, inserts/deletes
-- only clearly-marked throwaway fixture rows, nothing persists past this
-- transaction). This is the backend half of "does removing the tester gate
-- actually let a normal authenticated user submit, and does the existing
-- moderation/visibility wall still hold" — the flag-removal change itself is
-- purely client-side (lib/featureFlags.js), so it has no RLS surface of its
-- own to test; what needs proving is that the RLS this flag now gates
-- FEWER users out of still behaves exactly as designed for the users who can
-- now reach it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  normal_user_1 uuid;
  normal_user_2 uuid;
  real_item_id uuid;
  fixture_candidate_id uuid;
  row_count int;
BEGIN
  -- Borrow 2 EXISTING non-admin users and 1 existing item, read-only —
  -- same reasoning as the momentum RPC self-check: public.users.id FKs to
  -- auth.users(id), so fabricating a new UUID here isn't safe.
  SELECT id INTO normal_user_1 FROM public.users WHERE is_admin IS NOT TRUE ORDER BY id LIMIT 1;
  SELECT id INTO normal_user_2 FROM public.users WHERE is_admin IS NOT TRUE AND id <> normal_user_1 ORDER BY id LIMIT 1;
  SELECT id INTO real_item_id FROM public.items LIMIT 1;

  IF normal_user_1 IS NULL OR normal_user_2 IS NULL THEN
    RAISE EXCEPTION 'SELFTEST SKIPPED-UNSAFE: fewer than 2 non-admin users exist in public.users to borrow IDs from';
  END IF;
  IF real_item_id IS NULL THEN
    RAISE EXCEPTION 'SELFTEST SKIPPED-UNSAFE: no rows exist in public.items to borrow an ID from';
  END IF;

  -- IMPORTANT: this whole script runs over a privileged connection (the
  -- role `supabase db query --linked` connects as owns these tables /
  -- has BYPASSRLS), which ignores RLS entirely regardless of
  -- request.jwt.claim.sub. Faking the JWT claim alone (the first version of
  -- this self-check) is not enough — auth.uid() would resolve correctly,
  -- but RLS itself would never actually be evaluated, so every check below
  -- would trivially "pass" whether or not the real policies work. Each
  -- block below explicitly `SET LOCAL ROLE` to `anon`/`authenticated` (the
  -- same unprivileged Postgres roles PostgREST itself connects as for
  -- real app traffic) so RLS is actually engaged, then `RESET ROLE`
  -- immediately after to return to the privileged connection role for the
  -- next borrow/cleanup step.

  -- 1. Anonymous (no session at all) cannot INSERT — proves Bug 2
  -- requirement "anonymous users cannot create an item_cover_candidates
  -- record" at the RLS layer, independent of the client-side UI gate.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    INSERT INTO public.item_cover_candidates (item_id, submitted_by_user_id, storage_path, consent_ack)
    VALUES (real_item_id, normal_user_1, '__selftest_anon_should_fail__.jpg', true);
    RAISE EXCEPTION 'SELFTEST FAILED: anonymous INSERT into item_cover_candidates should have been rejected by RLS';
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    IF SQLSTATE NOT IN ('42501', '28000') THEN RAISE; END IF;
  END;
  RESET ROLE;

  -- 2. A normal (non-admin, non-tester — the exact population the tester
  -- gate used to block) authenticated user CAN insert their own candidate.
  -- This is the RLS proof behind "normal authenticated account can submit a
  -- photo" — the capture screen itself (camera -> storage upload -> this
  -- insert) is unchanged app code, already covered by existing
  -- lib/coverCandidates.test.js / lib/coverCandidateEligibility.test.js.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', normal_user_1::text, true);
  INSERT INTO public.item_cover_candidates (item_id, submitted_by_user_id, storage_path, consent_ack)
  VALUES (real_item_id, normal_user_1, '__selftest_normal_user_insert__.jpg', true)
  RETURNING id INTO fixture_candidate_id;
  RESET ROLE;

  -- New rows default to status = 'pending' -- the same starting state every
  -- submission has always had, which is what makes it visible in the
  -- existing admin review workstream (checkoff_admin.html's Images tab
  -- queries item_cover_candidates?status=eq.needs_review /
  -- other-non-selected statuses with NO submitted_by_user_id filter, so a
  -- normal user's own submission surfaces there exactly like an admin's
  -- would -- verified by inspection, not re-tested here since that file
  -- lives outside this repo).
  IF NOT EXISTS (SELECT 1 FROM public.item_cover_candidates WHERE id = fixture_candidate_id AND status = 'pending') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a fresh submission must default to status = pending';
  END IF;

  -- 3. Not public: another normal (non-owning, non-admin) user cannot SELECT
  -- this still-pending candidate. Proves "remains non-public until
  -- approved" holds for an ordinary user, not just for anon.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', normal_user_2::text, true);
  SELECT count(*) INTO row_count FROM public.item_cover_candidates WHERE id = fixture_candidate_id;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a pending candidate must not be visible to a non-owning, non-admin user';
  END IF;

  -- 4. Not public to anon either, regardless of status: only status =
  -- 'selected' is anon/public-readable (supabase/migrations/
  -- 20260903_selected_cover_public_read.sql) -- this fixture row is
  -- 'pending', so anon must see zero rows for it.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO row_count FROM public.item_cover_candidates WHERE id = fixture_candidate_id;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a pending candidate must not be visible to anon';
  END IF;

  -- 5. A normal user (even the owner) can never self-approve: UPDATE is
  -- admin-only, unconditionally -- proves "normal authenticated user
  -- cannot approve, update, or delete candidates" survives the tester-gate
  -- removal.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', normal_user_1::text, true);
  UPDATE public.item_cover_candidates SET status = 'approved' WHERE id = fixture_candidate_id;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a normal (non-admin) user, including the submission owner, must never be able to UPDATE a candidate''s status';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', normal_user_1::text, true);
  DELETE FROM public.item_cover_candidates WHERE id = fixture_candidate_id;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RESET ROLE;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a normal (non-admin) user, including the submission owner, must never be able to DELETE a candidate';
  END IF;

  -- Cleanup -- back on the privileged connection role (RESET ROLE already
  -- called after every simulated block above), which can delete
  -- unconditionally. Nothing from this self-check persists past COMMIT
  -- regardless, but this keeps the fixture row from lingering if this
  -- whole DO block is ever run with COMMIT swapped out for testing.
  DELETE FROM public.item_cover_candidates WHERE id = fixture_candidate_id;

  RAISE NOTICE 'community_cover_photos RLS self-check PASSED';
END $$;

COMMIT;
