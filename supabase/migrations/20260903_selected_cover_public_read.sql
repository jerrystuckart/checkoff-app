-- Community Cover Photos V1 — fix a real gap found during the first
-- production run-through (2026-09-03): item_cover_candidates_select_own_or_admin
-- and "admins can view submission photos" only ever let the SUBMITTER or
-- an ADMIN read a candidate row / its storage object. That's correct for
-- every status except 'selected' — once an admin has explicitly picked a
-- candidate as an item's public cover, EVERY user needs to be able to
-- read it (that's the entire point of resolvedItemImage() / Home /
-- Item Detail rendering it). Without this, resolveActiveCoverUrl()
-- silently returns null for anyone who isn't the original submitter or
-- an admin — confirmed live: Home rendered no image for a fresh session
-- until this ran.
--
-- Deliberately narrow: adds SELECT only for rows/objects where
-- status = 'selected' (item_cover_candidates) — nothing else about the
-- existing submitter/admin-only policies changes, so pending/needs_review/
-- approved/rejected candidates remain exactly as private as before. No
-- user photo becomes public without an admin explicitly selecting it.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration file in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260903_selected_cover_public_read.sql --linked

BEGIN;

DROP POLICY IF EXISTS item_cover_candidates_select_selected_public ON item_cover_candidates;
CREATE POLICY item_cover_candidates_select_selected_public ON item_cover_candidates
  FOR SELECT USING (status = 'selected');

DROP POLICY IF EXISTS "anyone can view selected cover photos" ON storage.objects;
CREATE POLICY "anyone can view selected cover photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'submission-photos'
    AND EXISTS (
      SELECT 1 FROM item_cover_candidates
      WHERE item_cover_candidates.storage_path = storage.objects.name
        AND item_cover_candidates.status = 'selected'
    )
  );

COMMIT;
