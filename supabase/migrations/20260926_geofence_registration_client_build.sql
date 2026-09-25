-- Tester-only diagnostics (2026-09-26): record which JS bundle produced each
-- geofence registration row, so "did my OTA actually load on the device" can
-- be answered from the database instead of from an update-server manifest
-- request (which only proves the server would serve it, not that the phone
-- ran it). Additive nullable column on an existing tester-only log table; no
-- effect on any other table, trigger, or visit record.
BEGIN;

ALTER TABLE geofence_registration_log
  ADD COLUMN IF NOT EXISTS client_build text;

COMMENT ON COLUMN geofence_registration_log.client_build IS
  '2026-09-26: "<expo-updates updateId or embedded>|<runtimeVersion>|<channel>" of the JS bundle that wrote this row. NULL for rows written before this column existed.';

COMMIT;
