-- Tighten uploads into the private submission-photos bucket (2026-10-07).
--
-- BEFORE: "anyone can upload submission photos" — INSERT for role public with only
-- bucket_id = 'submission-photos' (anonymous, any path, any size/type).
-- AFTER:  signed-in users may INSERT only under cover-candidates/<their own uid>/...,
-- which is exactly what screens/CoverCandidateCaptureScreen.jsx writes
-- (`cover-candidates/${user.id}/${Date.now()}.${ext}`, upsert:false).
--
-- Unaffected (they use the service-role key, which bypasses RLS): admin Business
-- Photo Intake (secret-business-photos/...), admin/business-submissions/..., and the
-- site's business confirmation upload. SELECT/UPDATE/DELETE policies are untouched.
-- Known side effect: the public getcheckoff.com /submit form's OPTIONAL photo upload
-- (anonymous, bucket root) is no longer permitted; that form already continues
-- without a photo when the upload fails.
--
-- Also sets server-side limits on the bucket: 10 MB per file; JPEG/PNG/WebP/HEIC/HEIF
-- only. (Existing objects: all image/jpeg or image/png, max ~6 MB.)
BEGIN;

DROP POLICY IF EXISTS "anyone can upload submission photos" ON storage.objects;
DROP POLICY IF EXISTS "users upload own cover candidate photos" ON storage.objects;
CREATE POLICY "users upload own cover candidate photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'submission-photos'
    AND (storage.foldername(name))[1] = 'cover-candidates'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
 WHERE id = 'submission-photos';

COMMIT;
