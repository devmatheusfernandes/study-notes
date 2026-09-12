-- Self-contained excerpts ("quadros de destaque") embedded directly inside
-- the Research Guide's own .jwpub — 52.8% of its 73.886 citations resolve to
-- one of these (measured against the real file), meaning a citation like
-- this needs no other publication downloaded or resolved at all: the actual
-- text is right here, already imported.
--
-- Keyed by the archive's own ExtractId (stable across a reimport of the same
-- edition — several citations can point at the very same excerpt, e.g. a
-- Bible story cited from more than one verse), not by an identity column, so
-- re-running the import naturally replaces the same rows rather than piling
-- up duplicates alongside them.
create table public.bible_research_guide_extracts (
  extract_id integer primary key,
  content_html text not null,
  ref_title text,
  ref_symbol text
);

alter table public.bible_research_guide_extracts enable row level security;

create policy "bible_research_guide_extracts_read_authenticated" on public.bible_research_guide_extracts
  for select
  to authenticated
  using (true);

-- Escrita só pelo service role (app/(app)/research-guide-actions.ts) — mesma
-- convenção do resto das tabelas do Guia de Pesquisa.
