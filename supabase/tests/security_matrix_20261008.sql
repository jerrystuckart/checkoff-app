-- SECURITY PERMISSION MATRIX (2026-10-08). Run against a database that is allowed to take the DDL, e.g. a Supabase
-- branch/staging copy, or production only after approving it. It applies the three migrations
-- (20261008a/b/c), runs ~100 adversarial checks as anon / ordinary user / photo admin / general admin /
-- service_role, and ALWAYS ends with RAISE EXCEPTION, so everything (DDL included) rolls back.
-- Read the result in the error text: lines starting PASS / **FAIL** / STATE.
-- Afterwards confirm nothing persisted: to_regclass('public.photo_admins') IS NULL and
-- has_column_privilege('authenticated','public.users','is_admin','UPDATE') is still true (the vulnerable "before").


REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.users FROM PUBLIC, anon, authenticated;

GRANT UPDATE (
  display_name, avatar_url, city_id, neighborhood_id,
  pref_show_alcohol, notif_check_ins, notif_invites, notif_nudges, share_channels,
  app_version, build_number, platform, last_app_open_at, last_version_check_at,
  lifetime_points, referred_by
) ON public.users TO authenticated;



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


CREATE FUNCTION public._t(label text, stmt text, expect text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n bigint := 0; err text := NULL; ok boolean;
BEGIN
  BEGIN EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  ok := (err IS NULL AND n >= 1);               -- "allowed" = no error and at least one row affected/returned
  PERFORM set_config('chk.out', coalesce(current_setting('chk.out', true),'') ||
    CASE WHEN (expect='ok') = ok THEN 'PASS ' ELSE '**FAIL** ' END || label || ' [' || expect || ' -> ' || CASE WHEN ok THEN 'allowed' ELSE 'denied' END || ']' || E'\n', true);
END $f$;
CREATE FUNCTION public._def_update() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN UPDATE public.users SET is_admin = is_admin, insider_tier = insider_tier, current_streak = current_streak WHERE false; UPDATE public.users SET last_checkin_week = last_checkin_week WHERE id = (SELECT id FROM public.users LIMIT 1); END $f$;

DO $$
DECLARE
  jerry uuid := '11275026-65be-4421-80a4-46c57195408b';
  u1 uuid; u2 uuid;
  nocover uuid; cover_item uuid; old_active uuid; old_primary uuid; secret_item uuid := 'd8357f28-5680-462a-a504-dc4dfd7b7add';
  biz_before text; biz_after text; ok boolean; st text; de boolean; pr boolean;
  o text;
  PROT text[] := ARRAY['id','email','is_admin','is_pro','is_deleted','created_at','updated_at','founding_number','insider_tier','current_streak','longest_streak','last_checkin_week','visit_detection_tester','email_opt_out','email_opt_out_at','email_bounced','email_bounced_at'];
  ALLOWED text[] := ARRAY['display_name','avatar_url','city_id','neighborhood_id','pref_show_alcohol','notif_check_ins','notif_invites','notif_nudges','share_channels','app_version','build_number','platform','last_app_open_at','last_version_check_at','lifetime_points','referred_by'];
  c text; v text;
BEGIN
  SELECT id INTO u1 FROM users WHERE is_admin=false AND is_deleted IS NOT TRUE ORDER BY id LIMIT 1;
  SELECT id INTO u2 FROM users WHERE is_admin=false AND is_deleted IS NOT TRUE AND id<>u1 ORDER BY id LIMIT 1;
  SELECT i.id INTO nocover FROM destinations d JOIN destination_lists dl ON dl.destination_id=d.id JOIN list_items li ON li.list_id=dl.list_id JOIN items i ON i.id=li.item_id WHERE d.slug='willcox' AND NOT i.is_secret AND i.active_cover_candidate_id IS NULL LIMIT 1;
  SELECT id, active_cover_candidate_id INTO cover_item, old_active FROM items WHERE active_cover_candidate_id IS NOT NULL LIMIT 1;
  SELECT id INTO old_primary FROM item_cover_candidates WHERE item_id=cover_item AND is_primary;
  SELECT secret_business_photo_storage_path INTO biz_before FROM items WHERE id=secret_item;
  INSERT INTO storage.objects(bucket_id,name) VALUES ('submission-photos','cover-candidates/'||jerry||'/a.jpg'),('submission-photos','cover-candidates/'||jerry||'/b.jpg'),('submission-photos','cover-candidates/'||jerry||'/c.jpg'),('submission-photos','cover-candidates/'||u1||'/n.jpg'),('submission-photos','cover-candidates/'||u1||'/m.jpg');
  PERFORM set_config('chk.out','',true);

  -- ================= ANONYMOUS =================
  SET LOCAL ROLE anon;
  PERFORM _t('anon: insert candidate', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack) VALUES (%L,%L,'x','needs_review',true)$q$, nocover, u1), 'deny');
  PERFORM _t('anon: update users.is_admin', format($q$UPDATE users SET is_admin=true WHERE id=%L$q$, u1), 'deny');
  PERFORM _t('anon: insert users', format($q$INSERT INTO users(id,display_name,email,is_admin) VALUES (gen_random_uuid(),'x','x@x',true)$q$), 'deny');
  PERFORM _t('anon: grant photo_admins', format($q$INSERT INTO photo_admins(user_id) VALUES (%L)$q$, u1), 'deny');
  PERFORM _t('anon: read photo_admins', 'SELECT * FROM photo_admins', 'deny');
  PERFORM _t('anon: is_photo_admin()', 'SELECT is_photo_admin()', 'deny');
  PERFORM _t('anon: admin_publish_item_photo', format($q$SELECT admin_publish_item_photo(%L,'cover-candidates/'||%L||'/a.jpg')$q$, nocover, jerry), 'deny');
  RESET ROLE;

  -- ================= NORMAL AUTHENTICATED USER (u1) =================
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM _t('user: LEGIT submission (app columns, needs_review)', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,moderation_metadata,consent_ack) VALUES (%L,%L,%L,'needs_review','{"passesBasicSanity":true}',true)$q$, nocover, u1, 'cover-candidates/'||u1||'/n.jpg'), 'ok');
  PERFORM _t('user: legit automated_rejected', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,moderation_metadata,consent_ack) VALUES (%L,%L,'ar1','automated_rejected','{}',true)$q$, nocover, u1), 'ok');
  FOREACH v IN ARRAY ARRAY['approved','selected','cover_eligible','rejected'] LOOP
    PERFORM _t('user: status='||v, format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack) VALUES (%L,%L,%L,%L,true)$q$, nocover, u1, 'p-'||v, v), 'deny');
  END LOOP;
  FOREACH c IN ARRAY ARRAY['display_eligible','is_primary'] LOOP
    PERFORM _t('user: set '||c||'=true', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,%I) VALUES (%L,%L,%L,'needs_review',true,true)$q$, c, nocover, u1, 'p-'||c), 'deny');
  END LOOP;
  PERFORM _t('user: set display_weight', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,display_weight) VALUES (%L,%L,'pw','needs_review',true,99)$q$, nocover, u1), 'deny');
  PERFORM _t('user: set reviewed_by_user_id', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,reviewed_by_user_id) VALUES (%L,%L,'pr','needs_review',true,%L)$q$, nocover, u1, u1), 'deny');
  PERFORM _t('user: set reviewed_at', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,reviewed_at) VALUES (%L,%L,'pra','needs_review',true,now())$q$, nocover, u1), 'deny');
  PERFORM _t('user: set selected_as_cover_at', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,selected_as_cover_at) VALUES (%L,%L,'psc','needs_review',true,now())$q$, nocover, u1), 'deny');
  PERFORM _t('user: set source', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,source) VALUES (%L,%L,'psrc','needs_review',true,'business_submission')$q$, nocover, u1), 'deny');
  PERFORM _t('user: set submitted_by_token_id', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,submitted_by_token_id) VALUES (%L,%L,'ptk','needs_review',true,gen_random_uuid())$q$, nocover, u1), 'deny');
  PERFORM _t('user: set rejection_reason', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack,rejection_reason) VALUES (%L,%L,'prr','needs_review',true,'x')$q$, nocover, u1), 'deny');
  PERFORM _t('user: submit AS another user', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack) VALUES (%L,%L,'pu2','needs_review',true)$q$, nocover, u2), 'deny');
  PERFORM _t('user: submit without consent', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack) VALUES (%L,%L,'pnc','needs_review',false)$q$, nocover, u1), 'deny');
  PERFORM _t('user: update own candidate to selected', format($q$UPDATE item_cover_candidates SET status='selected', display_eligible=true WHERE submitted_by_user_id=%L$q$, u1), 'deny');
  PERFORM _t('user: set item active cover', format($q$UPDATE items SET active_cover_candidate_id=(SELECT id FROM item_cover_candidates LIMIT 1) WHERE id=%L$q$, nocover), 'deny');
  PERFORM _t('user: update items.body', format($q$UPDATE items SET body=body WHERE id=%L$q$, nocover), 'deny');
  FOREACH c IN ARRAY PROT LOOP
    PERFORM _t('user: UPDATE users.'||c, format($q$UPDATE users SET %I=%I WHERE id=%L$q$, c, c, u1), 'deny');
  END LOOP;
  PERFORM _t('user: SET is_admin=true (the exploit)', format($q$UPDATE users SET is_admin=true WHERE id=%L$q$, u1), 'deny');
  FOREACH c IN ARRAY ALLOWED LOOP
    PERFORM _t('user: UPDATE users.'||c||' (legit)', format($q$UPDATE users SET %I=%I WHERE id=%L$q$, c, c, u1), 'ok');
  END LOOP;
  PERFORM _t('user: lifetime_points write still fires tier trigger', format($q$UPDATE users SET lifetime_points=lifetime_points WHERE id=%L$q$, u1), 'ok');
  PERFORM _t('user: update ANOTHER user profile', format($q$UPDATE users SET display_name=display_name WHERE id=%L$q$, u2), 'deny');
  PERFORM _t('user: INSERT users row', format($q$INSERT INTO users(id,display_name,email,is_admin) VALUES (gen_random_uuid(),'x','y@y',true)$q$), 'deny');
  PERFORM _t('user: DELETE own users row', format($q$DELETE FROM users WHERE id=%L$q$, u1), 'deny');
  PERFORM _t('user: add self to photo_admins', format($q$INSERT INTO photo_admins(user_id) VALUES (%L)$q$, u1), 'deny');
  PERFORM _t('user: read photo_admins', 'SELECT * FROM photo_admins', 'deny');
  PERFORM _t('user: is_photo_admin() answers false', 'SELECT 1 WHERE is_photo_admin() = false', 'ok');
  PERFORM _t('user: admin_publish_item_photo', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, nocover, 'cover-candidates/'||u1||'/m.jpg'), 'deny');
  PERFORM _t('user: definer fn (server path) still updates protected cols', 'SELECT _def_update()', 'ok');
  RESET ROLE;
  SELECT status, display_eligible, is_primary INTO st, de, pr FROM item_cover_candidates WHERE storage_path='cover-candidates/'||u1||'/n.jpg';
  PERFORM set_config('chk.out', current_setting('chk.out')||'STATE legit user row = '||st||'/display_eligible='||de||'/primary='||pr||E'\n', true);
  SELECT (is_admin=false) INTO ok FROM users WHERE id=u1;
  PERFORM set_config('chk.out', current_setting('chk.out')||'STATE user still not admin = '||ok||E'\n', true);

  -- ================= PHOTO ADMIN (jerry granted via service/manual SQL) =================
  INSERT INTO photo_admins(user_id, granted_by, note) VALUES (jerry, jerry, 'test grant');
  PERFORM set_config('request.jwt.claims', json_build_object('sub',jerry,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM _t('photoadmin: is_photo_admin() true', 'SELECT 1 WHERE is_photo_admin()', 'ok');
  PERFORM _t('photoadmin: other user path', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, nocover, 'cover-candidates/'||u1||'/m.jpg'), 'deny');
  PERFORM _t('photoadmin: missing file', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, nocover, 'cover-candidates/'||jerry||'/missing.jpg'), 'deny');
  PERFORM _t('photoadmin: empty-cover item', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, nocover, 'cover-candidates/'||jerry||'/a.jpg'), 'ok');
  PERFORM _t('photoadmin: existing-cover item', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, cover_item, 'cover-candidates/'||jerry||'/b.jpg'), 'ok');
  PERFORM _t('photoadmin: SECRET item (Baba)', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, secret_item, 'cover-candidates/'||jerry||'/c.jpg'), 'ok');
  PERFORM _t('photoadmin: duplicate file', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, secret_item, 'cover-candidates/'||jerry||'/c.jpg'), 'deny');
  PERFORM _t('photoadmin: read photo_admins directly', 'SELECT * FROM photo_admins', 'deny');
  RESET ROLE;
  SELECT status, display_eligible, is_primary INTO st, de, pr FROM item_cover_candidates WHERE storage_path='cover-candidates/'||jerry||'/a.jpg';
  SELECT (active_cover_candidate_id=(SELECT id FROM item_cover_candidates WHERE storage_path='cover-candidates/'||jerry||'/a.jpg')) INTO ok FROM items WHERE id=nocover;
  PERFORM set_config('chk.out', current_setting('chk.out')||'STATE empty-cover item: row='||st||'/'||de||'/'||pr||' pointer_set='||ok||E'\n', true);
  SELECT status, display_eligible, is_primary INTO st, de, pr FROM item_cover_candidates WHERE storage_path='cover-candidates/'||jerry||'/b.jpg';
  SELECT (active_cover_candidate_id=old_active) INTO ok FROM items WHERE id=cover_item;
  PERFORM set_config('chk.out', current_setting('chk.out')||'STATE existing-cover item: new row='||st||'/'||de||'/'||pr||' old_active_kept='||ok||' old_primary_kept='||coalesce((SELECT (id=old_primary)::text FROM item_cover_candidates WHERE item_id=cover_item AND is_primary),'n/a')||E'\n', true);
  SELECT secret_business_photo_storage_path INTO biz_after FROM items WHERE id=secret_item;
  SELECT (active_cover_candidate_id IS NOT NULL) INTO ok FROM items WHERE id=secret_item;
  PERFORM set_config('chk.out', current_setting('chk.out')||'STATE secret item: got_cover='||ok||' business_photo_untouched='||(biz_before IS NOT DISTINCT FROM biz_after)||E'\n', true);

  -- a user who is ONLY a photo admin (not is_admin) gets no general admin powers from the capability
  INSERT INTO photo_admins(user_id) VALUES (u2);
  INSERT INTO storage.objects(bucket_id,name) VALUES ('submission-photos','cover-candidates/'||u2||'/z.jpg');
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM _t('photo-admin-only user: can publish', format($q$SELECT admin_publish_item_photo(%L,%L)$q$, cover_item, 'cover-candidates/'||u2||'/z.jpg'), 'ok');
  PERFORM _t('photo-admin-only user: still cannot set is_admin', format($q$UPDATE users SET is_admin=true WHERE id=%L$q$, u2), 'deny');
  PERFORM _t('photo-admin-only user: still cannot edit items', format($q$UPDATE items SET body=body WHERE id=%L$q$, nocover), 'deny');
  PERFORM _t('photo-admin-only user: cannot read photo_admins', 'SELECT * FROM photo_admins', 'deny');
  RESET ROLE;

  -- ================= GENERAL ADMIN (jerry, is_admin) =================
  PERFORM set_config('request.jwt.claims', json_build_object('sub',jerry,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM _t('admin: update items', format($q$UPDATE items SET body=body WHERE id=%L$q$, nocover), 'ok');
  PERFORM _t('admin: update item_cover_candidates (moderate)', format($q$UPDATE item_cover_candidates SET rejection_reason=rejection_reason WHERE submitted_by_user_id=%L$q$, u1), 'ok');
  PERFORM _t('admin: read others'' candidates', format($q$SELECT * FROM item_cover_candidates WHERE submitted_by_user_id=%L$q$, u1), 'ok');
  PERFORM _t('admin: admin_recent_signups()', 'SELECT * FROM admin_recent_signups()', 'ok');
  PERFORM _t('admin: update feature_flags', 'UPDATE feature_flags SET description=description WHERE key=(SELECT key FROM feature_flags LIMIT 1)', 'ok');
  PERFORM _t('admin: edit own profile', format($q$UPDATE users SET display_name=display_name WHERE id=%L$q$, jerry), 'ok');
  PERFORM _t('admin: normal submission still works', format($q$INSERT INTO item_cover_candidates(item_id,submitted_by_user_id,storage_path,status,consent_ack) VALUES (%L,%L,'adm-legit','needs_review',true)$q$, nocover, jerry), 'ok');
  PERFORM _t('admin: cannot flip is_admin via API (service role only now)', format($q$UPDATE users SET is_admin=is_admin WHERE id=%L$q$, jerry), 'deny');
  RESET ROLE;

  -- ================= SERVICE ROLE (Admin tool / edge functions) =================
  SET LOCAL ROLE service_role;
  PERFORM _t('service_role: update users.is_admin', format($q$UPDATE users SET is_admin=is_admin WHERE id=%L$q$, jerry), 'ok');
  PERFORM _t('service_role: update protected users cols', format($q$UPDATE users SET is_pro=is_pro, insider_tier=insider_tier, current_streak=current_streak WHERE id=%L$q$, u1), 'ok');
  PERFORM _t('service_role: moderate candidates (status/display)', format($q$UPDATE item_cover_candidates SET status=status, display_eligible=display_eligible WHERE submitted_by_user_id=%L$q$, u1), 'ok');
  PERFORM _t('service_role: insert approved candidate (token flow)', format($q$INSERT INTO item_cover_candidates(item_id,source,storage_path,status,consent_ack,submitted_by_token_id) VALUES (%L,'business_submission','svc1','approved',true,NULL)$q$, nocover), 'ok');
  PERFORM _t('service_role: manage photo_admins', format($q$INSERT INTO photo_admins(user_id) VALUES (%L) ON CONFLICT DO NOTHING$q$, jerry), 'ok');
  RESET ROLE;

  o := current_setting('chk.out');
  RAISE EXCEPTION E'MATRIX_RESULT\n%', o;
END $$;
