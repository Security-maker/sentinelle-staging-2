-- Sentinelle Pro V5.9.1 — Espace client production
-- Migration idempotente, limitée au portail client et à la préparation de l'envoi automatique.

begin;

alter table public.clients
  add column if not exists portal_enabled boolean not null default true,
  add column if not exists auto_email boolean not null default false;

create table if not exists public.client_report_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, email)
);

alter table public.client_report_recipients enable row level security;

drop policy if exists "client report recipients readable" on public.client_report_recipients;
drop policy if exists "staff manage client report recipients" on public.client_report_recipients;
create policy "client report recipients readable" on public.client_report_recipients
for select to authenticated
using (
  organization_id=public.current_organization_id()
  and (public.current_role() in ('admin','superviseur') or public.can_access_client(client_id))
);
create policy "staff manage client report recipients" on public.client_report_recipients
for all to authenticated
using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id())
with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());

-- Reconstitue les entités clients à partir des sites migrés, sans dupliquer un client déjà existant.
with site_clients as (
  select
    s.organization_id,
    trim(s.client_name) as client_name,
    max(nullif(trim(s.report_email),'')) as report_email
  from public.sites s
  where nullif(trim(s.client_name),'') is not null
  group by s.organization_id, trim(s.client_name)
)
insert into public.clients (organization_id,firebase_id,name,report_email,active,portal_enabled,auto_email)
select
  sc.organization_id,
  'client:auto:' || md5(lower(sc.client_name)),
  sc.client_name,
  sc.report_email,
  true,
  true,
  false
from site_clients sc
where not exists (
  select 1 from public.clients c
  where c.organization_id=sc.organization_id
    and lower(trim(c.name))=lower(sc.client_name)
);

-- Complète l'e-mail du client lorsqu'il était vide mais présent sur un site.
update public.clients c
set report_email=coalesce(c.report_email, src.report_email), updated_at=now()
from (
  select organization_id, lower(trim(client_name)) as client_key, max(nullif(trim(report_email),'')) as report_email
  from public.sites
  where nullif(trim(client_name),'') is not null
  group by organization_id, lower(trim(client_name))
) src
where c.organization_id=src.organization_id
  and lower(trim(c.name))=src.client_key
  and c.report_email is null
  and src.report_email is not null;

-- Associe chaque site à son client.
update public.sites s
set client_id=(
  select c2.id
  from public.clients c2
  where c2.organization_id=s.organization_id
    and lower(trim(c2.name))=lower(trim(s.client_name))
  order by c2.created_at asc
  limit 1
), updated_at=now()
where nullif(trim(s.client_name),'') is not null
  and s.client_id is distinct from (
    select c3.id
    from public.clients c3
    where c3.organization_id=s.organization_id
      and lower(trim(c3.name))=lower(trim(s.client_name))
    order by c3.created_at asc
    limit 1
  );

-- Tous les sites appartenant à un client sont déclarés dans le portail.
insert into public.client_sites (organization_id,client_id,site_id)
select s.organization_id,s.client_id,s.id
from public.sites s
where s.client_id is not null
on conflict (client_id,site_id) do nothing;

-- Vérifie qu'un compte client peut accéder au site précis d'un document.
create or replace function public.can_access_client_site(target_client uuid, target_firebase_site text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_staff()
  or exists (
    select 1
    from public.client_users cu
    join public.client_sites cs on cs.client_id=cu.client_id
    join public.sites s on s.id=cs.site_id
    where cu.profile_id=public.current_profile_id()
      and cu.client_id=target_client
      and s.organization_id=public.current_organization_id()
      and s.firebase_id=target_firebase_site
  )
$$;

-- Lecture des documents : un client doit être rattaché au client ET au site du PDF.
drop policy if exists "v587 generated docs read" on public.generated_documents;
drop policy if exists "v591 generated docs read" on public.generated_documents;
create policy "v591 generated docs read" on public.generated_documents
for select to authenticated
using (
  organization_id=public.current_organization_id()
  and (
    public.current_role() in ('admin','superviseur')
    or (public.current_role()='agent' and created_by_external_uid=public.current_profile_external_uid())
    or (
      public.current_role()='client'
      and client_id is not null
      and public.can_access_client(client_id)
      and (firebase_site_id is null or public.can_access_client_site(client_id,firebase_site_id))
    )
  )
);

-- Rattache les PDF déjà importés au client du site.
update public.generated_documents d
set client_id=s.client_id, updated_at=now()
from public.sites s
where d.organization_id=s.organization_id
  and d.firebase_site_id=s.firebase_id
  and s.client_id is not null
  and d.client_id is distinct from s.client_id;

-- Le trigger doit aussi renseigner client_id lors des futurs PDF.
create or replace function public.assign_document_client()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.firebase_site_id is not null then
    select s.client_id into new.client_id
    from public.sites s
    where s.organization_id = new.organization_id and s.firebase_id = new.firebase_site_id
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_document_client on public.generated_documents;
create trigger trg_assign_document_client
before insert or update of firebase_site_id,organization_id
on public.generated_documents
for each row execute function public.assign_document_client();

-- Lecture PDF : contrôle explicite du client autorisé en plus de l'organisation.
drop policy if exists "v587 documents storage read" on storage.objects;
create policy "v591 documents storage read" on storage.objects
for select to authenticated
using (
  bucket_id='main-courantes'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and exists (
    select 1 from public.generated_documents d
    where d.storage_bucket=bucket_id
      and d.storage_path=name
      and d.organization_id=public.current_organization_id()
      and (
        public.current_role() in ('admin','superviseur')
        or (public.current_role()='agent' and d.created_by_external_uid=public.current_profile_external_uid())
        or (public.current_role()='client' and d.client_id is not null and public.can_access_client(d.client_id) and (d.firebase_site_id is null or public.can_access_client_site(d.client_id,d.firebase_site_id)))
      )
  )
);

commit;

-- Contrôle lecture seule après migration.
select
  (select count(*) from public.clients) as clients,
  (select count(*) from public.sites where client_id is not null) as sites_rattaches,
  (select count(*) from public.generated_documents where client_id is not null) as pdf_rattaches,
  (select count(*) from public.client_sites) as liens_client_sites,
  (select count(*) from public.profiles where role='client') as comptes_client;
