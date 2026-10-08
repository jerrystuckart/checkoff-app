-- STATUS 2026-10-08: written and tested, NOT YET APPLIED to production (the deploy step needs approval; see docs/release/ACCOUNT_DELETION.md).
-- 2026-10-08  Account deletion pipeline (iOS and Android share this one backend contract).
--
-- WHY: the previous delete_my_account() deleted auth.users and relied on ON DELETE CASCADE. Four NO ACTION foreign keys
-- (interaction_events.user_id, campaign_sends.user_id, partner_promotions.created_by, users.referred_by) plus creators.user_id
-- (auth.users, NO ACTION) make that statement fail for any user who has such rows (47 users have interaction events), and stored photo
-- files were never removed (deleting rows does not delete Storage files).
--
-- CONTRACT
--   client:  select public.delete_my_account()   -- identity is auth.uid(); no user id parameter exists
--     -> inventories the caller's Storage objects NOW (before any row that identifies them is removed), stores the manifest in
--        account_deletion_requests, bans the auth user and revokes every session (access stops immediately), kicks the processor,
--        returns {status:'completed'|'accepted', request_id}.  "accepted" is NOT "completed": it means access is blocked and cleanup is queued.
--   processor account_deletion_process() (service role / postgres only; no HTTP endpoint is exposed; runs once inside delete_my_account and then every
--   minute from pg_cron, so any step that failed is retried until it succeeds):
--        1. remove manifest files with the Storage API (pg_net DELETE with the service key from vault), verify none remain -> storage_done
--        2. account_deletion_delete_data(request_id): FK aware database deletion                                          -> data_done
--        3. delete the auth user                                                                                          -> completed (identifiers cleared)
--
-- DELETED:   profile, check ins (and their photos), notes, visits, recovery logs, interaction events, campaign send log, notification log,
--            push tokens, badges, saved items, saved crew, friendships, dares to/from the user, invite referrals, list memberships,
--            lists the user created that nobody else belongs to, the user's cover photo candidates (rows and files), the auth account.
-- ANONYMIZED: other users' content the user touched stays (items.submitted_by, list_items.added_by, item_flags.user_id, user_suggestions.user_id
--            become NULL); users.referred_by on other accounts becomes NULL; creators.user_id becomes NULL (creator profile detached from login).
-- TRANSFERRED: lists the user created that other members still use go to the longest standing other member.
-- REFUSED:   is_admin accounts (CheckOff staff) are removed by support.
-- ROLLBACK:  restore the previous function body from supabase/migrations (see docs/security) and drop account_deletion_* objects.

create table if not exists public.account_deletion_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,                                   -- cleared when completed so no identifier is kept
  status           text not null default 'accepted' check (status in ('accepted','storage_done','data_done','completed')),
  storage_manifest jsonb not null default '[]'::jsonb,     -- [{bucket,name}] inventoried at request time
  attempts         int  not null default 0,
  storage_request_ids bigint[],                            -- pg_net request ids of the last Storage API calls
  storage_requested_at timestamptz,
  last_error       text,
  requested_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
alter table public.account_deletion_requests enable row level security;   -- no policies: no client access at all
revoke all on public.account_deletion_requests from public, anon, authenticated;
create unique index if not exists account_deletion_one_open_request on public.account_deletion_requests (user_id)
  where completed_at is null and user_id is not null;

-- Everything the user owns in Storage, derived from verified ownership only:
--   * objects uploaded by the user (storage.objects.owner_id)
--   * objects under the user's own prefix in checkin-photos (path starts with '<uid>/')
--   * check in photo URLs of the user's own check_ins that point into checkin-photos under the user's prefix
--   * cover candidate files recorded against the user's own item_cover_candidates rows (cover-candidates/ or business-submissions/ only)
create or replace function public.account_deletion_inventory(p_uid uuid)
returns jsonb language sql security definer set search_path = public, storage as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', bucket, 'name', name)), '[]'::jsonb) from (
    select o.bucket_id as bucket, o.name from storage.objects o where o.owner_id = p_uid::text
    union
    select o.bucket_id, o.name from storage.objects o where o.bucket_id = 'checkin-photos' and o.name like p_uid::text || '/%'
    union
    select 'checkin-photos', substring(c.photo_url from '/storage/v1/object/(?:public|sign)/checkin-photos/([^?]+)')
      from public.check_ins c
     where c.user_id = p_uid and c.photo_url like '%/checkin-photos/' || p_uid::text || '/%'
    union
    select 'submission-photos', k.storage_path from public.item_cover_candidates k
     where k.submitted_by_user_id = p_uid and k.storage_path ~ '^(cover-candidates|business-submissions)/'
  ) x where name is not null and name <> '';
$$;

create or replace function public.account_deletion_objects_remaining(p_request uuid)
returns int language sql security definer set search_path = public, storage as $$
  select count(*)::int
    from public.account_deletion_requests r
    cross join lateral jsonb_to_recordset(r.storage_manifest) as m(bucket text, name text)
    join storage.objects o on o.bucket_id = m.bucket and o.name = m.name
   where r.id = p_request;
$$;

create or replace function public.account_deletion_process()
returns jsonb language plpgsql security definer set search_path = public, auth, storage, vault, net as $$
declare
  r public.account_deletion_requests%rowtype; k text; remaining int; ids bigint[]; b record; i int; err text;
  base constant text := 'https://uggusbbswybyplypkbxz.supabase.co';
  done_n int := 0; pending_n int := 0;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  for r in select * from public.account_deletion_requests where completed_at is null order by requested_at limit 10 loop
    begin
      if r.status = 'accepted' then
        remaining := public.account_deletion_objects_remaining(r.id);
        if remaining = 0 then
          update public.account_deletion_requests set status = 'storage_done', last_error = null, updated_at = now() where id = r.id;
          r.status := 'storage_done';
        else
          -- surface what the previous Storage API call answered
          if r.storage_request_ids is not null then
            select string_agg(coalesce(h.status_code::text, 'no response') || ' ' || left(coalesce(h.content, h.error_msg, ''), 100), '; ')
              into err from net._http_response h
             where h.id = any (r.storage_request_ids) and (h.status_code is null or h.status_code not between 200 and 299 or h.timed_out);
          end if;
          if k is null then raise exception 'service key unavailable in vault'; end if;
          if r.storage_requested_at is null or r.storage_requested_at < now() - interval '90 seconds' then
            ids := '{}';
            for b in
              select m.bucket, array_agg(m.name order by m.name) as names
                from jsonb_to_recordset(r.storage_manifest) as m(bucket text, name text)
                join storage.objects o on o.bucket_id = m.bucket and o.name = m.name
               group by m.bucket
            loop
              for i in 0 .. ((array_length(b.names, 1) - 1) / 100) loop
                ids := ids || net.http_delete(
                  url := base || '/storage/v1/object/' || b.bucket,
                  headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
                  body := jsonb_build_object('prefixes', to_jsonb(b.names[(i * 100 + 1):(i * 100 + 100)])),
                  timeout_milliseconds := 30000);
              end loop;
            end loop;
            update public.account_deletion_requests
               set storage_request_ids = ids, storage_requested_at = now(), attempts = attempts + 1,
                   last_error = coalesce(err, last_error), updated_at = now()
             where id = r.id;
          end if;
          pending_n := pending_n + 1;
          continue;   -- verify on the next tick, after the Storage API has answered
        end if;
      end if;

      if r.status = 'storage_done' then
        perform public.account_deletion_delete_data(r.id);
        r.status := 'data_done';
      end if;

      if r.status = 'data_done' then
        delete from auth.users where id = r.user_id;   -- cascades identities, sessions, refresh tokens
        update public.account_deletion_requests
           set status = 'completed', user_id = null, storage_manifest = '[]'::jsonb, storage_request_ids = null,
               last_error = null, completed_at = now(), updated_at = now()
         where id = r.id;
        done_n := done_n + 1;
      end if;
    exception when others then
      update public.account_deletion_requests set attempts = attempts + 1, last_error = left(sqlerrm, 300), updated_at = now() where id = r.id;
      pending_n := pending_n + 1;
    end;
  end loop;
  return jsonb_build_object('completed', done_n, 'pending', pending_n);
end $$;

-- FK aware database deletion. Runs only for an open request whose files are already removed.
create or replace function public.account_deletion_delete_data(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid; v_status text; v_new_owner uuid; l record;
  n_lists_deleted int := 0; n_lists_moved int := 0; n_events int; n_sends int; n_notif int;
begin
  select user_id, status into v_uid, v_status from public.account_deletion_requests where id = p_request and completed_at is null;
  if v_uid is null then raise exception 'No open deletion request %', p_request; end if;
  if v_status not in ('storage_done','data_done') then raise exception 'Storage cleanup is not complete for request %', p_request; end if;
  if exists (select 1 from public.users where id = v_uid and is_admin) then raise exception 'Administrator accounts are removed by support'; end if;

  -- 1. Lists the user created: keep them for anyone who still uses them, delete the rest.
  for l in select id, is_official from public.lists where creator_id = v_uid loop
    select m.user_id into v_new_owner from public.list_members m
     where m.list_id = l.id and m.user_id <> v_uid order by m.joined_at, m.id limit 1;
    if v_new_owner is not null then
      update public.lists set creator_id = v_new_owner where id = l.id;  n_lists_moved := n_lists_moved + 1;
    elsif l.is_official or exists (select 1 from public.destination_lists d where d.list_id = l.id)
                        or exists (select 1 from public.destination_zones z where z.list_id = l.id) then
      update public.lists set creator_id = (select id from public.users where is_admin order by created_at limit 1) where id = l.id;
      n_lists_moved := n_lists_moved + 1;
    else
      delete from public.lists where id = l.id;  n_lists_deleted := n_lists_deleted + 1;
    end if;
  end loop;

  -- 2. The NO ACTION foreign keys, handled deliberately.
  delete from public.interaction_events where user_id = v_uid;  get diagnostics n_events = row_count;
  delete from public.campaign_sends     where user_id = v_uid;  get diagnostics n_sends  = row_count;
  delete from public.notification_log   where user_id = v_uid;  get diagnostics n_notif  = row_count;
  update public.users              set referred_by = null where referred_by = v_uid;
  update public.partner_promotions set created_by  = null where created_by  = v_uid;
  update public.creators           set user_id     = null where user_id     = v_uid;

  -- 3. The profile row. Everything else the user owns cascades from here (check_ins, candidate_visits, visit_*, push_tokens, ...);
  --    other users' content that merely references the user is set to NULL by its own foreign key.
  delete from public.users where id = v_uid;

  update public.account_deletion_requests set status = 'data_done', updated_at = now() where id = p_request;
  return jsonb_build_object('lists_deleted', n_lists_deleted, 'lists_transferred', n_lists_moved,
                            'interaction_events', n_events, 'campaign_sends', n_sends, 'notification_log', n_notif);
end $$;

-- Client facing entry point. Same name as before so every installed iOS and Android build keeps working.
create or replace function public.delete_my_account()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid(); v_req public.account_deletion_requests%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if exists (select 1 from public.users where id = v_uid and is_admin) then
    raise exception 'Administrator accounts are removed by CheckOff support. Email support@getcheckoff.com.' using errcode = 'P0001';
  end if;

  select * into v_req from public.account_deletion_requests where user_id = v_uid and completed_at is null;
  if found then
    perform public.account_deletion_process();
    return jsonb_build_object('status', 'accepted', 'request_id', v_req.id, 'already_requested', true);
  end if;

  insert into public.account_deletion_requests (user_id, storage_manifest)
  values (v_uid, public.account_deletion_inventory(v_uid))     -- inventory BEFORE any row is removed
  returning * into v_req;

  -- Stop all access now: ban the auth user and revoke every session and refresh token.
  update auth.users set banned_until = now() + interval '100 years' where id = v_uid;
  delete from auth.sessions where user_id = v_uid;
  delete from public.push_tokens where user_id = v_uid;         -- no more notifications immediately

  perform public.account_deletion_process();   -- an account with no stored files completes right here; otherwise cron finishes it
  return jsonb_build_object(
    'status', case when exists (select 1 from public.account_deletion_requests where id = v_req.id and completed_at is not null) then 'completed' else 'accepted' end,
    'request_id', v_req.id, 'already_requested', false);
end $$;

-- Privileges: clients may call only delete_my_account (signed in). Everything else is service role only.
revoke all on function public.account_deletion_inventory(uuid)       from public, anon, authenticated;
revoke all on function public.account_deletion_objects_remaining(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_process()             from public, anon, authenticated;
revoke all on function public.account_deletion_delete_data(uuid)     from public, anon, authenticated;
grant execute on function public.account_deletion_inventory(uuid), public.account_deletion_objects_remaining(uuid),
                          public.account_deletion_process(), public.account_deletion_delete_data(uuid) to service_role;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated, service_role;

-- Resume anything that is not finished (every minute; a no-op when nothing is open), and drop finished request rows after 30 days.
select cron.schedule('process-account-deletions', '* * * * *',
  $$select public.account_deletion_process(); delete from public.account_deletion_requests where completed_at < now() - interval '30 days';$$);
