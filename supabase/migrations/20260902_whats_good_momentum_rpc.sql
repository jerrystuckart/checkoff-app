-- What's Good V1 — anonymized community-momentum data RPC. check_ins RLS
-- permits only self-row reads (see the live audit performed during this
-- phase's preflight) — there is no policy allowing a client to read other
-- users' check_ins rows, and this migration deliberately does NOT change
-- that. Instead, this SECURITY DEFINER function reads across users
-- internally (bypassing RLS only inside its own narrow, reviewed body) and
-- returns exclusively anonymous, aggregated, day-granularity data: no
-- user_id, no exact checkoff timestamp, ever leaves Postgres. See
-- decision `whats_good_v1_momentum_ranking` and the "What's Good V1 — Data
-- Adapter Preflight" design conversation for the full rationale.
--
-- Pipeline this function feeds: check_ins -> this RPC (dedup + floor +
-- aggregate, identity stripped) -> lib/whatsGoodMomentum.js (pure scoring)
-- -> lib/whatsGoodSelection.js (pure ranking). Run manually via:
--   supabase db query -f supabase/migrations/20260902_whats_good_momentum_rpc.sql --linked

BEGIN;

CREATE OR REPLACE FUNCTION public.get_whats_good_momentum_contributions(candidate_item_ids uuid[])
RETURNS TABLE (
  item_id uuid,
  contribution_date date,
  verification_method text,
  contributor_count integer,
  previous_window_contributor_total integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  max_candidates constant int := 50;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF candidate_item_ids IS NULL OR array_length(candidate_item_ids, 1) IS NULL THEN
    RETURN; -- empty input -> empty result, not an error
  END IF;

  IF array_length(candidate_item_ids, 1) > max_candidates THEN
    RAISE EXCEPTION 'candidate_item_ids exceeds maximum of % items', max_candidates;
  END IF;

  RETURN QUERY
  WITH bounded_input AS (
    SELECT DISTINCT x AS item_id FROM unnest(candidate_item_ids) AS x
  ),
  windows AS (
    SELECT
      now() - interval '30 days' AS current_start,
      now()                      AS current_end,
      now() - interval '60 days' AS previous_start,
      now() - interval '30 days' AS previous_end
  ),
  qualifying AS (
    SELECT
      ci.item_id, ci.user_id, ci.checked_at, ci.verification_method,
      CASE
        WHEN ci.checked_at > w.current_start  AND ci.checked_at <= w.current_end  THEN 'current'
        WHEN ci.checked_at > w.previous_start AND ci.checked_at <= w.previous_end THEN 'previous'
      END AS contribution_window
    FROM public.check_ins ci
    JOIN bounded_input bi ON bi.item_id = ci.item_id
    CROSS JOIN windows w
    WHERE ci.checked_at > w.previous_start AND ci.checked_at <= w.current_end
  ),
  deduplicated AS (
    -- Most recent qualifying checkoff wins as each distinct contributor's
    -- representative row, per item + window. Deliberately independent of
    -- verification-method weighting (which is tunable JS-side business
    -- logic and must not leak into SQL) — see the momentum preflight for
    -- why "most recent" was chosen over "strongest verification".
    SELECT DISTINCT ON (q.item_id, q.contribution_window, q.user_id)
      q.item_id, q.contribution_window, q.checked_at, q.verification_method
    FROM qualifying q
    WHERE q.contribution_window IS NOT NULL
    ORDER BY q.item_id, q.contribution_window, q.user_id, q.checked_at DESC
  ),
  current_window_totals AS (
    -- NOTE: aliases (d.item_id, etc.) are required throughout this
    -- function, not just style — RETURNS TABLE's declared output columns
    -- (item_id, contribution_date, ...) become implicitly-scoped PL/pgSQL
    -- variables for the entire function body, so an unqualified `item_id`
    -- is genuinely ambiguous between that variable and a table column.
    SELECT d.item_id, count(*) AS contributor_count
    FROM deduplicated d WHERE d.contribution_window = 'current'
    GROUP BY d.item_id
  ),
  previous_window_totals AS (
    SELECT d.item_id, count(*) AS contributor_count
    FROM deduplicated d WHERE d.contribution_window = 'previous'
    GROUP BY d.item_id
  ),
  floor_passing_items AS (
    -- Locked product rule: momentum does not exist below 3 distinct
    -- current-window contributors. Enforced here (not just client-side) so
    -- an item below the floor never surfaces ANY contribution data at all
    -- — current or previous.
    SELECT cwt.item_id FROM current_window_totals cwt WHERE cwt.contributor_count >= 3
  ),
  current_buckets AS (
    SELECT
      d.item_id,
      (d.checked_at AT TIME ZONE 'UTC')::date AS contribution_date,
      d.verification_method,
      count(*)::integer AS contributor_count
    FROM deduplicated d
    JOIN floor_passing_items f ON f.item_id = d.item_id
    WHERE d.contribution_window = 'current'
    GROUP BY d.item_id, (d.checked_at AT TIME ZONE 'UTC')::date, d.verification_method
  )
  SELECT
    cb.item_id,
    cb.contribution_date,
    cb.verification_method,
    cb.contributor_count,
    COALESCE(pwt.contributor_count, 0)::integer AS previous_window_contributor_total
  FROM current_buckets cb
  LEFT JOIN previous_window_totals pwt ON pwt.item_id = cb.item_id;
END;
$$;

-- This project's default privileges auto-grant EXECUTE on new public-schema
-- functions to anon/authenticated/service_role/postgres at creation time —
-- a mechanism separate from (and not undone by) REVOKE ALL FROM PUBLIC,
-- confirmed by direct inspection during this migration's own development.
-- All three non-owner roles are revoked explicitly so EXECUTE ends up
-- granted to authenticated ONLY, exactly as required — postgres (the
-- function owner) is left alone since owner access isn't a client-facing
-- grant to begin with.
REVOKE ALL ON FUNCTION public.get_whats_good_momentum_contributions(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_whats_good_momentum_contributions(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.get_whats_good_momentum_contributions(uuid[]) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_whats_good_momentum_contributions(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Migration-level self-check. Exercises the REAL check_ins table end-to-end
-- (not a shadow/temp table, so it's proving the actual deployed behavior),
-- using clearly-marked throwaway fixture rows that are deleted before this
-- transaction commits — nothing persists. check_ins' AFTER INSERT triggers
-- (badge awards, streaks, notification queueing, leaderboard nudges, point
-- sync) are disabled for the duration of the fixture inserts so this
-- verification has zero side effects beyond the rows it creates and
-- deletes itself. auth.uid() is faked via a transaction-local
-- request.jwt.claim.sub setting (the standard Supabase technique for this),
-- never touching any other session.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  real_user_ids uuid[];
  test_user_1 uuid;
  test_user_2 uuid;
  test_user_3 uuid;
  test_user_4 uuid;
  test_item_low uuid := gen_random_uuid();          -- 2 distinct current users -> below floor
  test_item_one uuid := gen_random_uuid();           -- 1 distinct current user -> below floor
  test_item_none uuid := gen_random_uuid();          -- zero check_ins at all -> below floor
  test_item_ok uuid := gen_random_uuid();             -- dedup + most-recent-wins + previous=2
  test_item_boundary uuid := gen_random_uuid();       -- exact 30-day boundary
  test_item_no_previous uuid := gen_random_uuid();    -- 3 current, 0 previous
  total_contributor_count int;
  distinct_prev_totals int;
  row_count int;
  grant_count int;
BEGIN
  -- Borrow 4 EXISTING real user IDs read-only, rather than fabricating new
  -- ones — public.users.id has an FK to auth.users(id), so an arbitrary
  -- new UUID can't be inserted there without also touching auth.users
  -- (Supabase's own internal auth schema), which is unnecessary and
  -- riskier than it needs to be. Nothing below ever modifies a users row;
  -- only transient, self-deleted check_ins rows are attributed to these
  -- borrowed IDs, entirely undone before this transaction commits.
  SELECT array_agg(id) INTO real_user_ids FROM (SELECT id FROM public.users ORDER BY id LIMIT 4) sub;
  IF real_user_ids IS NULL OR array_length(real_user_ids, 1) < 4 THEN
    RAISE EXCEPTION 'SELFTEST SKIPPED-UNSAFE: fewer than 4 users exist in public.users to borrow IDs from';
  END IF;
  test_user_1 := real_user_ids[1];
  test_user_2 := real_user_ids[2];
  test_user_3 := real_user_ids[3];
  test_user_4 := real_user_ids[4];

  -- 1. Unauthenticated invocation is rejected.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM * FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok]);
    RAISE EXCEPTION 'SELFTEST FAILED: expected unauthenticated invocation to raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%authentication required%' THEN RAISE; END IF;
  END;

  -- Fake an authenticated session, scoped to this transaction only.
  PERFORM set_config('request.jwt.claim.sub', test_user_1::text, true);

  -- 2. More than 50 candidate IDs is rejected.
  BEGIN
    PERFORM * FROM public.get_whats_good_momentum_contributions(
      (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 51))
    );
    RAISE EXCEPTION 'SELFTEST FAILED: expected >50 candidate IDs to raise';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%exceeds maximum%' THEN RAISE; END IF;
  END;

  -- Fixtures below insert real rows into users/items/check_ins, all
  -- deleted before COMMIT. Disable check_ins' side-effecting triggers for
  -- the duration.
  ALTER TABLE public.check_ins DISABLE TRIGGER USER;

  INSERT INTO public.items (id, body, is_active, is_approved, is_universal) VALUES
    (test_item_low, '__whats_good_rpc_selftest_low__', false, false, false),
    (test_item_one, '__whats_good_rpc_selftest_one__', false, false, false),
    (test_item_ok, '__whats_good_rpc_selftest_ok__', false, false, false),
    (test_item_boundary, '__whats_good_rpc_selftest_boundary__', false, false, false),
    (test_item_no_previous, '__whats_good_rpc_selftest_noprev__', false, false, false);

  -- test_item_low: 2 distinct current users -> below the floor of 3.
  INSERT INTO public.check_ins (user_id, item_id, checked_at, verification_method) VALUES
    (test_user_1, test_item_low, now() - interval '1 day', 'live_location'),
    (test_user_2, test_item_low, now() - interval '2 days', 'live_location');

  -- test_item_one: 1 distinct current user -> below the floor.
  INSERT INTO public.check_ins (user_id, item_id, checked_at, verification_method) VALUES
    (test_user_1, test_item_one, now() - interval '1 day', 'live_location');

  -- test_item_ok: test_user_1 checks off TWICE in the current window (an
  -- older 'legacy' one and a more recent 'live_location' one) -> must
  -- dedupe to ONE representative, using the most recent. Plus user_2/user_3
  -- for a total of exactly 3 distinct current contributors (clears the
  -- floor). Plus user_1 (again, different window) and user_4 in the
  -- previous window -> previous_window_contributor_total should be 2.
  INSERT INTO public.check_ins (user_id, item_id, checked_at, verification_method) VALUES
    (test_user_1, test_item_ok, now() - interval '10 days', 'legacy'),
    (test_user_1, test_item_ok, now() - interval '1 day', 'live_location'),
    (test_user_2, test_item_ok, now() - interval '2 days', 'qr_scan'),
    (test_user_3, test_item_ok, now() - interval '3 days', 'photo'),
    (test_user_1, test_item_ok, now() - interval '40 days', 'live_location'),
    (test_user_4, test_item_ok, now() - interval '45 days', 'live_location');

  -- test_item_boundary: one checkoff at EXACTLY now()-30d (must land in
  -- 'previous' only, never 'current'), one at exactly now() (must land in
  -- 'current'), plus two more current-window users to clear the floor.
  -- now() is stable across this whole transaction, so this is an exact,
  -- deterministic boundary test, not an approximation.
  INSERT INTO public.check_ins (user_id, item_id, checked_at, verification_method) VALUES
    (test_user_1, test_item_boundary, now() - interval '30 days', 'live_location'),
    (test_user_2, test_item_boundary, now(), 'live_location'),
    (test_user_3, test_item_boundary, now() - interval '1 day', 'live_location'),
    (test_user_4, test_item_boundary, now() - interval '2 days', 'live_location');

  -- test_item_no_previous: 3 current-window distinct users, ZERO
  -- previous-window activity -> previous_window_contributor_total must be
  -- 0, and the item must NOT be dropped for lacking previous data.
  INSERT INTO public.check_ins (user_id, item_id, checked_at, verification_method) VALUES
    (test_user_1, test_item_no_previous, now() - interval '1 day', 'live_location'),
    (test_user_2, test_item_no_previous, now() - interval '2 days', 'live_location'),
    (test_user_3, test_item_no_previous, now() - interval '3 days', 'live_location');

  -- === Assertions ===

  -- 3. Current distinct count 0/1/2 -> no rows.
  SELECT count(*) INTO row_count FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_none]);
  IF row_count <> 0 THEN RAISE EXCEPTION 'SELFTEST FAILED: test_item_none (0 contributors) expected 0 rows, got %', row_count; END IF;

  SELECT count(*) INTO row_count FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_one]);
  IF row_count <> 0 THEN RAISE EXCEPTION 'SELFTEST FAILED: test_item_one (1 contributor) expected 0 rows, got %', row_count; END IF;

  SELECT count(*) INTO row_count FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_low]);
  IF row_count <> 0 THEN RAISE EXCEPTION 'SELFTEST FAILED: test_item_low (2 contributors) expected 0 rows, got %', row_count; END IF;

  -- 4. test_item_ok: dedup collapses 4 raw current-window rows (user1 x2,
  -- user2, user3) to exactly 3 distinct contributors.
  SELECT sum(contributor_count) INTO total_contributor_count
    FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok]);
  IF total_contributor_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_ok expected 3 distinct current contributors after dedup, got %', total_contributor_count;
  END IF;

  -- 5. Most recent representative wins: the superseded 'legacy' checkoff
  -- must never appear.
  IF EXISTS (
    SELECT 1 FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok])
    WHERE verification_method = 'legacy'
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_ok returned the superseded (older) verification_method — most-recent-wins is broken';
  END IF;

  -- 6. previous_window_contributor_total is correct (2) and consistent
  -- across every row for the same item.
  SELECT count(DISTINCT previous_window_contributor_total) INTO distinct_prev_totals
    FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok]);
  IF distinct_prev_totals <> 1 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_ok previous_window_contributor_total is inconsistent across rows';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok])
    WHERE previous_window_contributor_total = 2
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_ok expected previous_window_contributor_total = 2';
  END IF;

  -- 7. Exact 30-day boundary: the checkoff at exactly now()-30d must land
  -- in 'previous' only (previous total = 1), and current total must be
  -- exactly 3 (user2/user3/user4 — NOT including the boundary checkoff).
  SELECT sum(contributor_count) INTO total_contributor_count
    FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_boundary]);
  IF total_contributor_count IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_boundary expected 3 current contributors, got % (the exact-30-day-ago checkoff may have leaked into the current window)', total_contributor_count;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_boundary])
    WHERE previous_window_contributor_total = 1
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_boundary expected previous_window_contributor_total = 1 (the exact-30-day-ago checkoff should land there)';
  END IF;

  -- 8. Zero previous contributors returns 0, not a dropped item.
  SELECT count(*) INTO row_count FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_no_previous]);
  IF row_count = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_no_previous was dropped entirely instead of returning rows with previous_window_contributor_total = 0';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_no_previous])
    WHERE previous_window_contributor_total = 0
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: test_item_no_previous expected previous_window_contributor_total = 0';
  END IF;

  -- 9. Current distinct count >=3 returns correctly aggregated current
  -- buckets (already proven by #4/#7, restated explicitly): row count > 0
  -- for both floor-clearing items.
  SELECT count(*) INTO row_count FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok]);
  IF row_count = 0 THEN RAISE EXCEPTION 'SELFTEST FAILED: test_item_ok (floor cleared) unexpectedly returned 0 rows'; END IF;

  -- 10. Duplicate candidate IDs in the input do not duplicate output.
  SELECT count(*) INTO row_count FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok, test_item_ok, test_item_ok]);
  IF row_count <> (SELECT count(*) FROM public.get_whats_good_momentum_contributions(ARRAY[test_item_ok])) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: duplicate input item IDs produced duplicated output rows';
  END IF;

  -- Cleanup — nothing from this self-check persists past this transaction.
  DELETE FROM public.check_ins WHERE item_id IN (
    test_item_low, test_item_one, test_item_ok, test_item_boundary, test_item_no_previous
  );
  DELETE FROM public.items WHERE id IN (
    test_item_low, test_item_one, test_item_ok, test_item_boundary, test_item_no_previous
  );

  ALTER TABLE public.check_ins ENABLE TRIGGER USER;

  -- 11. Grants: EXECUTE only to `authenticated`, never PUBLIC/anon.
  SELECT count(*) INTO grant_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND routine_name = 'get_whats_good_momentum_contributions'
    AND grantee = 'authenticated'
    AND privilege_type = 'EXECUTE';
  IF grant_count <> 1 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: expected exactly one EXECUTE grant to authenticated, found %', grant_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public'
      AND routine_name = 'get_whats_good_momentum_contributions'
      AND grantee IN ('PUBLIC', 'anon', 'service_role')
  ) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: found an unexpected EXECUTE grant to PUBLIC, anon, or service_role';
  END IF;

  -- Note on "no user identity / no exact timestamp in the return schema":
  -- this is guaranteed by the RETURNS TABLE declaration itself (item_id,
  -- contribution_date [date, not timestamptz], verification_method,
  -- contributor_count, previous_window_contributor_total) — reviewable
  -- statically in this file, not something a runtime check adds value to.
  -- "Previous-window detail is not exposed" is the same kind of
  -- structural, DDL-level guarantee: there is no previous_date or
  -- previous_verification_method column anywhere in the return type.

  RAISE NOTICE 'get_whats_good_momentum_contributions self-check PASSED';
END $$;

COMMIT;
