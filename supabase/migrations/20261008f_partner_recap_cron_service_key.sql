-- send-partner-recap now rejects the public anon key and user JWTs (index.ts, commit b0df084). The monthly job (cron jobid 8,
-- 0 7 1 * *) must therefore send the service role JWT, read from the vault at run time like the account deletion job. Same schedule, same body.
-- Apply: supabase db query --linked --agent=no -f supabase/migrations/20261008f_partner_recap_cron_service_key.sql
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'send-partner-recap'),
  command := $job$select net.http_post(
    url     := 'https://uggusbbswybyplypkbxz.supabase.co/functions/v1/send-partner-recap',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_jwt'), 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  ) as request_id$job$
);
-- Check (no email: a zero uuid partner is "not found" after authorization, and 403 would mean the vault key does not match the function's key):
-- select net.http_post(url:='https://uggusbbswybyplypkbxz.supabase.co/functions/v1/send-partner-recap', headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='service_role_jwt'),'Content-Type','application/json'), body:='{"partner_id":"00000000-0000-0000-0000-000000000000"}'::jsonb);
-- then after a few seconds: select status_code, content from net._http_response order by id desc limit 1;   -- expect 404 Partner not found
