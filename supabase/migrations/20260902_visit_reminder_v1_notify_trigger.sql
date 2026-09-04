-- Visit Reminder V1: "Did you CheckOff the Thing?" high-confidence exit
-- recovery notification. Review-ready, NOT applied automatically — run
-- manually once reviewed, same convention as
-- supabase/migrations/20260828_visit_detection_phase1.sql:
--   supabase db query -f supabase/migrations/20260902_visit_reminder_v1_notify_trigger.sql --linked
--
-- WHY A DATABASE TRIGGER, NOT CLIENT CODE: candidate_visits rows are
-- written by lib/visitDetection/candidateVisitTracker.js's handleDeparture()
-- on-device, on geofence EXIT — frequently while the app is backgrounded,
-- the exact condition Phase 1's own docs (docs/visit-detection/phase1-notes.md)
-- flag as unreliable for anything that must survive process death. The
-- candidate_visits insert itself already succeeds durably today; a trigger
-- reacting to that row is the only point in the flow that doesn't depend
-- on the client process surviving past the write.
--
-- WHY THIS MUST READ confidence_score, NOT status: handleDeparture() writes
--   status = band === 'notify_eligible' ? 'high_confidence' : band
-- which collapses BOTH the weaker high_confidence band (score 70-84) and
-- the notify_eligible band (score >= strong_candidate_below, default 85)
-- into the same stored status = 'high_confidence'. Filtering on status
-- alone would also catch the weaker band. This trigger reproduces
-- bandForScore()'s own notify_eligible cutoff by reading confidence_score
-- directly against visit_confidence_bands.strong_candidate_below — the
-- exact existing threshold, not a new one. Mirrors (and must be kept in
-- sync with) lib/visitDetection/notifyEligibility.js's
-- isNotifyEligibleCandidateVisit(), which carries the real automated test
-- coverage for this rule (SQL and JS can't share code directly).
--
-- Does not touch visit_detection_profiles, visit_confidence_weights, or
-- visit_confidence_bands in any way — no new dwell threshold, confidence
-- band, or place-type timing is introduced.

BEGIN;

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
    RETURN NEW; -- below the existing notify-eligible threshold
  END IF;

  -- Tester gate — mirrors lib/featureFlags.js's isFlagEnabled(): both flags
  -- this notification depends on are in TESTER_GATED_FLAGS, so no
  -- non-tester ever receives one regardless of global flag values.
  SELECT COALESCE(visit_detection_tester, false) INTO v_is_tester FROM users WHERE id = NEW.user_id;
  IF NOT v_is_tester THEN
    RETURN NEW;
  END IF;

  -- Per-user override > global > false — same resolution order as
  -- isFlagEnabled().
  SELECT COALESCE(
    (SELECT enabled FROM feature_flag_overrides WHERE flag_key = 'realtime_nearby_checkoff_notifications' AND user_id = NEW.user_id),
    (SELECT enabled_globally FROM feature_flags WHERE key = 'realtime_nearby_checkoff_notifications'),
    false
  ) INTO v_realtime_enabled;
  IF NOT v_realtime_enabled THEN
    RETURN NEW; -- realtime_nearby_checkoff_notifications.enabled_globally must stay false; only a per-user override can flip this
  END IF;

  SELECT COALESCE(
    (SELECT enabled FROM feature_flag_overrides WHERE flag_key = 'candidate_visit_silent_mode' AND user_id = NEW.user_id),
    (SELECT enabled_globally FROM feature_flags WHERE key = 'candidate_visit_silent_mode'),
    false
  ) INTO v_silent_mode;
  IF v_silent_mode THEN
    RETURN NEW; -- silent-mode behavior preserved exactly
  END IF;

  -- Already checked off during THIS visit/context — arrival-anchored so an
  -- unrelated, much earlier checkoff never blocks a legitimately new visit.
  SELECT EXISTS (
    SELECT 1 FROM check_ins
    WHERE item_id = NEW.item_id AND user_id = NEW.user_id AND checked_at >= NEW.arrival_at
  ) INTO v_already_checked_off;
  IF v_already_checked_off THEN
    RETURN NEW;
  END IF;

  -- Per-visit dedup. The trigger already fires exactly once per INSERT, so
  -- this UPDATE ... WHERE notification_sent_at IS NULL guard is defense in
  -- depth (idempotent against any future re-fire), not load-bearing today.
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
-- SECURITY DEFINER is required, not incidental: notification_queue's own
-- RLS insert policy requires users.is_admin = true, and this trigger must
-- run for ordinary (non-admin) testers. Matches the existing precedent of
-- cleanup_visit_detection_debug_logs() (also SECURITY DEFINER) in
-- 20260828_visit_detection_phase1.sql.

DROP TRIGGER IF EXISTS candidate_visits_notify_high_confidence ON candidate_visits;
CREATE TRIGGER candidate_visits_notify_high_confidence
  AFTER INSERT ON candidate_visits
  FOR EACH ROW
  EXECUTE FUNCTION notify_high_confidence_candidate_visit();

COMMIT;
