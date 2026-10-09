-- Edge Function caller authorization (2026-10-08). process-notification-queue and streak-reminder now reject the public anon key and user JWTs and accept only the
-- service key or the x-campaign-secret header (supabase/functions/_shared/serverCaller.ts). The two scheduled jobs that call them must therefore send x-campaign-secret,
-- read from Vault at run time (`campaign_admin_secret`, stored by scripts/store-campaign-secret.sh). Authorization keeps the project's PUBLIC anon JWT only because the
-- gateway requires a valid JWT; the handlers do not accept it as authorization. The old handlers ignore the extra header, so this can be applied BEFORE the guards are deployed.
-- Changes ONLY the command of these two existing jobs (schedules and bodies unchanged). Aborts, changing nothing, if a job, its schedule or the vault secret is missing.
-- DELIBERATELY NOT TOUCHED: send-dormant-reminders (its job sends the vault sb_ key, which the gateway rejects with 401 "Invalid API key", so it has never reached the function;
-- pointing it at the anon key would START daily push reminders to dormant users, a product decision) and partner-renewal-emails (send-partner-renewal is not deployed, 404).
-- Project: uggusbbswybyplypkbxz (apply with the linked project only).
do $$
declare
  r record;
  v_job bigint;
  v_sched text;
begin
  if not exists (select 1 from vault.secrets where name = 'campaign_admin_secret') then
    raise exception 'vault secret campaign_admin_secret is missing (run scripts/store-campaign-secret.sh): nothing changed';
  end if;
  for r in select * from (values
    ('process-notification-queue', '* * * * *', 'process-notification-queue', $b${}$b$),
    ('streak-reminder-saturday', '0 18 * * 6', 'streak-reminder', $b${}$b$)
  ) as t(jobname, sched, fn, body) loop
    select jobid, schedule into v_job, v_sched from cron.job where jobname = r.jobname;
    if v_job is null then raise exception 'cron job % does not exist: nothing changed', r.jobname; end if;
    if v_sched <> r.sched then raise exception 'job % has schedule %, expected %: nothing changed', r.jobname, v_sched, r.sched; end if;
  end loop;
  for r in select * from (values
    ('process-notification-queue', '* * * * *', 'process-notification-queue', $b${}$b$),
    ('streak-reminder-saturday', '0 18 * * 6', 'streak-reminder', $b${}$b$)
  ) as t(jobname, sched, fn, body) loop
    perform cron.alter_job(
      job_id  := (select jobid from cron.job where jobname = r.jobname),
      command := format($job$select net.http_post(
    url     := 'https://uggusbbswybyplypkbxz.supabase.co/functions/v1/%s',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZ3VzYmJzd3lieXBseXBrYnh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODUwNDEsImV4cCI6MjA5MTM2MTA0MX0.EVk1t_u93uAMk9T9_uIs5Hy7kDwK3d5oYzBAl7cGpfc',
      'x-campaign-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'campaign_admin_secret'),
      'Content-Type', 'application/json'),
    body    := %L::jsonb
  ) as request_id$job$, r.fn, r.body)
    );
  end loop;
end
$$;
-- Verify afterwards (no secret values appear, only the vault lookup):
--   select jobname, schedule, command from cron.job where jobname in ('send-dormant-reminders','process-notification-queue','streak-reminder-saturday','partner-renewal-emails');
