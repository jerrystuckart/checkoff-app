-- Chief Phase 2A — Business Photo Outreach playbook (2026-09-04), follow-up.
--
-- The prior grants migration (20260904_agent_service_business_outreach_read_grants.sql)
-- added table-level GRANT SELECT for agent_service on business_outreach_tokens
-- and business_confirmation_submissions — but both tables have RLS enabled
-- (relrowsecurity = true, confirmed live) and neither had ANY policy
-- naming agent_service, so RLS silently filtered every row to zero
-- (discovered live: the reconciliation seed script returned "0 live
-- tokens" against a table with 140 real rows). A GRANT alone is
-- necessary but not sufficient under RLS — this migration adds the
-- missing SELECT policy, matching the exact naming convention already
-- used for agent_service's other RLS-scoped read access
-- (agent_service_select, see agent.owners/projects/tasks/etc).
--
-- SELECT only, read-only — mirrors the read-only grant it pairs with.
-- Chief never writes to these tables; the getcheckoff.com Vercel
-- function (its own service-role key) remains the only writer.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration file in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260904_agent_service_business_outreach_rls.sql --linked

BEGIN;

DROP POLICY IF EXISTS agent_service_select ON public.business_outreach_tokens;
CREATE POLICY agent_service_select ON public.business_outreach_tokens
  FOR SELECT TO agent_service USING (true);

DROP POLICY IF EXISTS agent_service_select ON public.business_confirmation_submissions;
CREATE POLICY agent_service_select ON public.business_confirmation_submissions
  FOR SELECT TO agent_service USING (true);

-- item_cover_candidates: the existing agent_service GRANT SELECT (prior
-- release-candidate task) only actually let agent_service read rows
-- matching item_cover_candidates_select_selected_public (display_eligible
-- = true, a policy with an empty polroles array — applies to every role,
-- agent_service included). That's fine for an already-public cover, but
-- Chief's PHOTO_SUBMITTED/PHOTO_REVIEW stages need to read a candidate
-- that is STILL needs_review/approved (not yet display_eligible) —
-- that's the whole point of surfacing it for Jerry to review. Read-only,
-- same as every other agent_service policy here; still no write access
-- beyond what the prior column-scoped UPDATE grant already allows.
DROP POLICY IF EXISTS agent_service_select ON public.item_cover_candidates;
CREATE POLICY agent_service_select ON public.item_cover_candidates
  FOR SELECT TO agent_service USING (true);

COMMIT;
