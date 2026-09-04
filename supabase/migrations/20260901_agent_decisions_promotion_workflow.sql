-- Phase 1A: the Chief -> durable-memory promotion workflow. Builds on the
-- proven Phase 0F/0G/0H foundation (open_brain_eligible,
-- record_decision_open_brain_sync(), the live standalone Open Brain
-- transport) WITHOUT modifying any of it — that gate and function are
-- untouched by this migration.
--
-- REVIEW-READY — DO NOT RUN AGAINST THE LINKED PROJECT WITHOUT REVIEW.
-- Run manually via:
--   supabase db query -f supabase/migrations/20260901_agent_decisions_promotion_workflow.sql --linked
--
-- ---------------------------------------------------------------------------
-- INVARIANT THIS MIGRATION ENFORCES (Jerry's explicit requirement):
--   Chief proposes. Jerry decides approve/reject/reconsider. Chief executes
--   an approved Open Brain sync.
--
-- This is NOT an application convention — it is a real capability boundary.
-- A brand-new Postgres role, agent_approver, is the ONLY role ever granted
-- EXECUTE on approve_decision_for_open_brain(), reject_decision_for_open_brain(),
-- and reconsider_decision_for_open_brain(). agent_service (Chief's role) is
-- granted EXECUTE on recommend_decision_for_open_brain() ONLY — it is
-- structurally unable to call any of the other three, the same way it is
-- already structurally unable to UPDATE agent.decisions directly (Phase 0F).
--
-- agent_approver is created WITHOUT LOGIN and WITHOUT a password here, same
-- posture as agent_service in Phase 0A — enabling login/a password (or, in
-- the future, wiring a dedicated approval service/credential behind it) is
-- a manual, out-of-band step for Jerry. For Phase 1A, Jerry exercises these
-- three functions manually via the Supabase SQL editor
-- (`SET ROLE agent_approver;` from a superuser session, then call the
-- function) — the SQL editor session itself is NOT the agent_approver
-- capability boundary; the boundary is the role and its narrow grants,
-- which exist independent of how Jerry happens to invoke them today.
--
-- SPOOFING CLOSED, NOT JUST GATED: it is not enough that agent_service
-- cannot call the three human-decision functions — it must also be unable
-- to fabricate a matching agent.decision_events row claiming a human
-- outcome happened. agent_service's own INSERT grant on
-- agent.decision_events is RLS-restricted to an ALLOW-LIST of event types
-- it may legitimately write directly (CREATED, OPEN_BRAIN_SYNC_SUCCEEDED,
-- OPEN_BRAIN_SYNC_FAILED, SUPERSEDED) — DURABLE_MEMORY_RECOMMENDED,
-- DURABLE_MEMORY_APPROVED, and DURABLE_MEMORY_REJECTED are excluded from
-- that allow-list entirely; those three event rows are written ONLY from
-- inside the corresponding SECURITY DEFINER function, as the function
-- owner (which is neither agent_service nor agent_approver — see below —
-- and therefore is not subject to agent_service's RLS policy at all).
-- Reconsideration deliberately produces no new event_type of its own,
-- staying within the exact 7-value list Jerry specified; the state
-- transition (durable_memory_recommendation: REJECTED -> NULL) is visible
-- directly on agent.decisions, and the subsequent
-- DURABLE_MEMORY_RECOMMENDED event's note records that it followed a
-- reconsideration.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight guard — fail loudly rather than silently colliding with a
-- partial prior run.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND column_name = 'durable_memory_recommendation'
  ) THEN
    RAISE EXCEPTION 'agent.decisions.durable_memory_recommendation already exists — inspect before re-running this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'agent' AND table_name = 'decision_events') THEN
    RAISE EXCEPTION 'agent.decision_events already exists — inspect before re-running this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_approver') THEN
    RAISE EXCEPTION 'role agent_approver already exists — inspect before re-running this migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. durable_memory_recommendation — Chief's own pending/rejected cache,
-- separate from open_brain_eligible (the proven, unchanged approval gate).
-- NULL = not yet reviewed (no separate NOT_REVIEWED literal needed).
-- ---------------------------------------------------------------------------

ALTER TABLE agent.decisions
  ADD COLUMN durable_memory_recommendation text
  CHECK (durable_memory_recommendation IS NULL OR durable_memory_recommendation IN ('RECOMMENDED', 'REJECTED'));

COMMENT ON COLUMN agent.decisions.durable_memory_recommendation IS
  'Chief''s own recommendation-state cache — NOT the approval gate (open_brain_eligible remains that, unchanged). NULL = not yet reviewed. Set to RECOMMENDED only via recommend_decision_for_open_brain() (agent_service), REJECTED only via reject_decision_for_open_brain() (agent_approver only), and reset toward reconsideration only via reconsider_decision_for_open_brain() (agent_approver only).';

-- ---------------------------------------------------------------------------
-- 2. agent.decision_events — append-only decision lifecycle audit, separate
-- from agent.runs (which stays execution/attempt telemetry, unchanged) and
-- from agent.task_events (task-scoped, structurally wrong for a
-- decision that may have no task at all). Unlike task_events, event_type
-- IS a closed, CHECK-constrained enum here: this table's lifecycle is a
-- small, fully-known set (Jerry's explicit 7 values), not an open-ended one
-- the way task history is.
-- ---------------------------------------------------------------------------

CREATE TABLE agent.decision_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id     uuid NOT NULL REFERENCES agent.decisions(id) ON DELETE RESTRICT,
  event_type      text NOT NULL CHECK (event_type IN (
                     'CREATED',
                     'DURABLE_MEMORY_RECOMMENDED',
                     'DURABLE_MEMORY_APPROVED',
                     'DURABLE_MEMORY_REJECTED',
                     'OPEN_BRAIN_SYNC_SUCCEEDED',
                     'OPEN_BRAIN_SYNC_FAILED',
                     'SUPERSEDED'
                   )),
  actor_owner_id  uuid REFERENCES agent.owners(id) ON DELETE RESTRICT,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  note            text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE agent.decision_events IS
  'Append-only. The application/service role should not be granted routine DELETE on this table. The authoritative decision-lifecycle history — agent.runs remains execution/attempt telemetry, not this.';

CREATE INDEX decision_events_decision_id_occurred_at_idx ON agent.decision_events (decision_id, occurred_at DESC);
CREATE INDEX decision_events_occurred_at_idx ON agent.decision_events (occurred_at DESC);

ALTER TABLE agent.decision_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. 'chief' owner — Phase 0B's bootstrap only ever registered 'jerry'
-- (HUMAN). Chief-originated events (CREATED, DURABLE_MEMORY_RECOMMENDED)
-- need their own actor identity, distinct from the human decisions
-- (APPROVED/REJECTED) they are never allowed to attribute to themselves.
-- ON CONFLICT DO NOTHING — safe to re-run, matches Phase 0B's own
-- idempotency convention.
-- ---------------------------------------------------------------------------

INSERT INTO agent.owners (owner_key, owner_type, display_name)
VALUES ('chief', 'AGENT', 'CheckOff Chief')
ON CONFLICT (owner_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. agent_service grants on the new column/table. NOTHING here grants any
-- path to durable_memory_recommendation = 'REJECTED', to open_brain_eligible,
-- or to a DURABLE_MEMORY_APPROVED/REJECTED decision_events row — those all
-- live exclusively inside the SECURITY DEFINER functions below, owned by
-- neither agent_service nor agent_approver.
-- ---------------------------------------------------------------------------

-- decision_events: append-only, and agent_service's own direct INSERT is
-- further restricted by RLS to an ALLOW-LIST of the event types that are
-- legitimately its own to write without going through a narrow function.
GRANT SELECT, INSERT ON agent.decision_events TO agent_service;
CREATE POLICY agent_service_select ON agent.decision_events
  FOR SELECT TO agent_service USING (true);
CREATE POLICY agent_service_insert ON agent.decision_events
  FOR INSERT TO agent_service
  WITH CHECK (event_type IN ('CREATED', 'OPEN_BRAIN_SYNC_SUCCEEDED', 'OPEN_BRAIN_SYNC_FAILED', 'SUPERSEDED'));

-- ---------------------------------------------------------------------------
-- 5. The new Postgres role. NOLOGIN/NOBYPASSRLS, same posture as
-- agent_service — a dedicated, minimal-privilege role, not a superuser
-- shortcut. Its ENTIRE privilege surface in the whole agent schema is
-- USAGE (required to even resolve agent.<function>()) plus EXECUTE on
-- exactly the three human-decision functions below. No table grants at
-- all — every write those functions make happens as the function owner,
-- which already has direct table privileges (same mechanism already
-- proven by record_decision_open_brain_sync in the 0901_..._sync
-- migration).
-- ---------------------------------------------------------------------------

CREATE ROLE agent_approver NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA agent TO agent_approver;

-- ---------------------------------------------------------------------------
-- 6. recommend_decision_for_open_brain() — Chief's only write path into the
-- promotion workflow. EXECUTE -> agent_service only.
-- ---------------------------------------------------------------------------

CREATE FUNCTION agent.recommend_decision_for_open_brain(
  p_decision_id uuid,
  p_reason text
)
RETURNS agent.decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = agent, pg_temp
AS $function$
DECLARE
  v_recommendation text;
  v_eligible boolean;
  v_chief_owner_id uuid;
  result agent.decisions;
BEGIN
  SELECT durable_memory_recommendation, open_brain_eligible INTO v_recommendation, v_eligible
  FROM agent.decisions WHERE id = p_decision_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recommend_decision_for_open_brain: no decision found with id %', p_decision_id;
  END IF;

  IF v_eligible THEN
    RAISE EXCEPTION 'recommend_decision_for_open_brain: decision % is already approved for Open Brain — recommending again is not meaningful', p_decision_id;
  END IF;

  IF v_recommendation = 'REJECTED' THEN
    RAISE EXCEPTION 'recommend_decision_for_open_brain: decision % was rejected for durable memory by Jerry — only reconsider_decision_for_open_brain() (Jerry-only) can reopen it', p_decision_id;
  END IF;

  SELECT id INTO v_chief_owner_id FROM agent.owners WHERE owner_key = 'chief';
  IF v_chief_owner_id IS NULL THEN
    RAISE EXCEPTION 'recommend_decision_for_open_brain: the chief owner row is missing — this should have been created by the promotion-workflow migration';
  END IF;

  IF v_recommendation IS DISTINCT FROM 'RECOMMENDED' THEN
    UPDATE agent.decisions SET durable_memory_recommendation = 'RECOMMENDED' WHERE id = p_decision_id;
    INSERT INTO agent.decision_events (decision_id, event_type, actor_owner_id, note)
      VALUES (p_decision_id, 'DURABLE_MEMORY_RECOMMENDED', v_chief_owner_id, p_reason);
  END IF;
  -- Identical replay (already RECOMMENDED): idempotent no-op, no duplicate
  -- event — same "no UPDATE issued, no duplicate history" philosophy as
  -- record_decision_open_brain_sync's identical-replay case.

  SELECT * INTO result FROM agent.decisions WHERE id = p_decision_id;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION agent.recommend_decision_for_open_brain(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent.recommend_decision_for_open_brain(uuid, text) TO agent_service;

-- ---------------------------------------------------------------------------
-- 7. reject_decision_for_open_brain() — Jerry-only. EXECUTE -> agent_approver
-- only. agent_service is NEVER granted EXECUTE on this function.
-- ---------------------------------------------------------------------------

CREATE FUNCTION agent.reject_decision_for_open_brain(
  p_decision_id uuid,
  p_owner_key text,
  p_reason text
)
RETURNS agent.decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = agent, pg_temp
AS $function$
DECLARE
  v_recommendation text;
  v_eligible boolean;
  v_owner_id uuid;
  v_owner_type text;
  result agent.decisions;
BEGIN
  SELECT durable_memory_recommendation, open_brain_eligible INTO v_recommendation, v_eligible
  FROM agent.decisions WHERE id = p_decision_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reject_decision_for_open_brain: no decision found with id %', p_decision_id;
  END IF;

  IF v_eligible THEN
    RAISE EXCEPTION 'reject_decision_for_open_brain: decision % is already approved for Open Brain — cannot reject an approved decision', p_decision_id;
  END IF;

  SELECT id, owner_type INTO v_owner_id, v_owner_type FROM agent.owners WHERE owner_key = p_owner_key;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'reject_decision_for_open_brain: no owner found with owner_key %', p_owner_key;
  END IF;
  IF v_owner_type <> 'HUMAN' THEN
    RAISE EXCEPTION 'reject_decision_for_open_brain: owner % is not a HUMAN owner — durable-memory rejection is a human decision', p_owner_key;
  END IF;

  IF v_recommendation IS DISTINCT FROM 'REJECTED' THEN
    UPDATE agent.decisions SET durable_memory_recommendation = 'REJECTED' WHERE id = p_decision_id;
    INSERT INTO agent.decision_events (decision_id, event_type, actor_owner_id, note)
      VALUES (p_decision_id, 'DURABLE_MEMORY_REJECTED', v_owner_id, p_reason);
  END IF;
  -- Identical replay (already REJECTED): idempotent no-op.

  SELECT * INTO result FROM agent.decisions WHERE id = p_decision_id;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION agent.reject_decision_for_open_brain(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent.reject_decision_for_open_brain(uuid, text, text) TO agent_approver;

-- ---------------------------------------------------------------------------
-- 8. reconsider_decision_for_open_brain() — Jerry-only. Reopens a REJECTED
-- decision back to NULL so it can be recommended again. Only ever moves
-- REJECTED -> NULL; can never touch an already-approved decision. Writes no
-- decision_events row of its own (staying within Jerry's exact 7-value
-- list) — the transition is visible directly on agent.decisions, and the
-- subsequent DURABLE_MEMORY_RECOMMENDED event's note is expected to record
-- that it followed a reconsideration.
-- ---------------------------------------------------------------------------

CREATE FUNCTION agent.reconsider_decision_for_open_brain(
  p_decision_id uuid,
  p_owner_key text,
  p_reason text
)
RETURNS agent.decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = agent, pg_temp
AS $function$
DECLARE
  v_recommendation text;
  v_eligible boolean;
  v_owner_id uuid;
  v_owner_type text;
  result agent.decisions;
BEGIN
  SELECT durable_memory_recommendation, open_brain_eligible INTO v_recommendation, v_eligible
  FROM agent.decisions WHERE id = p_decision_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconsider_decision_for_open_brain: no decision found with id %', p_decision_id;
  END IF;

  IF v_recommendation IS DISTINCT FROM 'REJECTED' THEN
    RAISE EXCEPTION 'reconsider_decision_for_open_brain: decision % is not currently REJECTED (state: %) — nothing to reconsider', p_decision_id, COALESCE(v_recommendation, 'NOT_REVIEWED');
  END IF;

  IF v_eligible THEN
    RAISE EXCEPTION 'reconsider_decision_for_open_brain: decision % is open_brain_eligible=true while REJECTED — inconsistent state, refusing to touch it', p_decision_id;
  END IF;

  SELECT id, owner_type INTO v_owner_id, v_owner_type FROM agent.owners WHERE owner_key = p_owner_key;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'reconsider_decision_for_open_brain: no owner found with owner_key %', p_owner_key;
  END IF;
  IF v_owner_type <> 'HUMAN' THEN
    RAISE EXCEPTION 'reconsider_decision_for_open_brain: owner % is not a HUMAN owner — reconsideration is a human decision', p_owner_key;
  END IF;

  UPDATE agent.decisions SET durable_memory_recommendation = NULL WHERE id = p_decision_id;

  SELECT * INTO result FROM agent.decisions WHERE id = p_decision_id;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION agent.reconsider_decision_for_open_brain(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent.reconsider_decision_for_open_brain(uuid, text, text) TO agent_approver;

-- ---------------------------------------------------------------------------
-- 9. approve_decision_for_open_brain() — Jerry-only. The ONLY path to
-- open_brain_eligible = true (unchanged from Phase 0F: agent_service still
-- has no INSERT or UPDATE on that column at all). EXECUTE -> agent_approver
-- only. agent_service is NEVER granted EXECUTE on this function.
-- ---------------------------------------------------------------------------

CREATE FUNCTION agent.approve_decision_for_open_brain(
  p_decision_id uuid,
  p_owner_key text
)
RETURNS agent.decisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = agent, pg_temp
AS $function$
DECLARE
  v_recommendation text;
  v_eligible boolean;
  v_owner_id uuid;
  v_owner_type text;
  result agent.decisions;
BEGIN
  SELECT durable_memory_recommendation, open_brain_eligible INTO v_recommendation, v_eligible
  FROM agent.decisions WHERE id = p_decision_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_decision_for_open_brain: no decision found with id %', p_decision_id;
  END IF;

  IF v_recommendation IS DISTINCT FROM 'RECOMMENDED' THEN
    RAISE EXCEPTION 'approve_decision_for_open_brain: decision % is not currently RECOMMENDED (state: %) — nothing to approve', p_decision_id, COALESCE(v_recommendation, 'NOT_REVIEWED');
  END IF;

  SELECT id, owner_type INTO v_owner_id, v_owner_type FROM agent.owners WHERE owner_key = p_owner_key;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'approve_decision_for_open_brain: no owner found with owner_key %', p_owner_key;
  END IF;
  IF v_owner_type <> 'HUMAN' THEN
    RAISE EXCEPTION 'approve_decision_for_open_brain: owner % is not a HUMAN owner — durable-memory approval is a human decision', p_owner_key;
  END IF;

  IF NOT v_eligible THEN
    UPDATE agent.decisions SET open_brain_eligible = true WHERE id = p_decision_id;
    INSERT INTO agent.decision_events (decision_id, event_type, actor_owner_id)
      VALUES (p_decision_id, 'DURABLE_MEMORY_APPROVED', v_owner_id);
  END IF;
  -- Identical replay (already eligible=true): idempotent no-op.

  SELECT * INTO result FROM agent.decisions WHERE id = p_decision_id;
  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION agent.approve_decision_for_open_brain(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent.approve_decision_for_open_brain(uuid, text) TO agent_approver;

-- ---------------------------------------------------------------------------
-- Postflight — structural checks only (catalog inspection). The functional
-- proof that agent_service is actually BLOCKED from approve/reject/
-- reconsider (not just that the grants happen to be absent) lives in
-- agent-service/verifyDecisionPromotionPrivileges.ts, which connects
-- directly as agent_service via the real AGENT_SERVICE_DATABASE_URL and
-- attempts each forbidden call. Run it after this migration is applied:
--   npm run agent:verify:decision-promotion
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Column + CHECK constraint present.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND column_name = 'durable_memory_recommendation'
  ) THEN
    RAISE EXCEPTION 'durable_memory_recommendation column was not created';
  END IF;

  -- decision_events table + event_type CHECK present.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'agent' AND table_name = 'decision_events') THEN
    RAISE EXCEPTION 'agent.decision_events was not created';
  END IF;

  -- 'chief' owner exists.
  IF NOT EXISTS (SELECT 1 FROM agent.owners WHERE owner_key = 'chief' AND owner_type = 'AGENT') THEN
    RAISE EXCEPTION 'chief owner row was not created';
  END IF;

  -- agent_approver role exists, NOLOGIN, NOBYPASSRLS.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_approver' AND NOT rolcanlogin AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'agent_approver role missing or not NOLOGIN/NOBYPASSRLS';
  END IF;

  -- agent_service: EXECUTE on recommend ONLY — must be present for
  -- recommend, absent for reject/reconsider/approve.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'agent' AND routine_name = 'recommend_decision_for_open_brain' AND grantee = 'agent_service'
  ) THEN
    RAISE EXCEPTION 'agent_service is missing EXECUTE on recommend_decision_for_open_brain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'agent' AND routine_name IN ('reject_decision_for_open_brain', 'reconsider_decision_for_open_brain', 'approve_decision_for_open_brain')
      AND grantee = 'agent_service'
  ) THEN
    RAISE EXCEPTION 'agent_service must NOT have EXECUTE on reject/reconsider/approve_decision_for_open_brain — this is the whole point of this migration';
  END IF;

  -- agent_approver: EXECUTE on reject/reconsider/approve ONLY — must be
  -- absent for recommend.
  IF (
    SELECT count(DISTINCT routine_name) FROM information_schema.routine_privileges
    WHERE routine_schema = 'agent' AND routine_name IN ('reject_decision_for_open_brain', 'reconsider_decision_for_open_brain', 'approve_decision_for_open_brain')
      AND grantee = 'agent_approver'
  ) <> 3 THEN
    RAISE EXCEPTION 'agent_approver is missing EXECUTE on one or more of reject/reconsider/approve_decision_for_open_brain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'agent' AND routine_name = 'recommend_decision_for_open_brain' AND grantee = 'agent_approver'
  ) THEN
    RAISE EXCEPTION 'agent_approver must NOT have EXECUTE on recommend_decision_for_open_brain';
  END IF;

  -- PUBLIC has EXECUTE on none of the four.
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'agent'
      AND routine_name IN ('recommend_decision_for_open_brain', 'reject_decision_for_open_brain', 'reconsider_decision_for_open_brain', 'approve_decision_for_open_brain')
      AND grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not have EXECUTE on any of the four promotion-workflow functions';
  END IF;

  -- All four: SECURITY DEFINER, hardened search_path, owned by neither
  -- agent_service nor agent_approver (privilege separation requires the
  -- owner to actually have more privilege than the caller).
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'agent'
      AND p.proname IN ('recommend_decision_for_open_brain', 'reject_decision_for_open_brain', 'reconsider_decision_for_open_brain', 'approve_decision_for_open_brain')
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'all four promotion-workflow functions must be SECURITY DEFINER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'agent'
      AND p.proname IN ('recommend_decision_for_open_brain', 'reject_decision_for_open_brain', 'reconsider_decision_for_open_brain', 'approve_decision_for_open_brain')
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) AS cfg WHERE cfg ~ '^search_path\s*=\s*agent\s*,\s*pg_temp\s*$'
      )
  ) THEN
    RAISE EXCEPTION 'all four promotion-workflow functions must have the hardened search_path (agent, pg_temp)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'agent'
      AND p.proname IN ('recommend_decision_for_open_brain', 'reject_decision_for_open_brain', 'reconsider_decision_for_open_brain', 'approve_decision_for_open_brain')
      AND r.rolname IN ('agent_service', 'agent_approver')
  ) THEN
    RAISE EXCEPTION 'none of the four promotion-workflow functions may be owned by agent_service or agent_approver — SECURITY DEFINER would provide no privilege separation';
  END IF;

  -- agent.decisions: still no UPDATE (table- or column-level) for
  -- agent_service — re-asserted, unchanged from the 0901_..._sync
  -- migration.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND grantee = 'agent_service' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'agent_service must NOT have table-wide UPDATE on agent.decisions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'agent' AND table_name = 'decisions' AND grantee = 'agent_service' AND privilege_type = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'agent_service must NOT have column-level UPDATE on agent.decisions, including durable_memory_recommendation';
  END IF;

  -- decision_events: agent_service's INSERT policy allow-list is present
  -- (existence check only — the functional "does it actually block a
  -- DURABLE_MEMORY_APPROVED insert" proof lives in the live probe script).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'agent' AND tablename = 'decision_events' AND policyname = 'agent_service_insert'
  ) THEN
    RAISE EXCEPTION 'agent_service_insert RLS policy on agent.decision_events was not created';
  END IF;

  RAISE NOTICE 'PASS (structural): durable_memory_recommendation added; agent.decision_events created with RLS + allow-listed agent_service INSERT; chief owner present; agent_approver role created with EXECUTE on reject/reconsider/approve ONLY; agent_service has EXECUTE on recommend ONLY; PUBLIC excluded from all four; all four SECURITY DEFINER with hardened search_path, owned by neither service role; agent_service still has zero UPDATE on agent.decisions.';
END $$;

COMMIT;
