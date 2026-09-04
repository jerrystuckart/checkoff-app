-- Chief Phase 2A — Business Photo Outreach playbook (2026-09-04).
--
-- agent-service's businessPhotoOutreachEngine.ts needs to READ
-- business_outreach_tokens and business_confirmation_submissions to
-- assess a WAITING task's evidence (has the business responded? what did
-- they say?) — the exact same tables verified end-to-end in the prior
-- task. SELECT only, same narrow-grant convention as every other
-- agent_service grants migration in this directory (e.g.
-- 20260903_agent_service_cover_candidate_grants.sql) — Chief never
-- writes to these tables; the getcheckoff.com Vercel function (its own
-- service-role key) remains the only writer.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration file in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260904_agent_service_business_outreach_read_grants.sql --linked

BEGIN;

GRANT SELECT ON public.business_outreach_tokens TO agent_service;
GRANT SELECT ON public.business_confirmation_submissions TO agent_service;

COMMIT;
