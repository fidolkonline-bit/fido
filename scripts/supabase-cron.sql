-- Every-minute safety net for Fido on Vercel Hobby (which only allows daily cron jobs): Supabase calls /api/cron.
-- Run with scripts/setup-supabase-cron.sh, which passes :app_url and :cron_secret. Safe to re-run.
-- The secret is kept in Supabase Vault, not in the job text.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.update_secret(id, :'cron_secret') from vault.secrets where name = 'fido_cron_secret';
select vault.create_secret(:'cron_secret', 'fido_cron_secret', 'Bearer token for Fido /api/cron')
  where not exists (select 1 from vault.secrets where name = 'fido_cron_secret');

select cron.unschedule(jobid) from cron.job where jobname = 'fido-every-minute';
select cron.schedule('fido-every-minute', '* * * * *', format($job$
  select net.http_get(
    url := %L,
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fido_cron_secret')),
    timeout_milliseconds := 30000
  );
$job$, rtrim(:'app_url', '/') || '/api/cron'));

select jobname, schedule, active from cron.job where jobname = 'fido-every-minute';
