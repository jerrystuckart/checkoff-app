-- REVIEW ONLY — NOT A MIGRATION. Read-only verification, safe to run
-- repeatedly against any environment. Run this AFTER manually applying
-- supabase/migrations/20260830_agent_operational_schema_phase0a.sql, to
-- independently confirm the migration landed as specified.
--
-- Each block raises an EXCEPTION and stops on the first failure, so a clean
-- run to the final NOTICE means every check in this file passed.

DO $$
DECLARE
  r record;
  cnt int;
BEGIN

  -- 1. agent schema exists ---------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'agent') THEN
    RAISE EXCEPTION 'FAIL: agent schema does not exist';
  END IF;
  RAISE NOTICE 'PASS: agent schema exists';

  -- 2. all eight tables exist ------------------------------------------------
  SELECT count(*) INTO cnt FROM information_schema.tables
    WHERE table_schema = 'agent' AND table_name IN (
      'owners', 'projects', 'contacts', 'tasks', 'task_events',
      'interactions', 'decisions', 'runs'
    );
  IF cnt <> 8 THEN
    RAISE EXCEPTION 'FAIL: expected 8 agent tables, found %', cnt;
  END IF;
  RAISE NOTICE 'PASS: all 8 agent tables exist';

  -- 3. required columns spot-check (one representative per table) -----------
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='agent' AND table_name='owners' AND column_name='owner_key') THEN
    RAISE EXCEPTION 'FAIL: agent.owners.owner_key missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='agent' AND table_name='tasks' AND column_name='next_check_at') THEN
    RAISE EXCEPTION 'FAIL: agent.tasks.next_check_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='agent' AND table_name='tasks' AND column_name='blocked_by_task_id') THEN
    RAISE EXCEPTION 'FAIL: agent.tasks.blocked_by_task_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='agent' AND table_name='decisions' AND column_name='open_brain_thought_id') THEN
    RAISE EXCEPTION 'FAIL: agent.decisions.open_brain_thought_id missing';
  END IF;
  RAISE NOTICE 'PASS: representative required columns present';

  -- 4. every FK has explicit delete behavior (no NO ACTION-by-omission) -----
  FOR r IN
    SELECT con.conname, con.confdeltype
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'agent' AND con.contype = 'f'
  LOOP
    IF r.confdeltype NOT IN ('r', 'c', 'n', 'd') THEN
      RAISE EXCEPTION 'FAIL: FK % has unexpected delete rule %', r.conname, r.confdeltype;
    END IF;
  END LOOP;
  SELECT count(*) INTO cnt
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'agent' AND con.contype = 'f';
  RAISE NOTICE 'PASS: % FKs in agent schema all have an explicit delete rule', cnt;

  -- 5. all FKs are RESTRICT specifically (Phase 0A's required default) ------
  SELECT count(*) INTO cnt
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname = 'agent' AND con.contype = 'f' AND con.confdeltype <> 'r';
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: % agent.* FK(s) are not ON DELETE RESTRICT', cnt;
  END IF;
  RAISE NOTICE 'PASS: every agent.* FK is ON DELETE RESTRICT';

  -- 6. unique constraints/indexes --------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='agent' AND tablename='projects' AND indexdef ILIKE '%UNIQUE%project_key%') THEN
    RAISE EXCEPTION 'FAIL: projects.project_key UNIQUE index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='agent' AND tablename='owners' AND indexdef ILIKE '%UNIQUE%owner_key%') THEN
    RAISE EXCEPTION 'FAIL: owners.owner_key UNIQUE index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='agent' AND tablename='decisions' AND indexdef ILIKE '%UNIQUE%decision_key%') THEN
    RAISE EXCEPTION 'FAIL: decisions.decision_key UNIQUE index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='agent' AND tablename='interactions'
      AND indexname='interactions_channel_source_ref_idx'
      AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%WHERE%source_ref%IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'FAIL: interactions (channel, source_ref) partial unique index missing/wrong';
  END IF;
  RAISE NOTICE 'PASS: required unique constraints/indexes present';

  -- 7. required task indexes -------------------------------------------------
  IF (SELECT count(*) FROM pg_indexes WHERE schemaname='agent' AND tablename='tasks'
      AND indexname IN ('tasks_status_idx','tasks_next_check_at_idx','tasks_due_at_idx',
                         'tasks_project_id_idx','tasks_owner_id_idx','tasks_contact_id_idx')) <> 6 THEN
    RAISE EXCEPTION 'FAIL: one or more required agent.tasks indexes missing';
  END IF;
  RAISE NOTICE 'PASS: required agent.tasks indexes present';

  -- 8. RLS enabled on all 8 tables ------------------------------------------
  -- NOTE: unlike this repo's service_role-only tables (e.g. city_partnerships),
  -- zero policies is NOT expected here — agent_service is an ordinary role
  -- (no BYPASSRLS, not the table owner — checks 8c/8d below), so it needs its
  -- own policies or RLS blocks it just like anyone else.
  SELECT count(*) INTO cnt FROM pg_tables
    WHERE schemaname='agent' AND tablename IN (
      'owners','projects','contacts','tasks','task_events','interactions','decisions','runs'
    ) AND rowsecurity = true;
  IF cnt <> 8 THEN
    RAISE EXCEPTION 'FAIL: expected RLS enabled on all 8 agent tables, found % ', cnt;
  END IF;
  RAISE NOTICE 'PASS: RLS enabled on all 8 agent tables';

  -- 8a. agent_service has a policy for every action its grants allow --------
  -- Expected policy set per table: owners=SELECT only; task_events/
  -- decisions=SELECT+INSERT only (append-only); projects/contacts/tasks/
  -- runs/interactions=SELECT+INSERT+UPDATE. No table should ever have a
  -- DELETE policy for agent_service. (interactions' UPDATE policy is a
  -- row/role gate only — its actual column scoping is verified separately
  -- in 8e/8g via information_schema.column_privileges, since RLS has no
  -- column concept.)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename='owners' AND policyname='agent_service_select' AND 'agent_service' = ANY(roles) AND cmd='SELECT') THEN
    RAISE EXCEPTION 'FAIL: agent.owners missing agent_service SELECT policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename='owners' AND cmd IN ('INSERT','UPDATE','DELETE')) THEN
    RAISE EXCEPTION 'FAIL: agent.owners has an unexpected write/delete policy (should be SELECT-only for now)';
  END IF;

  FOR r IN SELECT unnest(ARRAY['projects','contacts','tasks','runs','interactions']) AS tbl LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename=r.tbl AND cmd='SELECT' AND 'agent_service' = ANY(roles)) THEN
      RAISE EXCEPTION 'FAIL: agent.% missing agent_service SELECT policy', r.tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename=r.tbl AND cmd='INSERT' AND 'agent_service' = ANY(roles)) THEN
      RAISE EXCEPTION 'FAIL: agent.% missing agent_service INSERT policy', r.tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename=r.tbl AND cmd='UPDATE' AND 'agent_service' = ANY(roles)) THEN
      RAISE EXCEPTION 'FAIL: agent.% missing agent_service UPDATE policy', r.tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename=r.tbl AND cmd='DELETE') THEN
      RAISE EXCEPTION 'FAIL: agent.% has an unexpected DELETE policy', r.tbl;
    END IF;
  END LOOP;

  FOR r IN SELECT unnest(ARRAY['task_events','decisions']) AS tbl LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename=r.tbl AND cmd='SELECT' AND 'agent_service' = ANY(roles)) THEN
      RAISE EXCEPTION 'FAIL: agent.% missing agent_service SELECT policy', r.tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename=r.tbl AND cmd='INSERT' AND 'agent_service' = ANY(roles)) THEN
      RAISE EXCEPTION 'FAIL: agent.% missing agent_service INSERT policy', r.tbl;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='agent' AND tablename=r.tbl AND cmd IN ('UPDATE','DELETE')) THEN
      RAISE EXCEPTION 'FAIL: agent.% (append-only) has an unexpected UPDATE/DELETE policy', r.tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: agent_service policy set matches the intended least-privilege model per table';

  -- 8b. no policy on agent.* targets anon/authenticated/public ---------------
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'agent'
      AND (roles && ARRAY['anon','authenticated','public']::name[])
  ) THEN
    RAISE EXCEPTION 'FAIL: an agent.* RLS policy targets anon/authenticated/public';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'agent' AND 'agent_service' <> ALL(roles)) THEN
    RAISE EXCEPTION 'FAIL: an agent.* RLS policy does not target agent_service specifically';
  END IF;
  RAISE NOTICE 'PASS: every agent.* RLS policy targets agent_service only';

  -- 8c. agent_service does not have BYPASSRLS --------------------------------
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'agent_service') THEN
    RAISE EXCEPTION 'FAIL: agent_service has BYPASSRLS — this defeats the whole RLS model';
  END IF;
  RAISE NOTICE 'PASS: agent_service does not have BYPASSRLS';

  -- 8d. agent_service does not own any agent.* table -------------------------
  -- Postgres does not enforce RLS against a table's owner by default (only
  -- BYPASSRLS or FORCE ROW LEVEL SECURITY change that) — if agent_service
  -- ever became the owner, every policy above would silently do nothing.
  SELECT count(*) INTO cnt FROM pg_tables WHERE schemaname = 'agent' AND tableowner = 'agent_service';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: agent_service owns % agent.* table(s) — RLS policies would not apply to it', cnt;
  END IF;
  RAISE NOTICE 'PASS: agent_service does not own any agent.* table';

  -- 8e. agent_service's TABLE-LEVEL privileges match the intended set
  -- exactly — both directions: nothing missing AND nothing extra.
  --
  -- IMPORTANT: information_schema.role_table_grants (and table_privileges)
  -- only reflects whole-table grants — a column-level GRANT (like
  -- interactions' UPDATE, see 8g) never appears here, even though it grants
  -- real UPDATE privilege on those columns. So interactions' expected
  -- table-level set is {INSERT, SELECT}, same as the append-only tables —
  -- its UPDATE is verified separately, at the column level, in 8g.
  DECLARE
    expected text[];
    actual text[];
  BEGIN
    FOR r IN SELECT * FROM (VALUES
      ('owners',       ARRAY['SELECT']),
      ('projects',     ARRAY['INSERT','SELECT','UPDATE']),
      ('contacts',     ARRAY['INSERT','SELECT','UPDATE']),
      ('tasks',        ARRAY['INSERT','SELECT','UPDATE']),
      ('runs',         ARRAY['INSERT','SELECT','UPDATE']),
      ('task_events',  ARRAY['INSERT','SELECT']),
      ('decisions',    ARRAY['INSERT','SELECT']),
      ('interactions', ARRAY['INSERT','SELECT'])
    ) AS t(tbl, expected_privs)
    LOOP
      expected := r.expected_privs;
      SELECT coalesce(array_agg(DISTINCT privilege_type ORDER BY privilege_type), ARRAY[]::text[])
        INTO actual
        FROM information_schema.role_table_grants
        WHERE table_schema = 'agent' AND table_name = r.tbl AND grantee = 'agent_service';
      IF actual <> expected THEN
        RAISE EXCEPTION 'FAIL: agent_service table-level privileges on agent.% are % but expected % (checking both missing and extra)', r.tbl, actual, expected;
      END IF;
    END LOOP;
  END;
  RAISE NOTICE 'PASS: agent_service table-level privileges match the intended set exactly on every table (no missing, no extra)';

  -- 8f. no DELETE privilege granted anywhere in the schema -------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'agent' AND grantee = 'agent_service' AND privilege_type = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent_service has a DELETE grant somewhere in agent.*';
  END IF;
  RAISE NOTICE 'PASS: agent_service has no DELETE privilege anywhere in agent.*';

  -- 8g. interactions' UPDATE grant is scoped to exactly the enrichment
  -- columns (summary, outcome, requires_action, metadata) — checked via
  -- column_privileges, since role_table_grants can't see column grants at
  -- all (8e's note above). Every other column (identity/timing/links) must
  -- have NO UPDATE privilege for agent_service.
  DECLARE
    actual_cols text[];
    expected_cols text[] := ARRAY['metadata','outcome','requires_action','summary'];
  BEGIN
    SELECT coalesce(array_agg(DISTINCT column_name ORDER BY column_name), ARRAY[]::text[])
      INTO actual_cols
      FROM information_schema.column_privileges
      WHERE table_schema = 'agent' AND table_name = 'interactions'
        AND grantee = 'agent_service' AND privilege_type = 'UPDATE';
    IF actual_cols <> expected_cols THEN
      RAISE EXCEPTION 'FAIL: agent_service UPDATE columns on agent.interactions are % but expected exactly %', actual_cols, expected_cols;
    END IF;
  END;
  RAISE NOTICE 'PASS: agent_service UPDATE on agent.interactions is scoped to exactly the enrichment columns (summary, outcome, requires_action, metadata)';

  -- 9. task status CHECK constraint values -----------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname='agent' AND cl.relname='tasks' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%BACKLOG%' AND pg_get_constraintdef(con.oid) ILIKE '%NEEDS_JERRY%'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.tasks.status CHECK constraint missing or incomplete';
  END IF;
  RAISE NOTICE 'PASS: agent.tasks.status CHECK constraint present';

  -- 10. required task invariants present (spot-check constraint names) ------
  IF (SELECT count(*) FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname='agent' AND cl.relname='tasks' AND con.conname IN (
        'tasks_next_action_required','tasks_waiting_requires_check_at',
        'tasks_blocked_requires_reason','tasks_needs_jerry_requires_request',
        'tasks_in_progress_requires_owner_and_start','tasks_done_requires_completed_at',
        'tasks_requires_jerry_matches_status'
      )) <> 7 THEN
    RAISE EXCEPTION 'FAIL: one or more agent.tasks status-invariant CHECK constraints missing';
  END IF;
  RAISE NOTICE 'PASS: agent.tasks status-invariant CHECK constraints present';

  -- 10a. requires_jerry <-> status='NEEDS_JERRY' is a true biconditional,
  -- not just a one-way implication (i.e. status='READY' + requires_jerry=
  -- true must be rejected, not merely NEEDS_JERRY-without-requires_jerry).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname='agent' AND cl.relname='tasks' AND con.conname='tasks_requires_jerry_matches_status'
      -- Loose substring match rather than an exact literal, since
      -- pg_get_constraintdef may render an explicit ::text cast after the
      -- 'NEEDS_JERRY' literal depending on Postgres version.
      AND pg_get_constraintdef(con.oid) ILIKE '%requires_jerry = (status =%NEEDS_JERRY%'
  ) THEN
    RAISE EXCEPTION 'FAIL: tasks_requires_jerry_matches_status is not the expected biconditional';
  END IF;
  RAISE NOTICE 'PASS: requires_jerry is enforced as a true biconditional with status = NEEDS_JERRY';

  -- 10b. task_events.from_status/to_status are constrained to the task
  -- status vocabulary (nullable, but no typo'd values) -----------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname='agent' AND cl.relname='task_events' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%from_status%' AND pg_get_constraintdef(con.oid) ILIKE '%NEEDS_JERRY%'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.task_events.from_status CHECK constraint missing or incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname='agent' AND cl.relname='task_events' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%to_status%' AND pg_get_constraintdef(con.oid) ILIKE '%NEEDS_JERRY%'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.task_events.to_status CHECK constraint missing or incomplete';
  END IF;
  RAISE NOTICE 'PASS: agent.task_events.from_status/to_status are constrained to the task status vocabulary';

  -- 11. Open Brain columns exist AND are nullable — as two separate,
  -- positive assertions. The previous version of this check
  -- (`IF EXISTS (... AND is_nullable = 'NO')`) was a false-positive trap:
  -- if a column were missing entirely, the inner EXISTS would find nothing
  -- either way and the check would silently PASS. Counting the exact
  -- expected column set closes that gap.
  SELECT count(*) INTO cnt FROM information_schema.columns
    WHERE table_schema='agent' AND table_name='decisions'
      AND column_name IN ('open_brain_thought_id','open_brain_title_snapshot','open_brain_summary_snapshot');
  IF cnt <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected all 3 Open Brain columns to exist on agent.decisions, found %', cnt;
  END IF;
  SELECT count(*) INTO cnt FROM information_schema.columns
    WHERE table_schema='agent' AND table_name='decisions'
      AND column_name IN ('open_brain_thought_id','open_brain_title_snapshot','open_brain_summary_snapshot')
      AND is_nullable = 'YES';
  IF cnt <> 3 THEN
    RAISE EXCEPTION 'FAIL: expected all 3 Open Brain columns on agent.decisions to be nullable, found % nullable', cnt;
  END IF;
  RAISE NOTICE 'PASS: all 3 Open Brain columns exist on agent.decisions and are nullable';

  -- 12. runs.project_id / runs.task_id exist AND are nullable — same
  -- exists-then-nullable pattern as check 11, for the same reason.
  SELECT count(*) INTO cnt FROM information_schema.columns
    WHERE table_schema='agent' AND table_name='runs' AND column_name IN ('project_id','task_id');
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected both project_id and task_id to exist on agent.runs, found %', cnt;
  END IF;
  SELECT count(*) INTO cnt FROM information_schema.columns
    WHERE table_schema='agent' AND table_name='runs' AND column_name IN ('project_id','task_id')
      AND is_nullable = 'YES';
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected agent.runs.project_id and task_id to both be nullable, found % nullable', cnt;
  END IF;
  RAISE NOTICE 'PASS: agent.runs.project_id and task_id exist and are nullable';

  -- 13. no unintended FKs from agent.* to public.* ---------------------------
  SELECT count(*) INTO cnt
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_class fcl ON fcl.oid = con.confrelid
    JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
    WHERE ns.nspname = 'agent' AND con.contype = 'f' AND fns.nspname <> 'agent';
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL: found % FK(s) from agent.* into a non-agent schema', cnt;
  END IF;
  RAISE NOTICE 'PASS: no FKs from agent.* into public.* or any other schema';

  -- 14. no seed rows ----------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM agent.owners UNION ALL SELECT 1 FROM agent.projects UNION ALL
    SELECT 1 FROM agent.contacts UNION ALL SELECT 1 FROM agent.tasks UNION ALL
    SELECT 1 FROM agent.task_events UNION ALL SELECT 1 FROM agent.interactions UNION ALL
    SELECT 1 FROM agent.decisions UNION ALL SELECT 1 FROM agent.runs
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.* contains rows — Phase 0A must ship with zero seed data';
  END IF;
  RAISE NOTICE 'PASS: no seed rows in any agent.* table';

  -- 15. agent.* is not granted to anon/authenticated/service_role -----------
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'agent' AND grantee IN ('anon', 'authenticated', 'service_role')
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.* has a grant to anon/authenticated/service_role — should only be granted to agent_service';
  END IF;
  RAISE NOTICE 'PASS: agent.* is not granted to anon/authenticated/service_role';

  -- 15a. schema-level privileges: agent_service has exactly USAGE (not
  -- CREATE) on schema agent; anon/authenticated/service_role have neither.
  -- has_schema_privilege() computes EFFECTIVE privilege — it accounts for
  -- PUBLIC-implied grants and role-membership inheritance, unlike a raw
  -- information_schema row lookup, which is the actual gap between "no
  -- direct grant" and "no effective access."
  IF NOT has_schema_privilege('agent_service', 'agent', 'USAGE') THEN
    RAISE EXCEPTION 'FAIL: agent_service does not have effective USAGE on schema agent';
  END IF;
  IF has_schema_privilege('agent_service', 'agent', 'CREATE') THEN
    RAISE EXCEPTION 'FAIL: agent_service has effective CREATE on schema agent — it should not be able to create new objects in this schema';
  END IF;
  FOR r IN SELECT unnest(ARRAY['anon','authenticated','service_role']) AS rolename LOOP
    IF has_schema_privilege(r.rolename, 'agent', 'USAGE') THEN
      RAISE EXCEPTION 'FAIL: % has effective USAGE on schema agent', r.rolename;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: agent_service has exactly USAGE (not CREATE) on schema agent; anon/authenticated/service_role have neither';

  -- 15b. agent_service is not a member of any other role. Role membership
  -- is the actual mechanism by which a role could inherit privileges it
  -- wasn't directly granted (e.g. if someone later ran `GRANT authenticated
  -- TO agent_service`) — this migration never does that, and this check
  -- proves it stayed that way.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = 'agent_service'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent_service is a member of another role — this could grant it privileges beyond agent.* through inheritance';
  END IF;
  RAISE NOTICE 'PASS: agent_service is not a member of any other role';

  -- 15c. agent_service has no elevated role attributes (superuser/createdb/
  -- createrole would each independently defeat the least-privilege model
  -- regardless of what's granted on agent.*).
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'agent_service' AND (rolsuper OR rolcreatedb OR rolcreaterole)
  ) THEN
    RAISE EXCEPTION 'FAIL: agent_service has an elevated role attribute (superuser/createdb/createrole)';
  END IF;
  RAISE NOTICE 'PASS: agent_service has no elevated role attributes';

  -- 15d. agent_service has NO effective WRITE (INSERT/UPDATE/DELETE) on ANY
  -- public.* table, full stop — deliberately UNFILTERED (checked against
  -- every table in public, including system/extension-owned ones like
  -- PostGIS's spatial_ref_sys). There is no legitimate reason for
  -- agent_service to have write access to anything in public, extension
  -- catalog or application data alike, and extension reference tables like
  -- spatial_ref_sys don't grant PUBLIC write in practice — so this check
  -- has no false-positive risk from being broad, and being broad is
  -- strictly safer than filtering it.
  FOR r IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LOOP
    IF has_table_privilege('agent_service', quote_ident('public') || '.' || quote_ident(r.table_name), 'INSERT')
      OR has_table_privilege('agent_service', quote_ident('public') || '.' || quote_ident(r.table_name), 'UPDATE')
      OR has_table_privilege('agent_service', quote_ident('public') || '.' || quote_ident(r.table_name), 'DELETE')
    THEN
      RAISE EXCEPTION 'FAIL: agent_service has effective WRITE (INSERT/UPDATE/DELETE) privilege on public.%', r.table_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: agent_service has zero effective INSERT/UPDATE/DELETE on every public.* table';

  -- 15d2. agent_service has NO effective SELECT on any CheckOff-owned
  -- APPLICATION table in public — FILTERED to exclude system/extension-
  -- managed objects, via a principled test rather than a hardcoded
  -- table-name list: pg_depend records every object that is a *member* of
  -- an extension (deptype = 'e'). PostGIS's spatial_ref_sys is created by
  -- the postgis extension and is such a member; it carries its own
  -- baseline PUBLIC SELECT grant (`=r/supabase_admin` in its ACL) that has
  -- nothing to do with this migration — agent_service inherits that like
  -- every other role via the PUBLIC pseudo-role, not because anything here
  -- granted it application-data authority. A hardcoded exclusion list would
  -- need updating for every extension CheckOff ever installs; this filter
  -- doesn't.
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'f')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    IF has_table_privilege('agent_service', quote_ident('public') || '.' || quote_ident(r.table_name), 'SELECT') THEN
      RAISE EXCEPTION 'FAIL: agent_service has effective SELECT on CheckOff application table public.%', r.table_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS: agent_service has zero effective SELECT on every CheckOff-owned application table in public (extension-owned tables excluded from this check — see 15e for what was excluded and why)';

  -- 15e. Report (do NOT fail on, and do NOT revoke) any baseline privilege
  -- PUBLIC itself holds on the public schema or its tables — including the
  -- extension-owned tables excluded from 15d2's SELECT check, named
  -- explicitly here so "excluded" doesn't mean "unexamined." Some baseline
  -- PUBLIC access is normal/expected in Postgres/Supabase (e.g. USAGE on
  -- the public schema, or PostGIS reference tables granting PUBLIC SELECT)
  -- and revoking it here would be a destructive, unrelated change to
  -- existing production privileges/extension behavior this migration has
  -- no mandate to make. This is informational only — 15d/15d2 above are the
  -- actual pass/fail gates for agent_service specifically.
  --
  -- NOTE: has_schema_privilege()/has_table_privilege() do NOT accept the
  -- literal 'PUBLIC' as a role argument — there is no role named PUBLIC in
  -- pg_roles; that spelling is only special syntax inside GRANT/REVOKE. To
  -- check what the PUBLIC pseudo-role itself holds, this reads the ACL
  -- directly via aclexplode(), where a grantee OID of 0 denotes PUBLIC —
  -- the same mechanism information_schema's own views use internally to
  -- render the literal text 'PUBLIC' in their grantee column.
  IF EXISTS (
    SELECT 1 FROM pg_namespace n,
      aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'USAGE'
  ) THEN
    RAISE NOTICE 'INFO: PUBLIC has baseline USAGE on schema public (schema name resolution only, not data access) — not modified by this migration';
  END IF;

  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'f')
      AND EXISTS (
        SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE a.grantee = 0 AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      )
  LOOP
    RAISE NOTICE 'INFO: public.% is extension-owned (excluded from 15d2''s application-table SELECT check) and grants PUBLIC some privilege via its own ACL, unrelated to this migration', r.table_name;
  END LOOP;

  SELECT count(*) INTO cnt FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
      AND EXISTS (
        SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE a.grantee = 0 AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      );
  IF cnt > 0 THEN
    RAISE NOTICE 'INFO: % CheckOff application table(s) in public grant some DML privilege to PUBLIC directly (pre-existing project state, not introduced by this migration, not revoked by it) — review with `SELECT table_name FROM information_schema.role_table_grants WHERE grantee=''PUBLIC'' AND table_schema=''public''` if this is unexpected', cnt;
  ELSE
    RAISE NOTICE 'INFO: no CheckOff application table in public grants any DML privilege to PUBLIC';
  END IF;

  -- 15f. What this file can and cannot say about service_role specifically:
  -- service_role is not a member of agent_service and vice versa (15b
  -- covers agent_service's side), and 15/15a already prove service_role has
  -- no direct grant or schema USAGE on agent.*. What this file cannot
  -- meaningfully validate is Supabase's own platform-level behavior for
  -- service_role (its BYPASSRLS attribute and whatever broad default
  -- privileges Supabase's project bootstrap may have granted it on
  -- public.*) — that is Supabase account/project configuration, not
  -- something this migration touches or can introspect further than the
  -- ordinary Postgres catalog checks already performed above.
  RAISE NOTICE 'INFO: service_role''s own BYPASSRLS/default-privilege behavior on public.* is Supabase platform configuration, not altered or introspectable further by this migration';

  -- 16. locked status value sets are present as specified --------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname='agent' AND cl.relname='projects' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%PLANNED%' AND pg_get_constraintdef(con.oid) ILIKE '%ACTIVE%'
      AND pg_get_constraintdef(con.oid) ILIKE '%ON_HOLD%' AND pg_get_constraintdef(con.oid) ILIKE '%COMPLETED%'
      AND pg_get_constraintdef(con.oid) ILIKE '%CANCELED%'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.projects.status CHECK constraint missing PLANNED/ACTIVE/ON_HOLD/COMPLETED/CANCELED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname='agent' AND cl.relname='runs' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%RUNNING%' AND pg_get_constraintdef(con.oid) ILIKE '%SUCCEEDED%'
      AND pg_get_constraintdef(con.oid) ILIKE '%FAILED%' AND pg_get_constraintdef(con.oid) ILIKE '%CANCELED%'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.runs.status CHECK constraint missing RUNNING/SUCCEEDED/FAILED/CANCELED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE ns.nspname='agent' AND cl.relname='interactions' AND con.contype='c'
      AND pg_get_constraintdef(con.oid) ILIKE '%INBOUND%' AND pg_get_constraintdef(con.oid) ILIKE '%OUTBOUND%'
  ) THEN
    RAISE EXCEPTION 'FAIL: agent.interactions.direction CHECK constraint missing INBOUND/OUTBOUND';
  END IF;
  RAISE NOTICE 'PASS: locked status value sets (projects.status, runs.status, interactions.direction) present';

  -- 17. agent schema is not on PostgREST's exposed-schemas list --------------
  -- Exposed schemas are project-level Supabase config (Studio → API
  -- Settings), not something visible from inside Postgres itself. This
  -- migration does not and cannot change that setting — confirm manually in
  -- the dashboard that "agent" is absent from "Exposed schemas".
  RAISE NOTICE 'MANUAL CHECK: confirm in Supabase Studio > API Settings that "agent" is NOT in Exposed schemas';

  RAISE NOTICE '=== ALL AUTOMATED CHECKS PASSED ===';
END $$;
