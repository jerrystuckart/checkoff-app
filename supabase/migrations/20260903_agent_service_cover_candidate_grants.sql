-- Add Cover Candidate Review Into Existing Admin Images Area (2026-09-03) —
-- Chief-ready operations: agent-service's coverCandidateModeration.ts needs
-- real Postgres grants to read/write item_cover_candidates and update
-- items.active_cover_candidate_id. The agent_service role currently has
-- ZERO grants on the public schema (confirmed via information_schema.
-- role_table_grants before writing this) — it was scoped entirely to
-- agent.* in Phase 0A/0C. This migration is the deliberate, narrow
-- exception: exactly the tables/columns the moderation operations touch,
-- nothing broader.
--
-- This does NOT weaken Supabase RLS. RLS governs PostgREST/anon/
-- authenticated access; agent_service is a direct Postgres role connected
-- via pg (agent-service/db.ts), the same trust boundary already used for
-- every agent.* write — this migration just extends that SAME boundary to
-- two public tables, with column-level UPDATE grants (not blanket UPDATE)
-- so agent_service cannot, say, rewrite an item's body text or an
-- unrelated column just because it can update active_cover_candidate_id.
--
-- "Do not give Chief autonomous approval authority yet" (explicit
-- instruction) is enforced at the APPLICATION layer, same as every other
-- agent-service write today: these grants make the operations callABLE,
-- not autonomous — nothing in this codebase invokes them without a human
-- driving the admin UI (or, later, an explicit Chief action a human
-- approves). See agent-service/coverCandidateModeration.ts.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration file in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260903_agent_service_cover_candidate_grants.sql --linked

BEGIN;

GRANT SELECT ON public.item_cover_candidates TO agent_service;
GRANT UPDATE (status, rejection_reason, reviewed_by_user_id, reviewed_at, selected_as_cover_at)
  ON public.item_cover_candidates TO agent_service;

-- Read access for joining candidate rows to their item's body/venue/
-- metro context in the review list — SELECT only, no write.
GRANT SELECT ON public.items TO agent_service;
GRANT SELECT ON public.neighborhoods TO agent_service;
GRANT SELECT ON public.metro_areas TO agent_service;
GRANT SELECT ON public.partners TO agent_service;
GRANT SELECT ON public.users TO agent_service;

-- The one items column moderation actually needs to write: which
-- candidate is the item's active cover. Nothing else on items.
GRANT UPDATE (active_cover_candidate_id) ON public.items TO agent_service;

COMMIT;
