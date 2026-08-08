-- SENTINELLE PRO V5.8.4 — STAGING SUPABASE
-- Étape 5 : nettoyage sécurisé du scénario métier de bout en bout.
-- À exécuter UNIQUEMENT sur le projet sentinelle-pro-staging.
-- Cette fonction ne touche jamais Firebase ni les lignes métier normales.

create or replace function public.staging_cleanup_business_flow_v584(p_flow_id text)
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

  if p_flow_id is null or p_flow_id !~ '^v584-[0-9]+-[a-zA-Z0-9-]+$' then
    raise exception 'Identifiant de scénario staging invalide' using errcode='22023';
  end if;

  delete from public.reports
  where organization_id = v_org
    and firebase_id like 'staging-flow-%'
    and payload->>'staging_business_flow' = 'true'
    and payload->>'staging_flow_id' = p_flow_id;
  get diagnostics v_reports = row_count;

  delete from public.shifts
  where organization_id = v_org
    and firebase_id like 'staging-flow-%'
    and payload->>'staging_business_flow' = 'true'
    and payload->>'staging_flow_id' = p_flow_id;
  get diagnostics v_shifts = row_count;

  delete from public.missions
  where organization_id = v_org
    and firebase_id like 'staging-flow-%'
    and payload->>'staging_business_flow' = 'true'
    and payload->>'staging_flow_id' = p_flow_id;
  get diagnostics v_missions = row_count;

  return jsonb_build_object(
    'ok', true,
    'flow_id', p_flow_id,
    'reports_deleted', v_reports,
    'shifts_deleted', v_shifts,
    'missions_deleted', v_missions
  );
end
$$;

revoke all on function public.staging_cleanup_business_flow_v584(text) from public;
grant execute on function public.staging_cleanup_business_flow_v584(text) to authenticated;

comment on function public.staging_cleanup_business_flow_v584(text)
is 'STAGING ONLY — supprime exclusivement les lignes marquées staging_business_flow pour le scénario V5.8.4 demandé par le QG.';
