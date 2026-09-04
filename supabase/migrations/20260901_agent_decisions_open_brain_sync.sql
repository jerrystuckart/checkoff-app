-- Phase 0F: (1) an explicit eligibility signal for Open Brain write-back,
-- (2) the narrow, validated mechanism for recording sync metadata on
-- agent.decisions without granting agent_service general UPDATE, (3) a
-- column-scoped INSERT grant that makes eligibility genuinely impossible
-- for agent_service to set, not merely discouraged by a DEFAULT, and (4)
-- immutability of recorded sync metadata — once a decision's Open Brain
-- thought id and snapshots are recorded, nothing (including a same-
-- thought-id retry) may silently change what was recorded.
--
-- APPLIED to the live CheckOff Supabase project. Post-apply verification
-- (npm run agent:verify:open-brain-sync — all privilege probes pass; npm
-- run agent:typecheck; npm run agent:test) confirmed the schema, grants,
-- and function described below match what is documented here. Originally
-- run manually via:
--   supabase db query -f supabase/migrations/20260901_agent_decisions_open_brain_sync.sql --linked
--
-- ---------------------------------------------------------------------------
-- WHY EACH PIECE IS NEEDED (inspected, not assumed):
--
-- (1) Eligibility column: agent.decisions currently has NO field
-- representing "this is durable/approved institutional memory" — only
-- open_brain_thought_id/title_snapshot/summary_snapshot (all nullable
-- placeholders, Phase 0A) and ordinary content columns. Phase 0F's explicit
-- instruction is not to infer eligibility from wording and not to treat
-- "decision exists" as equivalent to "publish this" — since no such signal
-- exists today, this adds one: open_brain_eligible boolean, default false.
--
-- (2) Sync-metadata write mechanism: agent_service has SELECT, INSERT only
-- on agent.decisions (Phase 0A §3.2). Granting table-wide UPDATE would let
-- agent_service silently rewrite decision/decision_key/decided_at/
-- decided_by_owner_id/project_id/open_brain_eligible too, defeating the
-- whole point of decisions being effectively append-only and eligibility
-- being an editorial gate. Per this repo's own established convention (see
-- update_item_location/update_neighborhood_center RPCs), the fix is a
-- narrowly-scoped SECURITY DEFINER function that can write ONLY the 3 Open
-- Brain sync columns, after validating the target decision exists, IS
-- ELIGIBLE, and refusing to silently overwrite an existing DIFFERENT
-- thought id. This eligibility check lives in the function itself
-- (defense-in-depth at the database boundary) — it does not rely on
-- application code in agent-service having checked it first.
--
-- (3) INSERT bypass: a boolean column with DEFAULT false is NOT a security
-- control by itself. agent_service's existing table-wide
-- `GRANT INSERT ON agent.decisions` (Phase 0A) lets it name ANY column,
-- including a newly added one, in an explicit INSERT column list — e.g.
-- `INSERT INTO agent.decisions (decision_key, decision, open_brain_eligible)
-- VALUES (..., true)` would succeed under agent_service today, once this
-- column exists, entirely bypassing the "editorial action only" intent.
-- RLS's `WITH CHECK (true)` on the existing insert policy does not help —
-- RLS is row-scoped, it has no concept of "this column may not be set."
-- The fix: revoke the table-wide INSERT and replace it with a column-scoped
-- INSERT grant naming only the columns legitimate decision creation
-- actually uses today (verified against agent-service: no createDecision
-- mutation exists yet, but the columns below are exactly Phase 0A's
-- content columns) — open_brain_eligible and all 3 open_brain_* sync
-- columns are excluded. Postgres enforces this at the grammar level: a role
-- with only column-scoped INSERT privilege cannot mention an unlisted
-- column in the INSERT statement at all (not even to set it to its default
-- value), while simply omitting an unlisted column from the column list —
-- the normal way to create a decision — still works and takes the
-- column's DEFAULT/NULL as before. This is the same column-privilege
-- pattern already used in this schema for agent.interactions's UPDATE
-- grant (Phase 0A), applied here to INSERT instead.
--
-- (4) Immutability + all-or-nothing sync metadata: the function below
-- previously ran an UPDATE on every call once the same thought id was
-- supplied, silently accepting a different title/summary snapshot on a
-- "retry" — that would let recorded institutional memory drift from what
-- was actually captured. It now distinguishes three cases for an
-- already-synced decision: identical replay (no-op, no UPDATE issued),
-- same thought id with a changed snapshot (rejected — snapshots are
-- immutable once recorded), and a different thought id (rejected, as
-- before). Separately: I checked the live data before proposing the CHECK
-- constraint below — all 3 existing Bootstrap v1 decisions have
-- open_brain_thought_id/title_snapshot/summary_snapshot all NULL, so an
-- all-or-nothing constraint is safe to add now. It does not constrain
-- open_brain_eligible at all — a decision may be eligible with all three
-- sync columns still NULL (not yet synced); the constraint only forbids a
-- row where some but not all of the three sync columns are populated.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE agent.decisions ADD COLUMN IF NOT EXISTS open_brain_eligible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN agent.decisions.open_brain_eligible IS
  'Explicit editorial signal that this decision is approved durable institutional memory eligible for Open Brain write-back. Defaults false — existence of a decision row does not imply eligibility. agent_service cannot set this column via INSERT (column-scoped grant excludes it) or via UPDATE (no UPDATE grant on this table at all); setting it true is a deliberate action taken directly against the database by a role with table-wide privileges (e.g. postgres via the Supabase SQL editor), outside the normal service write path.';

-- All-or-nothing: a decision's Open Brain sync metadata is either fully
-- unset (never synced) or fully set (synced) — never partially populated.
-- Verified safe against live data before adding: all 3 Bootstrap v1
-- decisions currently have all three columns NULL. Independent of
-- open_brain_eligible — an eligible, not-yet-synced decision correctly has
-- all three columns NULL, which this constraint allows.
ALTER TABLE agent.decisions
  ADD CONSTRAINT decisions_open_brain_sync_all_or_nothing
  CHECK (
    (open_brain_thought_id IS NULL AND open_brain_title_snapshot IS NULL AND open_brain_summary_snapshot IS NULL)
    OR
    (open_brain_thought_id IS NOT NULL AND open_brain_title_snapshot IS NOT NULL AND open_brain_summary_snapshot IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Close the INSERT bypass: replace agent_service's table-wide INSERT with a
-- column-scoped one. Columns listed are exactly Phase 0A's decision-content
-- columns (id/created_at/decided_at all have defaults and don't need to be
-- listed to be used); open_brain_eligible and the 3 open_brain_* sync
-- columns are deliberately excluded so agent_service can never name them in
-- an INSERT, explicit-default or not.
-- ---------------------------------------------------------------------------

REVOKE INSERT ON agent.decisions FROM agent_service;
GRANT INSERT (project_id, decision_key, decision, decided_at, decided_by_owner_id, supersedes_decision_id, metadata)
  ON agent.decisions TO agent_service;

-- ---------------------------------------------------------------------------
-- record_decision_open_brain_sync() — the only way agent_service can ever
-- change an agent.decisions row after INSERT. Writes ONLY
-- open_brain_thought_id/open_brain_title_snapshot/open_brain_summary_snapshot,
-- and only for a decision that is already open_brain_eligible = true
-- (locked and checked inside this function — defense-in-depth, not
-- something callers can bypass by skipping an application-level check).
-- Refuses to run at all if the target decision doesn't exist, refuses to
-- silently replace an EXISTING different thought id (that would be a
-- resync/overwrite decision, which belongs to explicit reconciliation logic
-- in agent-service, not a bare metadata-recording call), and refuses blank
-- title/summary snapshots (they exist to preserve a deterministic memory
-- representation — a blank snapshot can never serve that purpose).
-- Recorded sync metadata is immutable: an identical replay (same thought
-- id, same snapshots) is allowed and returns the existing row as a no-op —
-- no UPDATE is issued — which is exactly what supports "remote create
-- succeeded, local recording failed, caller retries" (Phase 0F's core
-- reliability scenario) without erroring on the retry; a replay with the
-- SAME thought id but a DIFFERENT snapshot, or a genuinely different
-- thought id, is rejected outright rather than silently overwriting
-- history.
--
-- Hardened search_path: lists only the trusted schema this function
-- actually needs, with pg_temp explicitly last (per Postgres's own
-- SECURITY DEFINER guidance) so a session-local temp object can never be
-- created to shadow a lookup ahead of agent's own objects. pg_catalog is
-- always implicitly searched first regardless of search_path and does not
-- need to be listed. Every table reference below is schema-qualified
-- (agent.decisions) independent of search_path, as an additional layer.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION agent.record_decision_open_brain_sync(
  p_decision_id uuid,
  p_thought_id text,
  p_title_snapshot text,
  p_summary_snapshot text
)
RETURNS agent.decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = agent, pg_temp
AS $function$
DECLARE
  existing_thought_id text;
  existing_title_snapshot text;
  existing_summary_snapshot text;
  is_eligible boolean;
  result agent.decisions;
BEGIN
  IF p_thought_id IS NULL OR btrim(p_thought_id) = '' THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync: thought_id is required';
  END IF;

  IF p_title_snapshot IS NULL OR btrim(p_title_snapshot) = '' THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync: title_snapshot is required and must be nonblank — it is part of the deterministic memory representation';
  END IF;

  IF p_summary_snapshot IS NULL OR btrim(p_summary_snapshot) = '' THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync: summary_snapshot is required and must be nonblank — it is part of the deterministic memory representation';
  END IF;

  SELECT open_brain_thought_id, open_brain_title_snapshot, open_brain_summary_snapshot, open_brain_eligible
  INTO existing_thought_id, existing_title_snapshot, existing_summary_snapshot, is_eligible
  FROM agent.decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync: no decision found with id %', p_decision_id;
  END IF;

  IF NOT is_eligible THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync: decision % is not open_brain_eligible — refusing to record Open Brain sync metadata', p_decision_id;
  END IF;

  IF existing_thought_id IS NOT NULL THEN
    -- Already recorded. Sync metadata is immutable once established: this
    -- function never overwrites a previously-recorded thought id or its
    -- snapshots, on any code path, including a same-thought-id retry.
    IF existing_thought_id <> p_thought_id THEN
      RAISE EXCEPTION
        'record_decision_open_brain_sync: decision % is already synced to a different Open Brain thought (existing=%, requested=%) — refusing to silently overwrite; reconcile explicitly instead',
        p_decision_id, existing_thought_id, p_thought_id;
    END IF;

    IF existing_title_snapshot IS DISTINCT FROM p_title_snapshot OR existing_summary_snapshot IS DISTINCT FROM p_summary_snapshot THEN
      RAISE EXCEPTION
        'record_decision_open_brain_sync: decision % is already synced to Open Brain thought % with different recorded snapshot content — recorded sync metadata is immutable once established and historical snapshots are never overwritten; reconcile explicitly instead',
        p_decision_id, p_thought_id;
    END IF;

    -- Identical replay of an already-recorded sync: idempotent no-op — no
    -- UPDATE is issued at all. This is exactly what supports "remote
    -- create succeeded, local recording failed, caller retries" (Phase
    -- 0F's core reliability scenario) without erroring on the retry or
    -- performing a redundant write.
    SELECT * INTO result FROM agent.decisions WHERE id = p_decision_id;
    RETURN result;
  END IF;

  -- Not yet synced — this is the only path that ever writes these columns,
  -- and it only ever runs once per decision (every subsequent call for the
  -- same decision id takes one of the two branches above instead).
  UPDATE agent.decisions
  SET
    open_brain_thought_id = p_thought_id,
    open_brain_title_snapshot = p_title_snapshot,
    open_brain_summary_snapshot = p_summary_snapshot
  WHERE id = p_decision_id
  RETURNING * INTO result;

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION agent.record_decision_open_brain_sync(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent.record_decision_open_brain_sync(uuid, text, text, text) TO agent_service;

-- ---------------------------------------------------------------------------
-- Postflight — structural checks (catalog inspection).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND column_name = 'open_brain_eligible'
  ) THEN
    RAISE EXCEPTION 'open_brain_eligible column was not created';
  END IF;

  IF EXISTS (SELECT 1 FROM agent.decisions WHERE open_brain_eligible IS TRUE) THEN
    RAISE EXCEPTION 'Expected zero decisions marked open_brain_eligible immediately after this migration — eligibility is a separate editorial action';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'agent' AND c.conname = 'decisions_open_brain_sync_all_or_nothing' AND c.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'decisions_open_brain_sync_all_or_nothing CHECK constraint was not created';
  END IF;

  IF EXISTS (
    SELECT 1 FROM agent.decisions
    WHERE (open_brain_thought_id IS NULL) <> (open_brain_title_snapshot IS NULL)
       OR (open_brain_thought_id IS NULL) <> (open_brain_summary_snapshot IS NULL)
  ) THEN
    RAISE EXCEPTION 'found a decision with partially-populated open_brain_* sync columns — the all-or-nothing CHECK constraint should have prevented this';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'agent' AND routine_name = 'record_decision_open_brain_sync' AND grantee = 'agent_service'
  ) THEN
    RAISE EXCEPTION 'agent_service does not have EXECUTE on record_decision_open_brain_sync';
  END IF;

  -- No table-wide UPDATE on agent.decisions for agent_service, at all —
  -- the function above is the ONLY write path after INSERT.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND grantee = 'agent_service' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'agent_service must NOT have table-wide UPDATE on agent.decisions — the whole point of this migration is to avoid that';
  END IF;

  -- No column-level UPDATE on open_brain_eligible specifically either
  -- (belt-and-suspenders on top of the table-wide check above, since
  -- column-level UPDATE grants are a distinct catalog entry).
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND column_name = 'open_brain_eligible'
      AND grantee = 'agent_service' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'agent_service must NOT have column-level UPDATE on open_brain_eligible';
  END IF;

  -- No INSERT privilege on open_brain_eligible or the 3 sync columns —
  -- this is what actually closes the "explicit INSERT of true" bypass.
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'agent' AND table_name = 'decisions'
      AND column_name IN ('open_brain_eligible', 'open_brain_thought_id', 'open_brain_title_snapshot', 'open_brain_summary_snapshot')
      AND grantee = 'agent_service' AND privilege_type = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'agent_service must NOT have INSERT on open_brain_eligible or any open_brain_* sync column';
  END IF;

  -- agent_service must still be able to INSERT the ordinary decision-content
  -- columns it legitimately needs for decision creation.
  IF EXISTS (
    SELECT col FROM unnest(ARRAY['project_id', 'decision_key', 'decision', 'decided_at', 'decided_by_owner_id', 'supersedes_decision_id', 'metadata']) AS col
    EXCEPT
    SELECT column_name FROM information_schema.column_privileges
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND grantee = 'agent_service' AND privilege_type = 'INSERT'
  ) THEN
    RAISE EXCEPTION 'agent_service is missing INSERT on one or more legitimate decision-creation columns';
  END IF;

  -- SECURITY DEFINER only adds privilege separation if the owner is NOT
  -- agent_service itself — if it were, the function would run with exactly
  -- agent_service's own (SELECT + column-scoped-INSERT-only) privileges and
  -- the UPDATE inside it would simply fail, defeating the entire point of
  -- this migration. The owner must be whatever role actually ran this
  -- migration (e.g. postgres/supabase_admin), which already has UPDATE on
  -- agent.decisions directly.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'agent' AND p.proname = 'record_decision_open_brain_sync' AND r.rolname = 'agent_service'
  ) THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync must NOT be owned by agent_service — SECURITY DEFINER would provide no privilege separation';
  END IF;

  -- The function must actually be SECURITY DEFINER — without this, running
  -- as agent_service (whatever the caller's own privileges are) would make
  -- the UPDATE inside it fail, since agent_service has no UPDATE grant.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'agent' AND p.proname = 'record_decision_open_brain_sync' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync must be SECURITY DEFINER';
  END IF;

  -- Hardened search_path: exactly "agent, pg_temp" (pg_temp last, no other
  -- schema listed) — see the function's own doc comment for why. Checked
  -- with a tolerant regex rather than a literal string match since Postgres
  -- may normalize internal whitespace when storing the GUC setting.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'agent' AND p.proname = 'record_decision_open_brain_sync'
      AND EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS cfg
        WHERE cfg ~ '^search_path\s*=\s*agent\s*,\s*pg_temp\s*$'
      )
  ) THEN
    RAISE EXCEPTION 'record_decision_open_brain_sync does not have the expected hardened search_path (agent, pg_temp last)';
  END IF;

  -- PUBLIC must not be able to execute this function — only agent_service.
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'agent' AND routine_name = 'record_decision_open_brain_sync' AND grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not have EXECUTE on record_decision_open_brain_sync';
  END IF;

  RAISE NOTICE 'PASS (structural): open_brain_eligible added (all false); all-or-nothing CHECK constraint present; column-scoped INSERT excludes open_brain_* columns while retaining legitimate decision-creation columns; no UPDATE (table- or column-level) on agent.decisions for agent_service; record_decision_open_brain_sync() is SECURITY DEFINER with a hardened search_path, owned by a role other than agent_service, EXECUTE granted to agent_service only (not PUBLIC).';
END $$;

-- ---------------------------------------------------------------------------
-- NOTE: there is deliberately no functional (SET LOCAL ROLE agent_service)
-- postflight block here. A real apply attempt against the Supabase linked
-- migration connection confirmed that connection cannot SET ROLE to
-- agent_service, so only catalog-inspection checks (above) belong in this
-- file. The functional proof that agent_service is actually blocked by
-- these grants — not just that the grants exist — lives in
-- agent-service/verifyOpenBrainSyncPrivileges.ts, which connects directly
-- as agent_service via the real AGENT_SERVICE_DATABASE_URL. Run it after
-- this migration is applied:
--   npm run agent:verify:open-brain-sync
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Setting eligibility, deliberately, after this migration is applied:
--
-- agent_service has NO path to open_brain_eligible = true — not via INSERT
-- (column-scoped grant excludes it), not via UPDATE (no UPDATE grant on
-- agent.decisions exists at all), and record_decision_open_brain_sync()
-- cannot touch it either (it only ever writes the 3 open_brain_* sync
-- columns). The only way to set it is for a role with table-wide privileges
-- on agent.decisions — in practice, Jerry running SQL directly as the
-- database owner (e.g. via the Supabase SQL editor, or `supabase db query
-- --linked` as postgres) — NOT through agent-service, and NOT automatically
-- by this migration:
--   UPDATE agent.decisions SET open_brain_eligible = true WHERE decision_key = '<key>';
-- This is a deliberate, out-of-band editorial action, one decision at a
-- time, exactly as Phase 0F's hardening pass requires.
-- ---------------------------------------------------------------------------

COMMIT;
