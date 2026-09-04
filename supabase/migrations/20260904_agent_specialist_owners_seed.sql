-- Chief Phase 2C — Specialist Agent Architecture (2026-09-04).
--
-- Seeds the 5 specialist owner rows (agent-service/specialists/registry.ts)
-- into the EXISTING agent.owners table — no new table, no schema
-- change. owner_type='AGENT' matches the existing 'chief' row exactly;
-- these are additional AGENT owners, not a new concept. A delegation
-- creates an agent.tasks row with owner_id pointing to the relevant
-- specialist, using the exact same createTask() primitive Chief already
-- uses for its own tasks — nothing new to write, just new legitimate
-- values for an existing column.
--
-- Idempotent (ON CONFLICT DO NOTHING on owner_key, which is already
-- unique). Review-ready, NOT applied automatically — same convention as
-- every other migration in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260904_agent_specialist_owners_seed.sql --linked

BEGIN;

INSERT INTO agent.owners (owner_key, owner_type, display_name, is_active)
VALUES
  ('metro_builder', 'AGENT', 'Metro Builder', true),
  ('research_verifier', 'AGENT', 'Research Verifier', true),
  ('business_outreach', 'AGENT', 'Business Outreach', true),
  ('destination_strategist', 'AGENT', 'Destination Strategist', true),
  ('destination_activation', 'AGENT', 'Destination Activation', true)
ON CONFLICT (owner_key) DO NOTHING;

COMMIT;
