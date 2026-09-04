-- REVIEW ONLY — NOT A MIGRATION, NOT AUTO-RUN. Operational-state
-- correction, not schema evolution — this is why it lives here rather
-- than in supabase/migrations/, matching this repo's existing
-- review_only_*.sql convention.
--
-- WHY: Phase 0B bootstrapped "Build Chief read/query layer"
-- (source_ref='chief-read-layer') as BLOCKED on "Repair ChatGPT Open
-- Brain authentication" (source_ref='open-brain-chatgpt-reconnect').
-- That dependency reflected an architecture that has since changed: the
-- future Chief will run as a standalone CheckOff service, not a custom
-- GPT, so direct ChatGPT -> Open Brain MCP access is NOT a prerequisite
-- for building the operational read/query layer. The blocker is stale.
--
-- The Open Brain reconnect task itself is NOT deleted or changed by this
-- file — per the Phase 0C architectural decision, it remains as an
-- optional/convenience task (still READY), it just no longer blocks
-- anything.
--
-- Jerry reviews and applies this manually:
--   supabase db query -f docs/agent-platform/review_only_phase0c_chief_read_layer_correction.sql --linked
--
-- SAFE TO RE-RUN: the UPDATE below only matches a row that is still
-- exactly source_type='bootstrap_v1', source_ref='chief-read-layer',
-- status='BLOCKED'. If it's already been corrected (by a prior run of
-- this file, or by hand), the UPDATE matches zero rows and this is a
-- no-op — it will not silently overwrite whatever state the task is in
-- by then.

BEGIN;

-- Preflight: report current state, and refuse to proceed if the row is
-- missing entirely (rather than silently doing nothing, which could mask
-- Phase 0B never having been applied).
DO $$
DECLARE
  current_status text;
BEGIN
  SELECT status INTO current_status
  FROM agent.tasks
  WHERE source_type = 'bootstrap_v1' AND source_ref = 'chief-read-layer';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'chief-read-layer bootstrap task not found — has docs/agent-platform/bootstrap_phase0b.sql been applied?';
  END IF;

  IF current_status <> 'BLOCKED' THEN
    RAISE NOTICE 'chief-read-layer is already status=% (not BLOCKED) — this correction is a no-op, likely already applied', current_status;
  ELSE
    RAISE NOTICE 'chief-read-layer is BLOCKED as expected — applying correction';
  END IF;
END $$;

-- The correction itself, plus a task_events record of WHY the blocker was
-- removed (a real state transition, not a silent edit) — consistent with
-- what task_events exists for.
WITH updated AS (
  UPDATE agent.tasks
  SET
    status = 'READY',
    blocked_by_task_id = NULL,
    blocker_note = NULL,
    next_action = 'Build the Chief operational read/query layer against agent.*. Open Brain integration will be added separately and is not a Phase 0C prerequisite.'
  WHERE source_type = 'bootstrap_v1' AND source_ref = 'chief-read-layer' AND status = 'BLOCKED'
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, from_status, to_status, changed_by_owner_id, note)
SELECT
  id,
  'STATUS_CHANGED',
  'BLOCKED',
  status,
  (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
  'Phase 0C architectural correction: direct ChatGPT -> Open Brain MCP access is not a Phase 0C prerequisite. The future standalone Chief service will connect to Open Brain directly; this bootstrap-time dependency was stale.'
FROM updated;

-- Postflight — confirm the resulting shape matches what was specified,
-- whether this run just applied it or it was already applied earlier.
DO $$
DECLARE
  r record;
BEGIN
  SELECT status, blocked_by_task_id, blocker_note, next_action INTO r
  FROM agent.tasks
  WHERE source_type = 'bootstrap_v1' AND source_ref = 'chief-read-layer';

  IF r.status <> 'READY' OR r.blocked_by_task_id IS NOT NULL OR r.blocker_note IS NOT NULL THEN
    RAISE EXCEPTION 'chief-read-layer is not in the expected corrected state: status=%, blocked_by_task_id=%, blocker_note=%',
      r.status, r.blocked_by_task_id, r.blocker_note;
  END IF;

  -- The Open Brain reconnect task must still exist, unchanged, as an
  -- optional/convenience task — this file must never delete or alter it.
  IF NOT EXISTS (
    SELECT 1 FROM agent.tasks
    WHERE source_type = 'bootstrap_v1' AND source_ref = 'open-brain-chatgpt-reconnect' AND status = 'READY'
  ) THEN
    RAISE EXCEPTION 'open-brain-chatgpt-reconnect is missing or no longer READY — this file must not have touched it';
  END IF;

  RAISE NOTICE 'PASS: chief-read-layer is READY with no blocker; open-brain-chatgpt-reconnect remains untouched (READY)';
END $$;

COMMIT;
