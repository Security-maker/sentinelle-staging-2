-- Sentinelle Pro V5.10.0 — Envoi automatique fiable des mains courantes
-- Idempotent : ajoute uniquement le suivi de livraison et le cron de relance.

begin;

alter table public.generated_documents
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists next_delivery_attempt_at timestamptz,
  add column if not exists delivery_error text,
  add column if not exists delivered_at timestamptz;

alter table public.email_deliveries
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

create index if not exists idx_generated_documents_delivery_queue
  on public.generated_documents (next_delivery_attempt_at, created_at)
  where type='mission' and delivery_status='retry_pending';

create index if not exists idx_email_deliveries_retry
  on public.email_deliveries (next_attempt_at, updated_at)
  where status='failed';

commit;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Le cron reste volontairement inoffensif tant que le secret Vault
-- "main_courante_cron_secret" n'a pas été créé.
create or replace function public.run_main_courante_delivery_queue()
returns void
language plpgsql
security definer
set search_path=public,vault,extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='main_courante_cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(v_secret,'')='' then
    return;
  end if;

  perform net.http_post(
    url := 'https://ksoyqtsrhtsfbwmxipqz.supabase.co/functions/v1/process-main-courante-queue',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-Cron-Secret',v_secret
    ),
    body := '{"source":"pg_cron"}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function public.run_main_courante_delivery_queue() from public, anon, authenticated;

-- Toutes les 5 minutes : traite uniquement les documents réellement en échec temporaire.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='sentinelle-main-courante-queue' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'sentinelle-main-courante-queue',
    '*/5 * * * *',
    'select public.run_main_courante_delivery_queue();'
  );
end $$;
