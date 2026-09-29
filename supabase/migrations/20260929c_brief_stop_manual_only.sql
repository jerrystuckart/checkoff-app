-- Four active, geocoded items whose experience is a seconds-long stop at a window (walk-up / drive-thru / wine window).
-- lib/visitDetection/profileClassifier.js already rules these out ('brief_stop_cue': a dwell profile would only ever
-- misfire). Recording that as an explicit manual_only decision moves them from "incomplete" to "intentionally excluded"
-- in item_visit_readiness. Only fills empty profiles.
-- Reversible: UPDATE items SET visit_profile_key = NULL, visit_profile_source = NULL WHERE visit_profile_source = 'curated_2026-09-29' AND id IN (...same ids...);
BEGIN;
UPDATE items SET visit_profile_key = 'manual_only', visit_profile_source = 'curated_2026-09-29'
WHERE visit_profile_key IS NULL AND is_active AND NOT is_universal AND id IN (
  '06eed925-c482-48ba-886a-907d53637259', -- Tastee Twist walk-up window
  '2be3a3d4-3f29-430a-b852-dd0eaee46bf9', -- Whataburger drive-thru
  'ebf3045d-70e2-48b5-9592-ebc547e7a197', -- Cantina de' Pucci wine window
  'f4654c57-447e-4478-b248-9c31cf1c012d'  -- drive-through liquor store window
);
DO $$
BEGIN
  IF (SELECT count(*) FROM items WHERE visit_profile_source = 'curated_2026-09-29' AND visit_profile_key = 'manual_only' AND id IN
      ('06eed925-c482-48ba-886a-907d53637259','2be3a3d4-3f29-430a-b852-dd0eaee46bf9','ebf3045d-70e2-48b5-9592-ebc547e7a197','f4654c57-447e-4478-b248-9c31cf1c012d')) <> 4
  THEN RAISE EXCEPTION 'expected 4 brief-stop exclusions'; END IF;
END $$;
COMMIT;
