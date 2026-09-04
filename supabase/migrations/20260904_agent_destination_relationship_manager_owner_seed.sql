-- Chief Phase 2C Destination Architecture Correction (2026-09-04).
--
-- Adds the destination_relationship_manager specialist owner row,
-- discovered missing from the original Phase 2C specialist team
-- (agent-service/specialists/registry.ts). Same pattern as
-- 20260904_agent_specialist_owners_seed.sql — additive, idempotent,
-- owner_type='AGENT' matching the existing convention.
--
-- Review-ready, NOT applied automatically. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260904_agent_destination_relationship_manager_owner_seed.sql --linked

BEGIN;

INSERT INTO agent.owners (owner_key, owner_type, display_name, is_active)
VALUES ('destination_relationship_manager', 'AGENT', 'Destination Relationship Manager', true)
ON CONFLICT (owner_key) DO NOTHING;

COMMIT;
