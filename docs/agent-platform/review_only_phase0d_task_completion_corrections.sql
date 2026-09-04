-- REVIEW ONLY — NOT A MIGRATION, NOT AUTO-RUN. Operational-state
-- correction, not schema evolution — same convention as
-- review_only_phase0c_chief_read_layer_correction.sql. Written by hand
-- because the Phase 0D write layer (agent-service/mutations.ts) did not
-- exist yet when this housekeeping was needed; once it exists, marking a
-- task DONE is normally transitionTask(), not raw SQL like this.
--
-- Current live state, read directly before writing this file (2026-08-31):
--   chief-read-layer                  status = READY        (Phase 0C is
--     complete and verified: clean typecheck, 34/34 integration tests
--     including the 22 new Phase 0D tests, live verify run, and the pg
--     "client already executing a query" deprecation warning fixed via
--     pg-pool's onConnect hook)
--   agent-platform-phase0b-bootstrap  status = IN_PROGRESS  (Phase 0B is
--     long since complete and re-verified — see Phase 0B/0C work — this
--     task was intentionally left IN_PROGRESS by the bootstrap script
--     itself, since it can't know it succeeded until a human verifies it;
--     see the "NOTE FOR JERRY" in the original Phase 0B deliverable)
--
-- Jerry reviews and applies manually:
--   supabase db query -f docs/agent-platform/review_only_phase0d_task_completion_corrections.sql --linked
--
-- SAFE TO RE-RUN: each UPDATE below only matches a row still in the exact
-- status this file assumes (READY / IN_PROGRESS respectively). If either
-- has already been corrected (by a prior run of this file, or by hand, or
-- once Phase 0D's transitionTask() is actually used for this), the UPDATE
-- matches zero rows and that part is a no-op.

BEGIN;

-- Preflight: report current state; don't fail outright if a row is
-- missing, since these might legitimately already be corrected — just
-- report what's found and let the guarded UPDATEs below be the real gate.
DO $$
DECLARE
  chief_status text;
  bootstrap_status text;
BEGIN
  SELECT status INTO chief_status FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'chief-read-layer';
  SELECT status INTO bootstrap_status FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'agent-platform-phase0b-bootstrap';

  IF chief_status IS NULL THEN
    RAISE EXCEPTION 'chief-read-layer task not found';
  END IF;
  IF bootstrap_status IS NULL THEN
    RAISE EXCEPTION 'agent-platform-phase0b-bootstrap task not found';
  END IF;

  RAISE NOTICE 'chief-read-layer is currently %', chief_status;
  RAISE NOTICE 'agent-platform-phase0b-bootstrap is currently %', bootstrap_status;
END $$;

-- 1. "Build Chief read/query layer": READY -> DONE.
WITH updated AS (
  UPDATE agent.tasks
  SET status = 'DONE', completed_at = now()
  WHERE source_type = 'bootstrap_v1' AND source_ref = 'chief-read-layer' AND status = 'READY'
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, from_status, to_status, changed_by_owner_id, note)
SELECT
  id,
  'STATUS_CHANGED',
  'READY',
  status,
  (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
  'Phase 0C complete and verified: clean tsc typecheck, 34/34 agent-service integration tests (including the 22 new Phase 0D write-layer tests), a live npm run agent:verify pass against this project, and the pg "client already executing a query" deprecation warning resolved via pg-pool''s onConnect hook.'
FROM updated;

-- 2. "Phase 0B — Bootstrap current operational state": IN_PROGRESS -> DONE.
-- Guarded to only apply if it's still IN_PROGRESS, matching the original
-- bootstrap's own design (it deliberately left this task open pending
-- human verification, not for this file to assume it's still open).
WITH updated AS (
  UPDATE agent.tasks
  SET status = 'DONE', completed_at = now()
  WHERE source_type = 'bootstrap_v1' AND source_ref = 'agent-platform-phase0b-bootstrap' AND status = 'IN_PROGRESS'
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, from_status, to_status, changed_by_owner_id, note)
SELECT
  id,
  'STATUS_CHANGED',
  'IN_PROGRESS',
  status,
  (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
  'Phase 0B bootstrap verified complete by Jerry: idempotency empirically confirmed by running bootstrap_phase0b.sql twice with zero new rows on the second run, and Phase 0C/0D built and tested successfully against the resulting operational state.'
FROM updated;

-- Postflight — confirm both tasks ended up DONE with completed_at set,
-- whether this run just applied it or it was already applied earlier.
DO $$
DECLARE
  r record;
BEGIN
  SELECT status, completed_at INTO r FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'chief-read-layer';
  IF r.status <> 'DONE' OR r.completed_at IS NULL THEN
    RAISE EXCEPTION 'chief-read-layer is not in the expected DONE state: status=%, completed_at=%', r.status, r.completed_at;
  END IF;

  SELECT status, completed_at INTO r FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'agent-platform-phase0b-bootstrap';
  IF r.status <> 'DONE' OR r.completed_at IS NULL THEN
    RAISE EXCEPTION 'agent-platform-phase0b-bootstrap is not in the expected DONE state: status=%, completed_at=%', r.status, r.completed_at;
  END IF;

  RAISE NOTICE 'PASS: both chief-read-layer and agent-platform-phase0b-bootstrap are DONE with completed_at set';
END $$;

-- Note: "Repair ChatGPT Open Brain authentication" (open-brain-chatgpt-
-- reconnect) is deliberately NOT touched by this file — per the Phase 0C
-- architectural decision, it remains READY as an optional/convenience
-- item, to be cleaned up separately per Phase 0D's explicit instruction.

COMMIT;
