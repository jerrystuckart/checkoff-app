-- send-partner-recap rejects the public anon key and user JWTs (index.ts, b0df084): the handler needs the service role key or x-campaign-secret.
-- The service role env value is reserved and was not changed; the monthly job instead sends x-campaign-secret from Vault (`campaign_admin_secret`, copied from the
-- deployed CAMPAIGN_ADMIN_SECRET by scripts/store-campaign-secret.sh, digest verified). The Authorization header carries the project's PUBLIC anon JWT only because the
-- gateway requires a valid JWT; the handler does not accept it as authorization.
-- Changes ONLY the command of the existing job 'send-partner-recap' (schedule and body '{}' unchanged). Fails if the job or the vault secret is missing.
-- Project: uggusbbswybyplypkbxz (the URL below; apply with the linked project only).
do $$
declare
  v_job   bigint;
  v_sched text;
begin
  select jobid, schedule into v_job, v_sched from cron.job where jobname = 'send-partner-recap';
  if v_job is null then raise exception 'cron job send-partner-recap does not exist: nothing changed'; end if;
  if v_sched <> '0 7 1 * *' then raise exception 'unexpected schedule %, expected 0 7 1 * *: nothing changed', v_sched; end if;
  if not exists (select 1 from vault.secrets where name = 'campaign_admin_secret') then
    raise exception 'vault secret campaign_admin_secret is missing (run scripts/store-campaign-secret.sh): nothing changed';
  end if;
  perform cron.alter_job(
    job_id  := v_job,
    command := $job$select net.http_post(
    url     := 'https://uggusbbswybyplypkbxz.supabase.co/functions/v1/send-partner-recap',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZ3VzYmJzd3lieXBseXBrYnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODUwNDEsImV4cCI6MjA5MTM2MTA0MX0.EVk1t_u93uAMk9T9_uIs5Hy7kDwK3d5oYzBAl7cGpfc',
      'x-campaign-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'campaign_admin_secret'),
      'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  ) as request_id$job$
  );
end
$$;
-- Verify after applying: select schedule, command from cron.job where jobname='send-partner-recap';  (command must contain no secret value, only the vault lookup)
