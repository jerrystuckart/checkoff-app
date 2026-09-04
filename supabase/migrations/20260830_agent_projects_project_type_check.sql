-- Phase 0B step 1: lock agent.projects.project_type to the now-known
-- minimal vocabulary. Left unconstrained in Phase 0A pending real data —
-- Phase 0B's bootstrap (docs/agent-platform/bootstrap_phase0b.sql) is that
-- data, so this constraint lands first, matching the repo's existing
-- text + CHECK convention (no Postgres ENUM).
--
-- REVIEW-READY — DO NOT RUN AGAINST THE LINKED PROJECT WITHOUT REVIEW.
-- Run manually via:
--   supabase db query -f supabase/migrations/20260830_agent_projects_project_type_check.sql --linked
--
-- ALTER TABLE ... ADD CONSTRAINT has no native IF NOT EXISTS, so a second
-- run would error on a bare ADD CONSTRAINT. Guarded the same way this
-- repo already guards a re-added CHECK constraint elsewhere (see
-- 20260830_geofence_debug_events_exit_verification.sql): DROP CONSTRAINT
-- IF EXISTS immediately before ADD CONSTRAINT, so rerunning this file is a
-- no-op the second time rather than an error.

BEGIN;

ALTER TABLE agent.projects DROP CONSTRAINT IF EXISTS projects_project_type_check;
ALTER TABLE agent.projects ADD CONSTRAINT projects_project_type_check
  CHECK (project_type IN ('METRO', 'DESTINATION_HUB', 'PRODUCT', 'INTERNAL'));

COMMIT;
