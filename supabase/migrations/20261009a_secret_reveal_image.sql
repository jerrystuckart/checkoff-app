-- Optional admin-managed REVEAL background image for secret items (portrait, shown full-screen behind
-- the unlocked Secret card). NOT APPLIED — review before running.
--
-- Schema verified 2026-10-09 (read-only, via the app's own API): public.items already has
-- secret_business_photo_storage_path (the locked/teaser photo). This adds the sibling
-- secret_reveal_image_storage_path, same shape (nullable text storage path in bucket submission-photos).
--
-- Safe defaults: NULL = no reveal image -> the app falls back to the approved cover/pool photo, then the
-- business photo, then the branded fallback. Additive only: no existing row/column/policy changes.
-- Ordinary users gain NOTHING: items is not writable by anon/authenticated (see security matrix: "cannot
-- edit items"), uploads by users are restricted to cover-candidates/<uid>/ (20261007d), and this path is only
-- ever written by the admin tool (service key). Pending/rejected submissions are never referenced by it.
-- The read policy is exact-path only, mirroring 20261007_secret_business_photo_read.sql.
-- The photo is not confidential (the secret is the verbiage), but the app only requests it after unlock.
BEGIN;

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS secret_reveal_image_storage_path text NULL;

-- Optional admin-chosen crop focus for the portrait background (percent, 0..100 per axis; NULL = app default).
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS secret_reveal_image_focus_x smallint NULL
    CONSTRAINT items_secret_reveal_focus_x_range CHECK (secret_reveal_image_focus_x BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS secret_reveal_image_focus_y smallint NULL
    CONSTRAINT items_secret_reveal_focus_y_range CHECK (secret_reveal_image_focus_y BETWEEN 0 AND 100);

COMMENT ON COLUMN public.items.secret_reveal_image_storage_path IS
  'Optional admin-uploaded portrait background shown behind the unlocked Secret card (submission-photos/secret-reveal-images/<item_id>/...). NULL = reuse approved cover.';

DROP POLICY IF EXISTS "anyone can view secret reveal images" ON storage.objects;
CREATE POLICY "anyone can view secret reveal images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'submission-photos'
    AND EXISTS (
      SELECT 1 FROM public.items
      WHERE items.secret_reveal_image_storage_path = storage.objects.name
    )
  );

COMMIT;

-- Rollback (no data loss for other features):
--   DROP POLICY IF EXISTS "anyone can view secret reveal images" ON storage.objects;
--   ALTER TABLE public.items DROP COLUMN IF EXISTS secret_reveal_image_storage_path,
--     DROP COLUMN IF EXISTS secret_reveal_image_focus_x, DROP COLUMN IF EXISTS secret_reveal_image_focus_y;
