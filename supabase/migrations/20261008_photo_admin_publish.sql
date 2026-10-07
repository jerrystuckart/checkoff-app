-- Photo-admin immediate publication (2026-10-08). REVIEW BEFORE APPLYING.
--
-- 1. photo_admins: the server-side list of users allowed to publish photos from the app
--    without moderation. Clients can neither read nor write it (RLS on, no policies, all
--    privileges revoked); only the service role and the SECURITY DEFINER functions below
--    touch it. DELIBERATELY NOT users.is_admin: that column is currently self-editable by
--    any signed-in user (users UPDATE grant + owner-update policy), so it cannot be trusted.
-- 2. is_photo_admin(): lets the app ask "am I one?" (UI only; the server re-checks).
-- 3. admin_publish_item_photo(): the ONLY path that publishes immediately. Verifies
--    auth.uid() is in photo_admins, the file is in the caller's own cover-candidates/<uid>/
--    folder and exists, then atomically (one transaction) records an approved,
--    display-eligible candidate. No active cover yet -> it becomes the active cover (selected,
--    primary, items pointer set). Already has an active cover -> it is only added to the
--    rotation pool (cover_eligible, not primary); the active cover is never replaced.
--    secret_business_photo_storage_path is never touched.
-- 4. Hardening: the user INSERT policy on item_cover_candidates previously let a client
--    insert a row with ANY status/display_eligible/is_primary. It now only allows an
--    ordinary community submission (pending/needs_review/automated_rejected, not
--    display-eligible, not primary, source community, no token). Existing app inserts
--    already satisfy this.
BEGIN;

CREATE TABLE IF NOT EXISTS public.photo_admins (
  user_id    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  note       text
);
ALTER TABLE public.photo_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.photo_admins FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_photo_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM public.photo_admins WHERE user_id = auth.uid()) $$;
REVOKE ALL ON FUNCTION public.is_photo_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_photo_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_publish_item_photo(
  p_item_id      uuid,
  p_storage_path text,
  p_moderation   jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_active uuid;
  v_new    uuid;
  v_cover  boolean;
  v_meta   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'admin_publish_item_photo: not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'admin_publish_item_photo: not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_storage_path IS NULL
     OR p_storage_path NOT LIKE ('cover-candidates/' || v_uid::text || '/%')
     OR p_storage_path LIKE '%..%' THEN
    RAISE EXCEPTION 'admin_publish_item_photo: path must be under your own cover-candidates folder' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'submission-photos' AND name = p_storage_path) THEN
    RAISE EXCEPTION 'admin_publish_item_photo: uploaded file not found' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.item_cover_candidates WHERE storage_path = p_storage_path) THEN
    RAISE EXCEPTION 'admin_publish_item_photo: this file was already submitted' USING ERRCODE = '23505';
  END IF;

  SELECT active_cover_candidate_id INTO v_active FROM public.items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_publish_item_photo: item not found' USING ERRCODE = '22023';
  END IF;

  v_cover := (v_active IS NULL);
  v_meta  := coalesce(p_moderation, '{}'::jsonb)
             || jsonb_build_object('uploadedVia', 'photo_admin_mobile', 'photoAdminUserId', v_uid);

  IF v_cover THEN
    -- the unique one-primary-per-item index: any stale primary keeps its place in the pool
    UPDATE public.item_cover_candidates SET is_primary = false WHERE item_id = p_item_id AND is_primary;
    INSERT INTO public.item_cover_candidates(
      item_id, submitted_by_user_id, source, storage_path, status, moderation_metadata,
      consent_ack, reviewed_by_user_id, reviewed_at, selected_as_cover_at, display_eligible, is_primary)
    VALUES (p_item_id, v_uid, 'community', p_storage_path, 'selected', v_meta,
      true, v_uid, now(), now(), true, true)
    RETURNING id INTO v_new;
    UPDATE public.items SET active_cover_candidate_id = v_new WHERE id = p_item_id;
  ELSE
    INSERT INTO public.item_cover_candidates(
      item_id, submitted_by_user_id, source, storage_path, status, moderation_metadata,
      consent_ack, reviewed_by_user_id, reviewed_at, display_eligible, is_primary)
    VALUES (p_item_id, v_uid, 'community', p_storage_path, 'cover_eligible', v_meta,
      true, v_uid, now(), true, false)
    RETURNING id INTO v_new;
  END IF;

  RETURN jsonb_build_object('candidate_id', v_new, 'became_cover', v_cover);
END
$$;
REVOKE ALL ON FUNCTION public.admin_publish_item_photo(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_publish_item_photo(uuid, text, jsonb) TO authenticated;

DROP POLICY IF EXISTS item_cover_candidates_insert_own ON public.item_cover_candidates;
CREATE POLICY item_cover_candidates_insert_own ON public.item_cover_candidates
  FOR INSERT
  WITH CHECK (
    submitted_by_user_id = auth.uid()
    AND consent_ack = true
    AND status IN ('pending', 'needs_review', 'automated_rejected')
    AND display_eligible = false
    AND is_primary = false
    AND source = 'community'
    AND submitted_by_token_id IS NULL
    AND selected_as_cover_at IS NULL
    AND reviewed_by_user_id IS NULL
  );

COMMIT;
