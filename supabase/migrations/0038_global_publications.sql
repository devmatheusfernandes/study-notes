-- Shared, single-copy publications (starting with Perspicaz/Insight, símbolo
-- `it`) that every signed-in user reads from, instead of each user
-- downloading and storing their own multi-hundred-MB copy in the private
-- `files` bucket. Same trust model as bible_research_guide (0027): no
-- user_id, read-only RLS for every authenticated user, writes only through
-- the service-role client (app/(app)/global-publications-actions.ts).
--
-- Keyed by `symbol` (not a singleton like bible_research_guide_meta) since
-- this is meant to hold more than one such work over time -- see
-- app/(app)/publication-download-actions.ts's own "known gap" note about
-- multi-volume reference works the WOL download-resolution chain can't
-- reach at all.

create table public.global_publications (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  title text not null,
  meps_language_index integer,
  created_at timestamptz not null default now()
);

alter table public.global_publications enable row level security;

create policy "global_publications_read_authenticated" on public.global_publications
  for select
  to authenticated
  using (true);

create table public.global_publication_chapters (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.global_publications(id) on delete cascade,
  document_id integer not null,
  -- How a `jwpub://p/T:<id>/…` citation elsewhere in the app addresses this
  -- entry -- see resolveJwpubReferences in app/(app)/jwpub-actions.ts, which
  -- this table is a second source for (after the caller's own jwpub_chapters).
  meps_document_id integer,
  position integer not null default 0,
  title text not null,
  content_html text,
  unique (publication_id, document_id)
);

create index global_publication_chapters_meps_document_id_idx
  on public.global_publication_chapters (meps_document_id)
  where meps_document_id is not null;

alter table public.global_publication_chapters enable row level security;

create policy "global_publication_chapters_read_authenticated" on public.global_publication_chapters
  for select
  to authenticated
  using (true);

create table public.global_publication_footnotes (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.global_publications(id) on delete cascade,
  footnote_id integer not null,
  content_html text not null,
  unique (publication_id, footnote_id)
);

alter table public.global_publication_footnotes enable row level security;

create policy "global_publication_footnotes_read_authenticated" on public.global_publication_footnotes
  for select
  to authenticated
  using (true);

-- One row per symbol -- tracks the same "already imported this exact file"
-- skip check bible_research_guide_meta does, generalized to more than one
-- publication instead of a hardcoded singleton.
create table public.global_publications_meta (
  symbol text primary key,
  source_hash text,
  import_version integer not null default 1,
  chapter_count integer not null default 0,
  imported_at timestamptz
);

alter table public.global_publications_meta enable row level security;

create policy "global_publications_meta_read_authenticated" on public.global_publications_meta
  for select
  to authenticated
  using (true);
