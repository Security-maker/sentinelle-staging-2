-- SENTINELLE PRO V5.8.4 — STAGING SUPABASE
-- Durcissement RLS Agent + sonde de sécurité auto-annulée.
-- À exécuter UNIQUEMENT sur le projet sentinelle-pro-staging.
-- Ne lit/modifie aucune donnée Firebase.
-- Ne supprime aucune donnée Supabase existante.

begin;

-- Helpers explicites pour ne pas confondre "staff" et "QG".
create or replace function public.is_qg()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_role() in ('admin','superviseur'), false)
$$;

create or replace function public.is_strict_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_role() = 'admin', false)
$$;

create or replace function public.current_site_external_id()
returns text
language sql
stable
security definer
set search_path=public
as $$
  select nullif(p.firebase_payload->>'siteActuel','')
  from public.profiles p
  where p.id = public.current_profile_id()
$$;

-- PROFILES : un agent ne voit que son profil ; le QG voit l'organisation.
drop policy if exists "own profile readable" on public.profiles;
create policy "own profile readable"
on public.profiles for select to authenticated
using (
  id = public.current_profile_id()
  or (public.is_qg() and organization_id = public.current_organization_id())
);

-- La politique d'écriture profils reste réservée au QG.
drop policy if exists "staff manage profiles" on public.profiles;
drop policy if exists "qg manage profiles" on public.profiles;
create policy "qg manage profiles"
on public.profiles for all to authenticated
using (public.is_qg() and organization_id = public.current_organization_id())
with check (public.is_qg() and organization_id = public.current_organization_id());

-- MISSIONS : QG gère ; agent lit et met à jour uniquement ses missions.
drop policy if exists "staff missions" on public.missions;
drop policy if exists "missions qg read" on public.missions;
drop policy if exists "missions qg insert" on public.missions;
drop policy if exists "missions qg update" on public.missions;
drop policy if exists "missions admin delete" on public.missions;
drop policy if exists "missions agent read own" on public.missions;
drop policy if exists "missions agent update own" on public.missions;

create policy "missions qg read"
on public.missions for select to authenticated
using (public.is_qg() and organization_id = public.current_organization_id());

create policy "missions qg insert"
on public.missions for insert to authenticated
with check (public.is_qg() and organization_id = public.current_organization_id());

create policy "missions qg update"
on public.missions for update to authenticated
using (public.is_qg() and organization_id = public.current_organization_id())
with check (public.is_qg() and organization_id = public.current_organization_id());

create policy "missions admin delete"
on public.missions for delete to authenticated
using (public.is_strict_admin() and organization_id = public.current_organization_id());

create policy "missions agent read own"
on public.missions for select to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
);

create policy "missions agent update own"
on public.missions for update to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
)
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
);

-- SHIFTS : miroir du comportement Firestore principal.
drop policy if exists "staff shifts" on public.shifts;
drop policy if exists "shifts qg read" on public.shifts;
drop policy if exists "shifts qg update" on public.shifts;
drop policy if exists "shifts admin delete" on public.shifts;
drop policy if exists "shifts agent read" on public.shifts;
drop policy if exists "shifts agent insert own" on public.shifts;
drop policy if exists "shifts agent update own" on public.shifts;

create policy "shifts qg read"
on public.shifts for select to authenticated
using (public.is_qg() and organization_id = public.current_organization_id());

create policy "shifts qg update"
on public.shifts for update to authenticated
using (public.is_qg() and organization_id = public.current_organization_id())
with check (public.is_qg() and organization_id = public.current_organization_id());

create policy "shifts admin delete"
on public.shifts for delete to authenticated
using (public.is_strict_admin() and organization_id = public.current_organization_id());

create policy "shifts agent read"
on public.shifts for select to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and (
    firebase_agent_uid = public.current_external_uid()
    or (
      status = 'completed'
      and public.current_site_external_id() is not null
      and firebase_site_id = public.current_site_external_id()
    )
  )
);

create policy "shifts agent insert own"
on public.shifts for insert to authenticated
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
);

create policy "shifts agent update own"
on public.shifts for update to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
)
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
);

-- REPORTS : agent lit/crée ses rapports verrouillés ; seul le QG les modifie.
drop policy if exists "staff reports" on public.reports;
drop policy if exists "reports qg read" on public.reports;
drop policy if exists "reports qg update" on public.reports;
drop policy if exists "reports admin delete" on public.reports;
drop policy if exists "reports agent read own" on public.reports;
drop policy if exists "reports agent insert own locked" on public.reports;

create policy "reports qg read"
on public.reports for select to authenticated
using (public.is_qg() and organization_id = public.current_organization_id());

create policy "reports qg update"
on public.reports for update to authenticated
using (public.is_qg() and organization_id = public.current_organization_id())
with check (public.is_qg() and organization_id = public.current_organization_id());

create policy "reports admin delete"
on public.reports for delete to authenticated
using (public.is_strict_admin() and organization_id = public.current_organization_id());

create policy "reports agent read own"
on public.reports for select to authenticated
using (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
);

create policy "reports agent insert own locked"
on public.reports for insert to authenticated
with check (
  public.current_role() = 'agent'
  and organization_id = public.current_organization_id()
  and firebase_agent_uid = public.current_external_uid()
  and payload->>'isLocked' = 'true'
);

-- Sonde STAGING : toutes les écritures de test sont automatiquement annulées
-- grâce aux sous-transactions PL/pgSQL. Elle sert uniquement à prouver les RLS.
create or replace function public.staging_probe_agent_rls_v584()
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid text := public.current_external_uid();
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
    return jsonb_build_object('ok',false,'error','Sonde réservée à un compte agent authentifié.');
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

  -- 1. Un agent ne doit pas pouvoir créer un profil.
  begin
    insert into public.profiles(organization_id,external_uid,role,first_name,last_name,active,firebase_payload)
    values(v_org,'staging-rls-forbidden-profile-'||gen_random_uuid()::text,'agent','Probe','Forbidden',true,'{"staging_rls_probe":true}'::jsonb);
    raise exception '__UNEXPECTED_PROFILE_INSERT_SUCCESS__';
  exception
    when insufficient_privilege then v_profile_insert_blocked := true;
    when others then
      if sqlerrm = '__UNEXPECTED_PROFILE_INSERT_SUCCESS__' then v_profile_insert_blocked := false;
      else raise;
      end if;
  end;

  -- 2. Un agent ne doit pas pouvoir modifier un site.
  select id into v_site_id from public.sites where organization_id=v_org order by id limit 1;
  if v_site_id is not null then
    begin
      update public.sites
      set payload = coalesce(payload,'{}'::jsonb) || '{"staging_rls_probe":true}'::jsonb
      where id=v_site_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        v_site_update_blocked := true;
      else
        raise exception '__UNEXPECTED_SITE_UPDATE_SUCCESS__';
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

  -- 3. Un agent ne doit pas créer une mission.
  begin
    insert into public.missions(organization_id,firebase_id,firebase_agent_uid,status,payload)
    values(v_org,'staging-rls-forbidden-mission-'||gen_random_uuid()::text,v_uid,'planned','{"staging_rls_probe":true}'::jsonb);
    raise exception '__UNEXPECTED_MISSION_INSERT_SUCCESS__';
  exception
    when insufficient_privilege then v_mission_insert_blocked := true;
    when others then
      if sqlerrm = '__UNEXPECTED_MISSION_INSERT_SUCCESS__' then v_mission_insert_blocked := false;
      else raise;
      end if;
  end;

  -- 4. L'agent doit pouvoir mettre à jour SA mission (comme Firestore actuellement).
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

  -- 5. L'agent doit pouvoir créer SON shift. L'insertion est toujours annulée par la sonde.
  begin
    insert into public.shifts(organization_id,firebase_id,firebase_agent_uid,status,started_at,payload)
    values(v_org,'staging-rls-authorized-shift-'||gen_random_uuid()::text,v_uid,'active',now(),'{"staging_rls_probe":true}'::jsonb);
    raise exception '__AUTHORIZED_SHIFT_INSERT_SUCCESS__';
  exception
    when others then
      if sqlerrm = '__AUTHORIZED_SHIFT_INSERT_SUCCESS__' then v_shift_own_insert_allowed := true;
      elsif sqlstate = '42501' then v_shift_own_insert_allowed := false;
      else raise;
      end if;
  end;

  -- 6. L'agent doit pouvoir créer SON rapport verrouillé. Annulé automatiquement.
  begin
    insert into public.reports(organization_id,firebase_id,firebase_agent_uid,occurred_at,category,severity,message,payload)
    values(v_org,'staging-rls-authorized-report-'||gen_random_uuid()::text,v_uid,now(),'Information','Normal','Sonde staging','{"isLocked":true,"staging_rls_probe":true}'::jsonb);
    raise exception '__AUTHORIZED_REPORT_INSERT_SUCCESS__';
  exception
    when others then
      if sqlerrm = '__AUTHORIZED_REPORT_INSERT_SUCCESS__' then v_report_own_insert_allowed := true;
      elsif sqlstate = '42501' then v_report_own_insert_allowed := false;
      else raise;
      end if;
  end;

  -- 7. Un agent ne doit pas pouvoir modifier un rapport déjà enregistré.
  select id into v_report_id
  from public.reports
  where organization_id=v_org and firebase_agent_uid=v_uid
  order by created_at desc limit 1;
  if v_report_id is not null then
    begin
      update public.reports
      set message = message
      where id=v_report_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        v_report_own_update_blocked := true;
      else
        raise exception '__UNEXPECTED_REPORT_UPDATE_SUCCESS__';
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

grant execute on function public.staging_probe_agent_rls_v584() to authenticated;

commit;

-- Contrôle manuel facultatif après exécution :
-- select policyname, cmd from pg_policies
-- where schemaname='public' and tablename in ('profiles','missions','shifts','reports')
-- order by tablename, policyname;
