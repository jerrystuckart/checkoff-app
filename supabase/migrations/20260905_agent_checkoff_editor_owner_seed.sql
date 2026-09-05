-- Chief — checkoff_editor owner seed (found 2026-09-05, San Diego Metro build).
--
-- 20260904_agent_specialist_owners_seed.sql seeded 5 of the 6 specialists
-- in agent-service/specialists/registry.ts (metro_builder,
-- research_verifier, business_outreach, destination_strategist,
-- destination_activation) but omitted checkoff_editor — a real registry/
-- migration drift, not a deliberate exclusion (checkoff_editor is a
-- first-class specialist, added in Phase 2D per its own module comment
-- in registry.ts). This went undetected until the first real
-- metro_launch run actually reached M6_5_CHECKOFF_EDITOR (every prior
-- proof was the synthetic TestExecutor dry run, which never resolves a
-- real agent.owners row) — both the San Diego and Tijuana extension runs
-- crashed at that stage with "Owner not found: checkoff_editor".
--
-- Idempotent (ON CONFLICT DO NOTHING on owner_key, already unique).
-- Review-ready, NOT applied automatically — same convention as every
-- other migration in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260905_agent_checkoff_editor_owner_seed.sql --linked

BEGIN;

INSERT INTO agent.owners (owner_key, owner_type, display_name, is_active)
VALUES ('checkoff_editor', 'AGENT', 'CheckOff Editor', true)
ON CONFLICT (owner_key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent.owners WHERE owner_key = 'checkoff_editor') THEN
    RAISE EXCEPTION 'Postflight failed: agent.owners has no checkoff_editor row after insert.';
  END IF;
END $$;

COMMIT;
