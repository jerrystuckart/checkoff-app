-- =============================================================================
-- Geofence registration state column (2026-09-25) — field bug fix.
--
-- ROOT CAUSE OF "0 monitored places, no visits detected all day in
-- Florence": lib/visitDetection/candidateVisitTracker.js's
-- classifyNearbyItems() ran an unbounded items query with no
-- .order()/.range() — PostgREST silently caps that at 1000 rows. Verified
-- directly against production this session: the catalog has 1536+ geocoded
-- items; a real REST call replicating this exact query returned exactly
-- 1000 (content-range 0-999/1536); only 2 of Florence's 96 geocoded items
-- (created most recently, landing outside the cap) were among them. This is
-- the same bug class already fixed in lib/whatsGoodDataAdapter.js
-- (8121018) — the JS fix (this migration's companion) adopts the same
-- proven fetchAllRows() pagination helper.
--
-- SEPARATE, SMALLER finding: the one Florence item that DID come through
-- ("Cantina de' Pucci" wine window) genuinely has no visit_profile_key
-- assigned — a real, isolated data gap (90 of 91 other Florence items DO
-- have one), not touched by this migration per explicit instruction not to
-- blindly assign profiles.
--
-- THIS MIGRATION: adds geofence_registration_log.registration_state so the
-- debug panel (and anything else reading this log) gets an explicit,
-- unambiguous outcome instead of re-deriving it from
-- (monitored_items.length, geofencing_started, error_message) — the exact
-- ambiguity that made "0 eligible places nearby" (a normal, non-error
-- outcome) render identically to "OS geofence registration actually
-- failed" as a ✕ in the debug panel.
-- =============================================================================

BEGIN;

ALTER TABLE geofence_registration_log
  ADD COLUMN IF NOT EXISTS registration_state text
  CHECK (registration_state IN ('ok_monitored', 'ok_none_eligible', 'query_error', 'os_registration_error'));

COMMENT ON COLUMN geofence_registration_log.registration_state IS
  '2026-09-25: explicit outcome of this refresh -- ok_monitored (N places registered), ok_none_eligible (query succeeded, nothing eligible nearby -- NOT a failure), query_error (the items query itself failed), os_registration_error (Location.startGeofencingAsync threw). NULL for rows logged before this column existed.';

COMMIT;
