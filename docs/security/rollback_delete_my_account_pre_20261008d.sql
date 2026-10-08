-- Previous delete_my_account() body (captured 2026-10-08 before migration 20261008d). Restores the old, FK blocked behavior.
CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Anonymize the public.users row — preserve for partner metrics
  -- Email replaced with untraceable placeholder (not NULL) to satisfy NOT NULL constraint
  UPDATE public.users
  SET
    display_name  = 'Deleted User',
    email         = 'deleted-' || uid || '@deleted.checkoff',
    avatar_url    = NULL,
    is_deleted    = true,
    updated_at    = now()
  WHERE id = uid;

  -- Delete push tokens — no more notifications
  DELETE FROM public.push_tokens WHERE user_id = uid;

  -- Delete saved crew entries for and about this user
  DELETE FROM public.saved_crew
  WHERE user_id = uid OR crew_member_id = uid;

  -- Delete from auth.users — prevents sign-in
  DELETE FROM auth.users WHERE id = uid;

END;
$function$
;
