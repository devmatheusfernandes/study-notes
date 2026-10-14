-- Embedded excerpts for the shared global publications (0038) — the same
-- archive feature jwpub_extracts (0042) persists for a per-user upload, now
-- for Perspicaz and the 2026 Guia de Pesquisa. Without this a global
-- publication's citations could only be bare `data-jwpub-pubref` pointers,
-- so the Guia's A–Z topic pages (whose citations are almost all excerpts)
-- would open nothing in place.
--
-- Same trust model as the rest of 0038: no user_id, readable by every
-- signed-in user, written only through the service-role client.
create table public.global_publication_extracts (
  publication_id uuid not null references public.global_publications(id) on delete cascade,
  extract_id integer not null,
  content_html text not null default '',
  caption text,
  ref_title text,
  ref_symbol text,
  ref_meps_document_id bigint,
  primary key (publication_id, extract_id)
);

alter table public.global_publication_extracts enable row level security;

create policy "global_publication_extracts_read_authenticated" on public.global_publication_extracts
  for select
  to authenticated
  using (true);

-- Document.SectionNumber / Document.Class from the archive, so a reader can
-- tell a publication's parts apart without guessing from titles: in the 2026
-- Guia de Pesquisa the A–Z topics are Class 3 in section 1, while the 66
-- Bible-book pages are Class 3 in section 2 and the introduction is Class 11.
alter table public.global_publication_chapters
  add column section_number integer,
  add column doc_class integer;
