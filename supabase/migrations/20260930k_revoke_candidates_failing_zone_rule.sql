-- Retroactive application of the zone rule to PENDING, UNCONFIRMED candidates (2026-09-30).
-- Found in the field log: the 18:30 Laurito-lodging session for Ristorante Da Adolfo was opened under the old loose rule (fix 173 m from a
-- 150 m zone, 10 m accuracy) and, once Da Adolfo became a normal restaurant again (20260930h), closed at 21:52 as a 202-minute
-- candidate. Its entry fix fails the current zone rule (visit_fix_presence on distance and accuracy), so the suggestion is withdrawn.
-- Only candidates that the user has not acted on, that came from a recorded session, and whose entry fix fails the rule are removed; the
-- session row is kept with outcome 'reevaluated_fix_not_in_zone' as the provenance. Nothing the user confirmed or dismissed is touched.
-- Not reversible by design (a false suggestion is not re-created); the session row documents it.
BEGIN;
WITH bad AS (
  SELECT c.id AS cand_id, s.id AS session_id
    FROM candidate_visits c
    JOIN visit_presence_sessions s ON s.candidate_visit_id = c.id
    JOIN items i ON i.id = c.item_id
   WHERE c.status IN ('candidate','medium_confidence','high_confidence') AND c.confirmed_at IS NULL AND c.rejected_at IS NULL
     AND c.detection_method = 'geofence_dwell'
     AND (visit_distance_m(s.enter_lat, s.enter_lng, i.maps_lat, i.maps_lng) > visit_geofence_radius_m(i.geo_radius_m) + visit_zone_tolerance_m()
          OR COALESCE(s.enter_accuracy_m, 999) > 65)
), upd AS (
  UPDATE visit_presence_sessions s SET outcome = 'reevaluated_fix_not_in_zone', candidate_visit_id = NULL FROM bad WHERE s.id = bad.session_id RETURNING s.id
)
DELETE FROM candidate_visits c USING bad WHERE c.id = bad.cand_id;
COMMIT;
