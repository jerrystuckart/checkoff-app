-- ROLLBACK for migration 20261008d (rev 4). Apply ONLY if the deletion pipeline must be backed out after it was applied.
-- Restores the original delete_my_account() body (the version captured 2026-10-08 before the migration), removes the new functions and the cron job.
-- It does NOT drop the three tables (account_deletion_requests, anonymous_completion_counts, retained_checkin_photos): they may hold real anonymous counts,
-- retained photo records and in flight deletion state. Drop them by hand only after reading them (commented statements at the end). No CASCADE anywhere.
-- Moved photos keep working: item_cover_candidates.storage_path was updated together with each move.
-- NOTE: restoring the old body brings back its original defect (it fails for users who have interaction_events rows). In flight requests stay in
-- account_deletion_requests; users whose access was already blocked (banned) stay banned until their request completes or you clear banned_until.
begin;

-- 1. stop the processor
do $$ begin
  if exists (select 1 from cron.job where jobname = 'process-account-deletions') then perform cron.unschedule('process-account-deletions'); end if;
end $$;

-- 2. restore the original function (same signature and return type, so CREATE OR REPLACE keeps owner and grants)
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

-- 3. remove the new functions (the wrapper no longer references v2 after step 2). Order matters for the two SQL language functions that call another.
drop function if exists public.delete_my_account_v2();
drop function if exists public.account_deletion_process();
drop function if exists public.account_deletion_delete_data(uuid);
drop function if exists public.account_deletion_inventory(uuid);
drop function if exists public.account_deletion_retain_inventory(uuid);
drop function if exists public.account_deletion_objects_remaining(uuid);
drop function if exists public.account_deletion_scrub_json(jsonb, uuid);
drop function if exists public.anonymous_completions_for_items(uuid[], date);

-- 4. the original ACL on the restored function (anon, authenticated, postgres, service_role)
grant execute on function public.delete_my_account() to anon, authenticated, service_role;

commit;

-- Optional, by hand, after inspecting the data:
--   select count(*) from public.account_deletion_requests where completed_at is null;   -- must be 0 before dropping
--   drop table public.account_deletion_requests;
--   drop table public.retained_checkin_photos;       -- retained photo records (the files stay in Storage)
--   drop table public.anonymous_completion_counts;   -- anonymous completion counts: dropping loses them permanently
