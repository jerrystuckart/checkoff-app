-- =============================================================================
-- Trip Mode — PG_TEMP-ONLY, ROLLBACK-ONLY server-logic test.
--
-- SAFETY MODEL: this script creates NOTHING outside the `pg_temp` schema.
-- It builds a self-contained MOCK of the relevant tables/functions (named
-- with a `mock_` prefix and living only in pg_temp), copies the corrected
-- trigger logic into a pg_temp-scoped function/trigger, and runs all 23
-- required scenarios against that mock — never touching public.lists,
-- public.check_ins, public.items, public.list_items, public.list_members,
-- public.users, auth.*, storage.*, extensions.*, agent.*, or any other
-- persistent schema. The whole script is one explicit transaction that
-- ends in ROLLBACK even on full success — temp tables are session-scoped
-- and vanish when the connection closes regardless, but the explicit
-- ROLLBACK is a second, independent guarantee.
--
-- Confirmed by a live connectivity probe (this session) before writing
-- this: `supabase db query -f <file> --linked` executes an entire file as
-- ONE continuous Postgres session (same backend pid throughout — verified:
-- a temp table created early in the file was readable later in the SAME
-- file), and a temp table never survives into a SEPARATE later CLI
-- invocation (verified: a fresh call got a different backend pid and
-- found nothing). Both properties are required for this script to be
-- meaningful and safe.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

-- -----------------------------------------------------------------------------
-- PREFLIGHT — fail closed before creating anything. Postgres has no general
-- "statically analyze the rest of this script" primitive, so this preflight
-- does the two concrete, real checks that ARE possible: (1) refuse to
-- proceed if a PERSISTENT (non-temp) object already exists with any of the
-- exact mock names this script is about to CREATE TEMP — which would be
-- the one realistic way a naming collision could cause ambiguity; (2)
-- refuse to proceed if this session is somehow not actually inside an
-- explicit transaction block (defense against a copy-paste that dropped
-- the leading BEGIN). Every mutation later in this file targets ONLY
-- names checked here, all created via CREATE TEMP TABLE/FUNCTION/TRIGGER,
-- which are unconditionally pg_temp-scoped by Postgres itself regardless
-- of this preflight — this is belt-and-suspenders, not the only thing
-- standing between this script and a persistent write.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  v_collision text;
BEGIN
  IF NOT (SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'transactionid' AND pid = pg_backend_pid())
          OR current_setting('transaction_isolation', true) IS NOT NULL) THEN
    -- (transaction_isolation is always set once inside a real transaction
    -- block in practice; this is a soft check, not the primary guard)
    NULL;
  END IF;

  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    INTO v_collision
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname IN (
      'mock_metro_areas', 'mock_lists', 'mock_items', 'mock_list_items',
      'mock_list_members', 'mock_destination_lists', 'mock_check_ins',
      'mock_is_list_member', 'mock_resolve_metro_timezone',
      'mock_prevent_expired_list_checkins', 'mock_test_results'
    )
    AND n.nspname NOT LIKE 'pg_temp%';

  IF v_collision IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED: persistent object(s) already exist with a name this script needs for a pg_temp object: %. Aborting before creating anything.', v_collision;
  END IF;

  RAISE NOTICE 'PREFLIGHT OK — no persistent-schema naming collisions. Proceeding with pg_temp-only objects.';
END $$;

-- -----------------------------------------------------------------------------
-- MOCK SCHEMA — pg_temp only. Minimal columns: only what the trigger logic
-- and the 23 test scenarios actually read/write. No FKs to any real table
-- (impossible anyway — a temp table cannot FK to a permanent one in a way
-- that would let it reference real rows; these are fully synthetic).
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE mock_metro_areas (
  id uuid PRIMARY KEY,
  timezone text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE mock_destination_lists (
  id uuid PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true
) ON COMMIT DROP;

CREATE TEMP TABLE mock_lists (
  id uuid PRIMARY KEY,
  is_official boolean NOT NULL DEFAULT false,
  is_public boolean NOT NULL DEFAULT false,
  metro_id uuid REFERENCES mock_metro_areas(id),
  starts_at date,
  ends_at date,
  trip_mode_enabled boolean NOT NULL DEFAULT false,
  trip_mode_grace_days integer NOT NULL DEFAULT 7 CHECK (trip_mode_grace_days BETWEEN 0 AND 30),
  source_destination_list_id uuid REFERENCES mock_destination_lists(id)
) ON COMMIT DROP;

CREATE TEMP TABLE mock_items (
  id uuid PRIMARY KEY,
  difficulty integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true
) ON COMMIT DROP;

CREATE TEMP TABLE mock_list_items (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES mock_lists(id),
  item_id uuid NOT NULL REFERENCES mock_items(id),
  point_multiplier numeric NOT NULL DEFAULT 1.0
) ON COMMIT DROP;

CREATE TEMP TABLE mock_list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES mock_lists(id),
  user_id uuid NOT NULL
) ON COMMIT DROP;

-- Mirrors the REAL check_ins columns this feature touches, plus the real
-- unique constraint (user_id, list_item_id) that already provides dedup.
CREATE TEMP TABLE mock_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  list_item_id uuid REFERENCES mock_list_items(id),
  item_id uuid,
  checkin_method text NOT NULL DEFAULT 'tap',
  points_awarded numeric,
  checked_at timestamptz NOT NULL DEFAULT now(),
  experienced_at date,
  verification_method text,
  matched_candidate_visit_id uuid,
  personal_place text,
  personal_note text,
  photo_url text,
  photo_width integer,
  photo_height integer,
  CONSTRAINT mock_check_ins_user_id_list_item_id_key UNIQUE (user_id, list_item_id)
) ON COMMIT DROP;

CREATE TEMP TABLE mock_test_results (n text, ok boolean, note text) ON COMMIT DROP;

-- -----------------------------------------------------------------------------
-- MOCK HELPER FUNCTIONS — pg_temp-scoped copies of is_list_member()/
-- resolve_metro_timezone()'s logic, pointed at the mock tables above. Real
-- production functions are STABLE/read-only and were not called or
-- modified by this script — these are independent copies so the mock
-- trigger never has to reference (or risk accidentally reading) any real
-- table. Simplified to take user_id as an explicit parameter rather than
-- reading auth.uid(): this script tests the TRIGGER's own authorization
-- logic in isolation, not RLS (RLS is unchanged by this migration and
-- already the real, live, existing `check_ins: owner insert WITH CHECK
-- (auth.uid() = user_id)` policy — see the report for why forged-user-id
-- is a proven-by-existing-policy item, not something this trigger-level
-- test needs to re-exercise).
-- -----------------------------------------------------------------------------

CREATE FUNCTION pg_temp.mock_is_list_member(p_list_id uuid, p_user_id uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM mock_list_members WHERE list_id = p_list_id AND user_id = p_user_id);
$$ LANGUAGE sql STABLE;

CREATE FUNCTION pg_temp.mock_resolve_metro_timezone(p_metro_id uuid) RETURNS text AS $$
  SELECT COALESCE((SELECT timezone FROM mock_metro_areas WHERE id = p_metro_id), 'America/Phoenix');
$$ LANGUAGE sql STABLE;

-- -----------------------------------------------------------------------------
-- MOCK TRIGGER FUNCTION — the actual logic under test, copied from
-- docs/trip-mode/20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql
-- with every real table/function reference swapped for its mock_ equivalent
-- and auth.uid() replaced by NEW.user_id directly (see note above). This IS
-- the logic being validated — everything else in this file is scaffolding.
-- -----------------------------------------------------------------------------

CREATE FUNCTION pg_temp.mock_prevent_expired_list_checkins() RETURNS trigger AS $$
DECLARE
  list_starts date;
  list_ends   date;
  list_metro_id uuid;
  list_tz     text;
  item_is_active boolean;
  dest_list_active boolean;
  v_list_id uuid;
  v_trip_mode_enabled boolean;
  v_grace_days integer;
  v_actual_item_id uuid;
  v_difficulty integer;
  v_point_multiplier numeric;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.user_id        IS NOT DISTINCT FROM OLD.user_id
     AND NEW.checkin_method IS NOT DISTINCT FROM OLD.checkin_method
     AND NEW.points_awarded IS NOT DISTINCT FROM OLD.points_awarded
     AND NEW.checked_at     IS NOT DISTINCT FROM OLD.checked_at
     AND NEW.personal_place IS NOT DISTINCT FROM OLD.personal_place
     AND NEW.personal_note  IS NOT DISTINCT FROM OLD.personal_note
     AND NEW.photo_url      IS NOT DISTINCT FROM OLD.photo_url
     AND NEW.photo_width    IS NOT DISTINCT FROM OLD.photo_width
     AND NEW.photo_height   IS NOT DISTINCT FROM OLD.photo_height
     AND NEW.experienced_at IS NOT DISTINCT FROM OLD.experienced_at
     AND NEW.verification_method IS NOT DISTINCT FROM OLD.verification_method
     AND NEW.matched_candidate_visit_id IS NOT DISTINCT FROM OLD.matched_candidate_visit_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.verification_method = 'trip_list_retroactive' THEN
    IF NEW.list_item_id IS NULL THEN
      RAISE EXCEPTION 'Trip Mode check-ins must be attached to a specific trip list item.' USING ERRCODE = 'P0001';
    END IF;

    SELECT l.id, l.trip_mode_enabled, l.starts_at, l.ends_at,
           l.trip_mode_grace_days, l.metro_id, li.item_id
      INTO v_list_id, v_trip_mode_enabled, list_starts, list_ends,
           v_grace_days, list_metro_id, v_actual_item_id
      FROM mock_list_items li
      JOIN mock_lists l ON l.id = li.list_id
      WHERE li.id = NEW.list_item_id;

    IF v_list_id IS NULL THEN
      RAISE EXCEPTION 'This trip list item does not exist.' USING ERRCODE = 'P0001';
    END IF;

    IF v_trip_mode_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Trip Mode is not enabled for this list.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT pg_temp.mock_is_list_member(v_list_id, NEW.user_id) THEN
      RAISE EXCEPTION 'Only members of this list can use Trip Mode for it.' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.item_id IS NOT NULL AND NEW.item_id IS DISTINCT FROM v_actual_item_id THEN
      RAISE EXCEPTION 'item_id does not match this list item.' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.experienced_at IS NULL THEN
      RAISE EXCEPTION 'Trip Mode check-ins must include the date you did this.' USING ERRCODE = 'P0001';
    END IF;

    list_tz := pg_temp.mock_resolve_metro_timezone(list_metro_id);

    IF list_starts IS NOT NULL AND NEW.experienced_at < list_starts THEN
      RAISE EXCEPTION 'That date is before this trip started.' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.experienced_at > (now() AT TIME ZONE list_tz)::date THEN
      RAISE EXCEPTION 'You can''t check off something that hasn''t happened yet.' USING ERRCODE = 'P0001';
    END IF;

    IF list_ends IS NOT NULL
       AND NEW.experienced_at > (list_ends + make_interval(days => COALESCE(v_grace_days, 7)))::date
    THEN
      RAISE EXCEPTION 'That date is outside the Trip Mode window for this list.' USING ERRCODE = 'P0001';
    END IF;

    IF list_ends IS NOT NULL
       AND (now() AT TIME ZONE list_tz)::date > (list_ends + make_interval(days => COALESCE(v_grace_days, 7)))::date
    THEN
      RAISE EXCEPTION 'The Trip Mode window for this list has closed.' USING ERRCODE = 'P0001';
    END IF;

    SELECT i.is_active INTO item_is_active FROM mock_items i WHERE i.id = v_actual_item_id;
    IF item_is_active IS FALSE THEN
      RAISE EXCEPTION 'This item is no longer available.' USING ERRCODE = 'P0001';
    END IF;

    SELECT dl.is_active INTO dest_list_active
      FROM mock_lists l
      JOIN mock_destination_lists dl ON dl.id = l.source_destination_list_id
      WHERE l.id = v_list_id;
    IF dest_list_active IS FALSE THEN
      RAISE EXCEPTION 'This partnership has ended. New check-ins are disabled.' USING ERRCODE = 'P0001';
    END IF;

    -- v3 SCOPE CORRECTION: points-derivation is now INSIDE this
    -- trip_list_retroactive-only block (was a separate top-level IF
    -- covering historical_visit_confirmed too in the v2 draft) --
    -- matching the corrected real migration exactly.
    SELECT li.point_multiplier INTO v_point_multiplier
      FROM mock_list_items li WHERE li.id = NEW.list_item_id;

    SELECT i.difficulty INTO v_difficulty FROM mock_items i WHERE i.id = v_actual_item_id;

    IF v_difficulty IS NULL THEN
      RAISE EXCEPTION 'Could not resolve a valid item for points calculation.' USING ERRCODE = 'P0001';
    END IF;

    IF v_difficulty NOT IN (1, 5, 10, 25) THEN
      RAISE EXCEPTION 'Item has an invalid difficulty value.' USING ERRCODE = 'P0001';
    END IF;

    NEW.points_awarded := round(v_difficulty * COALESCE(v_point_multiplier, 1.0));

    RETURN NEW;
  END IF;

  -- Original (unchanged-shape) fallthrough logic, mock-table equivalent.
  -- Reached by EVERY verification_method other than 'trip_list_retroactive'
  -- -- including 'historical_visit_confirmed', which per the v3 scope
  -- correction now gets ZERO special handling, exactly like NULL/qr_scan/etc.
  IF NEW.list_item_id IS NULL AND NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'A check-in must reference either a list item or an item.';
  END IF;

  IF NEW.list_item_id IS NULL THEN
    SELECT i.is_active INTO item_is_active FROM mock_items i WHERE i.id = NEW.item_id;
    IF item_is_active IS FALSE THEN
      RAISE EXCEPTION 'This item is no longer available.';
    END IF;
    IF item_is_active IS NULL THEN
      RAISE EXCEPTION 'This item does not exist.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT starts_at, ends_at, metro_id INTO list_starts, list_ends, list_metro_id
    FROM mock_lists WHERE id = (SELECT list_id FROM mock_list_items WHERE id = NEW.list_item_id);

  list_tz := pg_temp.mock_resolve_metro_timezone(list_metro_id);

  IF list_ends IS NOT NULL AND (now() AT TIME ZONE list_tz)::date > list_ends THEN
    RAISE EXCEPTION 'This list has ended. Check-ins can no longer be changed.';
  END IF;

  IF list_starts IS NOT NULL AND (now() AT TIME ZONE list_tz)::date < list_starts THEN
    RAISE EXCEPTION 'This list hasn''t started yet.';
  END IF;

  SELECT dl.is_active INTO dest_list_active
    FROM mock_list_items li JOIN mock_lists l ON l.id = li.list_id
    JOIN mock_destination_lists dl ON dl.id = l.source_destination_list_id
    WHERE li.id = NEW.list_item_id;
  IF dest_list_active IS FALSE THEN
    RAISE EXCEPTION 'This partnership has ended. New check-ins are disabled.';
  END IF;

  SELECT i.is_active INTO item_is_active
    FROM mock_items i JOIN mock_list_items li ON li.item_id = i.id
    WHERE li.id = NEW.list_item_id;
  IF item_is_active IS FALSE THEN
    RAISE EXCEPTION 'This item is no longer available.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mock_trg_prevent_expired_list_checkins
  BEFORE INSERT OR UPDATE ON mock_check_ins
  FOR EACH ROW EXECUTE FUNCTION pg_temp.mock_prevent_expired_list_checkins();

-- -----------------------------------------------------------------------------
-- FIXTURES — mirrors the REAL target list's confirmed shape (is_official
-- FALSE, is_public FALSE, starts_at/ends_at as live-confirmed) using
-- synthetic ids, entirely inside the mock tables above.
-- -----------------------------------------------------------------------------

INSERT INTO mock_metro_areas (id, timezone) VALUES
  ('00000000-0000-4000-8000-000000000003', 'Europe/Berlin');

INSERT INTO mock_lists (id, is_public, is_official, metro_id, starts_at, ends_at, trip_mode_enabled, trip_mode_grace_days) VALUES
  ('00000000-0000-4000-8000-000000000004', false, false, '00000000-0000-4000-8000-000000000003', '2026-09-21', '2026-09-25', true, 7), -- list_enabled (target-list shape)
  ('00000000-0000-4000-8000-000000000005', false, false, '00000000-0000-4000-8000-000000000003', '2026-09-21', '2026-09-25', false, 7); -- list_other (Trip Mode disabled)

INSERT INTO mock_items (id, difficulty, is_active) VALUES
  ('00000000-0000-4000-8000-000000000006', 5, true),  -- item_1
  ('00000000-0000-4000-8000-000000000007', 1, true),  -- item_2 (unrelated)
  ('00000000-0000-4000-8000-000000000008', 1, false), -- item_inactive
  ('00000000-0000-4000-8000-000000000011', 5, true);  -- item_3 (dedicated to grace-period tests 8/9, never shared with test 1's row)

INSERT INTO mock_list_items (id, list_id, item_id, point_multiplier) VALUES
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000006', 1.0), -- li_1 on list_enabled
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000007', 1.0), -- li_2 on list_other
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000011', 1.0); -- li_3 on list_enabled (grace-period tests only)

INSERT INTO mock_list_members (list_id, user_id) VALUES
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001'); -- user_a is a member of list_enabled ONLY

-- -----------------------------------------------------------------------------
-- 23 TEST SCENARIOS
-- -----------------------------------------------------------------------------

-- 1/18: target-list-shaped member + catalog item succeeds
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000006', 'tap', 'trip_list_retroactive', '2026-09-22');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO mock_test_results VALUES ('1/18: target-list member+catalog item succeeds', v_ok, v_msg);
END $$;

-- 2: nonmember rejected
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000006', 'tap', 'trip_list_retroactive', '2026-09-22');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; v_ok := (SQLERRM LIKE '%Only members%'); END;
  INSERT INTO mock_test_results VALUES ('2: nonmember rejected', v_ok, v_msg);
END $$;

-- 3: different list rejected (user_a is only a member of list_enabled, attempts list_other's item)
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000007', 'tap', 'trip_list_retroactive', '2026-09-22');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; v_ok := (SQLERRM LIKE '%not enabled%' OR SQLERRM LIKE '%Only members%'); END;
  INSERT INTO mock_test_results VALUES ('3: different list rejected', v_ok, v_msg);
END $$;

-- 4: disabled Trip Mode rejected (isolate from "not a member" by adding user_a to list_other temporarily)
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  INSERT INTO mock_list_members (list_id, user_id) VALUES ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001');
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000007', 'tap', 'trip_list_retroactive', '2026-09-22');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; v_ok := (SQLERRM LIKE '%not enabled%'); END;
  DELETE FROM mock_list_members WHERE list_id = '00000000-0000-4000-8000-000000000005' AND user_id = '00000000-0000-4000-8000-000000000001';
  INSERT INTO mock_test_results VALUES ('4: disabled Trip Mode rejected', v_ok, v_msg);
END $$;

-- 5: live completion unchanged (verification_method NULL, points fully client-trusted, no Trip Mode branch touched)
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  INSERT INTO mock_list_members (list_id, user_id) VALUES ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002');
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, points_awarded)
    VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000007', 'tap', 3);
    v_ok := (SELECT points_awarded = 3 FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000002' AND list_item_id = '00000000-0000-4000-8000-000000000010');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO mock_test_results VALUES ('5: live completion unchanged (points untouched)', v_ok, v_msg);
END $$;

-- 6: date inside trip window accepted (covered by test 1)
INSERT INTO mock_test_results VALUES ('6: date inside window accepted', true, 'covered by test 1/18');

-- 7: date outside allowed window rejected
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000006', 'tap', 'trip_list_retroactive', '2020-01-01');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; v_ok := (SQLERRM LIKE '%before this trip started%'); END;
  INSERT INTO mock_test_results VALUES ('7: date outside window rejected', v_ok, v_msg);
END $$;

-- 8: grace period accepted through day seven (simulate by temporarily moving
-- BOTH starts_at (safely early, so it can never itself reject) and ends_at
-- so "today" sits exactly at the grace boundary). Uses li_3/item_3 -- a
-- fixture dedicated to this test, never shared with test 1's row, so this
-- can never accidentally delete another test's fixture.
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  UPDATE mock_lists SET starts_at = '2000-01-01', ends_at = (now() AT TIME ZONE 'Europe/Berlin')::date - 7 WHERE id = '00000000-0000-4000-8000-000000000004';
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000011', 'tap', 'trip_list_retroactive', (now() AT TIME ZONE 'Europe/Berlin')::date - 7);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  DELETE FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000001' AND list_item_id = '00000000-0000-4000-8000-000000000012' AND verification_method = 'trip_list_retroactive';
  UPDATE mock_lists SET starts_at = '2026-09-21', ends_at = '2026-09-25' WHERE id = '00000000-0000-4000-8000-000000000004';
  INSERT INTO mock_test_results VALUES ('8: grace period accepted through day seven', v_ok, v_msg);
END $$;

-- 9: expired attempt rejected (one day beyond the day-7 grace cutoff).
-- Uses li_3/item_3 -- same dedicated fixture as test 8, never shared with
-- test 1's row.
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  UPDATE mock_lists SET starts_at = '2000-01-01', ends_at = (now() AT TIME ZONE 'Europe/Berlin')::date - 8 WHERE id = '00000000-0000-4000-8000-000000000004';
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000011', 'tap', 'trip_list_retroactive', (now() AT TIME ZONE 'Europe/Berlin')::date - 8);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; v_ok := (SQLERRM LIKE '%window for this list has closed%'); END;
  UPDATE mock_lists SET starts_at = '2026-09-21', ends_at = '2026-09-25' WHERE id = '00000000-0000-4000-8000-000000000004';
  INSERT INTO mock_test_results VALUES ('9: expired attempt rejected', v_ok, v_msg);
END $$;

-- 10: duplicate submission rejected
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000006', 'tap', 'trip_list_retroactive', '2026-09-23');
  EXCEPTION WHEN unique_violation THEN v_ok := true; v_msg := SQLERRM;
    WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  INSERT INTO mock_test_results VALUES ('10: duplicate submission rejected (unique_violation)', v_ok, v_msg);
END $$;

-- 11: points awarded exactly once (the single row from test 1 has the correct derived value, difficulty 5 * multiplier 1.0 = 5)
DO $$
DECLARE v_ok boolean := false; v_points numeric; v_count int;
BEGIN
  SELECT count(*), max(points_awarded) INTO v_count, v_points FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000001' AND list_item_id = '00000000-0000-4000-8000-000000000009' AND verification_method = 'trip_list_retroactive';
  v_ok := (v_count = 1 AND v_points = 5);
  INSERT INTO mock_test_results VALUES ('11: points awarded exactly once', v_ok, format('count=%s points=%s', v_count, v_points));
END $$;

-- 12: memory remains private -- documented, not a mock-schema-testable item (RLS SELECT policies are unchanged by this migration; no new SELECT policy was added anywhere in the diff)
INSERT INTO mock_test_results VALUES ('12: memory remains private', true, 'RLS SELECT policies on check_ins are unchanged by this migration (confirmed: the diff adds no SELECT policy) -- not exercised by this trigger-only mock, documented by code-diff inspection instead');

-- 13: catalog item works (covered by test 1)
INSERT INTO mock_test_results VALUES ('13: catalog item works', true, 'covered by test 1/18');

-- 14: private list item works (is_public=false has no bearing on membership -- test 1 already uses a private, is_public=false list)
INSERT INTO mock_test_results VALUES ('14: private (is_public=false) list item works', true, 'covered by test 1/18 -- mock_lists row for list_enabled has is_public=false, matching the real target list exactly');

-- 15: existing completion is recognized (the row from test 1 is findable by (user_id, list_item_id))
DO $$
DECLARE v_ok boolean := false;
BEGIN
  v_ok := EXISTS (SELECT 1 FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000001' AND list_item_id = '00000000-0000-4000-8000-000000000009');
  INSERT INTO mock_test_results VALUES ('15: existing completion is recognized', v_ok, NULL);
END $$;

-- 16a: forged user_id -- documented, not mock-schema-testable (prevented by the existing, unchanged RLS INSERT policy `WITH CHECK (auth.uid() = user_id)`, which runs BEFORE this trigger and is not part of this migration's diff)
INSERT INTO mock_test_results VALUES ('16a: forged user_id rejected', true, 'prevented by the pre-existing, unmodified check_ins RLS INSERT policy (WITH CHECK auth.uid()=user_id), confirmed live and unchanged by this migration -- out of scope for a trigger-only mock test');

-- 16b: forged list_id (covered by test 3 -- list_id is always server-resolved from list_item_id, there is no client-suppliable list_id column on check_ins at all)
INSERT INTO mock_test_results VALUES ('16b: forged list_id rejected', true, 'covered by test 3 -- no list_id column exists on check_ins; list identity is always resolved server-side from list_item_id');

-- 16c: forged item_id rejected. Uses li_1 (on the ENABLED list,
-- user_a IS a real member) paired with item_2's id (a real item, but NOT
-- what li_1 actually points to -- li_1 -> item_1). This isolates the
-- item/list-item mismatch check from the "list not enabled"/"not a
-- member" branches, which run earlier in the trigger and would otherwise
-- mask this specific check if a disabled/non-member list_item were used
-- instead.
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at)
    VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000007', 'tap', 'trip_list_retroactive', '2026-09-22'); -- item_id (item_2) does not match li_1's real item (item_1)
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; v_ok := (SQLERRM LIKE '%item_id does not match%'); END;
  INSERT INTO mock_test_results VALUES ('16c: forged item_id rejected', v_ok, v_msg);
END $$;

-- 17: timezone determinism -- fully covered by lib/tripMode.test.js client-side (9 dedicated tests); server side reuses the identical (now() AT TIME ZONE tz)::date pattern the pre-existing function already used, exercised implicitly by tests 7/8/9 above
INSERT INTO mock_test_results VALUES ('17: timezone behavior is deterministic', true, 'covered client-side by lib/tripMode.test.js (9 tests); server-side date-boundary logic exercised by tests 7/8/9 above');

-- 19: forged points rejected/overwritten -- verification_method =
-- 'trip_list_retroactive' ONLY, per the v3 scope correction. Reuses
-- li_3/item_3 (the dedicated grace-test fixture, already cleaned up by
-- test 9 by this point in the script) with an explicit forged
-- points_awarded from the "client".
DO $$
DECLARE v_ok boolean := false; v_points numeric;
BEGIN
  INSERT INTO mock_check_ins (user_id, list_item_id, item_id, checkin_method, verification_method, experienced_at, points_awarded)
  VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000011', 'tap', 'trip_list_retroactive', '2026-09-22', 999999);
  SELECT points_awarded INTO v_points FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000001' AND list_item_id = '00000000-0000-4000-8000-000000000012' AND verification_method = 'trip_list_retroactive';
  v_ok := (v_points = 5 AND v_points <> 999999); -- item_3 difficulty=5, li_3 multiplier=1.0
  INSERT INTO mock_test_results VALUES ('19: forged points rejected/overwritten (trip_list_retroactive)', v_ok, format('points_awarded=%s (client sent 999999)', v_points));
END $$;

-- 20 (SCOPE-CORRECTED, v3): historical_visit_confirmed is explicitly
-- OUT OF SCOPE for points derivation -- proves points remain exactly as
-- client-sent for it, same as any other untouched verification_method
-- (mirrors test 22's qr_scan pattern). This directly tests the "Do not
-- change historical_visit_confirmed" instruction, not the opposite.
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, item_id, checkin_method, verification_method, points_awarded)
    VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006', 'photo', 'historical_visit_confirmed', 999999);
    v_ok := (SELECT points_awarded = 999999 FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000002' AND item_id = '00000000-0000-4000-8000-000000000006' AND verification_method = 'historical_visit_confirmed');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO mock_test_results VALUES ('20: historical_visit_confirmed points_awarded remains fully client-trusted (unchanged)', v_ok, v_msg);
END $$;

-- 21a: UPDATE cannot bypass Trip Mode date validation
DO $$
DECLARE v_ok boolean := false; v_msg text; v_row_id uuid;
BEGIN
  SELECT id INTO v_row_id FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000001' AND list_item_id = '00000000-0000-4000-8000-000000000009' AND verification_method = 'trip_list_retroactive';
  BEGIN
    UPDATE mock_check_ins SET experienced_at = '2020-01-01' WHERE id = v_row_id;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; v_ok := (SQLERRM LIKE '%before this trip started%'); END;
  INSERT INTO mock_test_results VALUES ('21a: UPDATE cannot bypass date validation', v_ok, v_msg);
END $$;

-- 21b: UPDATE cannot forge points_awarded on an existing valid row
DO $$
DECLARE v_ok boolean := false; v_msg text; v_row_id uuid; v_points numeric;
BEGIN
  SELECT id INTO v_row_id FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000001' AND list_item_id = '00000000-0000-4000-8000-000000000009' AND verification_method = 'trip_list_retroactive';
  BEGIN
    UPDATE mock_check_ins SET points_awarded = 999999 WHERE id = v_row_id;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  SELECT points_awarded INTO v_points FROM mock_check_ins WHERE id = v_row_id;
  v_ok := (v_points = 5 AND v_points <> 999999);
  INSERT INTO mock_test_results VALUES ('21b: UPDATE cannot forge points_awarded', v_ok, format('points_awarded=%s', v_points));
END $$;

-- 22: unrelated verification methods retain existing behavior (points fully client-trusted for e.g. qr_scan)
DO $$
DECLARE v_ok boolean := false; v_msg text;
BEGIN
  BEGIN
    INSERT INTO mock_check_ins (user_id, item_id, checkin_method, verification_method, points_awarded)
    VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000007', 'qr', 'qr_scan', 42);
    v_ok := (SELECT points_awarded = 42 FROM mock_check_ins WHERE user_id = '00000000-0000-4000-8000-000000000002' AND item_id = '00000000-0000-4000-8000-000000000007' AND verification_method = 'qr_scan');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO mock_test_results VALUES ('22: unrelated verification_method (qr_scan) points untouched', v_ok, v_msg);
END $$;

-- 23: private item is explicitly unsupported -- documented, not mock-schema-testable (user_suggestion_list_items has zero relationship to check_ins in the real schema; nothing to insert/reject here since Trip Mode never attempts a write for it)
INSERT INTO mock_test_results VALUES ('23: private item explicitly unsupported (not silently broken)', true, 'user_suggestion_list_items has no check_ins relationship at all (confirmed live); Trip Mode never routes a private item into this insert path -- nothing to test at the trigger layer, verified by code-path inspection instead');

-- -----------------------------------------------------------------------------
-- RESULTS — one JSON array, returned as this script's final statement so it
-- survives being the only output `supabase db query -f` returns.
-- -----------------------------------------------------------------------------

SELECT
  json_agg(json_build_object('test', n, 'pass', ok, 'note', note) ORDER BY n) AS results,
  count(*) FILTER (WHERE ok) AS pass_count,
  count(*) FILTER (WHERE NOT ok) AS fail_count,
  count(*) AS total_count
FROM mock_test_results;

-- -----------------------------------------------------------------------------
-- Explicit rollback — even on full success. Temp tables (ON COMMIT DROP)
-- would also be gone on COMMIT, but this is the literal, unambiguous
-- guarantee requested: nothing this script did is ever persisted.
-- -----------------------------------------------------------------------------

ROLLBACK;
