-- =============================================================================
-- Visit Detection duplicate-completion guard (2026-09-24) — closes the gap
-- identified in build-readiness review: confirming a candidate visit for an
-- item the user already checked off (through ANY path -- live, photo,
-- Trip Mode, or an earlier confirm) must not create a second check_ins row
-- or award points twice, including when that other completion happened
-- AFTER the candidate_visits row was created.
--
-- TWO INDEPENDENT PIECES, matching the two distinct races this closes:
--
-- 1. SEQUENTIAL duplicate (live check-off, then later confirm, or vice
--    versa; or confirm-then-confirm-again on a DIFFERENT still-open
--    candidate_visits row for the same item): a plain existence check added
--    to prevent_expired_list_checkins()'s historical_visit_confirmed
--    branch, run inside the same BEFORE INSERT trigger every check_ins
--    insert already goes through -- server-enforced, no client trust.
--
-- 2. CONCURRENT duplicate (two simultaneous confirm attempts, whether for
--    the same candidate_visits row or two different ones on the same
--    item): the existence check above has a TOCTOU race window between
--    truly simultaneous transactions, so it alone isn't sufficient. A new
--    partial unique index makes two concurrent
--    verification_method='historical_visit_confirmed' inserts for the same
--    (user_id, item_id) atomically impossible at the Postgres level -- the
--    second transaction gets a real unique-violation, guaranteed.
--
-- SCOPE, DELIBERATELY NARROW: does NOT add a general uniqueness constraint
-- on (user_id, item_id) across all check_ins. A live production check this
-- session found genuine pre-existing duplicate standalone check-ins today
-- (verification_method IS NULL, from what looks like an unrelated
-- double-tap in the live check-off flow) -- adding a blanket constraint
-- would conflict with that real data and would change behavior for the
-- live/photo paths, which is explicitly out of scope ("Verify Trip Mode and
-- existing check-off behavior remain intact"). The partial index below only
-- ever applies to rows with verification_method = 'historical_visit_confirmed'
-- -- zero existing rows have that value, so creating it cannot conflict with
-- anything live today.
--
-- INSTALLED-APP COMPATIBILITY: the currently-installed app never sends
-- verification_method='historical_visit_confirmed' at all (that value only
-- exists in JS shipped by this build) -- neither the new EXISTS check nor
-- the new partial index can ever fire for old-app traffic. Every other
-- verification_method, and the original trigger body, are reproduced here
-- byte-for-byte unchanged from the live production definition.
--
-- Tested rollback-only before being applied: normal check-off then confirm
-- (rejected), confirm then a second confirm on a fresh candidate_visits row
-- for the same item (rejected), two simultaneous confirm attempts via
-- overlapping transactions (one wins, one gets a real unique-violation),
-- Trip Mode and live check-off paths unaffected.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_expired_list_checkins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  list_starts date;
  list_ends   date;
  list_metro_id uuid;
  list_tz     text;
  item_is_active boolean;
  dest_list_active boolean;
  -- Trip Mode MVP (2026-09-23) additions:
  v_list_id uuid;
  v_trip_mode_enabled boolean;
  v_grace_days integer;
  v_actual_item_id uuid;
  v_difficulty integer;
  v_point_multiplier numeric;
  -- Visit Detection Stage 2 (2026-09-23) additions:
  v_cv_user_id uuid;
  v_cv_item_id uuid;
  v_cv_status text;
  v_cv_expires_at timestamptz;
  v_cv_confirmed_at timestamptz;
  v_cv_rejected_at timestamptz;
  v_cv_difficulty integer;
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

  -- ═══════════════════════════════════════════════════════════════════════
  -- TRIP MODE MVP (2026-09-23) — unchanged, byte-for-byte, from the live
  -- production definition confirmed via pg_get_functiondef this session.
  -- ═══════════════════════════════════════════════════════════════════════
  IF NEW.verification_method = 'trip_list_retroactive' THEN

    IF NEW.list_item_id IS NULL THEN
      RAISE EXCEPTION 'Trip Mode check-ins must be attached to a specific trip list item.'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT l.id, l.trip_mode_enabled, l.starts_at, l.ends_at,
           l.trip_mode_grace_days, l.metro_id, li.item_id
      INTO v_list_id, v_trip_mode_enabled, list_starts, list_ends,
           v_grace_days, list_metro_id, v_actual_item_id
      FROM public.list_items li
      JOIN public.lists l ON l.id = li.list_id
      WHERE li.id = NEW.list_item_id;

    IF v_list_id IS NULL THEN
      RAISE EXCEPTION 'This trip list item does not exist.' USING ERRCODE = 'P0001';
    END IF;

    IF v_trip_mode_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Trip Mode is not enabled for this list.' USING ERRCODE = 'P0001';
    END IF;

    IF NOT public.is_list_member(v_list_id) THEN
      RAISE EXCEPTION 'Only members of this list can use Trip Mode for it.' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.item_id IS NOT NULL AND NEW.item_id IS DISTINCT FROM v_actual_item_id THEN
      RAISE EXCEPTION 'item_id does not match this list item.' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.experienced_at IS NULL THEN
      RAISE EXCEPTION 'Trip Mode check-ins must include the date you did this.' USING ERRCODE = 'P0001';
    END IF;

    list_tz := public.resolve_metro_timezone(list_metro_id);

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

    SELECT i.is_active INTO item_is_active FROM public.items i WHERE i.id = v_actual_item_id;
    IF item_is_active IS FALSE THEN
      RAISE EXCEPTION 'This item is no longer available.' USING ERRCODE = 'P0001';
    END IF;

    SELECT dl.is_active INTO dest_list_active
      FROM public.lists l
      JOIN public.destination_lists dl ON dl.id = l.source_destination_list_id
      WHERE l.id = v_list_id;
    IF dest_list_active IS FALSE THEN
      RAISE EXCEPTION 'This partnership has ended. New check-ins are disabled.' USING ERRCODE = 'P0001';
    END IF;

    SELECT li.point_multiplier INTO v_point_multiplier
      FROM public.list_items li WHERE li.id = NEW.list_item_id;

    SELECT i.difficulty INTO v_difficulty FROM public.items i WHERE i.id = v_actual_item_id;

    IF v_difficulty IS NULL THEN
      RAISE EXCEPTION 'Could not resolve a valid item for points calculation.' USING ERRCODE = 'P0001';
    END IF;

    IF v_difficulty NOT IN (1, 5, 10, 25) THEN
      RAISE EXCEPTION 'Item has an invalid difficulty value.' USING ERRCODE = 'P0001';
    END IF;

    NEW.points_awarded := round(v_difficulty * COALESCE(v_point_multiplier, 1.0));

    RETURN NEW;
  END IF;
  -- ═══════════════════════════════════════ end Trip Mode authorization ═══

  -- ═══════════════════════════════════════════════════════════════════════
  -- VISIT DETECTION STAGE 2 (2026-09-23) — confirm a specific candidate
  -- visit. Only reached when the client explicitly sets this
  -- verification_method; every other value (NULL, 'trip_list_retroactive',
  -- etc.) is unaffected. Standalone-item only (list_item_id must be NULL) —
  -- candidate_visits are always item-level, never list-item-level, so there
  -- is no list/trip-window concept to enforce here; the authorization
  -- boundary is entirely "does a real, owned, unexpired, not-yet-converted
  -- candidate_visits row exist for this exact item."
  -- ═══════════════════════════════════════════════════════════════════════
  IF NEW.verification_method = 'historical_visit_confirmed' THEN

    IF NEW.list_item_id IS NOT NULL THEN
      RAISE EXCEPTION 'Visit confirmation is only supported for standalone items.' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.matched_candidate_visit_id IS NULL THEN
      RAISE EXCEPTION 'A visit confirmation must reference the specific candidate visit being confirmed.' USING ERRCODE = 'P0001';
    END IF;

    IF NEW.item_id IS NULL THEN
      RAISE EXCEPTION 'A visit confirmation must reference an item.' USING ERRCODE = 'P0001';
    END IF;

    -- Lock the row so two concurrent confirm attempts (or a confirm racing a
    -- dismiss) can't both succeed.
    SELECT user_id, item_id, status, expires_at, confirmed_at, rejected_at
      INTO v_cv_user_id, v_cv_item_id, v_cv_status, v_cv_expires_at, v_cv_confirmed_at, v_cv_rejected_at
      FROM public.candidate_visits
      WHERE id = NEW.matched_candidate_visit_id
      FOR UPDATE;

    IF v_cv_user_id IS NULL THEN
      RAISE EXCEPTION 'That candidate visit no longer exists.' USING ERRCODE = 'P0001';
    END IF;

    -- auth.uid() directly, not NEW.user_id — SECURITY DEFINER means this
    -- function runs with elevated privilege, but auth.uid() still resolves
    -- to the real calling user's JWT claim, and check_ins' own RLS INSERT
    -- policy already forces NEW.user_id = auth.uid(), so this is never
    -- spoofable via a client-supplied user_id on either row.
    IF v_cv_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'You can only confirm your own candidate visits.' USING ERRCODE = 'P0001';
    END IF;

    IF v_cv_item_id IS DISTINCT FROM NEW.item_id THEN
      RAISE EXCEPTION 'item_id does not match this candidate visit.' USING ERRCODE = 'P0001';
    END IF;

    IF v_cv_confirmed_at IS NOT NULL OR v_cv_rejected_at IS NOT NULL OR v_cv_status NOT IN ('candidate', 'medium_confidence', 'high_confidence') THEN
      RAISE EXCEPTION 'This visit has already been confirmed, dismissed, or expired.' USING ERRCODE = 'P0001';
    END IF;

    IF v_cv_expires_at IS NOT NULL AND v_cv_expires_at < now() THEN
      RAISE EXCEPTION 'This visit suggestion has expired.' USING ERRCODE = 'P0001';
    END IF;

    SELECT i.is_active INTO item_is_active FROM public.items i WHERE i.id = NEW.item_id;
    IF item_is_active IS FALSE THEN
      RAISE EXCEPTION 'This item is no longer available.' USING ERRCODE = 'P0001';
    END IF;
    IF item_is_active IS NULL THEN
      RAISE EXCEPTION 'This item does not exist.' USING ERRCODE = 'P0001';
    END IF;

    -- DUPLICATE-COMPLETION GUARD (2026-09-24) -- the gap identified during
    -- build readiness review: confirming a candidate visit for an item the
    -- user already completed through ANY path (a live check-in, an earlier
    -- confirm, Trip Mode -- any verification_method) must not create a
    -- second check_ins row or award points twice, including when that
    -- other completion happened AFTER this candidate_visits row was
    -- created (e.g. the user checked off live at the venue while this
    -- suggestion was still sitting unconfirmed in their inbox). This is a
    -- plain existence check, not time-anchored to arrival_at/created_at at
    -- all -- "already done, by any means, as of right now" is the whole
    -- rule. It runs inside the SAME BEFORE INSERT trigger as every other
    -- check_ins insert, so it applies without any client trust.
    IF EXISTS (
      SELECT 1 FROM public.check_ins WHERE user_id = NEW.user_id AND item_id = NEW.item_id
    ) THEN
      RAISE EXCEPTION 'This item has already been checked off.' USING ERRCODE = 'P0001';
    END IF;

    SELECT i.difficulty INTO v_cv_difficulty FROM public.items i WHERE i.id = NEW.item_id;
    IF v_cv_difficulty IS NULL THEN
      RAISE EXCEPTION 'Could not resolve a valid item for points calculation.' USING ERRCODE = 'P0001';
    END IF;
    IF v_cv_difficulty NOT IN (1, 5, 10, 25) THEN
      RAISE EXCEPTION 'Item has an invalid difficulty value.' USING ERRCODE = 'P0001';
    END IF;

    -- Standalone item, no list multiplier — same formula every other
    -- standalone check-off uses today, just derived server-side here rather
    -- than trusted from the client, same rationale as Trip Mode's fix.
    NEW.points_awarded := v_cv_difficulty;

    -- The candidate_visits back-link (status/confirmed_at/converted_checkoff_id)
    -- is NOT set here. converted_checkoff_id has a FK to check_ins(id), and
    -- this is a BEFORE INSERT trigger -- the check_ins row NEW refers to does
    -- not exist yet at this point in the transaction, so an UPDATE
    -- referencing NEW.id here fails the FK check immediately (confirmed by
    -- this migration's own rollback-only test run before it was applied).
    -- See mark_candidate_visit_confirmed() below (AFTER INSERT on check_ins),
    -- which runs once this row is real. The FOR UPDATE lock taken above is
    -- held for the rest of this transaction, so no concurrent confirm/
    -- dismiss can race between this validation and that AFTER trigger.
    RETURN NEW;
  END IF;
  -- ═════════════════════════════════════ end visit confirmation authorization ═══

  -- ═══════════════════════════════════════════════════════════════════════
  -- ORIGINAL FUNCTION BODY — unchanged from the live production definition.
  -- ═══════════════════════════════════════════════════════════════════════

  IF NEW.list_item_id IS NULL AND NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'A check-in must reference either a list item or an item.';
  END IF;

  IF NEW.list_item_id IS NULL THEN
    SELECT i.is_active INTO item_is_active
    FROM items i
    WHERE i.id = NEW.item_id;

    IF item_is_active IS FALSE THEN
      RAISE EXCEPTION 'This item is no longer available.';
    END IF;

    IF item_is_active IS NULL THEN
      RAISE EXCEPTION 'This item does not exist.';
    END IF;

    RETURN NEW;
  END IF;

  SELECT starts_at, ends_at, metro_id
  INTO list_starts, list_ends, list_metro_id
  FROM lists
  WHERE id = (
    SELECT list_id FROM list_items WHERE id = NEW.list_item_id
  );

  list_tz := public.resolve_metro_timezone(list_metro_id);

  IF list_ends IS NOT NULL AND (now() AT TIME ZONE list_tz)::date > list_ends THEN
    RAISE EXCEPTION 'This list has ended. Check-ins can no longer be changed.';
  END IF;

  IF list_starts IS NOT NULL AND (now() AT TIME ZONE list_tz)::date < list_starts THEN
    RAISE EXCEPTION 'This list hasn''t started yet. Check back on %.', to_char(list_starts, 'Month DD, YYYY');
  END IF;

  SELECT dl.is_active
  INTO dest_list_active
  FROM list_items li
  JOIN lists l ON l.id = li.list_id
  JOIN destination_lists dl ON dl.id = l.source_destination_list_id
  WHERE li.id = NEW.list_item_id;

  IF dest_list_active IS FALSE THEN
    RAISE EXCEPTION 'This partnership has ended. New check-ins are disabled.';
  END IF;

  SELECT i.is_active
  INTO item_is_active
  FROM items i
  JOIN list_items li ON li.item_id = i.id
  WHERE li.id = NEW.list_item_id;

  IF item_is_active IS FALSE THEN
    RAISE EXCEPTION 'This item is no longer available.';
  END IF;

  RETURN NEW;
END;
$function$;

-- -----------------------------------------------------------------------------
-- Partial unique index closing the CONCURRENT-confirm race. Only ever
-- constrains verification_method = 'historical_visit_confirmed' rows.
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS check_ins_one_confirmed_visit_per_item
  ON public.check_ins (user_id, item_id)
  WHERE verification_method = 'historical_visit_confirmed';

COMMENT ON INDEX check_ins_one_confirmed_visit_per_item IS
  'Visit Detection duplicate-completion guard (2026-09-24): at most one historical_visit_confirmed check-in per user per item, enforced atomically against concurrent confirm attempts. Does not constrain any other verification_method.';

-- Postflight guard.
DO $$
DECLARE
  idx_count int;
  duplicate_confirmed_check int;
BEGIN
  SELECT count(*) INTO idx_count FROM pg_indexes
  WHERE tablename = 'check_ins' AND indexname = 'check_ins_one_confirmed_visit_per_item';
  IF idx_count < 1 THEN
    RAISE EXCEPTION 'check_ins_one_confirmed_visit_per_item index did not get created';
  END IF;

  SELECT count(*) INTO duplicate_confirmed_check
  FROM check_ins WHERE verification_method = 'historical_visit_confirmed';
  IF duplicate_confirmed_check <> 0 THEN
    RAISE EXCEPTION 'Unexpected pre-existing historical_visit_confirmed rows found (%), review before assuming this index applied cleanly', duplicate_confirmed_check;
  END IF;
END $$;

COMMIT;
