-- Push notifications stay unambiguous-only (2026-09-30). Removing the overlap score penalty (20260930i) would otherwise let a stay
-- among several close venues reach the notify band and push once per venue. Such candidates, lower-bound candidates and
-- re-evaluated past stays remain inbox suggestions. The realtime notification flag stays tester-only and untouched.
-- Reversible: recreate the function from 20260902_visit_reminder_v1_notify_trigger.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.notify_high_confidence_candidate_visit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- Honor-system rule (2026-09-30): ambiguity no longer lowers the score, so it is kept out of PUSH notifications explicitly.
  -- A stay among several close CheckOff places, a lower-bound stay (exit never observed) and a re-evaluated past stay are
  -- inbox-only suggestions; only an unambiguous, freshly observed visit can notify.
  IF COALESCE((NEW.metadata->>'competingVenueCount')::int, 0) > 0
     OR NEW.metadata->>'dwellBound' = 'lower'
     OR NEW.metadata->>'reevaluated' = 'true' THEN
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
$function$;

COMMIT;
