-- Phase 0B — Bootstrap current CheckOff operational state into agent.*.
-- NOT A SCHEMA MIGRATION — this is a data load, kept in docs/agent-platform/
-- per this repo's existing review_only_*.sql convention (see
-- docs/visit-detection/review_only_visit_profile_mapping_suggestion.sql).
--
-- Prerequisites (apply first, in order):
--   1. supabase/migrations/20260830_agent_operational_schema_phase0a.sql
--   2. supabase/migrations/20260830_agent_projects_project_type_check.sql
--
-- APPLIED to the live CheckOff Supabase project (idempotency empirically
-- confirmed by running this file twice with zero new rows on the second
-- run; see docs/agent-platform/review_only_phase0d_task_completion_corrections.sql
-- for the recorded confirmation). Originally run manually via:
--   supabase db query -f docs/agent-platform/bootstrap_phase0b.sql --linked
--
-- IDEMPOTENT BY DESIGN — safe to run any number of times:
--   * owners/projects/decisions use their existing UNIQUE key column
--     (owner_key / project_key / decision_key) with ON CONFLICT DO NOTHING.
--   * agent.tasks has no natural business-key uniqueness (by design — see
--     Phase 0A review), so this file enforces its OWN idempotency using
--     source_type = 'bootstrap_v1' + a stable source_ref slug per task: an
--     INSERT ... SELECT ... WHERE NOT EXISTS (...) RETURNING id CTE, whose
--     result feeds the matching agent.task_events CREATED insert. If the
--     task already exists, the CTE returns zero rows and BOTH inserts
--     (task + event) become no-ops — never just one of the two.
--   * No new permanent uniqueness constraint is added to agent.tasks for
--     this — Phase 0A deliberately left it without one pending a real
--     need, and this bootstrap can enforce its own idempotency without it.
--
-- SCOPE — per Phase 0B spec:
--   * 2 owners, 7 projects, 9 tasks (source_type='bootstrap_v1'), 9 matching
--     CREATED task_events, 3 decisions.
--   * 0 contacts, 0 interactions, 0 runs — deliberately not bootstrapped
--     yet; a later relationship-reconciliation pass handles that.
--   * No public.* writes anywhere in this file.
--   * No fictional status-transition history — every task gets exactly one
--     CREATED event reflecting its bootstrap-time status, not a
--     reconstructed chronology.
--   * Phoenix/Milwaukee/Tucson get ON_HOLD project rows only — no tasks,
--     intentionally (their discoverability comes from the project row).
--
-- All now() calls below resolve to the same value (Postgres evaluates
-- now() once per transaction), so "bootstrap execution timestamp" is
-- consistent across started_at/next_check_at within a single run.

BEGIN;

-- ---------------------------------------------------------------------------
-- Owners
-- ---------------------------------------------------------------------------

INSERT INTO agent.owners (owner_key, owner_type, display_name)
VALUES
  ('jerry', 'HUMAN', 'Jerry'),
  ('chief', 'AGENT', 'CheckOff Chief of Staff')
ON CONFLICT (owner_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Projects — owner resolved by owner_key, not a hardcoded id.
-- ---------------------------------------------------------------------------

INSERT INTO agent.projects (project_key, name, project_type, status, owner_id)
SELECT v.project_key, v.name, v.project_type, v.status,
       (SELECT id FROM agent.owners WHERE owner_key = 'jerry')
FROM (VALUES
  ('agent_platform',          'Agent Platform',                        'INTERNAL',         'ACTIVE'),
  ('destination_hubs_wave_1', 'Destination Hubs Wave 1',                'DESTINATION_HUB',  'ACTIVE'),
  ('denver_metro',            'Denver Metro',                           'METRO',            'ACTIVE'),
  ('phoenix_metro',           'Phoenix Metro',                          'METRO',            'ON_HOLD'),
  ('milwaukee_metro',         'Milwaukee Metro',                        'METRO',            'ON_HOLD'),
  ('tucson_metro',            'Tucson Metro',                           'METRO',            'ON_HOLD'),
  ('whats_good_widget',       'What''s Good / What to Get Widget',      'PRODUCT',          'ACTIVE')
) AS v(project_key, name, project_type, status)
ON CONFLICT (project_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Tasks — one INSERT-if-absent + matching CREATED event per task. Every
-- lookup (project, owner, blocking task) is by stable key, never a
-- hardcoded id, so this stays correct regardless of insert order across
-- separate bootstrap runs.
-- ---------------------------------------------------------------------------

-- Task 1 — agent_platform: the bootstrap task itself. Seeded IN_PROGRESS
-- with no path to DONE here — the script can't know it succeeded until
-- Jerry verifies it; he marks it DONE manually after reconciling.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, status, owner_id, started_at, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'agent_platform'),
    'Phase 0B — Bootstrap current operational state',
    'IN_PROGRESS',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    now(),
    'Load and validate Bootstrap Inventory v1.',
    'bootstrap_v1',
    'agent-platform-phase0b-bootstrap'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'agent-platform-phase0b-bootstrap'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 2 — agent_platform: Open Brain credential repair. Must exist before
-- Task 3 below, since Task 3 blocks on it by id.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, status, owner_id, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'agent_platform'),
    'Repair ChatGPT Open Brain authentication',
    'READY',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    'Repair the ChatGPT/Open Brain MCP credential before building the Chief read layer.',
    'bootstrap_v1',
    'open-brain-chatgpt-reconnect'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'open-brain-chatgpt-reconnect'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 3 — agent_platform: Chief read/query layer. Concretely blocked on
-- Task 2 via blocked_by_task_id (not prose-only), plus a secondary
-- blocker_note for the Phase 0B completion dependency.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, status, owner_id, blocked_by_task_id, blocker_note, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'agent_platform'),
    'Build Chief read/query layer',
    'BLOCKED',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    (SELECT id FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'open-brain-chatgpt-reconnect'),
    'Phase 0B bootstrap must also be completed before Phase 0C begins.',
    'After Open Brain access is restored and Phase 0B is complete, begin the Chief read/query layer.',
    'bootstrap_v1',
    'chief-read-layer'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'chief-read-layer'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 4 — destination_hubs_wave_1: Buena Vista outreach. READY, not
-- IN_PROGRESS — DVA-1/DVA-2/DAP evaluation is complete, but outreach
-- itself has not started.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, description, status, owner_id, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1'),
    'Buena Vista — begin outreach',
    'DVA-1, DVA-2, and DAP evaluation are complete. No outreach has started yet.',
    'READY',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    'Begin outreach to Buena Vista following the completed DVA-1, DVA-2, and DAP evaluation.',
    'bootstrap_v1',
    'destination-buena-vista-outreach'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'destination-buena-vista-outreach'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 5 — destination_hubs_wave_1: Grand Lake follow-up. WAITING with
-- next_check_at = bootstrap execution time — no historical due date
-- manufactured.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, status, owner_id, next_check_at, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1'),
    'Grand Lake — reconcile response and follow up',
    'WAITING',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    now(),
    'Check for any response to the initial outreach and follow up if none has been received.',
    'bootstrap_v1',
    'destination-grand-lake-followup'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'destination-grand-lake-followup'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 6 — destination_hubs_wave_1: Rim Country follow-up. Same WAITING
-- shape as Task 5.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, status, owner_id, next_check_at, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1'),
    'Rim Country — reconcile responses and follow up',
    'WAITING',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    now(),
    'Check the current response status from the Rim Country contacts and determine the appropriate follow-up.',
    'bootstrap_v1',
    'destination-rim-country-followup'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'destination-rim-country-followup'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 7 — denver_metro: track replies to the Denver Featured outreach
-- blast. One tracking task, not one per business — per spec.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, description, status, owner_id, next_check_at, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'denver_metro'),
    'Denver Featured outreach — track replies',
    'Every Denver business in the app was emailed last week. Replies are trickling in; most have not responded.',
    'WAITING',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    now(),
    'Review new replies from Denver businesses, respond where needed, and continue tracking businesses that have not responded.',
    'bootstrap_v1',
    'denver-featured-outreach-replies'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'denver-featured-outreach-replies'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 8 — whats_good_widget: widget build. READY, not IN_PROGRESS — only
-- high-level discussion has happened so far. Must exist before Task 9
-- below, since Task 9 blocks on it by id.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, description, status, owner_id, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'whats_good_widget'),
    'Build What''s Good / What to Get widget',
    'Only high-level discussion has occurred. No product/design work or development has begun.',
    'READY',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    'Begin product/design definition for the What''s Good / What to Get home-screen widget.',
    'bootstrap_v1',
    'whats-good-widget-build'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'whats-good-widget-build'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- Task 9 — whats_good_widget: marketing. Concretely blocked on Task 8 via
-- blocked_by_task_id.
WITH new_task AS (
  INSERT INTO agent.tasks (project_id, title, status, owner_id, blocked_by_task_id, next_action, source_type, source_ref)
  SELECT
    (SELECT id FROM agent.projects WHERE project_key = 'whats_good_widget'),
    'Market What''s Good / What to Get widget',
    'BLOCKED',
    (SELECT id FROM agent.owners WHERE owner_key = 'jerry'),
    (SELECT id FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'whats-good-widget-build'),
    'After the widget is live, activate onboarding and in-app promotion of the widget.',
    'bootstrap_v1',
    'whats-good-widget-marketing'
  WHERE NOT EXISTS (
    SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = 'whats-good-widget-marketing'
  )
  RETURNING id, status
)
INSERT INTO agent.task_events (task_id, event_type, to_status, changed_by_owner_id, note)
SELECT id, 'CREATED', status, (SELECT id FROM agent.owners WHERE owner_key = 'jerry'), 'Bootstrap v1 initial creation'
FROM new_task;

-- ---------------------------------------------------------------------------
-- Decisions — project resolved by project_key, decided_by resolved by
-- owner_key. Open Brain reference columns left NULL (no integration yet).
-- ---------------------------------------------------------------------------

INSERT INTO agent.decisions (project_id, decision_key, decision, decided_by_owner_id)
SELECT p.id, v.decision_key, v.decision, (SELECT id FROM agent.owners WHERE owner_key = 'jerry')
FROM (VALUES
  ('destination_wave1_complexity', 'destination_hubs_wave_1',
   'Operationally heavy, geographically distributed destinations such as Verde Valley remain future/flagship targets rather than first-five Wave 1 priorities.'),
  ('rim_country_wave1', 'destination_hubs_wave_1',
   'Rim Country remains in Wave 1 because outreach has already begun despite its somewhat greater complexity.'),
  ('widget_marketing_after_build', 'whats_good_widget',
   'Aggressive onboarding and in-app promotion of What''s Good / What to Get begins only after the widget exists.')
) AS v(decision_key, project_key, decision)
JOIN agent.projects p ON p.project_key = v.project_key
ON CONFLICT (decision_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Postflight guard — self-contained sanity check on THIS file's own rows
-- (by key, not by total table count — Phase 0C+ may add more owners/
-- projects/decisions later without this file's own check going stale).
-- The authoritative exact-state snapshot lives in the separate
-- review_only_phase0b_validation.sql, which is appropriate to assert exact
-- totals against since nothing else has been seeded into agent.* yet.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(k, ', ') INTO missing
  FROM unnest(ARRAY['jerry', 'chief']) AS k
  WHERE NOT EXISTS (SELECT 1 FROM agent.owners WHERE owner_key = k);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Bootstrap v1 owners missing: %', missing;
  END IF;

  SELECT string_agg(k, ', ') INTO missing
  FROM unnest(ARRAY[
    'agent_platform', 'destination_hubs_wave_1', 'denver_metro',
    'phoenix_metro', 'milwaukee_metro', 'tucson_metro', 'whats_good_widget'
  ]) AS k
  WHERE NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = k);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Bootstrap v1 projects missing: %', missing;
  END IF;

  SELECT string_agg(k, ', ') INTO missing
  FROM unnest(ARRAY[
    'agent-platform-phase0b-bootstrap', 'open-brain-chatgpt-reconnect', 'chief-read-layer',
    'destination-buena-vista-outreach', 'destination-grand-lake-followup', 'destination-rim-country-followup',
    'denver-featured-outreach-replies', 'whats-good-widget-build', 'whats-good-widget-marketing'
  ]) AS k
  WHERE NOT EXISTS (SELECT 1 FROM agent.tasks WHERE source_type = 'bootstrap_v1' AND source_ref = k);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Bootstrap v1 tasks missing: %', missing;
  END IF;

  SELECT string_agg(k, ', ') INTO missing
  FROM unnest(ARRAY['destination_wave1_complexity', 'rim_country_wave1', 'widget_marketing_after_build']) AS k
  WHERE NOT EXISTS (SELECT 1 FROM agent.decisions WHERE decision_key = k);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Bootstrap v1 decisions missing: %', missing;
  END IF;

  -- Not checked here: this file never inserts into agent.contacts/
  -- interactions/runs, so there is nothing for a self-check to assert
  -- about them — a table-total check would risk misattributing unrelated
  -- future data to this bootstrap. The exact-state snapshot ("0 rows
  -- right now") is the dedicated validation file's job (it's the
  -- appropriate place for a total-count assertion, since it's meant to be
  -- re-run and re-evaluated against the current full state of agent.*).
END $$;

COMMIT;
