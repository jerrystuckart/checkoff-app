-- Lets the app sign/read ONLY the partner storefront/venue photo recorded in
-- items.secret_business_photo_storage_path (admin Business Photo Intake) so the
-- locked Secret CheckOff screen can show it. Without this, the existing
-- submission-photos SELECT policy only exposes selected cover candidates, so
-- createSignedUrl() on secret-business-photos/... is denied.
-- NOT APPLIED — review before running. Scope is exact-path match only; no
-- other objects in the bucket become readable.
BEGIN;

DROP POLICY IF EXISTS "anyone can view secret business photos" ON storage.objects;
CREATE POLICY "anyone can view secret business photos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'submission-photos'
    AND EXISTS (
      SELECT 1 FROM public.items
      WHERE items.secret_business_photo_storage_path = storage.objects.name
    )
  );

COMMIT;
