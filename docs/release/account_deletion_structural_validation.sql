-- READ ONLY structural validation of migration 20261008d against the LIVE production catalog. It creates nothing and changes nothing.
--   * PREPARE parses and plans a statement against the real tables, columns, types and function signatures WITHOUT executing it (session local; gone at the end).
--   * The few EXECUTEs are pure SELECTs with a random uuid (no matching rows), run only to prove runtime typing.
-- It does NOT execute the migration's functions, does not test control flow, FK behavior, the Storage API calls, or anything on the tables the migration itself creates
-- (account_deletion_requests, anonymous_completion_counts, retained_checkin_photos) because they do not exist yet. Those need the disposable account test after apply.
-- Run: supabase db query -f docs/release/account_deletion_structural_validation.sql --linked --agent=no -o json   (last statement returns the summary row)

-- retain inventory (candidates + check in photos)
prepare s01(uuid) as
select jsonb_build_object('kind','cover_candidate','candidate_id',k.id,'bucket','submission-photos','from',k.storage_path,
  'to', case when k.storage_path like '%' || $1::text || '%'
             then split_part(k.storage_path,'/',1) || '/retained/' || k.id::text || coalesce('.' || nullif(lower(substring(k.storage_path from '\.([A-Za-z0-9]{1,5})$')),''),'')
             else k.storage_path end)
  from public.item_cover_candidates k
 where k.submitted_by_user_id = $1 and k.storage_path ~ '^(cover-candidates|business-submissions)/'
   and exists (select 1 from storage.objects o where o.bucket_id='submission-photos' and o.name=k.storage_path);
prepare s02(uuid) as
select jsonb_build_object('kind','checkin_photo','bucket','checkin-photos','from',p.name,
  'to','retained/' || gen_random_uuid()::text || coalesce('.' || nullif(lower(substring(p.name from '\.([A-Za-z0-9]{1,5})$')),''),''),
  'item_id',p.item_id,'width',p.width,'height',p.height)
  from (select distinct on (o.name) o.name, coalesce(c.item_id, li.item_id) as item_id, c.photo_width as width, c.photo_height as height
          from public.check_ins c left join public.list_items li on li.id = c.list_item_id
          join storage.objects o on o.bucket_id='checkin-photos' and c.photo_url like '%/checkin-photos/' || o.name and o.name like $1::text || '/%'
         where c.user_id = $1 and c.photo_url is not null and coalesce((o.metadata->>'size')::bigint,0) > 0 and coalesce(c.item_id, li.item_id) is not null
         order by o.name) p;
-- deletion inventory (owned files)
prepare s03(uuid) as
select o.bucket_id, o.name from storage.objects o where o.owner_id = $1::text
union select o.bucket_id, o.name from storage.objects o where o.bucket_id='checkin-photos' and o.name like $1::text || '/%';
-- anonymous counts source
prepare s04(uuid) as
with completions_by_day as (
  select coalesce(c.item_id, li.item_id) as item_id, (c.checked_at at time zone 'UTC')::date as d,
         (array_agg(case when c.verification_method='historical_visit_confirmed' then 'confirmed_suggestion'
                         when c.verification_method='trip_list_retroactive' then 'retroactive'
                         when c.photo_url is not null then 'photo' else 'tap' end
                     order by case when c.verification_method='historical_visit_confirmed' then 1 when c.verification_method='trip_list_retroactive' then 2
                                   when c.photo_url is not null then 3 else 4 end))[1] as method
    from public.check_ins c left join public.list_items li on li.id = c.list_item_id
   where c.user_id = $1 and coalesce(c.item_id, li.item_id) is not null group by 1, 2
), monthly as (
  select r.item_id, date_trunc('month', r.d)::date as period_month, r.method, count(*)::int as completions
    from completions_by_day r join public.items i on i.id = r.item_id group by 1, 2, 3)
select item_id, period_month, method, completions from monthly;
-- data deletion statements
prepare s05(uuid) as select id, is_official from public.lists where creator_id = $1;
prepare s06(uuid, uuid) as select m.user_id from public.list_members m where m.list_id = $1 and m.user_id <> $2 order by m.joined_at, m.id limit 1;
prepare s07(uuid, uuid) as update public.lists set creator_id = $1 where id = $2;
prepare s08(uuid) as select 1 from public.destination_lists d where d.list_id = $1;
prepare s09(uuid) as select 1 from public.destination_zones z where z.list_id = $1;
prepare s10(uuid) as delete from public.lists where id = $1;
prepare s11(uuid) as delete from public.interaction_events where user_id = $1;
prepare s12(uuid) as delete from public.campaign_sends where user_id = $1;
prepare s13(uuid) as delete from public.notification_log where user_id = $1;
prepare s14(uuid) as update public.users set referred_by = null where referred_by = $1;
prepare s15(uuid) as update public.partner_promotions set created_by = null where created_by = $1;
prepare s16(uuid) as update public.creators set user_id = null where user_id = $1;
prepare s17(uuid) as delete from public.users where id = $1;
prepare s18(uuid) as select id from public.users where is_admin and id <> $1 order by created_at limit 1;
prepare s19 as select count(*) from public.users where is_admin;
prepare s20(uuid) as select 1 from public.photo_admins where user_id = $1;
prepare s21 as select count(*) from public.photo_admins;
-- processor statements on existing objects
prepare s22(jsonb) as
select m.bucket, m."from", m."to" from jsonb_to_recordset($1) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
 where m."from" <> m."to" and exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = m."from")
   and not exists (select 1 from storage.objects o where o.bucket_id = m.bucket and o.name = m."to");
prepare s23(jsonb, uuid) as
update public.item_cover_candidates c set storage_path = m."to", submitted_by_user_id = null,
       moderation_metadata = case when c.moderation_metadata is null then null else replace(c.moderation_metadata::text, $2::text, 'removed')::jsonb end,
       rejection_reason = replace(c.rejection_reason, $2::text, 'removed')
  from jsonb_to_recordset($1) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
 where m.kind = 'cover_candidate' and c.id = m.candidate_id and c.submitted_by_user_id = $2;
prepare s24(jsonb) as
update storage.objects o set owner = null, owner_id = null
  from jsonb_to_recordset($1) as m(kind text, candidate_id uuid, bucket text, "from" text, "to" text, item_id uuid, width int, height int)
 where o.bucket_id = m.bucket and o.name = m."to";
prepare s25(bigint[]) as
select string_agg(coalesce(h.status_code::text,'no response') || ' ' || left(coalesce(h.content, h.error_msg, ''), 100), '; ')
  from net._http_response h where h.id = any ($1) and (h.status_code is null or h.status_code not between 200 and 299 or h.timed_out);
prepare s26(text) as select net.http_post(url := $1, headers := '{}'::jsonb, timeout_milliseconds := 30000, body := jsonb_build_object('bucketId','b','sourceKey','a','destinationKey','c'));
prepare s27(text) as select net.http_delete(url := $1, headers := '{}'::jsonb, timeout_milliseconds := 30000, body := jsonb_build_object('prefixes', to_jsonb((array['a','b'])[1:2])));
prepare s28 as select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1;       -- prepared only, never executed
prepare s29(uuid) as delete from auth.users where id = $1;
-- client entry point statements
prepare s30(uuid) as update auth.users set banned_until = now() + interval '100 years' where id = $1;
prepare s31(uuid) as delete from auth.sessions where user_id = $1;
prepare s32(uuid) as delete from public.push_tokens where user_id = $1;
prepare s33(uuid) as select 1 from public.users where id = $1 and is_admin;
-- pure SELECTs actually executed with a random uuid (no rows match; proves runtime typing of the retain / count / inventory queries)
execute s01(gen_random_uuid());
execute s02(gen_random_uuid());
execute s03(gen_random_uuid());
execute s04(gen_random_uuid());
execute s05(gen_random_uuid());
execute s18(gen_random_uuid());
execute s19;
execute s21;
-- expression patterns used by the SQL functions, executed on literals
select r->>'bucket' as bucket, r->>'from' as name from jsonb_array_elements('[{"bucket":"b","from":"f"}]'::jsonb) r;
select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', x, 'name', 'n')), '[]'::jsonb) as distinct_manifest from (values ('a'), ('a'), ('b')) v(x);
select extract(day from date '2026-10-01') = 1 as month_start_check_ok, (date '2026-10-01' at time zone 'UTC')::date is not null as tz_cast_ok;
-- privileges the migration's SECURITY DEFINER functions (owner postgres) need outside the public schema: PREPARE does not check these, so check them explicitly.
-- Raises (division by zero) if any is missing, so a missing privilege can never read as a pass.
select 1 / (case when (has_table_privilege('postgres','auth.users','UPDATE') and has_table_privilege('postgres','auth.users','DELETE')
                       and has_table_privilege('postgres','auth.sessions','DELETE')
                       and has_table_privilege('postgres','storage.objects','SELECT') and has_table_privilege('postgres','storage.objects','UPDATE')
                       and has_table_privilege('postgres','vault.decrypted_secrets','SELECT') and has_table_privilege('postgres','net._http_response','SELECT')
                       and has_function_privilege('postgres','net.http_post(text,jsonb,jsonb,jsonb,integer)','EXECUTE')
                       and has_function_privilege('postgres','net.http_delete(text,jsonb,jsonb,integer,jsonb)','EXECUTE')
                       and has_function_privilege('postgres','cron.schedule(text,text,text)','EXECUTE')
                       and has_schema_privilege('postgres','public','CREATE'))
                 then 1 else 0 end) as privileges_ok;     -- 1 when all present; division by zero (a loud failure) when any is missing
select 'structural validation passed: 33 statements parsed and planned against the live catalog, 11 pure selects executed, 11 privileges confirmed' as result;
