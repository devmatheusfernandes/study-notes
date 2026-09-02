-- Tags: a second, N-to-N organization axis for notes/files, independent of folders.
-- Follows the same owner-only RLS convention as notes/folders (0001_notes_and_folders.sql).

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  color text not null default '#f97316',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index tags_user_idx on public.tags(user_id);

-- Join table for the notes<->tags many-to-many relationship. Carries its own
-- `user_id` (rather than relying on a join through `notes`/`tags`) because RLS
-- policies can't easily traverse a join — same reasoning as `files` bucket
-- ownership checks in app/(app)/files-actions.ts.
create table public.note_tags (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

create index note_tags_tag_idx on public.note_tags(tag_id);
create index note_tags_note_idx on public.note_tags(note_id);

create trigger tags_set_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();

alter table public.tags enable row level security;
alter table public.note_tags enable row level security;

create policy "tags_owner_all" on public.tags
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "note_tags_owner_all" on public.note_tags
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
