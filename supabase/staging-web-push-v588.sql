-- SENTINELLE PRO V5.8.8 — WEB PUSH NATIF SUPABASE
-- À exécuter UNIQUEMENT dans sentinelle-pro-staging.
-- Prérequis : V5.8.7.1 validée.
-- Aucun changement Firebase / OneSignal / Cloudflare.

begin;

do $$
begin
  if to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.current_organization_id()') is null
     or to_regprocedure('public.current_role()') is null then
    raise exception 'Socle Supabase Auth/RLS manquant';
  end if;
end $$;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid not null,
  external_uid text,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  preferences jsonb not null default '{"flash":true,"planning":true,"instructions":true,"documents":true,"operations":true}'::jsonb,
  user_agent text,
  platform text,
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (endpoint ~ '^https://'),
  check (char_length(p256dh) between 20 and 400),
  check (char_length(auth_secret) between 8 and 300)
);

create index if not exists idx_web_push_org_profile
  on public.web_push_subscriptions(organization_id,profile_id,enabled);
create index if not exists idx_web_push_external_uid
  on public.web_push_subscriptions(organization_id,external_uid,enabled);

alter table public.web_push_subscriptions enable row level security;
revoke all on public.web_push_subscriptions from anon, authenticated;

-- Aucun accès direct aux endpoints/clefs de chiffrement depuis le navigateur.
-- Toutes les opérations passent par des RPC SECURITY DEFINER contrôlées.

drop policy if exists "web push own read" on public.web_push_subscriptions;
drop policy if exists "web push own write" on public.web_push_subscriptions;

create or replace function public.sentinelle_push_preferences_sanitize(p_preferences jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'flash', coalesce((p_preferences->>'flash')::boolean,true),
    'planning', coalesce((p_preferences->>'planning')::boolean,true),
    'instructions', coalesce((p_preferences->>'instructions')::boolean,true),
    'documents', coalesce((p_preferences->>'documents')::boolean,true),
    'operations', coalesce((p_preferences->>'operations')::boolean,true)
  )
$$;

create or replace function public.sentinelle_register_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_preferences jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile public.profiles%rowtype;
  v_id uuid;
begin
  select * into v_profile
  from public.profiles
  where id=public.current_profile_id() and active=true;

  if v_profile.id is null or auth.uid() is null then
    raise exception 'Profil authentifié requis' using errcode='42501';
  end if;
  if coalesce(p_endpoint,'') !~ '^https://' then
    raise exception 'Endpoint Web Push invalide' using errcode='22023';
  end if;
  if char_length(coalesce(p_p256dh,'')) < 20 or char_length(coalesce(p_auth,'')) < 8 then
    raise exception 'Clés Web Push invalides' using errcode='22023';
  end if;

  insert into public.web_push_subscriptions (
    organization_id,profile_id,auth_user_id,external_uid,endpoint,p256dh,auth_secret,
    preferences,user_agent,platform,enabled,updated_at
  ) values (
    v_profile.organization_id,v_profile.id,auth.uid(),v_profile.external_uid,p_endpoint,p_p256dh,p_auth,
    public.sentinelle_push_preferences_sanitize(coalesce(p_preferences,'{}'::jsonb)),
    left(coalesce(p_user_agent,''),1000),left(coalesce(p_platform,''),200),true,now()
  )
  on conflict (endpoint) do update set
    organization_id=excluded.organization_id,
    profile_id=excluded.profile_id,
    auth_user_id=excluded.auth_user_id,
    external_uid=excluded.external_uid,
    p256dh=excluded.p256dh,
    auth_secret=excluded.auth_secret,
    preferences=excluded.preferences,
    user_agent=excluded.user_agent,
    platform=excluded.platform,
    enabled=true,
    failure_count=0,
    last_error=null,
    updated_at=now()
  returning id into v_id;

  return jsonb_build_object('ok',true,'subscription_id',v_id,'enabled',true);
end;
$$;

create or replace function public.sentinelle_disable_web_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer;
begin
  if public.current_profile_id() is null then
    raise exception 'Profil authentifié requis' using errcode='42501';
  end if;
  update public.web_push_subscriptions
  set enabled=false,updated_at=now()
  where profile_id=public.current_profile_id() and endpoint=p_endpoint;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'disabled',v_count);
end;
$$;

create or replace function public.sentinelle_update_web_push_preferences(p_preferences jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer;
  v_preferences jsonb := public.sentinelle_push_preferences_sanitize(coalesce(p_preferences,'{}'::jsonb));
begin
  if public.current_profile_id() is null then
    raise exception 'Profil authentifié requis' using errcode='42501';
  end if;
  update public.web_push_subscriptions
  set preferences=v_preferences,updated_at=now()
  where profile_id=public.current_profile_id() and enabled=true;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'updated',v_count,'preferences',v_preferences);
end;
$$;

create or replace function public.sentinelle_web_push_status()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_total integer;
  v_enabled integer;
  v_last_success timestamptz;
  v_last_failure timestamptz;
begin
  if v_profile_id is null then
    raise exception 'Profil authentifié requis' using errcode='42501';
  end if;
  select count(*),count(*) filter(where enabled),max(last_success_at),max(last_failure_at)
    into v_total,v_enabled,v_last_success,v_last_failure
  from public.web_push_subscriptions where profile_id=v_profile_id;
  return jsonb_build_object(
    'ok',true,'total_count',v_total,'enabled_count',v_enabled,
    'last_success_at',v_last_success,'last_failure_at',v_last_failure
  );
end;
$$;

revoke all on function public.sentinelle_push_preferences_sanitize(jsonb) from public;
revoke all on function public.sentinelle_register_web_push_subscription(text,text,text,jsonb,text,text) from public;
revoke all on function public.sentinelle_disable_web_push_subscription(text) from public;
revoke all on function public.sentinelle_update_web_push_preferences(jsonb) from public;
revoke all on function public.sentinelle_web_push_status() from public;

grant execute on function public.sentinelle_register_web_push_subscription(text,text,text,jsonb,text,text) to authenticated;
grant execute on function public.sentinelle_disable_web_push_subscription(text) to authenticated;
grant execute on function public.sentinelle_update_web_push_preferences(jsonb) to authenticated;
grant execute on function public.sentinelle_web_push_status() to authenticated;

commit;

select
  to_regclass('public.web_push_subscriptions') as web_push_subscriptions,
  to_regprocedure('public.sentinelle_register_web_push_subscription(text,text,text,jsonb,text,text)') as register_rpc,
  to_regprocedure('public.sentinelle_web_push_status()') as status_rpc;
