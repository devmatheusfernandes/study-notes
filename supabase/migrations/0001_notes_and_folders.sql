-- Notes and folders, replacing the client-only localStorage store.
-- RLS is the real access control here (unlike Storage, this data is read
-- and written through the per-request authenticated server client, not a
-- service-role bypass) — see CLAUDE.md for why the two differ.

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete set null,
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index folders_user_parent_idx on public.folders(user_id, parent_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  type text not null default 'nota' check (type in ('nota', 'pdf', 'docx', 'xlsx', 'jwpub', 'arquivo')),
  title text not null default '',
  body text not null default '',
  -- Links to a Supabase Storage object (see lib/storage-config.ts) for file-type notes; null for text notes.
  storage_path text,
  pinned boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived', 'trashed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_user_status_idx on public.notes(user_id, status);
create index notes_user_folder_idx on public.notes(user_id, folder_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;
alter table public.folders enable row level security;

create policy "notes_owner_all" on public.notes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "folders_owner_all" on public.folders
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
