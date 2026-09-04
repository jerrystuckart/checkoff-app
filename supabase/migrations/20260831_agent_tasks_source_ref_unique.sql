-- Phase 0D: proposed migration to close a real concurrency gap in
-- createTask()'s idempotency, discovered during Phase 0D implementation —
-- NOT applied, review first.
--
-- agent.tasks has no unique constraint on (source_type, source_ref).
-- agent-service/mutations.ts's createTask() currently implements
-- idempotency as a check-then-insert inside its own transaction (SELECT
-- for an existing (source_type, source_ref) match, insert only if none
-- found). That is correct for a single retried caller, but it is NOT safe
-- against two truly concurrent createTask() calls with the same
-- source_ref: both transactions can see "no existing row" before either
-- commits its INSERT, producing two rows with the same (source_type,
-- source_ref) — exactly the race Phase 0A's review flagged when it
-- decided NOT to add this constraint back then ("this bootstrap can
-- enforce its own idempotency without it" — true for a single-writer,
-- one-shot bootstrap script; not true for a service that may receive
-- concurrent calls).
--
-- This migration adds the same shape of guarantee agent.interactions
-- already has (see interactions_channel_source_ref_idx in
-- 20260830_agent_operational_schema_phase0a.sql): a partial unique index
-- that only applies when source_ref is non-null, so rows with no source
-- identity (source_ref IS NULL) remain freely insertable.
--
-- REVIEW-READY — DO NOT RUN AGAINST THE LINKED PROJECT WITHOUT REVIEW.
-- Run manually via:
--   supabase db query -f supabase/migrations/20260831_agent_tasks_source_ref_unique.sql --linked
--
-- SEQUENCING (code is already written and ready for this — see
-- agent-service/mutations.ts's hasSourceRefUniqueIndex()): as soon as this
-- migration is applied, createTask() automatically starts using
-- `INSERT ... ON CONFLICT (source_type, source_ref) WHERE source_ref IS
-- NOT NULL DO NOTHING` for a genuinely race-safe single round trip — it
-- checks for this index's existence on every call (no caching, no stale
-- state, no process restart required) and uses the fast path the moment
-- it's there. Today, before this migration is applied, createTask() uses
-- a check-then-insert fallback that is correct for a single retried
-- caller but NOT safe against genuine concurrent callers — see that
-- function's own doc comment. No application code change accompanies
-- this migration; none is needed.
--
-- Idempotent to rerun: DROP INDEX IF EXISTS guards against error on a
-- second run, matching this repo's existing idempotency discipline.
--
-- PREFLIGHT DUPLICATE GUARD: if any existing agent.tasks rows already
-- share a non-null (source_type, source_ref) pair, a bare CREATE UNIQUE
-- INDEX would fail with Postgres's own generic "could not create unique
-- index — key is duplicated" error, naming a row but not explaining the
-- shape of the problem. The check below runs first and, if it finds any
-- duplicate group, raises a clear, actionable error naming every
-- conflicting (source_type, source_ref) pair and its row count, so
-- whoever is applying this understands exactly what needs manual
-- resolution before retrying — rather than reverse-engineering it from a
-- bare constraint-violation message. Bootstrap v1's own source_refs were
-- all applied via WHERE NOT EXISTS checks that make duplicates within
-- that one script's rows structurally impossible, so this is not expected
-- to find anything — but this migration does not assume that silently.

BEGIN;

DO $$
DECLARE
  dup_count int;
  dup_list text;
BEGIN
  SELECT count(*), string_agg(source_type || '/' || source_ref || ' (' || cnt || ' rows)', ', ')
    INTO dup_count, dup_list
  FROM (
    SELECT source_type, source_ref, count(*) AS cnt
    FROM agent.tasks
    WHERE source_ref IS NOT NULL
    GROUP BY source_type, source_ref
    HAVING count(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create tasks_source_type_source_ref_idx: % existing (source_type, source_ref) pair(s) already have duplicate rows and must be resolved manually first: %',
      dup_count, dup_list;
  END IF;
END $$;

DROP INDEX IF EXISTS agent.tasks_source_type_source_ref_idx;
CREATE UNIQUE INDEX tasks_source_type_source_ref_idx
  ON agent.tasks (source_type, source_ref) WHERE source_ref IS NOT NULL;

COMMIT;
