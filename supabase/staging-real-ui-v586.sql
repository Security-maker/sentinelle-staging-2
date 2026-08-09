-- SENTINELLE PRO V5.8.6 — STAGING REAL UI / SUPABASE CORE
-- À exécuter UNIQUEMENT dans le projet : sentinelle-pro-staging
-- Prérequis : V5.8.5 Supabase Auth natif déjà appliquée.
-- Ce script ne touche pas Firebase et ne supprime aucune donnée métier existante.

begin;

do $$
begin
  if to_regprocedure('public.current_profile_external_uid()') is null then
    raise exception 'V5.8.5 manquante : applique supabase-auth-native-v585.sql avant V5.8.6';
  end if;
end $$;

-- Les anciennes collections Firestore non encore normalisées (rondes, preuve photo,
-- planning mensuel, facturation de test...) disposent d'un sas de compatibilité
-- STAGING. Les collections métier principales restent dans leurs vraies tables.
create table if not exists public.compat_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  collection_name text not null check (char_length(collection_name) between 1 and 160),
  external_id text not null check (char_length(external_id) between 1 and 220),
  owner_external_uid text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, collection_name, external_id)
);
create index if not exists idx_compat_records_org_collection on public.compat_records(organization_id,collection_name);
create index if not exists idx_compat_records_owner on public.compat_records(organization_id,owner_external_uid);

alter table public.compat_records enable row level security;
grant select,insert,update,delete on public.compat_records to authenticated;

-- QG : lecture/gestion complète de son organisation.
drop policy if exists "v586 qg read compat" on public.compat_records;
create policy "v586 qg read compat" on public.compat_records
for select to authenticated
using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());

drop policy if exists "v586 qg insert compat" on public.compat_records;
create policy "v586 qg insert compat" on public.compat_records
for insert to authenticated
with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());

drop policy if exists "v586 qg update compat" on public.compat_records;
create policy "v586 qg update compat" on public.compat_records
for update to authenticated
using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id())
with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());

drop policy if exists "v586 qg delete compat" on public.compat_records;
create policy "v586 qg delete compat" on public.compat_records
for delete to authenticated
using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());

-- Agent : ses enregistrements opérationnels + les ressources partagées nécessaires au terrain.
drop policy if exists "v586 agent read compat" on public.compat_records;
create policy "v586 agent read compat" on public.compat_records
for select to authenticated
using (
  public.current_role()='agent'
  and organization_id=public.current_organization_id()
  and (
    owner_external_uid=public.current_profile_external_uid()
    or collection_name in ('documents','flashMessages','roundCheckpoints','planningPublications')
  )
);

drop policy if exists "v586 agent insert compat" on public.compat_records;
create policy "v586 agent insert compat" on public.compat_records
for insert to authenticated
with check (
  public.current_role()='agent'
  and organization_id=public.current_organization_id()
  and owner_external_uid=public.current_profile_external_uid()
  and split_part(collection_name,'/',1) in ('shiftProofs','rounds','roundCheckpointsLogs','pushTokens','alerts','securityIntelLogs','planningAcknowledgements')
);

drop policy if exists "v586 agent update compat" on public.compat_records;
create policy "v586 agent update compat" on public.compat_records
for update to authenticated
using (
  public.current_role()='agent'
  and organization_id=public.current_organization_id()
  and owner_external_uid=public.current_profile_external_uid()
)
with check (
  public.current_role()='agent'
  and organization_id=public.current_organization_id()
  and owner_external_uid=public.current_profile_external_uid()
);

-- Pas de DELETE agent volontairement.

-- L'agent ne reçoit toujours aucun droit UPDATE général sur profiles.
-- Cette RPC ne permet que son état opérationnel, nécessaire au code V5.8.4 :
-- statut / site actuel / lastSeen / présence en ligne.
create or replace function public.sentinelle_v586_update_my_state(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_allowed jsonb := '{}'::jsonb;
  v_key text;
begin
  if v_profile_id is null or public.current_role() not in ('agent','admin','superviseur') then
    raise exception 'Profil authentifié requis' using errcode='42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch invalide' using errcode='22023';
  end if;

  foreach v_key in array array['statut','siteActuel','siteActuelNom','lastSeen','isOnline'] loop
    if p_patch ? v_key then
      v_allowed := v_allowed || jsonb_build_object(v_key,p_patch->v_key);
    end if;
  end loop;

  if v_allowed='{}'::jsonb then
    raise exception 'Aucun champ opérationnel autorisé' using errcode='22023';
  end if;

  update public.profiles
  set firebase_payload=coalesce(firebase_payload,'{}'::jsonb)||v_allowed,
      updated_at=now()
  where id=v_profile_id;

  return jsonb_build_object('ok',true,'profile_id',v_profile_id,'updated',v_allowed);
end;
$$;
revoke all on function public.sentinelle_v586_update_my_state(jsonb) from public;
grant execute on function public.sentinelle_v586_update_my_state(jsonb) to authenticated;

commit;

-- CONTRÔLE : doit retourner compat_records + les deux fonctions.
select to_regclass('public.compat_records') as compat_records,
       to_regprocedure('public.current_profile_external_uid()') as auth_link,
       to_regprocedure('public.sentinelle_v586_update_my_state(jsonb)') as operational_state;
