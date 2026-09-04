-- Phase 0A: agent operational data/control layer (schema only — no Chief
-- agent, no LLM/SDK integration, no Open Brain integration, no schedulers,
-- no seed data). Creates a new, independently-evolvable `agent` schema with
-- eight tables representing current operational state: projects, tasks,
-- task history, owners, contacts, interactions, decisions, and future agent
-- run observability.
--
-- REVIEW-READY — DO NOT RUN AGAINST THE LINKED PROJECT WITHOUT REVIEW.
-- This migration was authored by inspecting the actual repo conventions
-- (gen_random_uuid(), text+CHECK over enums, BEGIN/COMMIT + IF NOT EXISTS
-- idempotency) — see docs/agent-platform/phase0a-review.md for the full
-- inspection report, architecture findings, and the access-model rationale.
--
-- Run manually via:
--   supabase db query -f supabase/migrations/20260830_agent_operational_schema_phase0a.sql --linked
--
-- ACCESS MODEL (see docs/agent-platform/phase0a-review.md §3 for full
-- rationale): this repo's only existing privileged-access pattern is the
-- Supabase `service_role` key (used by Edge Functions and the local admin
-- tool), which bypasses RLS entirely and has broad standing access to
-- public.*. Handing the future TS Chief service that same key would violate
-- the Phase 0A requirement that it not gain unrestricted authority over
-- public.*. This migration therefore creates a NEW, dedicated,
-- least-privilege Postgres role (`agent_service`) scoped to nothing but the
-- `agent` schema, intended to be reached via a direct Postgres connection
-- (NOT through PostgREST/supabase-js) — the `agent` schema is not added to
-- Supabase's exposed-schemas list by this migration, and none should be.
--
-- RLS stays enabled on every agent.* table. `agent_service` does NOT get
-- BYPASSRLS and does NOT own these tables (whichever role runs this
-- migration does — see the ownership postflight check below), so RLS is
-- fully enforced against it like any other role. Because RLS is enforced,
-- `agent_service` also needs explicit per-table, per-action RLS policies
-- (below) matching its intended grants — grants alone are not sufficient.
-- These policies are plain role gates (`TO agent_service USING (true)`),
-- not row-level predicates: `agent_service` connects directly to Postgres
-- with no JWT/session context to write a row-owner check against, so this
-- is "let this one role in, per allowed action, per table" rather than
-- multi-tenant row isolation.
--
-- The role is created WITHOUT LOGIN and WITHOUT a password here — enabling
-- login and setting a password is a manual, out-of-band step for Jerry
-- (never commit a DB password to a migration file).

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight guard — this is a brand-new schema; fail loudly instead of
-- silently colliding if `agent` already exists with unexpected contents
-- (e.g. a partial prior run outside of IF NOT EXISTS coverage).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'agent' AND table_name NOT IN (
      'owners', 'projects', 'contacts', 'tasks', 'task_events',
      'interactions', 'decisions', 'runs'
    )
  ) THEN
    RAISE EXCEPTION 'agent schema already contains unexpected objects — inspect before re-running this migration';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS agent;

-- Defense-in-depth, not a correction of observed behavior: verified against
-- Postgres's actual defaults, a newly created schema (anything other than
-- the schema literally named "public") does NOT grant anything to PUBLIC on
-- creation, and CREATE TABLE does not grant anything to PUBLIC either — so
-- this is a no-op against current state. It's here so the intended "PUBLIC
-- gets nothing in this schema" posture is explicit and self-reasserting,
-- rather than relying on an absence of a grant that was never made.
REVOKE ALL ON SCHEMA agent FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger. The repo has no existing reusable updated_at
-- trigger function anywhere (public.* tables set updated_at manually from
-- application/RPC code) — this proposes one, scoped entirely to the agent
-- schema so it introduces no new convention for public.* to reconcile with.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION agent.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Unlike schemas/tables, Postgres DOES grant EXECUTE on a new function to
-- PUBLIC by default. Revoking it does not affect trigger firing — verified
-- against Postgres's trigger semantics: a trigger function is invoked
-- internally by the executor as a side effect of the table DML, and the
-- invoking role is never checked for EXECUTE on the trigger function
-- itself (only for the normal DML privilege on the table). This just
-- closes off the unrelated ability to CALL agent.set_updated_at() directly.
REVOKE ALL ON FUNCTION agent.set_updated_at() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- agent.owners — registry for humans, agents, and system actors. No seed
-- rows (Phase 0B bootstraps real owners after this schema is reviewed).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.owners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key     text NOT NULL UNIQUE,
  owner_type    text NOT NULL CHECK (owner_type IN ('HUMAN', 'AGENT', 'SYSTEM')),
  display_name  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);

DROP TRIGGER IF EXISTS set_updated_at ON agent.owners;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent.owners
  FOR EACH ROW EXECUTE FUNCTION agent.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent.projects — high-level CheckOff initiatives.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key       text NOT NULL UNIQUE,
  name              text NOT NULL,
  project_type      text NOT NULL,
  -- Minimal status set, locked by Jerry — no sub-states, no workflow engine.
  status            text NOT NULL DEFAULT 'PLANNED'
                      CHECK (status IN ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELED')),
  priority          text,
  summary           text,
  owner_id          uuid REFERENCES agent.owners(id) ON DELETE RESTRICT,
  started_at        timestamptz,
  target_at         timestamptz,
  completed_at      timestamptz,
  last_activity_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT projects_completed_requires_completed_at
    CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

DROP TRIGGER IF EXISTS set_updated_at ON agent.projects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent.projects
  FOR EACH ROW EXECUTE FUNCTION agent.set_updated_at();

CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON agent.projects (owner_id);

-- ---------------------------------------------------------------------------
-- agent.contacts — lightweight relationship/CRM state. No next_followup_at:
-- a follow-up is work, and work is represented by agent.tasks. This is a
-- locked architectural principle — do not add a second, independently
-- writable follow-up clock here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.contacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name   text,
  person_name         text,
  role                text,
  email               text,
  phone               text,
  website             text,
  instagram           text,
  linkedin            text,
  contact_type        text,
  relationship_status text,
  source              text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

DROP TRIGGER IF EXISTS set_updated_at ON agent.contacts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent.contacts
  FOR EACH ROW EXECUTE FUNCTION agent.set_updated_at();

-- ---------------------------------------------------------------------------
-- agent.tasks — authoritative CURRENT operational task state. Cancellation
-- is a status, not row deletion; all FKs default to RESTRICT to preserve
-- operational history.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid REFERENCES agent.projects(id) ON DELETE RESTRICT,
  parent_task_id      uuid REFERENCES agent.tasks(id) ON DELETE RESTRICT,
  contact_id          uuid REFERENCES agent.contacts(id) ON DELETE RESTRICT,
  title               text NOT NULL,
  description         text,
  status              text NOT NULL DEFAULT 'BACKLOG'
                        CHECK (status IN (
                          'BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING',
                          'BLOCKED', 'NEEDS_JERRY', 'DONE', 'CANCELED'
                        )),
  priority            text,
  owner_id            uuid REFERENCES agent.owners(id) ON DELETE RESTRICT,
  due_at              timestamptz,
  next_check_at       timestamptz,
  -- Primary blocker only — this is NOT intended to model a complete
  -- dependency graph. If a task has multiple blockers, pick the most
  -- material one here and note the rest in blocker_note/description.
  blocked_by_task_id  uuid REFERENCES agent.tasks(id) ON DELETE RESTRICT,
  blocker_note        text,
  requires_jerry      boolean NOT NULL DEFAULT false,
  jerry_request       text,
  next_action         text,
  source_type         text,
  source_ref          text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Direct single-contact link, intentional for Phase 0: most tasks relate
  -- to zero or one contact. Not a join table — if a task ever needs multiple
  -- contacts, that's a Phase 0B+ decision, not solved here.
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT tasks_not_self_blocked CHECK (blocked_by_task_id IS NULL OR blocked_by_task_id <> id),
  CONSTRAINT tasks_not_self_parent CHECK (parent_task_id IS NULL OR parent_task_id <> id),

  -- "What happens next?" — every task except BACKLOG/DONE/CANCELED must
  -- carry a meaningful next_action. This and the per-status checks below are
  -- fully expressible as same-row CHECK constraints, so they're enforced
  -- here rather than deferred to the service layer.
  CONSTRAINT tasks_next_action_required CHECK (
    status IN ('BACKLOG', 'DONE', 'CANCELED')
    OR (next_action IS NOT NULL AND btrim(next_action) <> '')
  ),
  CONSTRAINT tasks_waiting_requires_check_at CHECK (
    status <> 'WAITING' OR next_check_at IS NOT NULL
  ),
  CONSTRAINT tasks_blocked_requires_reason CHECK (
    status <> 'BLOCKED'
    OR blocked_by_task_id IS NOT NULL
    OR (blocker_note IS NOT NULL AND btrim(blocker_note) <> '')
  ),
  -- requires_jerry and status are kept as separate columns but must never
  -- disagree: requires_jerry is true if and only if status = 'NEEDS_JERRY'.
  -- Without this, e.g. status='READY' + requires_jerry=true would give the
  -- operational system two contradictory answers to "does this need Jerry?".
  CONSTRAINT tasks_requires_jerry_matches_status CHECK (
    requires_jerry = (status = 'NEEDS_JERRY')
  ),
  CONSTRAINT tasks_needs_jerry_requires_request CHECK (
    status <> 'NEEDS_JERRY'
    OR (jerry_request IS NOT NULL AND btrim(jerry_request) <> '')
  ),
  CONSTRAINT tasks_in_progress_requires_owner_and_start CHECK (
    status <> 'IN_PROGRESS' OR (owner_id IS NOT NULL AND started_at IS NOT NULL)
  ),
  CONSTRAINT tasks_done_requires_completed_at CHECK (
    status <> 'DONE' OR completed_at IS NOT NULL
  )
  -- NOTE: CANCELED's "reason must live in a task_events STATUS_CHANGED note"
  -- invariant is cross-table and cannot be a CHECK constraint. It is left to
  -- the future transition_task() service primitive to enforce — see
  -- docs/agent-platform/phase0a-review.md.
);

COMMENT ON COLUMN agent.tasks.blocked_by_task_id IS
  'Primary blocker only. Not intended to model a complete task dependency graph.';
COMMENT ON COLUMN agent.tasks.contact_id IS
  'Single-contact link, intentional for Phase 0 — most tasks relate to zero or one contact. No join table yet.';
COMMENT ON COLUMN agent.tasks.due_at IS
  'When the work should be completed.';
COMMENT ON COLUMN agent.tasks.next_check_at IS
  'When the Chief should reconsider/inspect the task. Distinct from due_at.';

DROP TRIGGER IF EXISTS set_updated_at ON agent.tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON agent.tasks
  FOR EACH ROW EXECUTE FUNCTION agent.set_updated_at();

CREATE INDEX IF NOT EXISTS tasks_status_idx ON agent.tasks (status);
CREATE INDEX IF NOT EXISTS tasks_next_check_at_idx ON agent.tasks (next_check_at);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx ON agent.tasks (due_at);
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON agent.tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_owner_id_idx ON agent.tasks (owner_id);
CREATE INDEX IF NOT EXISTS tasks_contact_id_idx ON agent.tasks (contact_id);
-- Not in the spec's explicit list, but added because this table's design
-- revolves around walking parent/blocker chains ("what are the subtasks of
-- X", "what task is blocking Y") — Postgres does not auto-index FK columns.
CREATE INDEX IF NOT EXISTS tasks_parent_task_id_idx ON agent.tasks (parent_task_id);
CREATE INDEX IF NOT EXISTS tasks_blocked_by_task_id_idx ON agent.tasks (blocked_by_task_id);

-- ---------------------------------------------------------------------------
-- agent.task_events — append-only meaningful task history.
--
-- event_type is intentionally NOT a CHECK-constrained enum, unlike this
-- repo's usual text+CHECK convention for status-like columns (see
-- geofence_debug_events.event_type, which needed a follow-up migration just
-- to add one new value). The Phase 0A spec explicitly calls this out: this
-- table must accept new legitimate event types without a schema migration
-- every time, so it is left as free-form NOT NULL text. Validate/normalize
-- event_type values in the future transition_task() service layer instead.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.task_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id               uuid NOT NULL REFERENCES agent.tasks(id) ON DELETE RESTRICT,
  event_type            text NOT NULL,
  -- Unlike event_type, from_status/to_status describe the fixed
  -- agent.tasks state machine, not an open vocabulary — a typo'd status
  -- string here would silently corrupt the append-only history these rows
  -- exist to protect, so they're constrained to that same status list.
  from_status           text CHECK (from_status IS NULL OR from_status IN (
                          'BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING',
                          'BLOCKED', 'NEEDS_JERRY', 'DONE', 'CANCELED'
                        )),
  to_status             text CHECK (to_status IS NULL OR to_status IN (
                          'BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING',
                          'BLOCKED', 'NEEDS_JERRY', 'DONE', 'CANCELED'
                        )),
  changed_by_owner_id   uuid REFERENCES agent.owners(id) ON DELETE RESTRICT,
  changed_at            timestamptz NOT NULL DEFAULT now(),
  note                  text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE agent.task_events IS
  'Append-only. The application/service role should not be granted routine DELETE on this table.';

-- Composite index serves both "timeline for this task" and "task_id only"
-- lookups; changed_at alone serves "what changed recently" across all tasks.
CREATE INDEX IF NOT EXISTS task_events_task_id_changed_at_idx ON agent.task_events (task_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS task_events_changed_at_idx ON agent.task_events (changed_at DESC);

-- ---------------------------------------------------------------------------
-- agent.interactions — historical communication/activity. No followup_at:
-- if an interaction requires future work, the future service layer creates
-- a task for it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.interactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid REFERENCES agent.contacts(id) ON DELETE RESTRICT,
  project_id      uuid REFERENCES agent.projects(id) ON DELETE RESTRICT,
  task_id         uuid REFERENCES agent.tasks(id) ON DELETE RESTRICT,
  channel         text NOT NULL,
  direction       text CHECK (direction IS NULL OR direction IN ('INBOUND', 'OUTBOUND')),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  subject         text,
  summary         text,
  outcome         text,
  requires_action boolean NOT NULL DEFAULT false,
  source_ref      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Idempotency key for interactions ingested from an external provider
-- (email/message id, calendar event id, etc). Rows with no source_ref
-- (manually logged interactions) remain freely insertable.
CREATE UNIQUE INDEX IF NOT EXISTS interactions_channel_source_ref_idx
  ON agent.interactions (channel, source_ref) WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS interactions_contact_id_idx ON agent.interactions (contact_id);
CREATE INDEX IF NOT EXISTS interactions_project_id_idx ON agent.interactions (project_id);
CREATE INDEX IF NOT EXISTS interactions_task_id_idx ON agent.interactions (task_id);

-- ---------------------------------------------------------------------------
-- agent.decisions — concise operational record of meaningful decisions.
-- Open Brain fields are nullable placeholders; no Open Brain integration is
-- built in Phase 0A. open_brain_thought_id is stored as text (not uuid) since
-- Open Brain's ID format is not being assumed/locked in by this migration.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.decisions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  uuid REFERENCES agent.projects(id) ON DELETE RESTRICT,
  decision_key                text NOT NULL UNIQUE,
  decision                    text NOT NULL,
  decided_at                  timestamptz NOT NULL DEFAULT now(),
  decided_by_owner_id         uuid REFERENCES agent.owners(id) ON DELETE RESTRICT,
  open_brain_thought_id       text,
  open_brain_title_snapshot   text,
  open_brain_summary_snapshot text,
  supersedes_decision_id      uuid REFERENCES agent.decisions(id) ON DELETE RESTRICT,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT decisions_not_self_superseding CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id)
);

CREATE INDEX IF NOT EXISTS decisions_project_id_idx ON agent.decisions (project_id);

-- ---------------------------------------------------------------------------
-- agent.runs — future observability for Chief and specialist-agent
-- executions. project_id and task_id stay nullable: global audits, research
-- sweeps, and health checks are legitimate task-less/project-less runs.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent.runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES agent.projects(id) ON DELETE RESTRICT,
  task_id         uuid REFERENCES agent.tasks(id) ON DELETE RESTRICT,
  agent_owner_id  uuid REFERENCES agent.owners(id) ON DELETE RESTRICT,
  run_type        text NOT NULL,
  run_scope       text,
  status          text NOT NULL DEFAULT 'RUNNING'
                    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  input_summary   text,
  output_summary  text,
  error_message   text,
  trace_id        text,
  model           text,
  usage_metadata  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_project_id_idx ON agent.runs (project_id);
CREATE INDEX IF NOT EXISTS runs_task_id_idx ON agent.runs (task_id);
CREATE INDEX IF NOT EXISTS runs_agent_owner_id_idx ON agent.runs (agent_owner_id);

-- ---------------------------------------------------------------------------
-- RLS — enabled on every agent.* table. Unlike this repo's existing
-- "service_role only" tables (city_partnerships, destination_partners),
-- zero policies is NOT the right posture here: those tables are reachable
-- only by service_role, which bypasses RLS entirely, so an empty policy set
-- correctly means "nobody else gets in." agent_service is an ordinary role
-- with NO BYPASSRLS (verified in the postflight guard below) and does NOT
-- own these tables (ownership belongs to whichever role runs this migration
-- — also verified below), so RLS applies to it in full. That means
-- agent_service needs its own explicit policies below, or it would see and
-- write nothing despite its table grants.
-- ---------------------------------------------------------------------------

ALTER TABLE agent.owners        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.task_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.interactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.runs          ENABLE ROW LEVEL SECURITY;

-- Same defense-in-depth posture as the schema-level REVOKE above, now that
-- all 8 tables exist: CREATE TABLE does not grant anything to PUBLIC by
-- default, so this is a no-op against current state, but makes "PUBLIC has
-- nothing here" explicit and self-reasserting.
REVOKE ALL ON ALL TABLES IN SCHEMA agent FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Least-privilege service role. Created WITHOUT LOGIN and WITHOUT a
-- password — enabling login and setting a password/connection limit is a
-- manual step Jerry performs directly against the linked project (never
-- commit a DB credential to a migration file). This role is not granted
-- anything on public.*, and public.* roles (anon, authenticated,
-- service_role) are not granted anything here. It never receives BYPASSRLS.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_service') THEN
    CREATE ROLE agent_service NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA agent TO agent_service;

-- ---------------------------------------------------------------------------
-- Per-table least privilege, split by what each table actually represents
-- rather than granting an identical SELECT/INSERT/UPDATE set everywhere:
--
--   Mutable current-state tables (the service both creates and updates rows
--   in as work progresses): projects, contacts, tasks, runs
--     -> SELECT, INSERT, UPDATE. No DELETE anywhere in this schema — see
--        below.
--
--   Append-only historical-fact tables (a fact is recorded once and never
--   rewritten; a correction is a new row, not an edit): task_events,
--   decisions
--     -> SELECT, INSERT only. No UPDATE, no DELETE. task_events is
--        explicitly required to be append-only by the Phase 0A spec;
--        decisions get the same treatment — a correction supersedes via a
--        new row (supersedes_decision_id), it does not edit the original —
--        "historical data should be more restrictive where appropriate."
--
--   interactions is NOT append-only, deliberately: a message can be
--   ingested (INSERT) before it's been classified, and enrichment
--   (summary/outcome/requires_action/metadata) needs to land on the SAME
--   row afterward — the partial unique index on (channel, source_ref)
--   means a corrected re-INSERT for the same source message is rejected,
--   so "insert a second copy" is not an option here the way it is for
--   task_events/decisions. The UPDATE grant is scoped to exactly the
--   enrichment columns (summary, outcome, requires_action, metadata) via a
--   column-level GRANT — occurred_at, channel, source_ref, and the
--   contact_id/project_id/task_id links stay immutable after insert. RLS
--   cannot restrict which columns an UPDATE touches (documented elsewhere
--   in this repo — see candidate_visits_update_own in
--   20260828_visit_detection_phase1.sql), so the column-level GRANT is the
--   real enforcement here; the RLS policy below is still required as the
--   role/row gate, same as every other table.
--
--   owners (registry, not yet bootstrapped — Phase 0B owns creating real
--   owner rows, done by an admin role, not agent_service)
--     -> SELECT only for now. INSERT/UPDATE can be added in a later,
--        narrowly-scoped migration once the service has a concrete need
--        (e.g. registering a new specialist agent) to write here.
--
-- Every GRANT below is paired with a matching RLS policy — the grant alone
-- does nothing while RLS is enabled and enforced, per the note above.
-- ---------------------------------------------------------------------------

-- owners: read-only for agent_service.
GRANT SELECT ON agent.owners TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.owners;
CREATE POLICY agent_service_select ON agent.owners
  FOR SELECT TO agent_service USING (true);

-- projects: current-state table.
GRANT SELECT, INSERT, UPDATE ON agent.projects TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.projects;
CREATE POLICY agent_service_select ON agent.projects
  FOR SELECT TO agent_service USING (true);
DROP POLICY IF EXISTS agent_service_insert ON agent.projects;
CREATE POLICY agent_service_insert ON agent.projects
  FOR INSERT TO agent_service WITH CHECK (true);
DROP POLICY IF EXISTS agent_service_update ON agent.projects;
CREATE POLICY agent_service_update ON agent.projects
  FOR UPDATE TO agent_service USING (true) WITH CHECK (true);

-- contacts: current-state table.
GRANT SELECT, INSERT, UPDATE ON agent.contacts TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.contacts;
CREATE POLICY agent_service_select ON agent.contacts
  FOR SELECT TO agent_service USING (true);
DROP POLICY IF EXISTS agent_service_insert ON agent.contacts;
CREATE POLICY agent_service_insert ON agent.contacts
  FOR INSERT TO agent_service WITH CHECK (true);
DROP POLICY IF EXISTS agent_service_update ON agent.contacts;
CREATE POLICY agent_service_update ON agent.contacts
  FOR UPDATE TO agent_service USING (true) WITH CHECK (true);

-- tasks: current-state table.
GRANT SELECT, INSERT, UPDATE ON agent.tasks TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.tasks;
CREATE POLICY agent_service_select ON agent.tasks
  FOR SELECT TO agent_service USING (true);
DROP POLICY IF EXISTS agent_service_insert ON agent.tasks;
CREATE POLICY agent_service_insert ON agent.tasks
  FOR INSERT TO agent_service WITH CHECK (true);
DROP POLICY IF EXISTS agent_service_update ON agent.tasks;
CREATE POLICY agent_service_update ON agent.tasks
  FOR UPDATE TO agent_service USING (true) WITH CHECK (true);

-- task_events: append-only. SELECT + INSERT only — no UPDATE policy, no
-- UPDATE grant, so this is enforced at both layers.
GRANT SELECT, INSERT ON agent.task_events TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.task_events;
CREATE POLICY agent_service_select ON agent.task_events
  FOR SELECT TO agent_service USING (true);
DROP POLICY IF EXISTS agent_service_insert ON agent.task_events;
CREATE POLICY agent_service_insert ON agent.task_events
  FOR INSERT TO agent_service WITH CHECK (true);

-- interactions: ingest-then-enrich communication log. SELECT + INSERT on
-- the whole table, plus UPDATE scoped ONLY to the enrichment columns — see
-- the rationale above. This is intentionally NOT SELECT, INSERT, UPDATE at
-- the table level.
GRANT SELECT, INSERT ON agent.interactions TO agent_service;
GRANT UPDATE (summary, outcome, requires_action, metadata) ON agent.interactions TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.interactions;
CREATE POLICY agent_service_select ON agent.interactions
  FOR SELECT TO agent_service USING (true);
DROP POLICY IF EXISTS agent_service_insert ON agent.interactions;
CREATE POLICY agent_service_insert ON agent.interactions
  FOR INSERT TO agent_service WITH CHECK (true);
-- Row/role gate only — the column-level GRANT above is what actually keeps
-- this UPDATE scoped to the enrichment columns; RLS has no column concept.
DROP POLICY IF EXISTS agent_service_update ON agent.interactions;
CREATE POLICY agent_service_update ON agent.interactions
  FOR UPDATE TO agent_service USING (true) WITH CHECK (true);

-- decisions: append-only decision record. SELECT + INSERT only — a
-- correction supersedes via a new row (supersedes_decision_id), it does not
-- edit the original.
GRANT SELECT, INSERT ON agent.decisions TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.decisions;
CREATE POLICY agent_service_select ON agent.decisions
  FOR SELECT TO agent_service USING (true);
DROP POLICY IF EXISTS agent_service_insert ON agent.decisions;
CREATE POLICY agent_service_insert ON agent.decisions
  FOR INSERT TO agent_service WITH CHECK (true);

-- runs: current-state table (RUNNING -> SUCCEEDED/FAILED/CANCELED is an
-- in-place update of the same row, not a new row per transition).
GRANT SELECT, INSERT, UPDATE ON agent.runs TO agent_service;
DROP POLICY IF EXISTS agent_service_select ON agent.runs;
CREATE POLICY agent_service_select ON agent.runs
  FOR SELECT TO agent_service USING (true);
DROP POLICY IF EXISTS agent_service_insert ON agent.runs;
CREATE POLICY agent_service_insert ON agent.runs
  FOR INSERT TO agent_service WITH CHECK (true);
DROP POLICY IF EXISTS agent_service_update ON agent.runs;
CREATE POLICY agent_service_update ON agent.runs
  FOR UPDATE TO agent_service USING (true) WITH CHECK (true);

-- No DELETE grant or policy anywhere in this schema: per Phase 0A's
-- preferred posture, the application role gets no routine DELETE privilege
-- on any agent.* table. Administrative/manual cleanup remains a separate,
-- explicit action taken by an admin role outside this migration.

-- ---------------------------------------------------------------------------
-- Postflight guard — verify structural and security expectations before
-- committing.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  table_count int;
  role_exists boolean;
  bypass_rls boolean;
  owned_by_agent_service int;
BEGIN
  SELECT count(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'agent' AND table_name IN (
    'owners', 'projects', 'contacts', 'tasks', 'task_events',
    'interactions', 'decisions', 'runs'
  );
  IF table_count <> 8 THEN
    RAISE EXCEPTION 'expected 8 tables in agent schema, found %', table_count;
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_service') INTO role_exists;
  IF NOT role_exists THEN
    RAISE EXCEPTION 'agent_service role was not created';
  END IF;

  SELECT rolbypassrls INTO bypass_rls FROM pg_roles WHERE rolname = 'agent_service';
  IF bypass_rls THEN
    RAISE EXCEPTION 'agent_service must not have BYPASSRLS';
  END IF;

  SELECT count(*) INTO owned_by_agent_service
  FROM pg_tables
  WHERE schemaname = 'agent' AND tableowner = 'agent_service';
  IF owned_by_agent_service > 0 THEN
    RAISE EXCEPTION 'agent_service owns % agent.* table(s) — RLS policies would not apply to it as owner; the migration-runner role must own these tables instead', owned_by_agent_service;
  END IF;

  IF EXISTS (
    SELECT 1 FROM agent.owners UNION ALL
    SELECT 1 FROM agent.projects UNION ALL
    SELECT 1 FROM agent.contacts UNION ALL
    SELECT 1 FROM agent.tasks UNION ALL
    SELECT 1 FROM agent.task_events UNION ALL
    SELECT 1 FROM agent.interactions UNION ALL
    SELECT 1 FROM agent.decisions UNION ALL
    SELECT 1 FROM agent.runs
  ) THEN
    RAISE EXCEPTION 'Phase 0A must not insert any operational data — found unexpected rows';
  END IF;
END $$;

COMMIT;
