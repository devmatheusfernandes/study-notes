-- Embedded excerpts ("quadros de destaque") for an ordinary, per-user
-- uploaded publication — the same archive feature the Research Guide already
-- uses (public.bible_research_guide_extracts), now available to anything the
-- user uploads.
--
-- This is not an exotic case: measured against the real files, EVERY one of
-- the 115 citations in a "Nossa Vida e Ministério Cristão" apostila
-- (mwb_T_202611) carries its own excerpt, so a citation into another
-- publication can be read in place instead of needing that publication
-- downloaded at all. (Some publications carry none — `lmd` has zero — and
-- those keep falling back to the `data-jwpub-pubref` "Baixar" flow.)
--
-- Keyed by (publication_id, ExtractId): ExtractId is the archive's own id,
-- which is exactly what a citation link's `data-xtid` carries, and several
-- citations routinely share one excerpt.
create table public.jwpub_extracts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  publication_id uuid not null references public.jwpub_publications(id) on delete cascade,
  extract_id integer not null,
  content_html text not null default '',
  -- Pre-built markup from Extract.Caption naming the source, e.g.
  -- '<span class="eloc">it-1 "Criação" par. 4</span> <span class="etitle">Criação</span>'.
  -- Often the ONLY place the cited article's name appears — a Perspicaz
  -- citation's own visible link text is just "Perspicaz, Volume 1,".
  caption text,
  ref_title text,
  ref_symbol text,
  -- Extract.RefMepsDocumentId — the document the excerpt was taken from, so
  -- the reader can offer to open/download the whole publication from the
  -- same panel that shows the excerpt.
  ref_meps_document_id bigint,
  created_at timestamptz not null default now(),
  primary key (publication_id, extract_id)
);

create index jwpub_extracts_publication_idx on public.jwpub_extracts(publication_id);

alter table public.jwpub_extracts enable row level security;

create policy "jwpub_extracts_owner_all" on public.jwpub_extracts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The Research Guide's own excerpt table predates both of these columns; it
-- was importing the caption nowhere and had no way to offer the source
-- publication. Same meaning as the two columns above.
alter table public.bible_research_guide_extracts
  add column caption text,
  add column ref_meps_document_id bigint;
