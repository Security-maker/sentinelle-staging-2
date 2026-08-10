-- =========================================================
-- SENTINELLE PRO STAGING · V5.8.8.6
-- Anti-doublon prise de poste : 1 seul shift actif / agent
-- Projet STAGING uniquement avant bascule production.
-- =========================================================

begin;

-- 1) Nettoie les doublons actifs déjà présents.
-- On conserve le shift actif le plus récent par agent et on annule les autres.
with ranked_active as (
  select
    id,
    row_number() over (
      partition by organization_id, firebase_agent_uid
      order by coalesce(started_at, created_at) desc, created_at desc, id desc
    ) as rn
  from public.shifts
  where status = 'active'
    and firebase_agent_uid is not null
)
update public.shifts s
set
  status = 'cancelled',
  completed_at = coalesce(s.completed_at, now()),
  updated_at = now(),
  payload = jsonb_set(
    jsonb_set(coalesce(s.payload, '{}'::jsonb), '{duplicateAutoClosed}', 'true'::jsonb, true),
    '{duplicateAutoClosedReason}',
    to_jsonb('V5.8.8.6 anti-doublon prise de poste'::text),
    true
  )
from ranked_active r
where s.id = r.id
  and r.rn > 1;

-- 2) Garde-fou atomique côté PostgreSQL.
-- Deux clics/requêtes simultanés ne pourront plus créer deux shifts actifs.
create unique index if not exists uq_shifts_one_active_per_agent
  on public.shifts (organization_id, firebase_agent_uid)
  where status = 'active'
    and firebase_agent_uid is not null;

commit;

-- 3) Contrôles : cette requête doit retourner 0 ligne.
select
  organization_id,
  firebase_agent_uid,
  count(*) as active_shift_count
from public.shifts
where status = 'active'
  and firebase_agent_uid is not null
group by organization_id, firebase_agent_uid
having count(*) > 1;

-- 4) Vérifie que l'index existe.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'shifts'
  and indexname = 'uq_shifts_one_active_per_agent';
