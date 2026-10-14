-- STATUS 2026-10-08 (rev 5): written, NOT YET APPLIED to production. Incremental fix on top of the APPLIED rev 4 (20261008d), found by the disposable account test.
-- It only redefines two existing functions with the SAME signatures and return types (CREATE OR REPLACE keeps owner and grants), so there is no DROP and no 42P13.
--
-- DEFECT 1 (Storage credential): account_deletion_process() called the Storage API with the vault secret `service_role_key`, which is a new style `sb_...` key, not a JWT.
--   The Storage API answers 403 "Invalid Compact JWS" whether the key is sent as Bearer, as apikey, or both (the gateway does not exchange it on this path). Every move and delete of a
--   stored file therefore failed, so accounts with photos stayed in `accepted`. Accounts without stored files were unaffected. FIX: the processor now reads a separate vault secret
--   `service_role_jwt` (the project's legacy service_role JWT) and sends it as apikey and Bearer; if it is missing or not a JWT the request records a precise last_error and nothing is
--   changed. The secret must be stored first (scripts/store-service-role-jwt.sh), the preflight verifies it (role service_role, this project) without printing it.
-- DEFECT 2 (notification_queue): the outbox has no user column or foreign key, so rows survived an account deletion and held the deleted user's display name (`from_user`),
--   their id as recipient (`to_user_id`), the item and list, with timestamps. FIX: account_deletion_delete_data() removes the rows addressed to the user and the rows about the
--   user's activity before deleting the profile (attribution by id where the payload has one, otherwise display name plus the user's own list item, dare or list).
--   Not fixed here (flagged): the table is never purged (3,496 rows back to April); rows written under an earlier display name cannot be attributed.
-- ROLLBACK: restore the two function bodies from 20261008d_account_deletion_pipeline.sql (create or replace). Nothing else changes.

create or replace function public.account_deletion_delete_data(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid; v_status text; v_counted boolean; v_new_owner uuid; l record; v_fallback_admin uuid;
  v_name text; v_li text[]; v_dares text[]; v_lists text[]; n_queue int := 0;
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

  -- 0b. Capture what identifies this user's notification outbox rows BEFORE anything is deleted.
  select display_name into v_name from public.users where id = v_uid;
  select coalesce(array_agg(distinct list_item_id::text), '{}') into v_li from public.check_ins where user_id = v_uid and list_item_id is not null;
  select coalesce(array_agg(id::text), '{}') into v_dares from public.dares where from_user_id = v_uid or to_user_id = v_uid;
  select coalesce(array_agg(list_id::text), '{}') into v_lists from public.list_members where user_id = v_uid;

  -- 0. Anonymous completion counts, exactly once. One qualifying completion = one confirmed check in per experience per day (fan out mirror rows on other
  --    lists are the same real action). Only confirmed check ins are read: candidate_visits, presence sessions and suggestions are never counted.
  if not v_counted then
    with completions_by_day as (
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
        from completions_by_day r join public.items i on i.id = r.item_id
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
  -- 2b. notification_queue has no user column and no foreign key, so it would survive the deletion: remove the rows addressed to the user and the rows about the user's
  --     activity (the payload carries the user's display name, the list item or dare, and recipients' ids). Matching is by id where the payload has one, and by display name
  --     plus the user's own list item, dare or list to avoid touching other members' rows. Rows written under an earlier display name cannot be attributed and remain.
  delete from public.notification_queue q
   where q.payload->>'to_user_id' = v_uid::text
      or (coalesce(v_name, '') <> '' and (
            (q.payload->>'from_user' = v_name and (q.payload->>'list_item_id' = any (v_li) or q.payload->>'dare_id' = any (v_dares)))
         or (q.type = 'leaderboard_nudge' and left(q.payload->>'message', length(v_name) + 1) = v_name || ' ' and q.payload->>'list_id' = any (v_lists))));
  get diagnostics n_queue = row_count;
  update public.users              set referred_by = null where referred_by = v_uid;
  update public.partner_promotions set created_by  = null where created_by  = v_uid;
  update public.creators           set user_id     = null where user_id     = v_uid;

  -- 3. The profile row. Everything else the user owns cascades from here (check_ins, candidate_visits, visit_*, push_tokens ...).
  --    Retained photo candidates no longer reference the user (anonymized earlier), so they survive. Other users' content that merely references the
  --    user is set to NULL by its own foreign key.
  delete from public.users where id = v_uid;

  update public.account_deletion_requests set status = 'data_done', updated_at = now() where id = p_request;
  return jsonb_build_object('lists_deleted', n_lists_deleted, 'lists_transferred', n_lists_moved, 'anonymous_count_cells', n_counted,
                            'interaction_events', n_events, 'campaign_sends', n_sends, 'notification_log', n_notif, 'notification_queue', n_queue);
end $$;

create or replace function public.account_deletion_process()
returns jsonb language plpgsql security definer set search_path = public, auth, storage, vault, net as $$
declare
  r public.account_deletion_requests%rowtype; k text; remaining int; ids bigint[]; b record; e record; i int; err text; pending_moves int;
  base constant text := 'https://uggusbbswybyplypkbxz.supabase.co';
  hdr jsonb; done_n int := 0; pending_n int := 0;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'service_role_jwt' limit 1;
  hdr := jsonb_build_object('apikey', coalesce(k, ''), 'Authorization', 'Bearer ' || coalesce(k, ''), 'Content-Type', 'application/json');
  for r in select * from public.account_deletion_requests where completed_at is null order by requested_at limit 10 loop
    begin
      -- A. retained photos: move to neutral paths, verify, then anonymize their rows
      if r.status = 'accepted' then
        select count(*) into pending_moves
          from jsonb_to_recordset(r.retain_manifest) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
         where m."from" <> m."to"
           and not exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = m."to");
        if pending_moves > 0 then
          if r.storage_request_ids is not null then
            select string_agg(coalesce(h.status_code::text, 'no response') || ' ' || left(coalesce(h.content, h.error_msg, ''), 100), '; ')
              into err from net._http_response h
             where h.id = any (r.storage_request_ids) and (h.status_code is null or h.status_code not between 200 and 299 or h.timed_out);
          end if;
          if k is null or k !~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then raise exception 'vault secret service_role_jwt is missing or is not a JWT: the Storage API needs the legacy service_role JWT (a new style sb_ key is rejected)'; end if;
          if r.storage_requested_at is null or r.storage_requested_at < now() - interval '90 seconds' then
            ids := '{}';
            for e in
              select m.bucket, m."from", m."to"
                from jsonb_to_recordset(r.retain_manifest) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
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
        insert into public.retained_checkin_photos (item_id, bucket, name, width, height)
        select m.item_id, m.bucket, m."to", m.width, m.height
          from jsonb_to_recordset(r.retain_manifest) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
         where m.kind = 'checkin_photo' and m.item_id is not null
        on conflict (bucket, name) do nothing;
        update public.item_cover_candidates c
           set storage_path = m."to", submitted_by_user_id = null,
               moderation_metadata = public.account_deletion_scrub_json(c.moderation_metadata, r.user_id),
               rejection_reason = replace(c.rejection_reason, r.user_id::text, 'removed')
          from jsonb_to_recordset(r.retain_manifest) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
         where m.kind = 'cover_candidate' and c.id = m.candidate_id and c.submitted_by_user_id = r.user_id;
        update storage.objects o set owner = null, owner_id = null
          from jsonb_to_recordset(r.retain_manifest) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
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
          if k is null or k !~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then raise exception 'vault secret service_role_jwt is missing or is not a JWT: the Storage API needs the legacy service_role JWT (a new style sb_ key is rejected)'; end if;
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

-- Privileges are unchanged by CREATE OR REPLACE; asserted again so this file stands on its own.
revoke all on function public.account_deletion_process()         from public, anon, authenticated;
revoke all on function public.account_deletion_delete_data(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_process(), public.account_deletion_delete_data(uuid) to service_role;

notify pgrst, 'reload schema';
