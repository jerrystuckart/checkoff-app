-- Rollback of 20261009a_photo_consent_version.sql. Restores the previous function bodies and DROPS the consent columns (this deletes the recorded evidence).
-- Only run if the migration must be undone; prefer leaving the nullable columns in place.
CREATE OR REPLACE FUNCTION public.account_deletion_retain_inventory(p_uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
  select coalesce(jsonb_agg(e), '[]'::jsonb) from (
    select jsonb_build_object(
             'kind', 'cover_candidate', 'candidate_id', k.id, 'bucket', 'submission-photos', 'from', k.storage_path,
             'to', case when k.storage_path like '%' || p_uid::text || '%'
                        then split_part(k.storage_path, '/', 1) || '/retained/' || k.id::text
                             || coalesce('.' || nullif(lower(substring(k.storage_path from '\.([A-Za-z0-9]{1,5})$')), ''), '')
                        else k.storage_path end) as e
      from public.item_cover_candidates k
     where k.submitted_by_user_id = p_uid
       and k.storage_path ~ '^(cover-candidates|business-submissions)/'
       and exists (select 1 from storage.objects o where o.bucket_id = 'submission-photos' and o.name = k.storage_path)
    union all
    select jsonb_build_object(
             'kind', 'checkin_photo', 'bucket', 'checkin-photos', 'from', p.name,
             'to', 'retained/' || gen_random_uuid()::text || coalesce('.' || nullif(lower(substring(p.name from '\.([A-Za-z0-9]{1,5})$')), ''), ''),
             'item_id', p.item_id, 'width', p.width, 'height', p.height)
      from (
        select distinct on (o.name) o.name, coalesce(c.item_id, li.item_id) as item_id, c.photo_width as width, c.photo_height as height
          from public.check_ins c
          left join public.list_items li on li.id = c.list_item_id
          join storage.objects o on o.bucket_id = 'checkin-photos'
                                and c.photo_url like '%/checkin-photos/' || o.name
                                and o.name like p_uid::text || '/%'
         where c.user_id = p_uid and c.photo_url is not null
           and coalesce((o.metadata->>'size')::bigint, 0) > 0        -- an empty file is a failed upload: nothing to keep
           and coalesce(c.item_id, li.item_id) is not null
         order by o.name
      ) p
  ) x;
$function$;

CREATE OR REPLACE FUNCTION public.account_deletion_process()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'storage', 'vault', 'net'
AS $function$
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
end $function$;

alter table public.retained_checkin_photos drop column if exists consent_version;
alter table public.item_cover_candidates drop column if exists consent_version;
alter table public.check_ins drop column if exists photo_terms_version;
