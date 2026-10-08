-- STATUS 2026-10-08 (rev 2): written, NOT YET APPLIED to production. Supersedes rev 1 (commit 21c7dec). See docs/release/ACCOUNT_DELETION.md.
--
-- Account deletion pipeline (iOS and Android share this one backend contract).
--
-- WHY: the previous delete_my_account() deleted auth.users and relied on ON DELETE CASCADE. Four NO ACTION foreign keys
-- (interaction_events.user_id, campaign_sends.user_id, partner_promotions.created_by, users.referred_by) plus creators.user_id
-- (auth.users, NO ACTION) make that statement fail for any user who has such rows (47 users have interaction events), and stored
-- files were never handled (deleting rows does not delete Storage files).
--
-- PRODUCT DECISIONS (Jerry, 2026-10-08)
--   * Photos a user SUBMITTED AS CHECKOFF CONTENT (item_cover_candidates: catalog covers, approved and pending candidates, business photos) are RETAINED.
--     They lose their account attribution: submitted_by_user_id -> NULL, the file is moved to a neutral path (the old path embeds the uploader id),
--     storage owner / owner_id are cleared, and any occurrence of the user id in moderation_metadata / rejection_reason is scrubbed.
--     REJECTED candidates were never accepted as content, so they are deleted with the account (one condition below; flip it to retain them too).
--   * Private account files are DELETED: check in photos (checkin-photos/<uid>/...) and any other object the user owns. users.avatar_url is NULL for every
--     user and there is no avatar bucket, so there are no avatar files; an avatar object a user ever owned would be caught by the owner_id rule.
--   * Admin accounts can be deleted unless the account is the ONLY administrator (or the only photo administrator): the user is told what to do first.
--   * COMPLETED CHECKOFF HISTORY is kept only as anonymous counts: public.anonymous_completion_counts holds, per experience (item), per calendar month
--     and coarse method, how many confirmed CheckOffs deleted accounts completed. It has no user id, no profile link, no list or list item, no check in id,
--     no candidate or presence session link, no coordinates, no notes, no photo, no day. Nothing is a stable key for a person. Only confirmed check ins are counted;
--     detected visits, geofence sessions and pending or dismissed suggestions never are. The business association is the item's partner_id at report time.
--
-- CONTRACT
--   client:  select public.delete_my_account()   -- identity is auth.uid(); no user id parameter exists
--     -> inventories (BEFORE any row is removed) what to retain and what to delete, blocks access (ban + sessions revoked), runs the processor once,
--        returns {status:'completed'|'accepted', request_id}.  "accepted" is NOT "completed": access is blocked and cleanup is queued.
--   processor account_deletion_process() (postgres / service role only; no HTTP endpoint; once inside delete_my_account, then every minute from pg_cron):
--        accepted         -> move retained photos to neutral paths (Storage API move via pg_net), verify, then anonymize their rows
--        content_retained -> delete private files (Storage API bulk delete via pg_net), verify none remain
--        storage_done     -> account_deletion_delete_data(): ONE transaction that records the anonymous counts exactly once and deletes the database records
--        data_done        -> delete the auth user, clear identifiers on the request row
--   Every step is persisted and idempotent, so any failure resumes on the next tick. "completed" is only set after the auth user is gone.
--
-- DELETED:    profile, check ins and their photos and notes, visits, recovery logs, interaction events, campaign send log, notification log, push tokens, badges,
--             saved items and crew, friendships, dares to or from the user, referrals, list memberships, lists nobody else uses, rejected photo candidates, the auth account.
-- RETAINED:   submitted CheckOff photos (anonymized, see above); anonymous completion counts; other members' check ins and content.
-- ANONYMIZED: items.submitted_by, list_items.added_by, item_flags.user_id, user_suggestions.user_id; users.referred_by on other accounts; creators.user_id.
-- TRANSFERRED: lists other members still use go to the longest standing other member.
-- ROLLBACK:   docs/security/rollback_delete_my_account_pre_20261008d.sql restores the previous function; then drop account_deletion_* objects and
--             select cron.unschedule('process-account-deletions'). Moved photos keep working (storage_path was updated with the move). anonymous_completion_counts is
--             additive and harmless to keep.

create table if not exists public.account_deletion_requests (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid,                                   -- cleared when completed so no identifier is kept
  status               text not null default 'accepted'
                         check (status in ('accepted','content_retained','storage_done','data_done','completed')),
  retain_manifest      jsonb not null default '[]'::jsonb,     -- [{candidate_id, bucket, from, to}] submitted photos that stay
  storage_manifest     jsonb not null default '[]'::jsonb,     -- [{bucket, name}] private files that are deleted
  counts_recorded      boolean not null default false,         -- anonymous counts written for this request (guards against double counting)
  storage_request_ids  bigint[],                               -- pg_net request ids of the last Storage API calls
  storage_requested_at timestamptz,
  attempts             int  not null default 0,
  last_error           text,
  requested_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz
);
alter table public.account_deletion_requests enable row level security;   -- no policies: no client access at all
revoke all on public.account_deletion_requests from public, anon, authenticated;
create unique index if not exists account_deletion_one_open_request on public.account_deletion_requests (user_id)
  where completed_at is null and user_id is not null;

-- Anonymous reporting record: CONFIRMED CheckOffs completed by accounts that were later deleted. Read by reporting (service role) only.
create table if not exists public.anonymous_completion_counts (
  item_id      uuid not null references public.items(id) on delete cascade,   -- the experience; the business is items.partner_id
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  method       text not null check (method in ('tap','photo','confirmed_suggestion','retroactive')),
  completions  int  not null check (completions > 0),
  primary key (item_id, period_month, method)
);
comment on table public.anonymous_completion_counts is
  'Counts of confirmed CheckOffs by deleted accounts, per experience and calendar month. Deliberately has no user, list, check in, candidate, session, coordinate, note or photo columns. Never holds detected visits or suggestions.';
alter table public.anonymous_completion_counts enable row level security;
revoke all on public.anonymous_completion_counts from public, anon, authenticated;
grant select on public.anonymous_completion_counts to service_role;

-- Reporting helper (service role): completions by deleted accounts for a set of experiences, optionally for one calendar month.
create or replace function public.anonymous_completions_for_items(p_item_ids uuid[], p_month date default null)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(completions), 0)::bigint from public.anonymous_completion_counts
   where item_id = any (p_item_ids) and (p_month is null or period_month = date_trunc('month', p_month)::date);
$$;

-- Submitted CheckOff photos that are kept, with the neutral path each one moves to. Only candidates whose file really exists and that were not rejected.
create or replace function public.account_deletion_retain_inventory(p_uid uuid)
returns jsonb language sql security definer set search_path = public, storage as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'candidate_id', k.id,
           'bucket', 'submission-photos',
           'from', k.storage_path,
           'to', case when k.storage_path like '%' || p_uid::text || '%'
                      then split_part(k.storage_path, '/', 1) || '/retained/' || k.id::text
                           || coalesce('.' || nullif(lower(substring(k.storage_path from '\.([A-Za-z0-9]{1,5})$')), ''), '')
                      else k.storage_path end)), '[]'::jsonb)
    from public.item_cover_candidates k
   where k.submitted_by_user_id = p_uid
     and k.status <> 'rejected'                                    -- REJECTED photos were never accepted as content: they are deleted instead
     and k.storage_path ~ '^(cover-candidates|business-submissions)/'
     and exists (select 1 from storage.objects o where o.bucket_id = 'submission-photos' and o.name = k.storage_path);
$$;

-- Private files to delete: everything the user owns or stored under their own prefix, check in photos of their own check ins, and their rejected
-- candidates' files, MINUS anything that is being retained.
create or replace function public.account_deletion_inventory(p_uid uuid)
returns jsonb language sql security definer set search_path = public, storage as $$
  with retained as (
    select r->>'from' as name from jsonb_array_elements(public.account_deletion_retain_inventory(p_uid)) r
  ), found as (
    select o.bucket_id as bucket, o.name from storage.objects o where o.owner_id = p_uid::text
    union
    select o.bucket_id, o.name from storage.objects o where o.bucket_id = 'checkin-photos' and o.name like p_uid::text || '/%'
    union
    select 'checkin-photos', substring(c.photo_url from '/storage/v1/object/(?:public|sign)/checkin-photos/([^?]+)')
      from public.check_ins c
     where c.user_id = p_uid and c.photo_url like '%/checkin-photos/' || p_uid::text || '/%'
    union
    select 'submission-photos', k.storage_path from public.item_cover_candidates k
     where k.submitted_by_user_id = p_uid and k.status = 'rejected' and k.storage_path ~ '^(cover-candidates|business-submissions)/'
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', f.bucket, 'name', f.name)), '[]'::jsonb)
    from found f
   where f.name is not null and f.name <> '' and not (f.bucket = 'submission-photos' and f.name in (select name from retained));
$$;

create or replace function public.account_deletion_objects_remaining(p_request uuid)
returns int language sql security definer set search_path = public, storage as $$
  select count(*)::int
    from public.account_deletion_requests r
    cross join lateral jsonb_to_recordset(r.storage_manifest) as m(bucket text, name text)
    join storage.objects o on o.bucket_id = m.bucket and o.name = m.name
   where r.id = p_request;
$$;

-- Remove every occurrence of the user id from a json document (moderation notes etc.).
create or replace function public.account_deletion_scrub_json(p_doc jsonb, p_uid uuid)
returns jsonb language sql immutable as $$
  select case when p_doc is null then null else replace(p_doc::text, p_uid::text, 'removed')::jsonb end;
$$;

-- FK aware database deletion. Runs only for an open request whose retained photos are anonymized and private files are removed.
-- One transaction: the anonymous counts and the deletion of the rows they were computed from commit together, or neither does.
create or replace function public.account_deletion_delete_data(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid; v_status text; v_counted boolean; v_new_owner uuid; l record; v_fallback_admin uuid;
  n_lists_deleted int := 0; n_lists_moved int := 0; n_events int; n_sends int; n_notif int; n_counted int := 0;
begin
  select user_id, status, counts_recorded into v_uid, v_status, v_counted
    from public.account_deletion_requests where id = p_request and completed_at is null for update;
  if v_uid is null then raise exception 'No open deletion request %', p_request; end if;
  if v_status not in ('storage_done','data_done') then raise exception 'Cleanup is not complete for request %', p_request; end if;
  -- Defense in depth: never remove the last administrator or the last photo administrator.
  if exists (select 1 from public.users where id = v_uid and is_admin) and (select count(*) from public.users where is_admin) <= 1 then
    raise exception 'This is the only administrator account';
  end if;
  if exists (select 1 from public.photo_admins where user_id = v_uid) and (select count(*) from public.photo_admins) <= 1 then
    raise exception 'This is the only photo administrator account';
  end if;
  select id into v_fallback_admin from public.users where is_admin and id <> v_uid order by created_at limit 1;

  -- 0. Anonymous completion counts, exactly once. One qualifying completion = one confirmed check in per experience per day (fan out mirror rows on other
  --    lists are the same real action). Only confirmed check ins are read: candidate_visits, presence sessions and suggestions are never counted.
  if not v_counted then
    with real as (
      select coalesce(c.item_id, li.item_id) as item_id,
             (c.checked_at at time zone 'UTC')::date as d,
             (array_agg(case when c.verification_method = 'historical_visit_confirmed' then 'confirmed_suggestion'
                             when c.verification_method = 'trip_list_retroactive'      then 'retroactive'
                             when c.photo_url is not null                              then 'photo'
                             else 'tap' end
                         order by case when c.verification_method = 'historical_visit_confirmed' then 1
                                       when c.verification_method = 'trip_list_retroactive'      then 2
                                       when c.photo_url is not null                              then 3 else 4 end))[1] as method
        from public.check_ins c left join public.list_items li on li.id = c.list_item_id
       where c.user_id = v_uid and coalesce(c.item_id, li.item_id) is not null
       group by 1, 2
    ), monthly as (
      select r.item_id, date_trunc('month', r.d)::date as period_month, r.method, count(*)::int as completions
        from real r join public.items i on i.id = r.item_id
       group by 1, 2, 3
    )
    insert into public.anonymous_completion_counts (item_id, period_month, method, completions)
    select item_id, period_month, method, completions from monthly
    on conflict (item_id, period_month, method) do update set completions = public.anonymous_completion_counts.completions + excluded.completions;
    get diagnostics n_counted = row_count;
    update public.account_deletion_requests set counts_recorded = true where id = p_request;
  end if;

  -- 1. Lists the user created: keep them for anyone who still uses them, delete the rest.
  for l in select id, is_official from public.lists where creator_id = v_uid loop
    select m.user_id into v_new_owner from public.list_members m
     where m.list_id = l.id and m.user_id <> v_uid order by m.joined_at, m.id limit 1;
    if v_new_owner is not null then
      update public.lists set creator_id = v_new_owner where id = l.id;  n_lists_moved := n_lists_moved + 1;
    elsif v_fallback_admin is not null and (l.is_official or exists (select 1 from public.destination_lists d where d.list_id = l.id)
                                                       or exists (select 1 from public.destination_zones z where z.list_id = l.id)) then
      update public.lists set creator_id = v_fallback_admin where id = l.id;  n_lists_moved := n_lists_moved + 1;
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

  -- 3. The profile row. Everything else the user owns cascades from here (check_ins, candidate_visits, visit_*, push_tokens, rejected candidates ...).
  --    Retained photo candidates no longer reference the user (anonymized earlier), so they survive. Other users' content that merely references the
  --    user is set to NULL by its own foreign key.
  delete from public.users where id = v_uid;

  update public.account_deletion_requests set status = 'data_done', updated_at = now() where id = p_request;
  return jsonb_build_object('lists_deleted', n_lists_deleted, 'lists_transferred', n_lists_moved, 'anonymous_count_cells', n_counted,
                            'interaction_events', n_events, 'campaign_sends', n_sends, 'notification_log', n_notif);
end $$;

-- The processor.
create or replace function public.account_deletion_process()
returns jsonb language plpgsql security definer set search_path = public, auth, storage, vault, net as $$
declare
  r public.account_deletion_requests%rowtype; k text; remaining int; ids bigint[]; b record; e record; i int; err text; pending_moves int;
  base constant text := 'https://uggusbbswybyplypkbxz.supabase.co';
  hdr jsonb; done_n int := 0; pending_n int := 0;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  hdr := jsonb_build_object('Authorization', 'Bearer ' || coalesce(k, ''), 'Content-Type', 'application/json');
  for r in select * from public.account_deletion_requests where completed_at is null order by requested_at limit 10 loop
    begin
      -- A. retained photos: move to neutral paths, verify, then anonymize their rows
      if r.status = 'accepted' then
        select count(*) into pending_moves
          from jsonb_to_recordset(r.retain_manifest) as m(candidate_id uuid, bucket text, "from" text, "to" text)
         where m."from" <> m."to"
           and not exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = m."to");
        if pending_moves > 0 then
          if r.storage_request_ids is not null then
            select string_agg(coalesce(h.status_code::text, 'no response') || ' ' || left(coalesce(h.content, h.error_msg, ''), 100), '; ')
              into err from net._http_response h
             where h.id = any (r.storage_request_ids) and (h.status_code is null or h.status_code not between 200 and 299 or h.timed_out);
          end if;
          if k is null then raise exception 'service key unavailable in vault'; end if;
          if r.storage_requested_at is null or r.storage_requested_at < now() - interval '90 seconds' then
            ids := '{}';
            for e in
              select m.bucket, m."from", m."to"
                from jsonb_to_recordset(r.retain_manifest) as m(candidate_id uuid, bucket text, "from" text, "to" text)
               where m."from" <> m."to"
                 and exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = m."from")
                 and not exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = m."to")
            loop
              ids := ids || net.http_post(url := base || '/storage/v1/object/move', headers := hdr, timeout_milliseconds := 30000,
                                          body := jsonb_build_object('bucketId', e.bucket, 'sourceKey', e."from", 'destinationKey', e."to"));
            end loop;
            update public.account_deletion_requests
               set storage_request_ids = ids, storage_requested_at = now(), attempts = attempts + 1, last_error = coalesce(err, last_error), updated_at = now()
             where id = r.id;
          end if;
          pending_n := pending_n + 1;
          continue;   -- verify on the next tick, after the Storage API has answered
        end if;
        -- every retained file is at its neutral path: attribute nothing to the account any more
        update public.item_cover_candidates c
           set storage_path = m."to", submitted_by_user_id = null,
               moderation_metadata = public.account_deletion_scrub_json(c.moderation_metadata, r.user_id),
               rejection_reason = replace(c.rejection_reason, r.user_id::text, 'removed')
          from jsonb_to_recordset(r.retain_manifest) as m(candidate_id uuid, bucket text, "from" text, "to" text)
         where c.id = m.candidate_id and c.submitted_by_user_id = r.user_id;
        update storage.objects o set owner = null, owner_id = null
          from jsonb_to_recordset(r.retain_manifest) as m(candidate_id uuid, bucket text, "from" text, "to" text)
         where o.bucket_id = m.bucket and o.name = m."to";
        update public.account_deletion_requests
           set status = 'content_retained', storage_request_ids = null, storage_requested_at = null, last_error = null, updated_at = now()
         where id = r.id;
        r.status := 'content_retained';
      end if;

      -- B. private files: delete and verify
      if r.status = 'content_retained' then
        remaining := public.account_deletion_objects_remaining(r.id);
        if remaining = 0 then
          update public.account_deletion_requests set status = 'storage_done', last_error = null, updated_at = now() where id = r.id;
          r.status := 'storage_done';
        else
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
                ids := ids || net.http_delete(url := base || '/storage/v1/object/' || b.bucket, headers := hdr, timeout_milliseconds := 30000,
                                              body := jsonb_build_object('prefixes', to_jsonb(b.names[(i * 100 + 1):(i * 100 + 100)])));
              end loop;
            end loop;
            update public.account_deletion_requests
               set storage_request_ids = ids, storage_requested_at = now(), attempts = attempts + 1, last_error = coalesce(err, last_error), updated_at = now()
             where id = r.id;
          end if;
          pending_n := pending_n + 1;
          continue;
        end if;
      end if;

      if r.status = 'storage_done' then
        perform public.account_deletion_delete_data(r.id);
        r.status := 'data_done';
      end if;

      if r.status = 'data_done' then
        delete from auth.users where id = r.user_id;   -- cascades identities, sessions, refresh tokens
        update public.account_deletion_requests
           set status = 'completed', user_id = null, storage_manifest = '[]'::jsonb, retain_manifest = '[]'::jsonb, storage_request_ids = null,
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

-- Client facing entry point. Same name as before so every installed iOS and Android build keeps working.
create or replace function public.delete_my_account()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid(); v_req public.account_deletion_requests%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  -- Staff: supported, except for the last administrator (and the last photo administrator), who must hand over first.
  if exists (select 1 from public.users where id = v_uid and is_admin) and (select count(*) from public.users where is_admin) <= 1 then
    raise exception 'You are the only CheckOff administrator. Make another account an administrator first, then delete this one.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.photo_admins where user_id = v_uid) and (select count(*) from public.photo_admins) <= 1 then
    raise exception 'You are the only CheckOff photo administrator. Add another photo administrator first, then delete this account.' using errcode = 'P0001';
  end if;

  select * into v_req from public.account_deletion_requests where user_id = v_uid and completed_at is null;
  if found then
    perform public.account_deletion_process();
    return jsonb_build_object('status', 'accepted', 'request_id', v_req.id, 'already_requested', true);
  end if;

  insert into public.account_deletion_requests (user_id, retain_manifest, storage_manifest)
  values (v_uid, public.account_deletion_retain_inventory(v_uid), public.account_deletion_inventory(v_uid))   -- inventory BEFORE any row is removed
  returning * into v_req;

  -- Stop all access now: ban the auth user and revoke every session and refresh token.
  update auth.users set banned_until = now() + interval '100 years' where id = v_uid;
  delete from auth.sessions where user_id = v_uid;
  delete from public.push_tokens where user_id = v_uid;         -- no more notifications immediately

  perform public.account_deletion_process();   -- an account with nothing in Storage completes right here; otherwise cron finishes it
  return jsonb_build_object(
    'status', case when exists (select 1 from public.account_deletion_requests where id = v_req.id and completed_at is not null) then 'completed' else 'accepted' end,
    'request_id', v_req.id, 'already_requested', false);
end $$;

-- Privileges: clients may call only delete_my_account (signed in). Everything else is service role only.
revoke all on function public.anonymous_completions_for_items(uuid[], date) from public, anon, authenticated;
revoke all on function public.account_deletion_retain_inventory(uuid)   from public, anon, authenticated;
revoke all on function public.account_deletion_inventory(uuid)          from public, anon, authenticated;
revoke all on function public.account_deletion_objects_remaining(uuid)  from public, anon, authenticated;
revoke all on function public.account_deletion_scrub_json(jsonb, uuid)  from public, anon, authenticated;
revoke all on function public.account_deletion_process()                from public, anon, authenticated;
revoke all on function public.account_deletion_delete_data(uuid)        from public, anon, authenticated;
grant execute on function public.anonymous_completions_for_items(uuid[], date), public.account_deletion_retain_inventory(uuid),
                          public.account_deletion_inventory(uuid), public.account_deletion_objects_remaining(uuid),
                          public.account_deletion_scrub_json(jsonb, uuid), public.account_deletion_process(),
                          public.account_deletion_delete_data(uuid) to service_role;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated, service_role;

-- Resume anything that is not finished (every minute; a no-op when nothing is open), and drop finished request rows after 30 days.
select cron.schedule('process-account-deletions', '* * * * *',
  $$select public.account_deletion_process(); delete from public.account_deletion_requests where completed_at < now() - interval '30 days';$$);
