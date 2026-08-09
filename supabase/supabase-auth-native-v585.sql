-- SENTINELLE PRO V5.8.5 — STAGING SUPABASE AUTH NATIF
-- À exécuter UNIQUEMENT sur le projet sentinelle-pro-staging.
-- Objectif : faire fonctionner les RLS Agent avec un JWT Supabase natif.
-- Aucune donnée métier existante n'est supprimée ou modifiée.

begin;

-- Le JWT Supabase contient auth.users.id dans sub. Le profil métier conserve
-- encore external_uid = ancien UID Firebase afin de rester compatible avec
-- les colonnes firebase_agent_uid déjà migrées.
create or replace function public.current_profile_external_uid()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select p.external_uid
  from public.profiles p
  where p.id = public.current_profile_id()
$$;

grant execute on function public.current_profile_external_uid() to authenticated;

-- MISSIONS : l'agent est reconnu via son profil Supabase Auth, puis son
-- external_uid historique est comparé à firebase_agent_uid.
drop policy if exists "missions agent read own" on public.missions;
create policy "missions agent read own"
on public.missions for select to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
);

drop policy if exists "missions agent update own" on public.missions;
create policy "missions agent update own"
on public.missions for update to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
)
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
);

-- SHIFTS.
drop policy if exists "shifts agent read" on public.shifts;
create policy "shifts agent read"
on public.shifts for select to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and (
    firebase_agent_uid = public.current_profile_external_uid()
    or (
      status = 'completed'
      and public.current_site_external_id() is not null
      and firebase_site_id = public.current_site_external_id()
    )
  )
);

drop policy if exists "shifts agent insert own" on public.shifts;
create policy "shifts agent insert own"
on public.shifts for insert to authenticated
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
);

drop policy if exists "shifts agent update own" on public.shifts;
create policy "shifts agent update own"
on public.shifts for update to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
)
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
);

-- REPORTS.
drop policy if exists "reports agent read own" on public.reports;
create policy "reports agent read own"
on public.reports for select to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
);

drop policy if exists "reports agent insert own locked" on public.reports;
create policy "reports agent insert own locked"
on public.reports for insert to authenticated
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_profile_external_uid()
  and payload->>'isLocked' = 'true'
);

-- Sonde RLS dédiée à V5.8.5 / Supabase Auth natif.
create or replace function public.staging_probe_agent_rls_v585()
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid text := public.current_profile_external_uid();
  v_org uuid := public.current_organization_id();
  v_role text := public.current_role();
  v_site_id uuid;
  v_mission_id uuid;
  v_report_id uuid;
  v_rows integer := 0;
  v_profile_insert_blocked boolean := false;
  v_site_update_blocked boolean := false;
  v_mission_insert_blocked boolean := false;
  v_mission_own_update_allowed boolean := null;
  v_shift_own_insert_allowed boolean := false;
  v_report_own_insert_allowed boolean := false;
  v_report_own_update_blocked boolean := null;
  v_foreign_profiles_visible integer := 0;
  v_foreign_missions_visible integer := 0;
  v_foreign_reports_visible integer := 0;
begin
  if v_role <> 'agent' or v_uid is null or v_org is null then
    return jsonb_build_object('ok',false,'error','Sonde réservée à un compte agent Supabase Auth correctement relié.');
  end if;

  select count(*) into v_foreign_profiles_visible
  from public.profiles
  where external_uid is distinct from v_uid;

  select count(*) into v_foreign_missions_visible
  from public.missions
  where firebase_agent_uid is distinct from v_uid;

  select count(*) into v_foreign_reports_visible
  from public.reports
  where firebase_agent_uid is distinct from v_uid;

  begin
    insert into public.profiles(organization_id,external_uid,role,first_name,last_name,active,firebase_payload)
    values(v_org,'staging-v585-forbidden-profile-'||gen_random_uuid()::text,'agent','Probe','Forbidden',true,'{"staging_rls_probe":true}'::jsonb);
    raise exception '__UNEXPECTED_PROFILE_INSERT_SUCCESS__';
  exception
    when insufficient_privilege then v_profile_insert_blocked := true;
    when others then
      if sqlerrm = '__UNEXPECTED_PROFILE_INSERT_SUCCESS__' then v_profile_insert_blocked := false;
      else raise;
      end if;
  end;

  select id into v_site_id from public.sites where organization_id=v_org order by id limit 1;
  if v_site_id is not null then
    begin
      update public.sites
      set payload = coalesce(payload,'{}'::jsonb) || '{"staging_rls_probe":true}'::jsonb
      where id=v_site_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_site_update_blocked := true;
      else raise exception '__UNEXPECTED_SITE_UPDATE_SUCCESS__';
      end if;
    exception
      when insufficient_privilege then v_site_update_blocked := true;
      when others then
        if sqlerrm = '__UNEXPECTED_SITE_UPDATE_SUCCESS__' then v_site_update_blocked := false;
        else raise;
        end if;
    end;
  else
    v_site_update_blocked := true;
  end if;

  begin
    insert into public.missions(organization_id,firebase_id,firebase_agent_uid,status,payload)
    values(v_org,'staging-v585-forbidden-mission-'||gen_random_uuid()::text,v_uid,'planned','{"staging_rls_probe":true}'::jsonb);
    raise exception '__UNEXPECTED_MISSION_INSERT_SUCCESS__';
  exception
    when insufficient_privilege then v_mission_insert_blocked := true;
    when others then
      if sqlerrm = '__UNEXPECTED_MISSION_INSERT_SUCCESS__' then v_mission_insert_blocked := false;
      else raise;
      end if;
  end;

  select id into v_mission_id
  from public.missions
  where organization_id=v_org and firebase_agent_uid=v_uid
  order by created_at desc limit 1;
  if v_mission_id is not null then
    begin
      update public.missions
      set payload = coalesce(payload,'{}'::jsonb) || '{"staging_rls_probe":true}'::jsonb
      where id=v_mission_id;
      get diagnostics v_rows = row_count;
      if v_rows = 1 then raise exception '__AUTHORIZED_MISSION_UPDATE_SUCCESS__'; end if;
      v_mission_own_update_allowed := false;
    exception
      when others then
        if sqlerrm = '__AUTHORIZED_MISSION_UPDATE_SUCCESS__' then v_mission_own_update_allowed := true;
        elsif sqlstate = '42501' then v_mission_own_update_allowed := false;
        else raise;
        end if;
    end;
  end if;

  begin
    insert into public.shifts(organization_id,firebase_id,firebase_agent_uid,status,started_at,payload)
    values(v_org,'staging-v585-authorized-shift-'||gen_random_uuid()::text,v_uid,'active',now(),'{"staging_rls_probe":true}'::jsonb);
    raise exception '__AUTHORIZED_SHIFT_INSERT_SUCCESS__';
  exception
    when others then
      if sqlerrm = '__AUTHORIZED_SHIFT_INSERT_SUCCESS__' then v_shift_own_insert_allowed := true;
      elsif sqlstate = '42501' then v_shift_own_insert_allowed := false;
      else raise;
      end if;
  end;

  begin
    insert into public.reports(organization_id,firebase_id,firebase_agent_uid,occurred_at,category,severity,message,payload)
    values(v_org,'staging-v585-authorized-report-'||gen_random_uuid()::text,v_uid,now(),'Information','Normal','Sonde staging','{"isLocked":true,"staging_rls_probe":true}'::jsonb);
    raise exception '__AUTHORIZED_REPORT_INSERT_SUCCESS__';
  exception
    when others then
      if sqlerrm = '__AUTHORIZED_REPORT_INSERT_SUCCESS__' then v_report_own_insert_allowed := true;
      elsif sqlstate = '42501' then v_report_own_insert_allowed := false;
      else raise;
      end if;
  end;

  select id into v_report_id
  from public.reports
  where organization_id=v_org and firebase_agent_uid=v_uid
  order by created_at desc limit 1;
  if v_report_id is not null then
    begin
      update public.reports set message = message where id=v_report_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_report_own_update_blocked := true;
      else raise exception '__UNEXPECTED_REPORT_UPDATE_SUCCESS__';
      end if;
    exception
      when insufficient_privilege then v_report_own_update_blocked := true;
      when others then
        if sqlerrm = '__UNEXPECTED_REPORT_UPDATE_SUCCESS__' then v_report_own_update_blocked := false;
        else raise;
        end if;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'external_uid', v_uid,
    'foreign_profiles_visible', v_foreign_profiles_visible,
    'foreign_missions_visible', v_foreign_missions_visible,
    'foreign_reports_visible', v_foreign_reports_visible,
    'profile_insert_blocked', v_profile_insert_blocked,
    'site_update_blocked', v_site_update_blocked,
    'mission_insert_blocked', v_mission_insert_blocked,
    'mission_own_update_allowed', v_mission_own_update_allowed,
    'shift_own_insert_allowed', v_shift_own_insert_allowed,
    'report_own_insert_allowed', v_report_own_insert_allowed,
    'report_own_update_blocked', v_report_own_update_blocked
  );
end;
$$;

grant execute on function public.staging_probe_agent_rls_v585() to authenticated;

-- Nettoyage du scénario métier V5.8.5.
create or replace function public.staging_cleanup_business_flow_v585(p_flow_id text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid := public.current_organization_id();
  v_role text := public.current_role();
  v_reports integer := 0;
  v_shifts integer := 0;
  v_missions integer := 0;
begin
  if v_role not in ('admin','superviseur') or v_org is null then
    raise exception 'Nettoyage réservé au QG authentifié' using errcode='42501';
  end if;

  if p_flow_id is null or p_flow_id !~ '^v585-[0-9]+-[a-zA-Z0-9-]+$' then
    raise exception 'Identifiant de scénario staging invalide' using errcode='22023';
  end if;

  delete from public.reports
  where organization_id=v_org
    and firebase_id like 'staging-flow-%'
    and payload->>'staging_business_flow'='true'
    and payload->>'staging_flow_id'=p_flow_id;
  get diagnostics v_reports = row_count;

  delete from public.shifts
  where organization_id=v_org
    and firebase_id like 'staging-flow-%'
    and payload->>'staging_business_flow'='true'
    and payload->>'staging_flow_id'=p_flow_id;
  get diagnostics v_shifts = row_count;

  delete from public.missions
  where organization_id=v_org
    and firebase_id like 'staging-flow-%'
    and payload->>'staging_business_flow'='true'
    and payload->>'staging_flow_id'=p_flow_id;
  get diagnostics v_missions = row_count;

  return jsonb_build_object(
    'ok',true,
    'flow_id',p_flow_id,
    'reports_deleted',v_reports,
    'shifts_deleted',v_shifts,
    'missions_deleted',v_missions
  );
end;
$$;

revoke all on function public.staging_cleanup_business_flow_v585(text) from public;
grant execute on function public.staging_cleanup_business_flow_v585(text) to authenticated;

commit;

-- Contrôle facultatif : les deux comptes déjà reliés doivent apparaître ici.
select email, role, auth_user_id, external_uid
from public.profiles
where auth_user_id is not null
order by role, email;
