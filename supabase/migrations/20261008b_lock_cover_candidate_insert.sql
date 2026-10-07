-- Close the pre-published-photo hole on item_cover_candidates (2026-10-08). REVIEW BEFORE APPLYING.
--
-- BEFORE: the INSERT policy only required submitted_by_user_id = auth.uid() AND consent_ack, and
-- `authenticated` held table-level INSERT, so a modified client could insert its own candidate already
-- status='selected', is_primary, display_eligible (public) — proved with a rolled-back production test.
--
-- AFTER (two independent layers):
--  1. Column privileges: clients may INSERT only item_id, submitted_by_user_id, storage_path, status,
--     moderation_metadata, consent_ack. Every publication/approval field (display_eligible, is_primary,
--     display_weight, reviewed_by_user_id, reviewed_at, selected_as_cover_at, rejection_reason, source,
--     submitted_by_token_id, ...) is not insertable by a client, so it takes its safe column default
--     (display_eligible=false, is_primary=false, source='community', display_weight=1, others null).
--  2. RLS: the only status a client may insert is pending / needs_review / automated_rejected.
-- Anonymous users get no write privileges at all. Admin/service-role paths (Admin tool, definer functions,
-- edge functions) are unaffected. UPDATE/DELETE remain admin-only RLS policies, unchanged.
BEGIN;

REVOKE INSERT, TRUNCATE, REFERENCES, TRIGGER ON public.item_cover_candidates FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE ON public.item_cover_candidates FROM PUBLIC, anon;

GRANT INSERT (item_id, submitted_by_user_id, storage_path, status, moderation_metadata, consent_ack)
  ON public.item_cover_candidates TO authenticated;

DROP POLICY IF EXISTS item_cover_candidates_insert_own ON public.item_cover_candidates;
CREATE POLICY item_cover_candidates_insert_own ON public.item_cover_candidates
  FOR INSERT
  WITH CHECK (
    submitted_by_user_id = auth.uid()
    AND consent_ack = true
    AND status IN ('pending', 'needs_review', 'automated_rejected')
  );

COMMIT;
