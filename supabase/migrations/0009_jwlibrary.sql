-- Imported JW Library `.jwlibrary` backups: the user's own notes, highlights
-- (UserMark/BlockRange), tags, bookmarks and study-answer fields exported
-- from the official app. See data/jwlibrary_schema.md for the source schema
-- this is modeled on.
--
-- One `jwlibrary_backups` row per upload, same note_id-FK-with-cascade shape
-- as jwpub_publications (0002) — deleting the note drops everything here.
--
-- `jwlibrary_notes.content`/`title` are the user's own free-text writing, so
-- they're encrypted like notes.title/body (see lib/encryption.ts), same as
-- jwpub_answers (0007). Everything else here is structural (location, color,
-- token ranges, tag names) and stays unencrypted, like jwpub_chapters.
--
-- Every table stores the source Location fields directly (denormalized,
-- rather than a shared Location table like the source schema) plus two
-- "already resolved at import time" pointers: resolved_publication_id /
-- resolved_chapter_id. A row with both null just means that Bible verse or
-- publication chapter isn't resolvable yet (Bible always resolves via
-- public.bible_verses; a publication only resolves if that .jwpub has
-- already been imported by this same user) — shown "loose" (title/content,
-- no context), same fallback data/jwlibrary_schema.md itself recommends.

create table public.jwlibrary_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid not null unique references public.notes(id) on delete cascade,
  device_name text,
  schema_version integer,
  imported_at timestamptz not null default now()
);

-- Shared location columns, repeated on every table below (Postgres has no
-- "include" mechanism for this — kept consistent by convention/comment):
--   book_number, chapter_number       -- Bible reference (Location.BookNumber/ChapterNumber)
--   key_symbol, meps_language,
--   issue_tag_number, meps_document_id -- publication reference (Location.KeySymbol/MepsLanguage/IssueTagNumber/DocumentId)
--   track                              -- media reference (Location.Track)
--   location_type                      -- Location.Type (0-3, see schema doc)
--   resolved_publication_id            -- FK jwpub_publications, set at import time if matched
--   resolved_chapter_id                -- FK jwpub_chapters, set at import time if matched

create table public.jwlibrary_usermarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  backup_id uuid not null references public.jwlibrary_backups(id) on delete cascade,
  source_guid text not null,
  color_index integer not null,
  style_index integer not null,
  version integer not null,
  book_number integer,
  chapter_number integer,
  key_symbol text,
  meps_language integer,
  issue_tag_number integer,
  meps_document_id integer,
  track integer,
  location_type integer,
  resolved_publication_id uuid references public.jwpub_publications(id) on delete set null,
  resolved_chapter_id uuid references public.jwpub_chapters(id) on delete set null,
  unique (user_id, source_guid)
);

create index jwlibrary_usermarks_backup_idx on public.jwlibrary_usermarks(backup_id);

create table public.jwlibrary_blockranges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  usermark_id uuid not null references public.jwlibrary_usermarks(id) on delete cascade,
  block_type integer not null,
  identifier integer not null,
  start_token integer,
  end_token integer
);

create index jwlibrary_blockranges_usermark_idx on public.jwlibrary_blockranges(usermark_id);

create table public.jwlibrary_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  backup_id uuid not null references public.jwlibrary_backups(id) on delete cascade,
  source_guid text not null,
  user_mark_id uuid references public.jwlibrary_usermarks(id) on delete set null,
  title text not null default '',
  content text not null default '',
  block_type integer not null default 0,
  block_identifier integer,
  source_created_at timestamptz,
  source_last_modified timestamptz,
  book_number integer,
  chapter_number integer,
  key_symbol text,
  meps_language integer,
  issue_tag_number integer,
  meps_document_id integer,
  track integer,
  location_type integer,
  resolved_publication_id uuid references public.jwpub_publications(id) on delete set null,
  resolved_chapter_id uuid references public.jwpub_chapters(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_guid)
);

create index jwlibrary_notes_backup_idx on public.jwlibrary_notes(backup_id);
create index jwlibrary_notes_resolved_chapter_idx on public.jwlibrary_notes(resolved_chapter_id);

create table public.jwlibrary_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  backup_id uuid not null references public.jwlibrary_backups(id) on delete cascade,
  tag_type integer not null, -- 0 = Favorite (special), 1 = user-created
  name text
);

create index jwlibrary_tags_backup_idx on public.jwlibrary_tags(backup_id);

create table public.jwlibrary_tag_map (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tag_id uuid not null references public.jwlibrary_tags(id) on delete cascade,
  note_id uuid references public.jwlibrary_notes(id) on delete cascade,
  -- Location-only tag (a chapter/verse tagged without a note attached to it) —
  -- same location columns as above, denormalized rather than a shared row.
  book_number integer,
  chapter_number integer,
  key_symbol text,
  meps_language integer,
  issue_tag_number integer,
  meps_document_id integer,
  track integer,
  location_type integer,
  resolved_publication_id uuid references public.jwpub_publications(id) on delete set null,
  resolved_chapter_id uuid references public.jwpub_chapters(id) on delete set null,
  position integer not null default 0,
  check (
    (note_id is not null and book_number is null and key_symbol is null and location_type is null) or
    (note_id is null)
  )
);

create index jwlibrary_tag_map_tag_idx on public.jwlibrary_tag_map(tag_id);
create index jwlibrary_tag_map_note_idx on public.jwlibrary_tag_map(note_id);

create table public.jwlibrary_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  backup_id uuid not null references public.jwlibrary_backups(id) on delete cascade,
  title text not null default '',
  snippet text,
  slot integer not null default 0,
  block_type integer not null default 0,
  block_identifier integer,
  book_number integer,
  chapter_number integer,
  key_symbol text,
  meps_language integer,
  issue_tag_number integer,
  meps_document_id integer,
  track integer,
  location_type integer,
  resolved_publication_id uuid references public.jwpub_publications(id) on delete set null,
  resolved_chapter_id uuid references public.jwpub_chapters(id) on delete set null
);

create index jwlibrary_bookmarks_backup_idx on public.jwlibrary_bookmarks(backup_id);

create table public.jwlibrary_input_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  backup_id uuid not null references public.jwlibrary_backups(id) on delete cascade,
  text_tag text not null,
  value text not null default '',
  book_number integer,
  chapter_number integer,
  key_symbol text,
  meps_language integer,
  issue_tag_number integer,
  meps_document_id integer,
  track integer,
  location_type integer,
  resolved_publication_id uuid references public.jwpub_publications(id) on delete set null,
  resolved_chapter_id uuid references public.jwpub_chapters(id) on delete set null
);

create index jwlibrary_input_fields_backup_idx on public.jwlibrary_input_fields(backup_id);

create trigger jwlibrary_notes_set_updated_at
  before update on public.jwlibrary_notes
  for each row execute function public.set_updated_at();

alter table public.jwlibrary_backups enable row level security;
alter table public.jwlibrary_usermarks enable row level security;
alter table public.jwlibrary_blockranges enable row level security;
alter table public.jwlibrary_notes enable row level security;
alter table public.jwlibrary_tags enable row level security;
alter table public.jwlibrary_tag_map enable row level security;
alter table public.jwlibrary_bookmarks enable row level security;
alter table public.jwlibrary_input_fields enable row level security;

create policy "jwlibrary_backups_owner_all" on public.jwlibrary_backups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jwlibrary_usermarks_owner_all" on public.jwlibrary_usermarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jwlibrary_blockranges_owner_all" on public.jwlibrary_blockranges
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jwlibrary_notes_owner_all" on public.jwlibrary_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jwlibrary_tags_owner_all" on public.jwlibrary_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jwlibrary_tag_map_owner_all" on public.jwlibrary_tag_map
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jwlibrary_bookmarks_owner_all" on public.jwlibrary_bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "jwlibrary_input_fields_owner_all" on public.jwlibrary_input_fields
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
