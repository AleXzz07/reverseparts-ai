create extension if not exists "pgcrypto";

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null,
  notes text not null default '',
  status text not null default 'draft' check (status in ('draft', 'generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.components
add column if not exists folder_id uuid references public.folders(id) on delete set null;

create table if not exists public.component_files (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  file_type text not null,
  file_size bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.stl_geometry_analyses (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  component_file_id uuid not null references public.component_files(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('success', 'failed')),
  error_message text,
  bounding_box jsonb,
  dimensions jsonb,
  volume_estimated double precision,
  surface_area double precision,
  triangle_count integer,
  presumed_unit text not null default 'mm presunti (STL unitless)',
  selected_unit text not null default 'mm' check (selected_unit in ('mm', 'cm', 'm', 'inch')),
  material_label text,
  density_g_cm3 double precision,
  volume_cm3 double precision,
  estimated_weight_g double precision,
  estimated_weight_kg double precision,
  holes_detected jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(component_file_id)
);

create table if not exists public.cad_feature_extractions (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  component_file_id uuid not null references public.component_files(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('success', 'failed')),
  error_message text,
  extracted_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(component_file_id)
);

alter table public.stl_geometry_analyses
add column if not exists selected_unit text not null default 'mm' check (selected_unit in ('mm', 'cm', 'm', 'inch')),
add column if not exists material_label text,
add column if not exists density_g_cm3 double precision,
add column if not exists volume_cm3 double precision,
add column if not exists estimated_weight_g double precision,
add column if not exists estimated_weight_kg double precision,
add column if not exists holes_detected jsonb not null default '[]'::jsonb;

create index if not exists folders_user_created_idx on public.folders(user_id, created_at desc);
create index if not exists components_user_created_idx on public.components(user_id, created_at desc);
create index if not exists components_folder_created_idx on public.components(folder_id, created_at desc);
create index if not exists component_files_component_idx on public.component_files(component_id);
create index if not exists ai_reports_component_created_idx on public.ai_reports(component_id, created_at desc);
create index if not exists stl_geometry_component_idx on public.stl_geometry_analyses(component_id);
create index if not exists cad_feature_extractions_component_idx on public.cad_feature_extractions(component_id);

alter table public.folders enable row level security;
alter table public.components enable row level security;
alter table public.component_files enable row level security;
alter table public.ai_reports enable row level security;
alter table public.stl_geometry_analyses enable row level security;
alter table public.cad_feature_extractions enable row level security;

drop policy if exists "Users can manage own folders" on public.folders;
create policy "Users can manage own folders"
on public.folders for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage own components" on public.components;
create policy "Users can manage own components"
on public.components for all
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and (
    folder_id is null
    or exists (
      select 1
      from public.folders
      where folders.id = components.folder_id
      and folders.user_id = auth.uid()
    )
  )
);

drop policy if exists "Users can manage own component files" on public.component_files;
create policy "Users can manage own component files"
on public.component_files for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage own AI reports" on public.ai_reports;
create policy "Users can manage own AI reports"
on public.ai_reports for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage own STL geometry analyses" on public.stl_geometry_analyses;
create policy "Users can manage own STL geometry analyses"
on public.stl_geometry_analyses for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can manage own CAD feature extractions" on public.cad_feature_extractions;
create policy "Users can manage own CAD feature extractions"
on public.cad_feature_extractions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('component-files', 'component-files', false)
on conflict (id) do nothing;

drop policy if exists "Users can upload files in own folder" on storage.objects;
create policy "Users can upload files in own folder"
on storage.objects for insert
with check (
  bucket_id = 'component-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can read own files" on storage.objects;
create policy "Users can read own files"
on storage.objects for select
using (
  bucket_id = 'component-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update own files" on storage.objects;
create policy "Users can update own files"
on storage.objects for update
using (
  bucket_id = 'component-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete own files" on storage.objects;
create policy "Users can delete own files"
on storage.objects for delete
using (
  bucket_id = 'component-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);
