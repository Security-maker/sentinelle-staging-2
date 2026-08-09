-- SENTINELLE PRO V5.8.7 — STAGING STORAGE + AUTH ADMIN HARDENING
-- À exécuter UNIQUEMENT dans sentinelle-pro-staging.
-- Prérequis : V5.8.6 validée.
-- Ne lit/modifie/supprime aucune donnée Firebase.

begin;

do $$
begin
  if to_regprocedure('public.current_profile_external_uid()') is null then
    raise exception 'V5.8.5/V5.8.6 manquante : current_profile_external_uid() absent';
  end if;
end $$;

-- Bucket privé unique pour les photos MCI, preuves de prise de poste et badges.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('report-photos','report-photos',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Retire les anciennes politiques trop larges du socle initial.
drop policy if exists "report photos staff read" on storage.objects;
drop policy if exists "report photos staff insert" on storage.objects;
drop policy if exists "v587 media read" on storage.objects;
drop policy if exists "v587 media insert" on storage.objects;
drop policy if exists "v587 media update" on storage.objects;
drop policy if exists "v587 media delete qg" on storage.objects;

create policy "v587 media read" on storage.objects
for select to authenticated
using (
  bucket_id='report-photos'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and (
    public.current_role() in ('admin','superviseur')
    or (
      public.current_role()='agent'
      and (storage.foldername(name))[2]=public.current_profile_external_uid()
    )
  )
);

create policy "v587 media insert" on storage.objects
for insert to authenticated
with check (
  bucket_id='report-photos'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and (
    public.current_role() in ('admin','superviseur')
    or (
      public.current_role()='agent'
      and (storage.foldername(name))[2]=public.current_profile_external_uid()
    )
  )
);

create policy "v587 media update" on storage.objects
for update to authenticated
using (
  bucket_id='report-photos'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and (
    public.current_role() in ('admin','superviseur')
    or (
      public.current_role()='agent'
      and (storage.foldername(name))[2]=public.current_profile_external_uid()
    )
  )
)
with check (
  bucket_id='report-photos'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and (
    public.current_role() in ('admin','superviseur')
    or (
      public.current_role()='agent'
      and (storage.foldername(name))[2]=public.current_profile_external_uid()
    )
  )
);

create policy "v587 media delete qg" on storage.objects
for delete to authenticated
using (
  bucket_id='report-photos'
  and public.current_role() in ('admin','superviseur')
  and (storage.foldername(name))[1]=public.current_organization_id()::text
);

-- Profils : un superviseur ne peut plus promouvoir un agent en superviseur/admin.
drop policy if exists "staff manage profiles" on public.profiles;
drop policy if exists "qg manage profiles" on public.profiles;
drop policy if exists "v587 admin manage profiles" on public.profiles;
drop policy if exists "v587 supervisor update agents" on public.profiles;

create policy "v587 admin manage profiles" on public.profiles
for all to authenticated
using (public.current_role()='admin' and organization_id=public.current_organization_id())
with check (public.current_role()='admin' and organization_id=public.current_organization_id());

create policy "v587 supervisor update agents" on public.profiles
for update to authenticated
using (
  public.current_role()='superviseur'
  and organization_id=public.current_organization_id()
  and role='agent'
)
with check (
  public.current_role()='superviseur'
  and organization_id=public.current_organization_id()
  and role='agent'
);

-- Documents générés : QG complet ; agent uniquement ses propres documents ; client uniquement ses documents autorisés.
drop policy if exists "documents readable" on public.generated_documents;
drop policy if exists "staff create documents" on public.generated_documents;
drop policy if exists "staff update documents" on public.generated_documents;
drop policy if exists "staff delete documents" on public.generated_documents;
drop policy if exists "v587 generated docs read" on public.generated_documents;
drop policy if exists "v587 generated docs qg insert" on public.generated_documents;
drop policy if exists "v587 generated docs agent insert" on public.generated_documents;
drop policy if exists "v587 generated docs qg update" on public.generated_documents;
drop policy if exists "v587 generated docs agent update" on public.generated_documents;
drop policy if exists "v587 generated docs qg delete" on public.generated_documents;

create policy "v587 generated docs read" on public.generated_documents
for select to authenticated
using (
  organization_id=public.current_organization_id()
  and (
    public.current_role() in ('admin','superviseur')
    or (public.current_role()='agent' and created_by_external_uid=public.current_profile_external_uid())
    or (public.current_role()='client' and client_id is not null and public.can_access_client(client_id))
  )
);
create policy "v587 generated docs qg insert" on public.generated_documents
for insert to authenticated
with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "v587 generated docs agent insert" on public.generated_documents
for insert to authenticated
with check (
  public.current_role()='agent'
  and organization_id=public.current_organization_id()
  and created_by_external_uid=public.current_profile_external_uid()
);
create policy "v587 generated docs qg update" on public.generated_documents
for update to authenticated
using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id())
with check (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());
create policy "v587 generated docs agent update" on public.generated_documents
for update to authenticated
using (
  public.current_role()='agent'
  and organization_id=public.current_organization_id()
  and created_by_external_uid=public.current_profile_external_uid()
)
with check (
  public.current_role()='agent'
  and organization_id=public.current_organization_id()
  and created_by_external_uid=public.current_profile_external_uid()
);
create policy "v587 generated docs qg delete" on public.generated_documents
for delete to authenticated
using (public.current_role() in ('admin','superviseur') and organization_id=public.current_organization_id());

-- Storage PDF : remplace les écritures staff globales par un chemin propriétaire.
drop policy if exists "documents storage read" on storage.objects;
drop policy if exists "documents storage insert" on storage.objects;
drop policy if exists "documents storage update" on storage.objects;
drop policy if exists "v587 documents storage read" on storage.objects;
drop policy if exists "v587 documents storage insert" on storage.objects;
drop policy if exists "v587 documents storage update" on storage.objects;
drop policy if exists "v587 documents storage delete qg" on storage.objects;

create policy "v587 documents storage read" on storage.objects
for select to authenticated
using (
  bucket_id='main-courantes'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and exists (
    select 1 from public.generated_documents d
    where d.storage_bucket=bucket_id and d.storage_path=name
      and d.organization_id=public.current_organization_id()
  )
);
create policy "v587 documents storage insert" on storage.objects
for insert to authenticated
with check (
  bucket_id='main-courantes'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and (
    public.current_role() in ('admin','superviseur')
    or (public.current_role()='agent' and (storage.foldername(name))[2]=public.current_profile_external_uid())
  )
);
create policy "v587 documents storage update" on storage.objects
for update to authenticated
using (
  bucket_id='main-courantes'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and (
    public.current_role() in ('admin','superviseur')
    or (public.current_role()='agent' and (storage.foldername(name))[2]=public.current_profile_external_uid())
  )
)
with check (
  bucket_id='main-courantes'
  and (storage.foldername(name))[1]=public.current_organization_id()::text
  and (
    public.current_role() in ('admin','superviseur')
    or (public.current_role()='agent' and (storage.foldername(name))[2]=public.current_profile_external_uid())
  )
);
create policy "v587 documents storage delete qg" on storage.objects
for delete to authenticated
using (
  bucket_id='main-courantes'
  and public.current_role() in ('admin','superviseur')
  and (storage.foldername(name))[1]=public.current_organization_id()::text
);

commit;

select
  (select public from storage.buckets where id='report-photos') as report_photos_public,
  (select public from storage.buckets where id='main-courantes') as pdf_public,
  to_regprocedure('public.current_profile_external_uid()') as auth_link;
