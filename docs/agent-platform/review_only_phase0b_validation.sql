-- REVIEW ONLY — NOT A MIGRATION. Read-only verification, safe to run
-- repeatedly against any environment. Run this AFTER manually applying:
--   1. supabase/migrations/20260830_agent_operational_schema_phase0a.sql
--   2. supabase/migrations/20260830_agent_projects_project_type_check.sql
--   3. docs/agent-platform/bootstrap_phase0b.sql
--
-- This is an EXACT-STATE snapshot check: as of Phase 0A + Phase 0B, the
-- Bootstrap v1 rows ARE the entire content of agent.* (Phase 0A shipped
-- zero seed data), so asserting exact totals (not just "these rows exist")
-- is correct here — unlike bootstrap_phase0b.sql's own lighter, by-key-only
-- postflight, which deliberately avoids total-count assertions since it
-- has to stay correct even after a future phase adds more rows.
--
-- Each block raises an EXCEPTION and stops on the first failure, so a
-- clean run to the final NOTICE means every check in this file passed.
-- Designed to be run twice in a row around a second bootstrap execution
-- (see Phase 0B spec's idempotency test) — both runs should PASS
-- identically, and the second bootstrap run should have added zero rows.

DO $$
DECLARE
  r record;
  cnt int;
  missing text;
BEGIN

  -- ---------------------------------------------------------------------
  -- OWNERS
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO cnt FROM agent.owners;
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 2 owners, found %', cnt;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agent.owners WHERE owner_key='jerry' AND owner_type='HUMAN' AND display_name='Jerry') THEN
    RAISE EXCEPTION 'FAIL: owner jerry missing or wrong shape';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agent.owners WHERE owner_key='chief' AND owner_type='AGENT' AND display_name='CheckOff Chief of Staff') THEN
    RAISE EXCEPTION 'FAIL: owner chief missing or wrong shape';
  END IF;
  RAISE NOTICE 'PASS: exactly 2 owners (jerry, chief), correct type/display_name';

  -- ---------------------------------------------------------------------
  -- PROJECTS — count, keys, statuses, and types
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO cnt FROM agent.projects;
  IF cnt <> 7 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 7 projects, found %', cnt;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('agent_platform',          'INTERNAL',        'ACTIVE'),
      ('destination_hubs_wave_1', 'DESTINATION_HUB', 'ACTIVE'),
      ('denver_metro',            'METRO',           'ACTIVE'),
      ('phoenix_metro',           'METRO',           'ON_HOLD'),
      ('milwaukee_metro',         'METRO',           'ON_HOLD'),
      ('tucson_metro',            'METRO',           'ON_HOLD'),
      ('whats_good_widget',       'PRODUCT',         'ACTIVE')
    ) AS t(project_key, project_type, status)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM agent.projects
      WHERE project_key = r.project_key AND project_type = r.project_type AND status = r.status
        AND owner_id = (SELECT id FROM agent.owners WHERE owner_key = 'jerry')
    ) THEN
      RAISE EXCEPTION 'FAIL: project % does not match expected type=%/status=%/owner=jerry', r.project_key, r.project_type, r.status;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: all 7 projects exist with expected project_type/status/owner';

  -- No unexpected 8th+ project key beyond the 7 above (guards against a
  -- typo'd project_key slipping in as a distinct row rather than matching).
  SELECT count(*) INTO cnt FROM agent.projects
    WHERE project_key NOT IN (
      'agent_platform','destination_hubs_wave_1','denver_metro',
      'phoenix_metro','milwaukee_metro','tucson_metro','whats_good_widget'
    );
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: found % unexpected project(s) outside the 7 Bootstrap v1 keys', cnt;
  END IF;

  -- Explicitly excluded per spec: no separate "Featured Business Outreach"
  -- project — Denver outreach belongs to denver_metro.
  IF EXISTS (SELECT 1 FROM agent.projects WHERE name ILIKE '%featured business outreach%') THEN
    RAISE EXCEPTION 'FAIL: a separate Featured Business Outreach project exists — Denver outreach must live under denver_metro';
  END IF;

  -- ---------------------------------------------------------------------
  -- PROJECT_TYPE CONSTRAINT — verify the guarantee itself, not just that
  -- today's rows happen to be valid. Clean data today doesn't prove the
  -- CHECK exists; this reads the constraint's actual definition.
  -- ---------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'agent' AND cl.relname = 'projects' AND con.contype = 'c'
      AND con.conname = 'projects_project_type_check'
      AND pg_get_constraintdef(con.oid) ILIKE '%METRO%'
      AND pg_get_constraintdef(con.oid) ILIKE '%DESTINATION_HUB%'
      AND pg_get_constraintdef(con.oid) ILIKE '%PRODUCT%'
      AND pg_get_constraintdef(con.oid) ILIKE '%INTERNAL%'
  ) THEN
    RAISE EXCEPTION 'FAIL: projects_project_type_check CHECK constraint missing or incomplete';
  END IF;
  -- And it must allow EXACTLY those four — not a superset. A definition
  -- containing an extra value (e.g. a typo'd fifth option) would still
  -- pass the ILIKE checks above, so also assert there is no 5th value by
  -- checking the constraint text doesn't contain any comma beyond the 3
  -- separating the 4 expected values. This is a light heuristic, not a
  -- full parse — good enough to catch an accidental extra value without
  -- writing a CHECK-constraint parser.
  IF (
    SELECT array_length(regexp_split_to_array(pg_get_constraintdef(con.oid), ','), 1)
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'agent' AND cl.relname = 'projects' AND con.conname = 'projects_project_type_check'
  ) <> 4 THEN
    RAISE EXCEPTION 'FAIL: projects_project_type_check does not appear to allow exactly 4 values';
  END IF;
  RAISE NOTICE 'PASS: projects_project_type_check exists and is defined to allow exactly METRO/DESTINATION_HUB/PRODUCT/INTERNAL';

  -- ---------------------------------------------------------------------
  -- TASKS — exactly 9 Bootstrap v1 tasks, each source_ref exactly once
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO cnt FROM agent.tasks WHERE source_type = 'bootstrap_v1';
  IF cnt <> 9 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 9 bootstrap_v1 tasks, found %', cnt;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('agent-platform-phase0b-bootstrap'),
      ('open-brain-chatgpt-reconnect'),
      ('chief-read-layer'),
      ('destination-buena-vista-outreach'),
      ('destination-grand-lake-followup'),
      ('destination-rim-country-followup'),
      ('denver-featured-outreach-replies'),
      ('whats-good-widget-build'),
      ('whats-good-widget-marketing')
    ) AS t(source_ref)
  LOOP
    SELECT count(*) INTO cnt FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = r.source_ref;
    IF cnt <> 1 THEN
      RAISE EXCEPTION 'FAIL: expected exactly 1 task with source_ref=%, found %', r.source_ref, cnt;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: exactly 9 bootstrap_v1 tasks, each source_ref present exactly once';

  -- Expected statuses per task
  FOR r IN
    SELECT * FROM (VALUES
      ('agent-platform-phase0b-bootstrap',        'IN_PROGRESS'),
      ('open-brain-chatgpt-reconnect',            'READY'),
      ('chief-read-layer',                        'BLOCKED'),
      ('destination-buena-vista-outreach',        'READY'),
      ('destination-grand-lake-followup',         'WAITING'),
      ('destination-rim-country-followup',        'WAITING'),
      ('denver-featured-outreach-replies',        'WAITING'),
      ('whats-good-widget-build',                 'READY'),
      ('whats-good-widget-marketing',             'BLOCKED')
    ) AS t(source_ref, expected_status)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM agent.tasks
      WHERE source_type = 'bootstrap_v1' AND source_ref = r.source_ref AND status = r.expected_status
    ) THEN
      RAISE EXCEPTION 'FAIL: task % is not in expected status %', r.source_ref, r.expected_status;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: all 9 bootstrap_v1 tasks have their expected status';

  -- Chief read task concretely blocks on the Open Brain repair task, and
  -- carries the Phase 0B secondary blocker note.
  IF NOT EXISTS (
    SELECT 1 FROM agent.tasks t
    JOIN agent.tasks blocker ON blocker.id = t.blocked_by_task_id
    WHERE t.source_type = 'bootstrap_v1' AND t.source_ref = 'chief-read-layer'
      AND blocker.source_type = 'bootstrap_v1' AND blocker.source_ref = 'open-brain-chatgpt-reconnect'
      AND t.blocker_note ILIKE '%Phase 0B%'
  ) THEN
    RAISE EXCEPTION 'FAIL: chief-read-layer does not concretely block on open-brain-chatgpt-reconnect with the expected blocker_note';
  END IF;
  RAISE NOTICE 'PASS: chief-read-layer blocks on open-brain-chatgpt-reconnect via blocked_by_task_id, with Phase 0B blocker_note';

  -- Widget marketing concretely blocks on widget build.
  IF NOT EXISTS (
    SELECT 1 FROM agent.tasks t
    JOIN agent.tasks blocker ON blocker.id = t.blocked_by_task_id
    WHERE t.source_type = 'bootstrap_v1' AND t.source_ref = 'whats-good-widget-marketing'
      AND blocker.source_type = 'bootstrap_v1' AND blocker.source_ref = 'whats-good-widget-build'
  ) THEN
    RAISE EXCEPTION 'FAIL: whats-good-widget-marketing does not concretely block on whats-good-widget-build';
  END IF;
  RAISE NOTICE 'PASS: whats-good-widget-marketing blocks on whats-good-widget-build via blocked_by_task_id';

  -- The three WAITING tasks have next_check_at populated.
  SELECT count(*) INTO cnt FROM agent.tasks
    WHERE source_type = 'bootstrap_v1'
      AND source_ref IN ('destination-grand-lake-followup', 'destination-rim-country-followup', 'denver-featured-outreach-replies')
      AND next_check_at IS NOT NULL;
  IF cnt <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected all 3 WAITING bootstrap tasks to have next_check_at set, found %', cnt;
  END IF;
  RAISE NOTICE 'PASS: all 3 WAITING bootstrap_v1 tasks have next_check_at populated';

  -- Widget build is READY, not IN_PROGRESS (redundant with the per-task
  -- status loop above, kept as an explicit named check per spec).
  IF NOT EXISTS (SELECT 1 FROM agent.tasks WHERE source_type='bootstrap_v1' AND source_ref='whats-good-widget-build' AND status='READY') THEN
    RAISE EXCEPTION 'FAIL: whats-good-widget-build must be READY, not IN_PROGRESS or anything else';
  END IF;

  -- Buena Vista outreach is READY, not IN_PROGRESS.
  IF NOT EXISTS (SELECT 1 FROM agent.tasks WHERE source_type='bootstrap_v1' AND source_ref='destination-buena-vista-outreach' AND status='READY') THEN
    RAISE EXCEPTION 'FAIL: destination-buena-vista-outreach must be READY, not IN_PROGRESS or anything else';
  END IF;
  RAISE NOTICE 'PASS: widget build and Buena Vista outreach are both READY (not IN_PROGRESS)';

  -- No tasks were created for the on-hold metros — their discoverability
  -- comes from the ON_HOLD project row alone.
  SELECT count(*) INTO cnt FROM agent.tasks t
    JOIN agent.projects p ON p.id = t.project_id
    WHERE t.source_type = 'bootstrap_v1' AND p.project_key IN ('phoenix_metro', 'milwaukee_metro', 'tucson_metro');
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: expected 0 bootstrap_v1 tasks under phoenix_metro/milwaukee_metro/tucson_metro, found %', cnt;
  END IF;
  RAISE NOTICE 'PASS: no tasks were bootstrapped for the on-hold metros';

  -- ---------------------------------------------------------------------
  -- TASK_EVENTS — exactly one CREATED event per bootstrap_v1 task
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO cnt
    FROM agent.task_events te
    JOIN agent.tasks t ON t.id = te.task_id
    WHERE t.source_type = 'bootstrap_v1' AND te.event_type = 'CREATED';
  IF cnt <> 9 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 9 CREATED task_events for bootstrap_v1 tasks, found %', cnt;
  END IF;

  SELECT count(*) INTO cnt FROM (
    SELECT t.id
    FROM agent.tasks t
    JOIN agent.task_events te ON te.task_id = t.id AND te.event_type = 'CREATED'
    WHERE t.source_type = 'bootstrap_v1'
    GROUP BY t.id
    HAVING count(*) <> 1
  ) dup;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: % bootstrap_v1 task(s) have duplicate CREATED events', cnt;
  END IF;

  -- Every bootstrap_v1 task has AT MOST one CREATED event and NO other
  -- event_type at all (bootstrap seeds current state, not history).
  SELECT count(*) INTO cnt
    FROM agent.task_events te
    JOIN agent.tasks t ON t.id = te.task_id
    WHERE t.source_type = 'bootstrap_v1' AND te.event_type <> 'CREATED';
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: found % non-CREATED task_event(s) on bootstrap_v1 tasks — no fictional history should have been backfilled', cnt;
  END IF;
  RAISE NOTICE 'PASS: each bootstrap_v1 task has exactly one CREATED event and no other event type';

  -- ---------------------------------------------------------------------
  -- DECISIONS
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO cnt FROM agent.decisions
    WHERE decision_key IN ('destination_wave1_complexity', 'rim_country_wave1', 'widget_marketing_after_build');
  IF cnt <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected all 3 Bootstrap v1 decision keys to exist, found %', cnt;
  END IF;
  SELECT count(*) INTO cnt FROM agent.decisions;
  IF cnt <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected exactly 3 decisions total, found %', cnt;
  END IF;
  RAISE NOTICE 'PASS: exactly the 3 Bootstrap v1 decision keys exist';

  -- ---------------------------------------------------------------------
  -- CONTACTS / INTERACTIONS / RUNS — 0 rows introduced by Bootstrap v1
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO cnt FROM agent.contacts;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: expected 0 contacts, found %', cnt;
  END IF;
  SELECT count(*) INTO cnt FROM agent.interactions;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: expected 0 interactions, found %', cnt;
  END IF;
  SELECT count(*) INTO cnt FROM agent.runs;
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: expected 0 runs, found %', cnt;
  END IF;
  RAISE NOTICE 'PASS: 0 contacts, 0 interactions, 0 runs';

  -- ---------------------------------------------------------------------
  -- PUBLIC — reminder only; not something this script can verify from
  -- inside agent.* (there is no "changed by this file" marker on public.*
  -- rows). The bootstrap file itself contains no INSERT/UPDATE/DELETE
  -- against any public.* table — confirm that by inspection if in doubt.
  -- ---------------------------------------------------------------------
  RAISE NOTICE 'MANUAL CHECK: confirm bootstrap_phase0b.sql contains no public.* writes by inspection — this script cannot verify that from inside agent.*';

  RAISE NOTICE '=== ALL AUTOMATED PHASE 0B CHECKS PASSED ===';
END $$;
