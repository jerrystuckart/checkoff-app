-- Checks for 20261009a_secret_reveal_image.sql. NOT RUN. Run on a branch/staging copy (or production only after
-- approval). Applies nothing permanently: it ALWAYS ends with RAISE EXCEPTION so the transaction rolls back.
-- Read the result in the error text: PASS / **FAIL** lines.
DO $$
DECLARE out text := ''; n int; ok boolean;
BEGIN
  -- apply the migration body inside this (rolled back) transaction
  ALTER TABLE public.items ADD COLUMN IF NOT EXISTS secret_reveal_image_storage_path text NULL,
    ADD COLUMN IF NOT EXISTS secret_reveal_image_focus_x smallint NULL CONSTRAINT items_secret_reveal_focus_x_range CHECK (secret_reveal_image_focus_x BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS secret_reveal_image_focus_y smallint NULL CONSTRAINT items_secret_reveal_focus_y_range CHECK (secret_reveal_image_focus_y BETWEEN 0 AND 100);
  DROP POLICY IF EXISTS "anyone can view secret reveal images" ON storage.objects;
  CREATE POLICY "anyone can view secret reveal images" ON storage.objects FOR SELECT USING (
    bucket_id = 'submission-photos' AND EXISTS (SELECT 1 FROM public.items WHERE items.secret_reveal_image_storage_path = storage.objects.name));

  SELECT count(*) INTO n FROM public.items WHERE secret_reveal_image_storage_path IS NOT NULL;
  out := out || CASE WHEN n = 0 THEN 'PASS default NULL for every existing item' ELSE '**FAIL** non-null defaults: '||n END || E'\n';

  SELECT NOT (has_column_privilege('anon','public.items','secret_reveal_image_storage_path','UPDATE') OR has_column_privilege('authenticated','public.items','secret_reveal_image_storage_path','UPDATE')
          OR has_column_privilege('anon','public.items','secret_reveal_image_focus_x','UPDATE') OR has_column_privilege('authenticated','public.items','secret_reveal_image_focus_y','UPDATE')) INTO ok;
  out := out || CASE WHEN ok THEN 'PASS anon/authenticated cannot UPDATE the new column' ELSE '**FAIL** a client role can UPDATE the new column' END || E'\n';

  SELECT NOT (has_column_privilege('anon','public.items','secret_reveal_image_storage_path','INSERT')
          OR has_column_privilege('authenticated','public.items','secret_reveal_image_storage_path','INSERT')) INTO ok;
  out := out || CASE WHEN ok THEN 'PASS anon/authenticated cannot INSERT the new column' ELSE '**FAIL** a client role can INSERT the new column' END || E'\n';

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='anyone can view secret reveal images' AND cmd='SELECT';
  out := out || CASE WHEN n = 1 THEN 'PASS exactly one SELECT-only exact-path read policy' ELSE '**FAIL** policy count '||n END || E'\n';

  RAISE EXCEPTION E'RESULT (rolled back):\n%', out;
END $$;
