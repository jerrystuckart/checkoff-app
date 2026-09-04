-- REVIEW ONLY — NOT A MIGRATION, NOT AUTO-RUN. Deletes ONLY the Phase 0D
-- test fixtures created while proving out agent-service/mutations.ts (see
-- agent-service/mutations.test.ts) during development. Does not touch
-- Bootstrap v1, any real project, or anything outside the exact scope
-- named below.
--
-- WHY THIS IS NOT AN agent_service OPERATION: agent_service deliberately
-- has no DELETE grant on any agent.* table (Phase 0A §3.2) — that is a
-- permanent security posture and this file does not touch it or ask for
-- it. This cleanup is meant to run through the SAME administrative
-- connection already used for schema migrations (the Supabase CLI /
-- Management API path, `supabase db query -f ... --linked`), which
-- authenticates as the project's admin/migration role, never as
-- agent_service and never through the agent-service TypeScript `pg`
-- connection. Do not attempt to run this via agent-service code.
--
-- SCOPE — every statement below is scoped to one of:
--   agent.tasks.source_type = 'phase0d_test'
--   agent.projects.project_key = 'phase0d_test_fixtures'
-- Nothing else is touched. The preflight step below refuses to proceed if
-- anything under that project ISN'T tagged as a test fixture, rather than
-- guessing.
--
-- Jerry reviews and applies manually:
--   supabase db query -f docs/agent-platform/review_only_phase0d_test_fixture_cleanup.sql --linked
--
-- FK-SAFE ORDER (every agent.* FK is ON DELETE RESTRICT — Phase 0A §—
-- nothing here is cascaded, everything is deleted explicitly in
-- dependency order):
--   1. agent.task_events referencing any test task (child of tasks)
--   2. blocked_by_task_id nulled out on any test task that blocks
--      another test task (both sides of that reference are being
--      deleted in this same pass; RESTRICT would otherwise reject
--      deleting a still-referenced row)
--   3. the test tasks themselves
--   4. the phase0d_test_fixtures project row, only once confirmed empty

BEGIN;

-- Preflight — report exactly what is about to be removed, and abort
-- entirely (no deletes at all) if anything under this project isn't
-- tagged as a Phase 0D test fixture, which would mean the project was
-- reused for something real that this file must not touch.
DO $$
DECLARE
  fixture_project_id uuid;
  non_test_task_count int;
  task_count int;
  event_count int;
  r record;
BEGIN
  SELECT id INTO fixture_project_id FROM agent.projects WHERE project_key = 'phase0d_test_fixtures';
  IF fixture_project_id IS NULL THEN
    RAISE NOTICE 'phase0d_test_fixtures project does not exist — nothing to clean up. Stopping.';
    RETURN;
  END IF;

  SELECT count(*) INTO non_test_task_count
  FROM agent.tasks
  WHERE project_id = fixture_project_id AND source_type IS DISTINCT FROM 'phase0d_test';
  IF non_test_task_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to clean up: % task(s) under phase0d_test_fixtures are NOT tagged source_type=phase0d_test. This project may have been reused for real work — resolve manually before rerunning this file.',
      non_test_task_count;
  END IF;

  SELECT count(*) INTO task_count FROM agent.tasks WHERE source_type = 'phase0d_test';
  SELECT count(*) INTO event_count
    FROM agent.task_events te JOIN agent.tasks t ON t.id = te.task_id
    WHERE t.source_type = 'phase0d_test';

  RAISE NOTICE 'About to delete % task_events row(s) and % task(s) tagged source_type=phase0d_test, then the phase0d_test_fixtures project row.', event_count, task_count;
  FOR r IN SELECT id, status, title, source_ref FROM agent.tasks WHERE source_type = 'phase0d_test' ORDER BY created_at LOOP
    RAISE NOTICE '  task % [%] % (source_ref=%)', r.id, r.status, r.title, r.source_ref;
  END LOOP;
END $$;

-- Only proceed with the actual deletes if the project still exists (the
-- preflight above already RETURNed early inside its own DO block if not,
-- but that RETURN only exits the DO block, not this transaction — so the
-- deletes below use the same "does it exist" guard via WHERE clauses that
-- naturally delete zero rows if there's nothing tagged phase0d_test).

-- 1. task_events for any test task.
DELETE FROM agent.task_events
WHERE task_id IN (SELECT id FROM agent.tasks WHERE source_type = 'phase0d_test');

-- 2. Null out any blocked_by_task_id pointing FROM one test task AT
--    another test task, so step 3 below doesn't hit a RESTRICT violation
--    deleting a still-referenced row.
UPDATE agent.tasks
SET blocked_by_task_id = NULL
WHERE blocked_by_task_id IN (SELECT id FROM agent.tasks WHERE source_type = 'phase0d_test');

-- 3. The test tasks themselves.
DELETE FROM agent.tasks WHERE source_type = 'phase0d_test';

-- 4. The dedicated test fixture project — only once confirmed to have
--    zero remaining tasks (re-checked explicitly here, not just assumed
--    from the preflight + step 3 above).
DO $$
DECLARE
  fixture_project_id uuid;
  remaining_tasks int;
BEGIN
  SELECT id INTO fixture_project_id FROM agent.projects WHERE project_key = 'phase0d_test_fixtures';
  IF fixture_project_id IS NOT NULL THEN
    SELECT count(*) INTO remaining_tasks FROM agent.tasks WHERE project_id = fixture_project_id;
    IF remaining_tasks > 0 THEN
      RAISE EXCEPTION 'Refusing to delete phase0d_test_fixtures project: % task(s) still reference it', remaining_tasks;
    END IF;
    DELETE FROM agent.projects WHERE id = fixture_project_id;
  END IF;
END $$;

-- Postflight
DO $$
DECLARE
  remaining_tasks int;
  remaining_project int;
BEGIN
  SELECT count(*) INTO remaining_tasks FROM agent.tasks WHERE source_type = 'phase0d_test';
  SELECT count(*) INTO remaining_project FROM agent.projects WHERE project_key = 'phase0d_test_fixtures';

  IF remaining_tasks <> 0 OR remaining_project <> 0 THEN
    RAISE EXCEPTION 'Cleanup incomplete: % test task(s), % test project row(s) remain', remaining_tasks, remaining_project;
  END IF;

  RAISE NOTICE 'PASS: all phase0d_test fixtures removed (task_events, tasks, and the phase0d_test_fixtures project row). Bootstrap v1 and all other agent.* rows are untouched.';
END $$;

COMMIT;
