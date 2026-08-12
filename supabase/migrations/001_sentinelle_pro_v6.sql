-- Sentinelle Pro V6 — socle Supabase compatible avec la passerelle Firebase V5.8
-- À exécuter sur un projet Supabase de STAGING avant toute activation en production.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  auth_user_id uuid unique,
  external_uid text unique,
  role text not null check (role in ('admin','superviseur','agent','client')),
  first_name text,
  last_name text,
  email text,
  phone text,
  active boolean not null default true,
  firebase_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (auth_user_id is not null or external_uid is not null)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  firebase_id text,
  name text not null,
  billing_email text,
  report_email text,
  siret text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, firebase_id)
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  firebase_id text not null,
  name text not null,
  address text,
  client_name text,
  report_email text,
  active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, firebase_id)
);

create table if not exists public.client_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, profile_id)
);

create table if not exists public.client_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, site_id)
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  firebase_id text not null,
  firebase_site_id text,
  firebase_agent_uid text,
  status text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, firebase_id)
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  firebase_id text not null,
  firebase_mission_id text,
  firebase_site_id text,
  firebase_agent_uid text,
  status text,
  started_at timestamptz,
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, firebase_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  firebase_id text not null,
  firebase_mission_id text,
  firebase_shift_id text,
  firebase_site_id text,
  firebase_agent_uid text,
  occurred_at timestamptz,
  category text,
  severity text,
  message text,
  photo_bucket text,
  photo_path text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, firebase_id)
);

create table if not exists public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  firebase_id text not null,
  firebase_site_id text,
  firebase_mission_id text,
  type text not null default 'mission',
  title text not null,
  row_count integer not null default 0,
  storage_bucket text not null default 'main-courantes',
  storage_path text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  delivery_status text not null default 'pending',
  created_by_external_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, firebase_id)
);

create table if not exists public.document_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.generated_documents(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (document_id, email)
);

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.generated_documents(id) on delete cascade,
  recipient_email text not null,
  provider text not null default 'brevo',
  provider_message_id text,
  idempotency_key text not null unique,
  status text not null default 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated by default as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_external_uid text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_external_uid on public.profiles(external_uid);
create index if not exists idx_profiles_auth_user_id on public.profiles(auth_user_id);
create index if not exists idx_sites_firebase_id on public.sites(organization_id,firebase_id);
create index if not exists idx_reports_chrono on public.reports(organization_id,firebase_mission_id,occurred_at,id);
create index if not exists idx_documents_client_date on public.generated_documents(client_id,created_at desc);
create index if not exists idx_documents_site_date on public.generated_documents(organization_id,firebase_site_id,created_at desc);

-- Résolution du compte courant pour Supabase Auth ou Firebase Third-Party Auth.
create or replace function public.current_external_uid()
returns text language sql stable as $$
  select nullif(auth.jwt()->>'sub','')
$$;

create or replace function public.current_profile_id()
returns uuid language sql stable security definer set search_path=public as $$
  select p.id from public.profiles p
  where p.active = true
    and (p.auth_user_id::text = public.current_external_uid() or p.external_uid = public.current_external_uid())
  limit 1
$$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public as $$
  select p.organization_id from public.profiles p where p.id = public.current_profile_id()
$$;

create or replace function public.current_role()
returns text language sql stable security definer set search_path=public as $$
  select p.role from public.profiles p where p.id = public.current_profile_id()
$$;

create or replace function public.is_staff()
returns boolean language sql stable as $$
  select coalesce(public.current_role() in ('admin','superviseur','agent'), false)
$$;

create or replace function public.can_access_client(target_client uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_staff()
  or exists (
    select 1 from public.client_users cu
    where cu.profile_id = public.current_profile_id() and cu.client_id = target_client
  )
$$;

-- Associe automatiquement un document au client du site migré.
create or replace function public.assign_document_client()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.client_id is null and new.firebase_site_id is not null then
    select s.client_id into new.client_id from public.sites s
    where s.organization_id = new.organization_id and s.firebase_id = new.firebase_site_id
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_assign_document_client on public.generated_documents;
create trigger trg_assign_document_client before insert or update of firebase_site_id,organization_id
on public.generated_documents for each row execute function public.assign_document_client();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.sites enable row level security;
alter table public.client_users enable row level security;
alter table public.client_sites enable row level security;
alter table public.missions enable row level security;
alter table public.shifts enable row level security;
alter table public.reports enable row level security;
alter table public.generated_documents enable row level security;
alter table public.document_recipients enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.audit_logs enable row level security;

create policy "organization readable" on public.organizations for select to authenticated using (id=public.current_organization_id());
create policy "own profile readable" on public.profiles for select to authenticated using (id=public.current_profile_id() or (public.is_staff() and organization_id=public.current_organization_id()));
create policy "staff manage profiles" on public.profiles for all to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id()) with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "client entities readable" on public.clients for select to authenticated using (organization_id=public.current_organization_id() and public.can_access_client(id));
create policy "staff manage clients" on public.clients for all to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id()) with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "sites readable" on public.sites for select to authenticated using (organization_id=public.current_organization_id() and (public.is_staff() or public.can_access_client(client_id)));
create policy "staff manage sites" on public.sites for all to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id()) with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "client user links readable" on public.client_users for select to authenticated using (organization_id=public.current_organization_id() and (profile_id=public.current_profile_id() or public.current_role() in ('admin','superviseur')));
create policy "staff manage client user links" on public.client_users for all to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id()) with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "client site links readable" on public.client_sites for select to authenticated using (organization_id=public.current_organization_id() and public.can_access_client(client_id));
create policy "staff manage client site links" on public.client_sites for all to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id()) with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());

create policy "staff missions" on public.missions for all to authenticated using (public.is_staff() and organization_id=public.current_organization_id()) with check (public.is_staff() and organization_id=public.current_organization_id());
create policy "staff shifts" on public.shifts for all to authenticated using (public.is_staff() and organization_id=public.current_organization_id()) with check (public.is_staff() and organization_id=public.current_organization_id());
create policy "staff reports" on public.reports for all to authenticated using (public.is_staff() and organization_id=public.current_organization_id()) with check (public.is_staff() and organization_id=public.current_organization_id());

create policy "documents readable" on public.generated_documents for select to authenticated using (
  organization_id=public.current_organization_id()
  and (public.is_staff() or (client_id is not null and public.can_access_client(client_id)))
);
create policy "staff create documents" on public.generated_documents for insert to authenticated with check (public.is_staff() and organization_id=public.current_organization_id());
create policy "staff update documents" on public.generated_documents for update to authenticated using (public.is_staff() and organization_id=public.current_organization_id()) with check (public.is_staff() and organization_id=public.current_organization_id());
create policy "staff delete documents" on public.generated_documents for delete to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "recipients readable" on public.document_recipients for select to authenticated using (organization_id=public.current_organization_id() and (public.is_staff() or public.can_access_client(client_id)));
create policy "staff manage recipients" on public.document_recipients for all to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id()) with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "staff deliveries" on public.email_deliveries for select to authenticated using (public.is_staff() and organization_id=public.current_organization_id());
create policy "staff audit logs" on public.audit_logs for select to authenticated using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "authenticated insert audit" on public.audit_logs for insert to authenticated with check (organization_id=public.current_organization_id());

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('main-courantes','main-courantes',false,15728640,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('report-photos','report-photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "documents storage read" on storage.objects for select to authenticated using (
  bucket_id='main-courantes'
  and exists (
    select 1 from public.generated_documents d
    where d.storage_bucket=bucket_id and d.storage_path=name
      and d.organization_id=public.current_organization_id()
      and (public.is_staff() or (d.client_id is not null and public.can_access_client(d.client_id)))
  )
);
create policy "documents storage insert" on storage.objects for insert to authenticated with check (
  bucket_id='main-courantes' and public.is_staff() and (storage.foldername(name))[1]=public.current_organization_id()::text
);
create policy "documents storage update" on storage.objects for update to authenticated using (
  bucket_id='main-courantes' and public.is_staff() and (storage.foldername(name))[1]=public.current_organization_id()::text
) with check (
  bucket_id='main-courantes' and public.is_staff() and (storage.foldername(name))[1]=public.current_organization_id()::text
);

create policy "report photos staff read" on storage.objects for select to authenticated using (
  bucket_id='report-photos' and public.is_staff() and (storage.foldername(name))[1]=public.current_organization_id()::text
);
create policy "report photos staff insert" on storage.objects for insert to authenticated with check (
  bucket_id='report-photos' and public.is_staff() and (storage.foldername(name))[1]=public.current_organization_id()::text
);

-- Le projet Firebase azzerap-7b440 doit être ajouté dans Authentication > Third-party Auth.
-- Les JWT Firebase doivent recevoir le custom claim role='authenticated'.
