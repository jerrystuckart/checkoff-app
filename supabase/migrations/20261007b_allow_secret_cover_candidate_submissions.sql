-- Allow user photo submissions for secret items (Jerry decision 2026-10-07).
-- Submissions still enter Admin review (needs_review) and are never public until approved.
--
-- Drops ONLY the trigger that rejected any INSERT/UPDATE on item_cover_candidates
-- for a secret item (that trigger also blocked Admin approve/reject of such rows).
-- KEPT on purpose: items_reject_secret_active_cover, which stops a secret item from
-- ever getting items.active_cover_candidate_id (an approved photo can't become the
-- secret item's active cover).
-- NOT APPLIED — apply before publishing the OTA that exposes the CTA.
BEGIN;

DROP TRIGGER IF EXISTS item_cover_candidates_reject_secret_items ON public.item_cover_candidates;
DROP FUNCTION IF EXISTS public.reject_secret_item_cover_candidates();

COMMIT;
