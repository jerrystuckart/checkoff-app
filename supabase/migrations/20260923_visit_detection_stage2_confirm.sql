-- =============================================================================
-- Visit Detection Stage 2 (2026-09-23) — confirm/review authorization +
-- candidate_visits forgery-plausibility gate + re-applying the departure
-- notification trigger, which a live audit this session found MISSING from
-- production (its migration file, 20260902_visit_reminder_v1_notify_trigger.sql,
-- exists in the repo but pg_trigger showed zero live triggers on
-- candidate_visits — the CREATE OR REPLACE below is idempotent and safe to
-- re-run regardless of why it never landed).
--
-- Tester-only in practice: every user-facing surface this migration enables
-- (the confirm insert path, the notify trigger) is already gated upstream
-- by users.visit_detection_tester (1 of 129 users today) via
-- lib/featureFlags.js's TESTER_GATED_FLAGS and the app's own UI gating — this
-- migration does not add or remove any tester gate itself, it only makes the
-- already-tester-gated feature actually work end-to-end.
--
-- SCOPE (three independent, additive changes):
--   1. candidate_visits INSERT policy gets a plausibility ceiling — see
--      max_plausible_candidate_visit_score() below.
--   2. prevent_expired_list_checkins() gets one new branch, exactly like
--      Trip Mode's own 'trip_list_retroactive' branch added in
--      20260923_trip_mode_retroactive_completion.sql, for
--      verification_method = 'historical_visit_confirmed' — a value that has
--      existed in the CHECK constraint since 20260828_visit_detection_phase1.sql
--      but has had zero live rows and zero server-side handling until now.
--      Every other verification_method (including 'trip_list_retroactive'
--      and NULL) falls through completely unchanged — this migration's
--      CREATE OR REPLACE reproduces the entire 20260923 Trip Mode function
--      byte-for-byte except for the one new IF branch inserted between Trip
--      Mode's block and the original body.
--   3. notify_high_confidence_candidate_visit() + its trigger, re-applied.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. candidate_visits INSERT plausibility ceiling.
--
--    WHY: candidate_visits_insert_own (20260828_visit_detection_phase1.sql)
--    only ever checked user_id = auth.uid() — confidence_score, dwell_minutes,
--    arrival_at/departure_at, and status are all otherwise fully
--    client-supplied with no server validation. That was harmless while
--    nothing consumed candidate_visits for anything real. It stops being
--    harmless the moment a confirm action (added below) can turn a
--    candidate_visits row into an authorized check-in with server-derived
--    points: a forged row (e.g. confidence_score=100, dwell_minutes=999,
--    for any item, from anywhere) would otherwise let a user grant
--    themselves a check-in with no location requirement at all.
--
--    This does NOT make candidate_visits fully forgery-proof — a client can
--    still choose which arrival_at/departure_at to submit, so a user who
--    already knows they're "near enough" to fabricate a plausible dwell
--    window is not newly stopped (the same is already true of every
--    existing standalone check-off today: the original
--    prevent_expired_list_checkins() body has never had a server-side
--    location/distance check for standalone items — confirmed via a live
--    read of the function this session). What this DOES stop: manufacturing
--    a confidence score or dwell time beyond what a genuine geofence_dwell
--    detection for that item's actual profile could ever produce, which is
--    the new, specific risk the confirm path introduces. Full anti-spoofing
--    would require moving confidence computation server-side entirely — a
--    larger rearchitecture explicitly out of scope for this pass.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.max_plausible_candidate_visit_score(p_item_id uuid, p_dwell_minutes numeric)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_key       text;
  v_candidate_dwell    integer;
  v_strong_dwell       integer;
  v_manual_only        boolean;
  v_w_inside           integer;
  v_w_exceeds_candidate integer;
  v_w_exceeds_strong    integer;
  v_w_good_accuracy     integer;
  v_w_stopped           integer;
BEGIN
  SELECT visit_profile_key INTO v_profile_key FROM items WHERE id = p_item_id;
  IF v_profile_key IS NULL THEN
    RETURN 0; -- no profile assigned — no legitimate automatic detection is possible for this item at all
  END IF;

  SELECT candidate_dwell_minutes, strong_dwell_minutes, manual_only
    INTO v_candidate_dwell, v_strong_dwell, v_manual_only
    FROM visit_detection_profiles WHERE key = v_profile_key;

  IF v_manual_only IS TRUE OR v_candidate_dwell IS NULL OR p_dwell_minutes IS NULL
     OR p_dwell_minutes < v_candidate_dwell THEN
    RETURN 0; -- a real detector (handleDeparture()) never inserts below its own profile's candidate threshold
  END IF;

  SELECT weight INTO v_w_inside            FROM visit_confidence_weights WHERE key = 'inside_venue_radius';
  SELECT weight INTO v_w_exceeds_candidate FROM visit_confidence_weights WHERE key = 'exceeds_candidate_dwell';
  SELECT weight INTO v_w_good_accuracy     FROM visit_confidence_weights WHERE key = 'good_location_accuracy';
  SELECT weight INTO v_w_stopped           FROM visit_confidence_weights WHERE key = 'stopped_not_driving';
  v_w_exceeds_strong := 0;
  IF v_strong_dwell IS NOT NULL AND p_dwell_minutes >= v_strong_dwell THEN
    SELECT weight INTO v_w_exceeds_strong FROM visit_confidence_weights WHERE key = 'exceeds_strong_dwell';
  END IF;

  RETURN COALESCE(v_w_inside, 0) + COALESCE(v_w_exceeds_candidate, 0) + COALESCE(v_w_exceeds_strong, 0)
       + COALESCE(v_w_good_accuracy, 0) + COALESCE(v_w_stopped, 0);
END;
$$;

COMMENT ON FUNCTION public.max_plausible_candidate_visit_score IS
  'Visit Detection Stage 2 (2026-09-23): upper bound on confidence_score a genuine geofence_dwell detection could produce for this item/dwell combination, using only the 5 signals the client detector can legitimately compute. Used as a candidate_visits INSERT plausibility ceiling, not a full forgery-proof gate.';

DROP POLICY IF EXISTS candidate_visits_insert_own ON candidate_visits;
CREATE POLICY candidate_visits_insert_own ON candidate_visits
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND detection_method = 'geofence_dwell'
    AND arrival_at IS NOT NULL
    AND departure_at IS NOT NULL
    AND departure_at > arrival_at
    AND dwell_minutes IS NOT NULL
    AND dwell_minutes >= 0
    -- 2-minute tolerance for JS rounding (Math.round(dwellMinutes * 10) / 10)
    -- and normal clock skew between arrival_at/departure_at capture and the
    -- insert — not a meaningful forgery window on its own.
    AND abs(dwell_minutes - (EXTRACT(EPOCH FROM (departure_at - arrival_at)) / 60.0)) < 2
    AND confidence_score IS NOT NULL
    AND confidence_score <= public.max_plausible_candidate_visit_score(item_id, dwell_minutes)
  );

-- -----------------------------------------------------------------------------
-- 2. Confirm authorization — new branch in prevent_expired_list_checkins(),
--    reached only for verification_method = 'historical_visit_confirmed'.
--    Reuses check_ins.matched_candidate_visit_id (already added by
--    20260923_trip_mode_retroactive_completion.sql) as the REQUIRED link to
--    the specific candidate_visits row being confirmed — this is what
--    authorizes THAT SPECIFIC qualified visit rather than opening a general
--    distance bypass: there is no path that grants a check-in for an
--    arbitrary item without a real, owned, unexpired, not-already-converted
--    candidate_visits row whose item_id matches.
-- -----------------------------------------------------------------------------

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
-- 2b. AFTER INSERT companion trigger on check_ins — performs the
--     candidate_visits back-link (status='confirmed', confirmed_at,
--     converted_checkoff_id) once the check_ins row genuinely exists (see
--     comment above explaining why this can't happen inside the BEFORE
--     trigger). Only acts on rows the BEFORE trigger already validated;
--     the IF NOT FOUND guard is defense-in-depth against a race, not the
--     primary authorization boundary (that's the FOR UPDATE row lock taken
--     in prevent_expired_list_checkins(), held for this whole transaction).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_candidate_visit_confirmed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verification_method = 'historical_visit_confirmed' AND NEW.matched_candidate_visit_id IS NOT NULL THEN
    UPDATE public.candidate_visits
      SET status = 'confirmed', confirmed_at = now(), converted_checkoff_id = NEW.id
      WHERE id = NEW.matched_candidate_visit_id
        AND confirmed_at IS NULL AND rejected_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This visit has already been confirmed or dismissed.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';

DROP TRIGGER IF EXISTS check_ins_mark_candidate_visit_confirmed ON check_ins;
CREATE TRIGGER check_ins_mark_candidate_visit_confirmed
  AFTER INSERT ON check_ins
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_candidate_visit_confirmed();

-- -----------------------------------------------------------------------------
-- 3. Re-apply the departure notification trigger. Verbatim from
--    20260902_visit_reminder_v1_notify_trigger.sql (idempotent
--    CREATE OR REPLACE + DROP/CREATE TRIGGER) — a live audit this session
--    found zero triggers on candidate_visits despite this migration file
--    existing in the repo, so it never actually took effect in production.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_high_confidence_candidate_visit()
RETURNS TRIGGER AS $$
DECLARE
  v_strong_candidate_below integer;
  v_silent_mode             boolean;
  v_realtime_enabled        boolean;
  v_is_tester                boolean;
  v_already_checked_off     boolean;
  v_item_body                text;
BEGIN
  IF NEW.confidence_score IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT strong_candidate_below INTO v_strong_candidate_below
  FROM visit_confidence_bands WHERE id = 1;

  IF v_strong_candidate_below IS NULL OR NEW.confidence_score < v_strong_candidate_below THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(visit_detection_tester, false) INTO v_is_tester FROM users WHERE id = NEW.user_id;
  IF NOT v_is_tester THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (SELECT enabled FROM feature_flag_overrides WHERE flag_key = 'realtime_nearby_checkoff_notifications' AND user_id = NEW.user_id),
    (SELECT enabled_globally FROM feature_flags WHERE key = 'realtime_nearby_checkoff_notifications'),
    false
  ) INTO v_realtime_enabled;
  IF NOT v_realtime_enabled THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    (SELECT enabled FROM feature_flag_overrides WHERE flag_key = 'candidate_visit_silent_mode' AND user_id = NEW.user_id),
    (SELECT enabled_globally FROM feature_flags WHERE key = 'candidate_visit_silent_mode'),
    false
  ) INTO v_silent_mode;
  IF v_silent_mode THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM check_ins
    WHERE item_id = NEW.item_id AND user_id = NEW.user_id AND checked_at >= NEW.arrival_at
  ) INTO v_already_checked_off;
  IF v_already_checked_off THEN
    RETURN NEW;
  END IF;

  UPDATE candidate_visits SET notification_sent_at = now()
  WHERE id = NEW.id AND notification_sent_at IS NULL;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT body INTO v_item_body FROM items WHERE id = NEW.item_id;

  INSERT INTO notification_queue (type, payload) VALUES (
    'candidate_visit_high_confidence',
    jsonb_build_object(
      'to_user_id', NEW.user_id,
      'item_id', NEW.item_id,
      'item_body', v_item_body,
      'candidate_visit_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS candidate_visits_notify_high_confidence ON candidate_visits;
CREATE TRIGGER candidate_visits_notify_high_confidence
  AFTER INSERT ON candidate_visits
  FOR EACH ROW
  EXECUTE FUNCTION notify_high_confidence_candidate_visit();

-- Postflight guard.
DO $$
DECLARE
  trig_count int;
BEGIN
  SELECT count(*) INTO trig_count FROM pg_trigger
  WHERE tgrelid = 'public.candidate_visits'::regclass AND NOT tgisinternal;
  IF trig_count < 1 THEN
    RAISE EXCEPTION 'candidate_visits_notify_high_confidence trigger did not get created';
  END IF;
END $$;

COMMIT;
