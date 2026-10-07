-- Which Bible texts each personal note cites, so the Bible reader's "Pessoal"
-- tab can list the notes that mention the chapter/verse being read.
--
-- `notes.title`/`notes.body` are encrypted at the application layer, so this
-- cannot be derived by SQL after the fact: the Server Actions that save a note
-- already hold the plaintext and parse it then (see lib/bible/note-scripture-
-- sync.ts). Only the scripture coordinates are stored in the clear — enough
-- to ask "which notes cite Mateus 5?" — while the surrounding excerpt
-- (`snippet`) is encrypted like the note text it was cut from.
create table public.note_scripture_refs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  book_order smallint not null,
  chapter smallint not null,
  verse smallint,
  end_verse smallint,
  snippet text
);

create index note_scripture_refs_lookup_idx
  on public.note_scripture_refs(user_id, book_order, chapter);
create index note_scripture_refs_note_idx on public.note_scripture_refs(note_id);

alter table public.note_scripture_refs enable row level security;

create policy "note_scripture_refs_owner_all" on public.note_scripture_refs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Marks a note as already parsed, so the one-off backfill of notes that
-- existed before this table (and notes that legitimately cite nothing) isn't
-- redone forever. Same role as global_videos.scriptures_indexed_at.
alter table public.notes add column scriptures_indexed_at timestamptz;

-- The generic set_updated_at() trigger would bump `updated_at` on the update
-- that merely stamps scriptures_indexed_at, which sorts the note to the top of
-- the list and shows a phantom "edited just now". Notes get their own trigger
-- function that leaves updated_at alone when that stamp is the only change.
create or replace function public.notes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'scriptures_indexed_at' - 'updated_at')
     is not distinct from (to_jsonb(old) - 'scriptures_indexed_at' - 'updated_at') then
    new.updated_at = old.updated_at;
  else
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.notes_set_updated_at();
