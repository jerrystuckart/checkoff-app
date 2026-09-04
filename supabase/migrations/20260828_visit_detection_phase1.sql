-- Phase 1: candidate visit detection — schema, visit profiles, feature flags.
-- Silent-mode only. No notification-sending logic depends on this migration;
-- it only creates the tables/columns the client-side detector and a future
-- recovery screen will read/write. Review-ready — run manually via:
--   supabase db query -f supabase/migrations/20260828_visit_detection_phase1.sql --linked

BEGIN;

-- ---------------------------------------------------------------------------
-- Feature flags (global switch + per-user override; no prod rows depend on
-- these existing yet, so no preflight guard needed beyond IF NOT EXISTS).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feature_flags (
  key               text PRIMARY KEY,
  description       text NOT NULL DEFAULT '',
  enabled_globally  boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_flag_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key    text NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flag_key, user_id)
);

INSERT INTO feature_flags (key, description, enabled_globally) VALUES
  ('candidate_visit_detection',            'Master switch: run on-device visit/dwell detection at all.', false),
  ('candidate_visit_silent_mode',          'When on, detection runs but never triggers a notification — candidate_visits rows only.', true),
  ('historical_checkoff_recovery',         'Surface the "Miss a CheckOff?" recovery screen for eligible candidate visits.', false),
  ('realtime_nearby_checkoff_notifications', '"What''s the thing?" real-time high-confidence push. Must stay off until silent-mode + recovery are validated.', false)
ON CONFLICT (key) DO NOTHING;

-- Per-user internal/test-cohort marker. Kept separate from users.is_admin,
-- which is an unrelated admin-tool RLS gate.
ALTER TABLE users ADD COLUMN IF NOT EXISTS visit_detection_tester boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Visit detection profiles — per-category dwell thresholds. Minutes, not a
-- single universal threshold (see product spec for the reasoning per type).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS visit_detection_profiles (
  key                     text PRIMARY KEY,
  label                   text NOT NULL,
  candidate_dwell_minutes integer,        -- NULL when manual_only
  strong_dwell_minutes    integer,        -- NULL when manual_only
  manual_only             boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_detection_profiles_dwell_or_manual CHECK (
    manual_only OR (candidate_dwell_minutes IS NOT NULL AND strong_dwell_minutes IS NOT NULL)
  )
);

INSERT INTO visit_detection_profiles (key, label, candidate_dwell_minutes, strong_dwell_minutes, manual_only) VALUES
  ('quick_stop',   'Quick stop (coffee, bakery, counter pickup)',  5, 12, false),
  ('retail',       'Retail',                                       9, 20, false),
  ('fast_casual',  'Fast casual',                                 10, 25, false),
  ('restaurant',   'Restaurant',                                  15, 60, false),
  ('bar',          'Bar',                                         15, 90, false),
  ('attraction',   'Attraction (museum, gallery, indoor)',        18, 90, false),
  ('outdoor',      'Outdoor (park, trail)',                       12, 45, false),
  ('event',        'Event',                                       20, 75, false),
  ('landmark',     'Landmark',                                     4, 10, false),
  ('manual_only',  'Manual only — no automatic detection',     NULL, NULL, true)
ON CONFLICT (key) DO NOTHING;

-- Item → profile mapping. NULL is treated as manual_only by the client
-- (see lib/visitDetection/profiles.js) so existing items need no backfill
-- before this ships — nothing is auto-detected until an item is explicitly
-- assigned a profile.
ALTER TABLE items ADD COLUMN IF NOT EXISTS visit_profile_key text REFERENCES visit_detection_profiles(key);

-- Universal items are locationless by the existing app-wide convention
-- (checkGeoFence() already skips them) — this constraint makes that rule
-- explicit at the schema level, so a future admin edit can't silently
-- assign a dwell profile to an item that will never be geofenced anyway.
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_universal_no_visit_profile;
ALTER TABLE items ADD CONSTRAINT items_universal_no_visit_profile
  CHECK (NOT (is_universal AND visit_profile_key IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Confidence scoring weights — tunable without a redeploy (see product spec's
-- confidence model). One row per signal; the client sums whichever signals
-- fired for a given candidate visit.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS visit_confidence_weights (
  key          text PRIMARY KEY,
  weight       integer NOT NULL,
  description  text NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO visit_confidence_weights (key, weight, description) VALUES
  ('inside_venue_radius',        30,  'User location fix fell inside the venue geofence radius'),
  ('exceeds_candidate_dwell',    25,  'Dwell time exceeded the profile''s candidate threshold'),
  ('exceeds_strong_dwell',       15,  'Dwell time exceeded the profile''s strong threshold'),
  ('stopped_not_driving',        15,  'Movement pattern suggests stopped/walking rather than driving'),
  ('good_location_accuracy',     10,  'Location fix accuracy was within the acceptable threshold'),
  ('no_competing_venue_nearby',  10,  'No other CheckOff venue geofence overlaps this one'),
  ('likely_drive_by',           -30,  'Speed/heading pattern suggests a drive-by, not a stop'),
  ('overlapping_venues',        -25,  'Multiple nearby CheckOff venues overlap, reducing match confidence'),
  ('poor_location_accuracy',    -20,  'Location fix accuracy was worse than the acceptable threshold')
ON CONFLICT (key) DO NOTHING;

-- Confidence bands, also tunable — read by the client as a single row rather
-- than four magic numbers scattered across files.
CREATE TABLE IF NOT EXISTS visit_confidence_bands (
  id                        int PRIMARY KEY DEFAULT 1,
  ignore_below              integer NOT NULL DEFAULT 50,
  medium_confidence_below   integer NOT NULL DEFAULT 70,
  strong_candidate_below    integer NOT NULL DEFAULT 85,
  CONSTRAINT visit_confidence_bands_singleton CHECK (id = 1),
  CONSTRAINT visit_confidence_bands_ordered CHECK (
    ignore_below < medium_confidence_below AND medium_confidence_below < strong_candidate_below
  )
);

INSERT INTO visit_confidence_bands (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Candidate visits. Deliberately minimal — no raw coordinate history, no
-- movement path. arrival_at/departure_at + a confidence score is the whole
-- record; metadata is small structured signals only (accuracy band, dwell
-- minutes, distance bucket), never lat/lng.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS candidate_visits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id                uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  visit_profile_key      text REFERENCES visit_detection_profiles(key),
  arrival_at             timestamptz NOT NULL,
  departure_at           timestamptz,
  dwell_minutes          numeric,
  detection_method       text NOT NULL DEFAULT 'geofence_dwell'
                           CHECK (detection_method IN ('geofence_dwell', 'visit_api', 'manual')),
  confidence_score       integer,
  status                 text NOT NULL DEFAULT 'candidate'
                           CHECK (status IN ('candidate', 'medium_confidence', 'high_confidence',
                                              'confirmed', 'rejected', 'expired')),
  notification_sent_at   timestamptz,
  confirmed_at           timestamptz,
  rejected_at            timestamptz,
  converted_checkoff_id  uuid REFERENCES check_ins(id) ON DELETE SET NULL,
  expires_at             timestamptz NOT NULL,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_visits_user_status_idx ON candidate_visits (user_id, status);
CREATE INDEX IF NOT EXISTS candidate_visits_expires_at_idx ON candidate_visits (expires_at);

-- Verification method on check_ins, so a historical-recovery CheckOff is
-- distinguishable from a live one without changing anything user-visible.
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS verification_method text
  CHECK (verification_method IN ('live_location', 'qr_scan', 'historical_visit_confirmed', 'photo', 'admin', 'legacy'));

-- Small additive column for candidate-visit analytics payloads (confidence
-- band, dwell range, visit profile) that don't fit interaction_events'
-- existing list_id/item_id-only shape. Reuses the existing event pipeline
-- (lib/trackEvent.js) rather than adding a parallel events table.
ALTER TABLE interaction_events ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Pilot debug/audit tables. Tester-only, short retention (see
-- cleanup_visit_detection_debug_logs() below) — this is what lets a tester
-- tell "we monitored this venue and saw nothing" apart from "this venue was
-- never in the monitored set" during the Phase 1 pilot. Never stores raw
-- coordinates: selection_lat/lng are the point used to pick the monitored
-- set, rounded to ~111m (3 decimal places) client-side before insert — good
-- enough to sanity-check which venues should have been nearby, not a
-- movement trail.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS geofence_registration_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refreshed_at        timestamptz NOT NULL DEFAULT now(),
  selection_lat       numeric(6,3),
  selection_lng       numeric(6,3),
  -- [{ "item_id": uuid, "distance_m": number }, ...] — the set actually
  -- passed to startGeofencingAsync.
  monitored_items     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "item_id": uuid, "distance_m": number|null, "reason": text }, ...]
  -- reason in ('beyond_radius', 'exceeds_region_cap', 'manual_only_profile',
  -- 'no_visit_profile_assigned', 'inactive', 'universal_item').
  excluded_items      jsonb NOT NULL DEFAULT '[]'::jsonb,
  geofencing_started  boolean NOT NULL,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geofence_registration_log_user_refreshed_idx
  ON geofence_registration_log (user_id, refreshed_at DESC);

CREATE TABLE IF NOT EXISTS geofence_debug_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      uuid REFERENCES items(id) ON DELETE SET NULL,
  event_type   text NOT NULL CHECK (event_type IN (
                 'enter', 'exit', 'discarded_below_candidate_dwell',
                 'discarded_manual_only_or_no_profile', 'discarded_no_arrival_record',
                 'candidate_created', 'task_error'
               )),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geofence_debug_events_user_occurred_idx
  ON geofence_debug_events (user_id, occurred_at DESC);

-- Pilot retention: unconfirmed/rejected/expired candidate visits and all
-- debug/audit rows are deleted after a short window — long enough to debug
-- detection accuracy during the pilot, short enough that this never becomes
-- a de facto movement history. Confirmed candidate visits are pruned too,
-- once older than the same window — the durable record for a confirmed
-- historical CheckOff lives in check_ins.verification_method, not here.
-- App-wide; not conditioned on metro/city in any way. Not scheduled by this
-- migration — run manually or wire to pg_cron (see existing cron functions
-- in supabase/functions/*/index.ts for the project's usual cron pattern)
-- once you're ready; the 14-day default here is the pilot value, meant to
-- be shortened (the product spec's steady-state target is closer to the
-- 24h grace window) once detection accuracy is validated.
CREATE OR REPLACE FUNCTION cleanup_visit_detection_debug_logs(retention_days integer DEFAULT 14)
RETURNS void AS $$
BEGIN
  DELETE FROM geofence_registration_log WHERE created_at < now() - (retention_days || ' days')::interval;
  DELETE FROM geofence_debug_events WHERE created_at < now() - (retention_days || ' days')::interval;
  DELETE FROM candidate_visits
    WHERE created_at < now() - (retention_days || ' days')::interval
    AND status IN ('candidate', 'medium_confidence', 'high_confidence', 'confirmed', 'rejected', 'expired');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE candidate_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidate_visits_select_own ON candidate_visits;
CREATE POLICY candidate_visits_select_own ON candidate_visits
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS candidate_visits_insert_own ON candidate_visits;
CREATE POLICY candidate_visits_insert_own ON candidate_visits
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users may only update their own candidate visits, and only the fields the
-- recovery flow needs to touch (status/confirmed/rejected/converted). This
-- is enforced by RLS at the row level, not the column level — Postgres RLS
-- can't restrict which columns an UPDATE touches — so the app must not send
-- other fields on update, and a future admin/service function is the place
-- to correct thresholds retroactively if needed.
DROP POLICY IF EXISTS candidate_visits_update_own ON candidate_visits;
CREATE POLICY candidate_visits_update_own ON candidate_visits
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flags_select_all ON feature_flags;
CREATE POLICY feature_flags_select_all ON feature_flags
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS feature_flags_admin_write ON feature_flags;
CREATE POLICY feature_flags_admin_write ON feature_flags
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin));

ALTER TABLE feature_flag_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flag_overrides_select_own ON feature_flag_overrides;
CREATE POLICY feature_flag_overrides_select_own ON feature_flag_overrides
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS feature_flag_overrides_admin_write ON feature_flag_overrides;
CREATE POLICY feature_flag_overrides_admin_write ON feature_flag_overrides
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin));

ALTER TABLE visit_detection_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visit_detection_profiles_select_all ON visit_detection_profiles;
CREATE POLICY visit_detection_profiles_select_all ON visit_detection_profiles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS visit_detection_profiles_admin_write ON visit_detection_profiles;
CREATE POLICY visit_detection_profiles_admin_write ON visit_detection_profiles
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin));

ALTER TABLE visit_confidence_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visit_confidence_weights_select_all ON visit_confidence_weights;
CREATE POLICY visit_confidence_weights_select_all ON visit_confidence_weights
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS visit_confidence_weights_admin_write ON visit_confidence_weights;
CREATE POLICY visit_confidence_weights_admin_write ON visit_confidence_weights
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin));

ALTER TABLE visit_confidence_bands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visit_confidence_bands_select_all ON visit_confidence_bands;
CREATE POLICY visit_confidence_bands_select_all ON visit_confidence_bands
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS visit_confidence_bands_admin_write ON visit_confidence_bands;
CREATE POLICY visit_confidence_bands_admin_write ON visit_confidence_bands
  FOR ALL USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin));

ALTER TABLE geofence_registration_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geofence_registration_log_select ON geofence_registration_log;
CREATE POLICY geofence_registration_log_select ON geofence_registration_log
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin)
  );

DROP POLICY IF EXISTS geofence_registration_log_insert_own ON geofence_registration_log;
CREATE POLICY geofence_registration_log_insert_own ON geofence_registration_log
  FOR INSERT WITH CHECK (user_id = auth.uid());

ALTER TABLE geofence_debug_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geofence_debug_events_select ON geofence_debug_events;
CREATE POLICY geofence_debug_events_select ON geofence_debug_events
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin)
  );

DROP POLICY IF EXISTS geofence_debug_events_insert_own ON geofence_debug_events;
CREATE POLICY geofence_debug_events_insert_own ON geofence_debug_events
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Pilot debug views (admin/tester use only — inherit RLS from base tables
-- via security_invoker, so a non-admin tester only ever sees their own rows
-- through these views, same as querying the base tables directly).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW candidate_visit_debug_view
WITH (security_invoker = true) AS
SELECT
  cv.id,
  cv.user_id,
  i.body AS item_name,
  cv.visit_profile_key,
  cv.arrival_at AS entered_at,
  cv.departure_at AS exited_at,
  cv.dwell_minutes,
  cv.confidence_score,
  CASE
    WHEN cv.confidence_score IS NULL THEN NULL
    WHEN cv.confidence_score < (SELECT ignore_below FROM visit_confidence_bands WHERE id = 1) THEN 'ignore'
    WHEN cv.confidence_score < (SELECT medium_confidence_below FROM visit_confidence_bands WHERE id = 1) THEN 'medium_confidence'
    WHEN cv.confidence_score < (SELECT strong_candidate_below FROM visit_confidence_bands WHERE id = 1) THEN 'high_confidence'
    ELSE 'notify_eligible'
  END AS confidence_band,
  cv.metadata AS scoring_factors,
  EXISTS (
    SELECT 1
    FROM geofence_registration_log g
    WHERE g.user_id = cv.user_id
      AND g.refreshed_at = (
        SELECT max(refreshed_at) FROM geofence_registration_log WHERE user_id = cv.user_id
      )
      AND g.monitored_items @> jsonb_build_array(jsonb_build_object('item_id', cv.item_id::text))
  ) AS was_in_last_monitored_set,
  cv.status,
  cv.notification_sent_at,
  cv.confirmed_at,
  cv.rejected_at,
  cv.created_at
FROM candidate_visits cv
JOIN items i ON i.id = cv.item_id
ORDER BY cv.created_at DESC;

CREATE OR REPLACE VIEW current_monitored_geofences
WITH (security_invoker = true) AS
WITH latest AS (
  SELECT DISTINCT ON (user_id) *
  FROM geofence_registration_log
  ORDER BY user_id, refreshed_at DESC
)
SELECT
  l.user_id,
  l.refreshed_at,
  l.selection_lat,
  l.selection_lng,
  l.geofencing_started,
  l.error_message,
  (monitored ->> 'item_id')::uuid AS item_id,
  i.body AS item_name,
  (monitored ->> 'distance_m')::numeric AS distance_m,
  'monitored'::text AS state
FROM latest l
CROSS JOIN LATERAL jsonb_array_elements(l.monitored_items) AS monitored
JOIN items i ON i.id = (monitored ->> 'item_id')::uuid
UNION ALL
SELECT
  l.user_id,
  l.refreshed_at,
  l.selection_lat,
  l.selection_lng,
  l.geofencing_started,
  l.error_message,
  (excluded ->> 'item_id')::uuid AS item_id,
  i.body AS item_name,
  (excluded ->> 'distance_m')::numeric AS distance_m,
  'excluded: ' || (excluded ->> 'reason') AS state
FROM latest l
CROSS JOIN LATERAL jsonb_array_elements(l.excluded_items) AS excluded
JOIN items i ON i.id = (excluded ->> 'item_id')::uuid;

-- Postflight guard: fail loudly if the seed data didn't land the way this
-- migration expects, rather than silently shipping an empty profile table.
DO $$
DECLARE
  profile_count int;
  flag_count int;
BEGIN
  SELECT count(*) INTO profile_count FROM visit_detection_profiles;
  SELECT count(*) INTO flag_count FROM feature_flags WHERE key IN (
    'candidate_visit_detection', 'candidate_visit_silent_mode',
    'historical_checkoff_recovery', 'realtime_nearby_checkoff_notifications'
  );
  IF profile_count < 10 THEN
    RAISE EXCEPTION 'visit_detection_profiles has % rows, expected >= 10', profile_count;
  END IF;
  IF flag_count <> 4 THEN
    RAISE EXCEPTION 'feature_flags missing expected keys, found % of 4', flag_count;
  END IF;
END $$;

COMMIT;
