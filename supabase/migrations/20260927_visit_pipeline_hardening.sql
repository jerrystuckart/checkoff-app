-- =============================================================================
-- Visit pipeline hardening (2026-09-27) — found by pushing realistic Florence
-- fixtures through every stage (see lib/visitDetection/visitPipeline.test.js).
--
-- 1. geofence_debug_events.event_type: add the discard/failure events the
--    tracker now emits (candidate_insert_failed was previously invisible: the
--    insert result was never checked, so an RLS rejection logged as success).
-- 2. max_plausible_candidate_visit_score(): the client now also computes
--    no_competing_venue_nearby (venue-overlap disambiguation). The INSERT
--    plausibility ceiling from 20260923 only allowed 5 signals (max 95), so a
--    legitimate high-confidence, unambiguous visit scoring 100 would have been
--    rejected by RLS and silently lost. Ceiling now includes that signal.
-- 3. prevent_expired_list_checkins():
--    a. confirm branch runs only on INSERT (editing the photo/note of a
--       confirmed check-in used to re-run confirm validation and fail);
--    b. a confirmed-visit row's label/link is immutable on UPDATE;
--    c. a points-carrying live/photo check-off is rejected when a
--       historical_visit_confirmed row already exists for the item (the
--       reverse of the duplicate guard in 20260924, which only covered
--       confirm-after-live).
--    Everything else (Trip Mode, ordinary check-offs, fan-out rows) is
--    reproduced unchanged from 20260925_seven_day_boundary_fix.sql.
-- All tester-only in effect; old installed apps never send the confirm label.
-- =============================================================================
BEGIN;

ALTER TABLE geofence_debug_events DROP CONSTRAINT IF EXISTS geofence_debug_events_event_type_check;
ALTER TABLE geofence_debug_events ADD CONSTRAINT geofence_debug_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'enter','exit','exit_ignored_still_inside','discarded_below_candidate_dwell',
    'discarded_manual_only_or_no_profile','discarded_no_arrival_record','candidate_created','task_error',
    'discarded_implausible_dwell','discarded_below_ignore_band','candidate_insert_failed'
  ]::text[]));

CREATE OR REPLACE FUNCTION public.max_plausible_candidate_visit_score(p_item_id uuid, p_dwell_minutes numeric)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_key text; v_candidate_dwell integer; v_strong_dwell integer; v_manual_only boolean;
  v_w_inside integer; v_w_exceeds_candidate integer; v_w_exceeds_strong integer;
  v_w_good_accuracy integer; v_w_stopped integer; v_w_no_competing integer;
BEGIN
  SELECT visit_profile_key INTO v_profile_key FROM items WHERE id = p_item_id;
  IF v_profile_key IS NULL THEN RETURN 0; END IF;

  SELECT candidate_dwell_minutes, strong_dwell_minutes, manual_only
    INTO v_candidate_dwell, v_strong_dwell, v_manual_only
    FROM visit_detection_profiles WHERE key = v_profile_key;

  IF v_manual_only IS TRUE OR v_candidate_dwell IS NULL OR p_dwell_minutes IS NULL
     OR p_dwell_minutes < v_candidate_dwell THEN
    RETURN 0;
  END IF;

  SELECT weight INTO v_w_inside            FROM visit_confidence_weights WHERE key = 'inside_venue_radius';
  SELECT weight INTO v_w_exceeds_candidate FROM visit_confidence_weights WHERE key = 'exceeds_candidate_dwell';
  SELECT weight INTO v_w_good_accuracy     FROM visit_confidence_weights WHERE key = 'good_location_accuracy';
  SELECT weight INTO v_w_stopped           FROM visit_confidence_weights WHERE key = 'stopped_not_driving';
  SELECT weight INTO v_w_no_competing      FROM visit_confidence_weights WHERE key = 'no_competing_venue_nearby';
  v_w_exceeds_strong := 0;
  IF v_strong_dwell IS NOT NULL AND p_dwell_minutes >= v_strong_dwell THEN
    SELECT weight INTO v_w_exceeds_strong FROM visit_confidence_weights WHERE key = 'exceeds_strong_dwell';
  END IF;

  RETURN LEAST(100,
      COALESCE(v_w_inside, 0) + COALESCE(v_w_exceeds_candidate, 0) + COALESCE(v_w_exceeds_strong, 0)
    + COALESCE(v_w_good_accuracy, 0) + COALESCE(v_w_stopped, 0) + COALESCE(v_w_no_competing, 0));
END;
$$;

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

  -- (2026-09-27) A confirmed-visit row's provenance is immutable: an UPDATE may
  -- not attach or detach the historical_visit_confirmed label / its candidate
  -- link (that would launder or strip the server-validated confirm). Ordinary
  -- edits to the row (photo, note) are unaffected — see the TG_OP = 'INSERT'
  -- restriction on the confirm branch below; before this, editing a confirmed
  -- check-in's memory re-ran the confirm validation and failed with "already
  -- confirmed". Trip Mode rows are deliberately untouched by this guard.
  IF TG_OP = 'UPDATE'
     AND (NEW.verification_method IS DISTINCT FROM OLD.verification_method
          OR NEW.matched_candidate_visit_id IS DISTINCT FROM OLD.matched_candidate_visit_id)
     AND (NEW.verification_method = 'historical_visit_confirmed' OR OLD.verification_method = 'historical_visit_confirmed')
  THEN
    RAISE EXCEPTION 'A visit-confirmed check-in cannot be relabeled.' USING ERRCODE = 'P0001';
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
  IF NEW.verification_method = 'historical_visit_confirmed' AND TG_OP = 'INSERT' THEN

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

    IF v_cv_expires_at IS NOT NULL AND v_cv_expires_at <= now() THEN
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

  -- (2026-09-27) No second points award for an item already completed via a
  -- confirmed visit: a live/photo check-off carrying points is rejected when a
  -- historical_visit_confirmed row exists for this user + item (stale screen,
  -- double tap, second device). Zero/NULL-point rows are unaffected, so the
  -- points-free list fan-out mirror rows (lib/checkInFanOut.js) still insert,
  -- and every path that has no confirmed-visit row is byte-for-byte unchanged.
  IF COALESCE(NEW.points_awarded, 0) > 0
     AND NEW.item_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.check_ins c
       WHERE c.user_id = NEW.user_id AND c.item_id = NEW.item_id
         AND c.verification_method = 'historical_visit_confirmed'
         AND c.id IS DISTINCT FROM NEW.id
     )
  THEN
    RAISE EXCEPTION 'This item was already checked off from a visit you confirmed.' USING ERRCODE = 'P0001';
  END IF;

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

DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'prevent_expired_list_checkins') NOT ILIKE '%TG_OP = ''INSERT''%'
     OR (SELECT prosrc FROM pg_proc WHERE proname = 'prevent_expired_list_checkins') NOT ILIKE '%already checked off from a visit you confirmed%' THEN
    RAISE EXCEPTION 'expected guards not found in live function definition';
  END IF;
END $$;

COMMIT;
