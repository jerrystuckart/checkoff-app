-- =============================================================================
-- APPLIED 2026-09-23 — approved after: read-only production trace, a
-- 25-scenario pg_temp-only rollback-only test run (25/25 passed, zero
-- persistent side effects, independently verified), and an 8-point
-- production preflight (all passed). See docs/trip-mode/ for the full
-- audit trail (TEST_RUN_REPORT.md, TARGET_LIST_FINDINGS.md,
-- REGRESSION_TEST_PLAN.md, ROLLBACK_A_SOFT_NOT_APPLIED.sql,
-- ROLLBACK_B_SCHEMA_NOT_APPLIED.sql).
-- Trip Mode retroactive completion (2026-09-23 urgent MVP, per-list).
-- REVISED 2026-09-23 (v2) — closed two release-blocking issues found in
-- v1's review: (1) server-side points_awarded derivation/validation for
-- verification_method = 'trip_list_retroactive' (v1 left points fully
-- client-trusted, same as every other check-in path today — flagged as
-- insufficient for THIS new server-enforced path); (2) an UPDATE-based
-- bypass of Trip Mode validation, where an UPDATE that changed ONLY
-- experienced_at/verification_method/matched_candidate_visit_id (none of
-- which were in the original "benign update, skip validation" early-
-- return's field list) would skip every check below entirely.
-- REVISED 2026-09-23 (v3) — SCOPE CORRECTION: v2 also applied the new
-- points-derivation logic to 'historical_visit_confirmed' (reasoning it
-- was safe since that value has zero live usage today). Per explicit
-- instruction, this was narrowed to 'trip_list_retroactive' ONLY —
-- 'historical_visit_confirmed' is now completely untouched by this
-- migration, exactly like every other pre-existing verification_method
-- value, not merely "safe to touch because it's dormant."
--
-- The reviewed draft this was copied from remains in docs/trip-mode/
-- (20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql) as the
-- audit-trail original.
--
-- SCOPE: lets an authenticated MEMBER of a list with Trip Mode explicitly
-- enabled retroactively record a check-in for an item on THAT list, for a
-- date within the list's trip window plus a configurable grace period —
-- entirely server-enforced (RLS + this trigger extension), independent of
-- whether the client shows a button. Existing live-location completion
-- (verification_method IS NULL — the ONLY value any of check_ins' 407 live
-- rows currently carry, confirmed via a live count this session) is
-- untouched: every branch below either is a brand-new column with a safe
-- default, or an early-return branch inside the existing trigger that only
-- fires for the two verification_method values this migration adds
-- server-side handling for — every other value falls through to the
-- ORIGINAL function body, byte-for-byte unchanged.
--
-- Traced before writing this (read-only, live production queries this same
-- session):
--   - check_ins RLS INSERT policies check ONLY auth.uid() = user_id — no
--     location/list/timing/points gate exists at the RLS layer today, for
--     ANY check-in, live or retroactive.
--   - check_ins_user_id_list_item_id_key (UNIQUE on user_id, list_item_id)
--     already exists and already prevents a duplicate Trip Mode
--     completion for the same list item — no new dedup mechanism needed.
--   - AFTER INSERT triggers already on check_ins (sync_lifetime_points,
--     check_ins_award_badges, check_ins_update_streak,
--     check_ins_queue_notification) fire on ANY insert regardless of
--     verification_method — Trip Mode completions get points/streak/badges
--     through the exact same authoritative path as live completions,
--     awarded exactly once per row (the existing unique constraint), with
--     zero new AFTER-trigger code.
--   - verification_method (checkin_method is a SEPARATE, pre-existing
--     column — see the column-name note below) already exists (added
--     20260716_list_deletion_fk_fixes.sql) but its CHECK constraint did
--     not yet include a retroactive-trip-list value — extended below.
--     Confirmed via a live count this session: 100% of existing check_ins
--     rows (407/407) have verification_method = NULL. 'historical_visit_confirmed'
--     (an existing allowed CHECK value, pre-dating this migration) has
--     ZERO live usage today — but per v3's explicit scope correction,
--     this migration does NOT add any new behavior for it (see the
--     points-derivation block's own v3 note further down): it remains
--     exactly as untouched as every other pre-existing verification_method.
--   - items.difficulty is confirmed (live DISTINCT query) to only ever
--     take the values {1, 5, 10, 25} in production today — matches the
--     product requirement "valid base difficulty remains 1, 5, 10, or 25"
--     exactly, and since it's read server-side from the items table (never
--     client-supplied in the insert payload at all), it has no forgery
--     vector of its own — the CHECK added below is a defensive guard
--     against a future data-integrity regression, not a response to any
--     currently-exploitable gap.
--   - resolve_metro_timezone(metro_id) and is_list_member(list_id)
--     already exist and are reused as-is, not reimplemented.
--
-- COLUMN-NAME CONTRACT (per explicit request to confirm and use
-- consistently): check_ins has BOTH checkin_method and verification_method
-- as real, distinct, already-existing production columns with different
-- purposes — confirmed live via information_schema.columns this session.
--   - checkin_method text NOT NULL DEFAULT 'tap', CHECK IN ('tap','photo','gps','qr')
--     — describes the UI INTERACTION that produced the row (did the user
--     tap a button, take a photo, scan a QR code). Trip Mode always sets
--     this to 'tap' (the sheet's primary action is a tap, same as the
--     live "I'VE DONE THIS" button), regardless of whether a photo was
--     also attached via the "Add photo or memory" step — checkin_method
--     is not being repurposed to mean "how the trip was verified."
--   - verification_method text NULL, CHECK IN (the 6 pre-existing values,
--     extended below with 'trip_list_retroactive') — describes HOW
--     CONFIDENTLY the completion is trusted / by what mechanism it was
--     verified (or, for the pre-existing NULL default, "not distinguished
--     — legacy/live"). This is the column Trip Mode's authorization and
--     (per the points-derivation fix below) points logic both branch on.
-- The migration, trigger, client payload, CHECK constraint, and tests all
-- use verification_method for Trip Mode's own identity, and leave
-- checkin_method='tap' untouched — this was already correct in v1, this
-- note exists only to make the contract explicit rather than implicit.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Per-list Trip Mode configuration. Explicit opt-in per list (policy #1 —
--    "Trip Mode is enabled explicitly per list. Do not hardcode behavior to
--    the title or Munich."). Defaults are inert (false / 7) so every
--    existing list is completely unaffected until a human explicitly flips
--    trip_mode_enabled for a specific list_id.
-- -----------------------------------------------------------------------------

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS trip_mode_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS trip_mode_grace_days integer NOT NULL DEFAULT 7;

-- Sensible bounds: 0 (no grace at all -- accept only during the trip
-- itself) through 30 days (a full month of grace is already generous for
-- a retroactive-completion feature; a materially longer value would start
-- to look more like a second, disconnected feature than "I forgot to
-- check something off from my trip"). Prevents a typo (e.g. 700 instead
-- of 7) from silently creating a near-unbounded retroactive window.
ALTER TABLE public.lists
  ADD CONSTRAINT lists_trip_mode_grace_days_bounds CHECK (trip_mode_grace_days BETWEEN 0 AND 30);

COMMENT ON COLUMN public.lists.trip_mode_enabled IS
  'Trip Mode MVP (2026-09-23): when true, members may retroactively record completions for this list''s items via verification_method=''trip_list_retroactive'', gated server-side by prevent_expired_list_checkins(). Explicit per-list opt-in — never inferred from title/metro.';

COMMENT ON COLUMN public.lists.trip_mode_grace_days IS
  'Trip Mode MVP (2026-09-23): how many days after lists.ends_at a retroactive completion is still accepted for this list. Default 7 per product spec.';

-- -----------------------------------------------------------------------------
-- 2. The user-selected "when did you actually do this" CALENDAR DATE.
--
--    TYPE: `date`, deliberately NOT `timestamptz`/`timestamp`. This is the
--    precise answer to "database type / timezone conversion / how a
--    user-selected calendar date becomes a timestamp / behavior while
--    traveling across timezones": it never becomes a timestamp at all, and
--    there is no timezone conversion to reason about, because a Postgres
--    `date` column carries NO time-of-day and NO timezone component — the
--    stored value '2026-09-23' means the same calendar day everywhere,
--    forever, full stop. The client (lib/tripMode.js's
--    getTripModeQuickChoices/deriveTripModeDateWindow, both already tested)
--    computes which 'YYYY-MM-DD' string "Today"/"Yesterday"/a picked day
--    corresponds to using the LIST's own metro timezone (via
--    Intl.DateTimeFormat('en-CA', {timeZone}) — the exact toMetroDateString
--    mechanism this codebase already uses for every other metro-aware date
--    comparison), NOT the device's current timezone — so if a user is
--    physically back in Phoenix when they open Trip Mode for a Munich
--    trip, "Yesterday" still correctly means "yesterday in Munich," not
--    "yesterday in Phoenix." That resolved string is sent as-is and stored
--    as-is; the server's own window/grace comparisons below are DATE-to-DATE
--    comparisons against lists.starts_at/ends_at (also plain `date` columns)
--    — never a date compared against a timestamptz, which is the specific
--    comparison class that could otherwise silently shift a day at a
--    timezone boundary. The ONE place an actual instant-to-date conversion
--    happens is "what does 'today' mean right now" (both client-side via
--    getTripModeQuickChoices and server-side via
--    `(now() AT TIME ZONE list_tz)::date` below) — and both sides use the
--    SAME list-timezone-based derivation, so they can never disagree.
--
--    Distinct from checked_at (timestamptz, DB-defaulted to now()), which
--    continues to mean "when this row was created" — i.e. right now, at
--    the moment of the retroactive submission — exactly as it already does
--    for every other check-in path; nothing reads checked_at as a
--    backdated timestamp today, and this migration does not change that
--    for ANY row, live or retroactive.
-- -----------------------------------------------------------------------------

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS experienced_at date;

COMMENT ON COLUMN public.check_ins.experienced_at IS
  'Trip Mode MVP (2026-09-23): the calendar date (no time-of-day, no timezone component) the user says they actually did this, resolved client-side in the LIST''s own metro timezone (never the device''s current timezone). NULL for every live/geofenced completion. Distinct from checked_at, which always means "when this row was inserted" and is never backdated.';

-- Best-effort, tester-only cross-reference to the existing candidate-visits
-- experiment (policy #CANDIDATE VISITS TESTING — "record whether a
-- retrospective Trip Mode completion had a matching candidate visit, but
-- do not require one and do not expose this comparison publicly"). Nullable,
-- never required, never joined into any user-facing query — purely for
-- tester-only analysis of detection recall/false-positive rate. Does NOT
-- expand candidate-visit collection to any additional user; it only lets a
-- Trip Mode completion reference a candidate_visits row that may already
-- exist for a tester who already has that experiment active.
ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS matched_candidate_visit_id uuid REFERENCES public.candidate_visits(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.check_ins.matched_candidate_visit_id IS
  'Trip Mode MVP (2026-09-23), TESTER-ONLY analytics: best-effort link to a candidate_visits row that may correspond to this retroactive completion. Never required, never publicly exposed, never used for authorization. Does not expand candidate-visit collection scope.';

-- Corrected schema count: this migration adds FOUR new columns total —
-- lists.trip_mode_enabled, lists.trip_mode_grace_days,
-- check_ins.experienced_at, check_ins.matched_candidate_visit_id — not
-- three as an earlier draft of this report miscounted.

-- -----------------------------------------------------------------------------
-- 3. Extend verification_method's CHECK constraint to allow the new value.
--    Every existing allowed value is preserved unchanged.
-- -----------------------------------------------------------------------------

ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS check_ins_verification_method_check;
ALTER TABLE public.check_ins ADD CONSTRAINT check_ins_verification_method_check
  CHECK (verification_method = ANY (ARRAY[
    'live_location'::text,
    'qr_scan'::text,
    'historical_visit_confirmed'::text,
    'photo'::text,
    'admin'::text,
    'legacy'::text,
    'trip_list_retroactive'::text
  ]));

-- -----------------------------------------------------------------------------
-- 4. Extend prevent_expired_list_checkins() — the ONLY trigger on
--    check_ins that currently validates list/date/item state on
--    INSERT/UPDATE. This is the real server-side authorization boundary
--    for Trip Mode (RLS alone only checks user_id = auth.uid()).
--
--    v2 CHANGES from the original draft:
--      (a) The "benign UPDATE, skip validation" early-return now ALSO
--          requires experienced_at, verification_method, and
--          matched_candidate_visit_id to be unchanged — closing the
--          UPDATE-based bypass where changing ONLY one of those three
--          fields (none of which were checked in v1) skipped every
--          check below, including the trip-window/points logic.
--      (b) A new points-derivation block, reached ONLY for
--          verification_method = 'trip_list_retroactive' (narrowed by
--          v3's scope correction — an earlier v2 draft also covered
--          'historical_visit_confirmed'; that value is now completely
--          untouched), that OVERWRITES NEW.points_awarded with a
--          server-computed value derived from
--          items.difficulty x list_items.point_multiplier — the
--          client-supplied value, if any, is never trusted or read for this
--          values. This runs on every INSERT and every UPDATE that
--          reaches this point (per fix (a) above), so an UPDATE cannot
--          plant a forged points_awarded either.
--
--    STRUCTURE (unchanged from v1): an early-exit branch for
--    NEW.verification_method = 'trip_list_retroactive' (full Trip Mode
--    authorization), then the new shared points-derivation block for
--    either Trip-Mode-relevant value, then the ORIGINAL function body
--    below, reproduced byte-for-byte, reached by every OTHER
--    verification_method value (including NULL — every live completion
--    today).
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
BEGIN
  -- v2 fix (a): experienced_at / verification_method / matched_candidate_visit_id
  -- added to this list — any UPDATE that changes ANY of these three, even
  -- if every other field is untouched, now falls through to full
  -- re-validation below instead of short-circuiting here.
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
  -- TRIP MODE MVP (2026-09-23) — retroactive list completion authorization.
  -- Only reached when the client explicitly sets this verification_method;
  -- every other value (including NULL, every existing live completion)
  -- skips this entire block.
  -- ═══════════════════════════════════════════════════════════════════════
  IF NEW.verification_method = 'trip_list_retroactive' THEN

    -- Must not authorize remote completion of unrelated catalog items
    -- outside the list — a bare/standalone item is never eligible. This
    -- also directly satisfies "the target user-created list must actually
    -- work": there is no official-vs-personal branching anywhere in this
    -- trigger — it operates on whatever real list_item_id the client
    -- sends, for ANY list (official or personal), as long as every check
    -- below passes. The v1 bug that blocked the target personal list was
    -- entirely client-side (a UI helper incorrectly nulled the id before
    -- it ever reached here) — see the client fix in this pass's report.
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

    -- Explicit per-list opt-in only.
    IF v_trip_mode_enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'Trip Mode is not enabled for this list.' USING ERRCODE = 'P0001';
    END IF;

    -- Only authenticated MEMBERS of the enabled list. is_list_member()
    -- checks list_members for auth.uid() — this function runs SECURITY
    -- DEFINER, but auth.uid() still resolves to the actual calling user
    -- (the JWT claim, not the function owner), and the check_ins RLS
    -- INSERT policy already forces NEW.user_id = auth.uid(), so this
    -- check is against the real inserting user, never spoofable via a
    -- client-supplied user_id.
    IF NOT public.is_list_member(v_list_id) THEN
      RAISE EXCEPTION 'Only members of this list can use Trip Mode for it.' USING ERRCODE = 'P0001';
    END IF;

    -- Reject a client attempt to forge item_id to something other than
    -- what this list_item_id actually points to — this is the exact
    -- "no mismatched list/item/list-item combination can be forged" gate:
    -- list_id is ALWAYS resolved here from list_item_id's own FK chain
    -- (never trusted from any client-supplied list_id — there isn't even
    -- a list_id column on check_ins), and item_id, if the client sends
    -- one at all, must agree with what list_item_id actually points to.
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

    -- The CURRENT moment must also still be inside window+grace — this is
    -- what actually closes the door after grace expires (an attempt dated
    -- validly inside the trip but submitted after the grace period itself
    -- has passed is still rejected).
    IF list_ends IS NOT NULL
       AND (now() AT TIME ZONE list_tz)::date > (list_ends + make_interval(days => COALESCE(v_grace_days, 7)))::date
    THEN
      RAISE EXCEPTION 'The Trip Mode window for this list has closed.' USING ERRCODE = 'P0001';
    END IF;

    -- Same item-availability guard the live path already applies.
    SELECT i.is_active INTO item_is_active FROM public.items i WHERE i.id = v_actual_item_id;
    IF item_is_active IS FALSE THEN
      RAISE EXCEPTION 'This item is no longer available.' USING ERRCODE = 'P0001';
    END IF;

    -- Same partnership-active guard the live path already applies.
    SELECT dl.is_active INTO dest_list_active
      FROM public.lists l
      JOIN public.destination_lists dl ON dl.id = l.source_destination_list_id
      WHERE l.id = v_list_id;
    IF dest_list_active IS FALSE THEN
      RAISE EXCEPTION 'This partnership has ended. New check-ins are disabled.' USING ERRCODE = 'P0001';
    END IF;

    -- ═══════════════════════════════════════════════════════════════════
    -- BLOCKER 2 FIX (2026-09-23, v3 — SCOPE CORRECTED) — server-side
    -- points derivation. v3 narrows this to verification_method =
    -- 'trip_list_retroactive' ONLY (an earlier draft also covered
    -- 'historical_visit_confirmed' — reverted per explicit instruction:
    -- "New behavior applies only to verification_method =
    -- 'trip_list_retroactive'. Do not change historical_visit_confirmed.").
    -- historical_visit_confirmed's points_awarded remains exactly as
    -- client-computed as it already is today — completely untouched by
    -- this migration, not merely "unused today" as the v2 draft reasoned.
    -- Every OTHER verification_method (including NULL, every live
    -- completion today) also remains untouched, as before.
    --
    -- This block is INSIDE the Trip Mode authorization IF above (not a
    -- separate top-level IF anymore, since it now only ever applies to
    -- the one verification_method already being validated there) —
    -- v_actual_item_id is always already resolved by this point.
    -- ═══════════════════════════════════════════════════════════════════
    SELECT li.point_multiplier INTO v_point_multiplier
      FROM public.list_items li WHERE li.id = NEW.list_item_id;

    SELECT i.difficulty INTO v_difficulty FROM public.items i WHERE i.id = v_actual_item_id;

    IF v_difficulty IS NULL THEN
      RAISE EXCEPTION 'Could not resolve a valid item for points calculation.' USING ERRCODE = 'P0001';
    END IF;

    -- Defensive guard, per the product requirement "valid base difficulty
    -- remains 1, 5, 10, or 25" — items.difficulty is server-read, not
    -- client-supplied, so this is data-integrity defense, not a response
    -- to a live forgery vector.
    IF v_difficulty NOT IN (1, 5, 10, 25) THEN
      RAISE EXCEPTION 'Item has an invalid difficulty value.' USING ERRCODE = 'P0001';
    END IF;

    -- The authoritative award, unconditionally overwriting whatever
    -- points_awarded the client sent (null, zero, or any forged value) —
    -- "derive... assign" per the product requirement, not "validate and
    -- reject on mismatch," so a client-side rounding quirk can never
    -- produce a spurious rejection; it simply never matters what the
    -- client sent for these two verification methods.
    NEW.points_awarded := round(v_difficulty * COALESCE(v_point_multiplier, 1.0));

    RETURN NEW;
  END IF;
  -- ═══════════════════════════════════════ end Trip Mode authorization ═══

  -- ═══════════════════════════════════════════════════════════════════════
  -- ORIGINAL FUNCTION BODY — byte-for-byte unchanged from the live
  -- production definition confirmed via `pg_get_functiondef` this same
  -- session. Reached for every verification_method value other than
  -- 'trip_list_retroactive' — including 'historical_visit_confirmed',
  -- which per the v3 scope correction is now completely untouched by this
  -- migration, exactly like every other pre-existing value — and every
  -- live completion today (verification_method IS NULL).
  -- ═══════════════════════════════════════════════════════════════════════

  IF NEW.list_item_id IS NULL AND NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'A check-in must reference either a list item or an item.';
  END IF;

  -- ── Standalone check-in: validate the item directly, resolve tz via item's metro ──
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

  -- ── List-attached check-in: resolve tz via the list's own metro_id ───────
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

-- prevent_expired_list_checkins is already wired to
-- trg_prevent_expired_list_checkins (BEFORE INSERT OR UPDATE ON check_ins),
-- confirmed live this session — CREATE OR REPLACE FUNCTION above is
-- sufficient, no CREATE TRIGGER needed.

COMMIT;

-- =============================================================================
-- Deliberately NOT included in this file: flipping trip_mode_enabled for
-- any specific list. See enable_trip_mode_for_munich_list_NOT_APPLIED.sql
-- in this same directory — kept separate so enabling Trip Mode for one
-- list is its own reviewable, revertible statement, independent of this
-- schema migration.
--
-- PRIVATE ITEMS (user_suggestion_list_items, e.g. this migration's target
-- list's 3 private rows) are explicitly OUT OF SCOPE for this migration
-- and this release — see this pass's report for the read-only findings
-- confirming they have NO existing relationship to check_ins at all (a
-- private item's completion is a boolean `checked`/`checked_at` pair
-- directly on user_suggestion_list_items, with no points_awarded, no
-- items.difficulty, no verification_method concept whatsoever). Trip Mode
-- does not touch user_suggestion_list_items in any way; the client
-- explicitly excludes private items from the Trip Mode entry point with a
-- clear UI state rather than attempting unsupported storage.
--
-- BROADER PRE-EXISTING ISSUE, DOCUMENTED BUT NOT FIXED HERE (explicit
-- product instruction: "Do not make a global points-system rewrite in this
-- emergency pass"): every check-off path OTHER than
-- verification_method = 'trip_list_retroactive' — including the live
-- 'tap'/'photo' flows using verification_method = NULL (100% of
-- production check_ins rows today) AND 'historical_visit_confirmed'
-- (explicitly excluded from this fix per the v3 scope correction, despite
-- having zero live usage today) — still computes points_awarded
-- client-side and writes it into a column this trigger does not validate
-- or derive for that case. This migration deliberately narrows its
-- points-validation fix to the ONE verification_method value Trip Mode
-- introduces, per the explicit instruction to secure the Trip Mode
-- insertion path specifically rather than rewrite the points system
-- globally. A follow-up to extend server-side derivation to the live path
-- too is a separate, larger, deliberate decision — not attempted here.
-- =============================================================================
