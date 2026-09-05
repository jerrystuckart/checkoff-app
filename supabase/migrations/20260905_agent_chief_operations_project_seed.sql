-- Chief Phase 2K — a single seed row in the EXISTING agent.projects
-- table, no new table, no schema change.
--
-- WHY: moving the Gmail inbound monitor's durable state (checkpoint,
-- processed-message-id idempotency, contact/thread routing) from local
-- files into agent.tasks/agent.task_events (the same pattern
-- DbExecutionStore/DbPlaybookRunStore already use — see
-- agent-service/specialists/dbGmailCheckpointStore.ts) requires
-- createTask() to resolve a real agent.projects.project_key. The Gmail
-- checkpoint is a Chief-operational singleton, not scoped to any one
-- destination/metro project, so it needs its own INTERNAL project row to
-- attach to — exactly the same reason agent.owners already carries a
-- 'chief' AGENT owner distinct from any specialist.
--
-- project_type='INTERNAL' is already a valid value under the existing
-- projects_project_type_check constraint (20260830_agent_projects_project_type_check.sql:
-- 'METRO', 'DESTINATION_HUB', 'PRODUCT', 'INTERNAL') — no constraint change needed.
--
-- Idempotent (ON CONFLICT DO NOTHING on project_key, already UNIQUE).
-- Review-ready, NOT applied automatically — same convention as every
-- other migration in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260905_agent_chief_operations_project_seed.sql --linked

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent.owners WHERE owner_key = 'chief' AND owner_type = 'AGENT') THEN
    RAISE EXCEPTION 'Preflight failed: agent.owners has no chief/AGENT row — expected from 20260901_agent_decisions_promotion_workflow.sql. Aborting.';
  END IF;
END $$;

INSERT INTO agent.projects (project_key, name, project_type, status, summary, owner_id)
SELECT
  'chief-operations',
  'Chief Operations',
  'INTERNAL',
  'ACTIVE',
  'Cross-cutting Chief infrastructure state that is not scoped to any single destination or metro project — e.g. the Gmail inbound monitor checkpoint.',
  id
FROM agent.owners WHERE owner_key = 'chief'
ON CONFLICT (project_key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = 'chief-operations') THEN
    RAISE EXCEPTION 'Postflight failed: agent.projects has no chief-operations row after insert.';
  END IF;
END $$;

COMMIT;
