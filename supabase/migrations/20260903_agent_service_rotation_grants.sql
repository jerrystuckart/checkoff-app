-- Multi-Image Rotation for Item Covers (2026-09-03) — follow-up grant.
--
-- agent-service/coverCandidateModeration.ts's 4 new operations
-- (addToRotation, removeFromRotation, setPrimaryImage,
-- listItemImagePool) need agent_service to write the 3 columns added by
-- 20260903_multi_image_rotation.sql (display_eligible, is_primary,
-- display_weight). The prior grants migration
-- (20260903_agent_service_cover_candidate_grants.sql) column-scoped
-- UPDATE to exactly the moderation-status columns that existed at the
-- time — this extends that SAME narrow column-level grant to the 3 new
-- columns, nothing broader (still no UPDATE on item_id, storage_path,
-- submitted_by_user_id, etc). SELECT is already granted on the whole
-- table, so the new columns are already readable — only UPDATE needs
-- extending.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration file in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260903_agent_service_rotation_grants.sql --linked

BEGIN;

GRANT UPDATE (display_eligible, is_primary, display_weight)
  ON public.item_cover_candidates TO agent_service;

COMMIT;
