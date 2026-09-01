-- Parsed .jwpub publications: the chapters/footnotes extracted from an
-- uploaded publication file, so a second device can read it instantly instead
-- of re-downloading and re-parsing the whole archive.
--
-- NOTE: unlike public.notes (whose title/body go through lib/encryption.ts),
-- this content is deliberately stored UNENCRYPTED — these are public
-- publication files, not the user's own private writing. RLS still scopes
-- every row to its owner, same as everywhere else.

create table public.jwpub_publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The file's own row in public.notes — deleting the note drops everything here.
  note_id uuid not null unique references public.notes(id) on delete cascade,
  symbol text not null default '',
  title text not null default '',
  -- Kept for reference/debugging: these are the inputs to the .jwpub key derivation.
  meps_language_index integer,
  year integer,
  issue_tag_number integer,
  status text not null default 'ready' check (status in ('ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jwpub_publications_user_note_idx on public.jwpub_publications(user_id, note_id);

create table public.jwpub_chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  publication_id uuid not null references public.jwpub_publications(id) on delete cascade,
  -- Document.DocumentId from the source SQLite — how jwpub:// links address chapters.
  document_id integer not null,
  position integer not null,
  title text not null default '',
  -- Sanitized HTML with jwpub-media:// rewritten to real Storage URLs. Null
  -- while the chapter stub exists but its content hasn't been saved yet.
  content_html text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, document_id)
);

create index jwpub_chapters_publication_position_idx on public.jwpub_chapters(publication_id, position);

create table public.jwpub_footnotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  publication_id uuid not null references public.jwpub_publications(id) on delete cascade,
  footnote_id integer not null,
  content_html text not null default '',
  created_at timestamptz not null default now(),
  unique (publication_id, footnote_id)
);

create trigger jwpub_publications_set_updated_at
  before update on public.jwpub_publications
  for each row execute function public.set_updated_at();

create trigger jwpub_chapters_set_updated_at
  before update on public.jwpub_chapters
  for each row execute function public.set_updated_at();

alter table public.jwpub_publications enable row level security;
alter table public.jwpub_chapters enable row level security;
alter table public.jwpub_footnotes enable row level security;

create policy "jwpub_publications_owner_all" on public.jwpub_publications
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "jwpub_chapters_owner_all" on public.jwpub_chapters
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "jwpub_footnotes_owner_all" on public.jwpub_footnotes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
