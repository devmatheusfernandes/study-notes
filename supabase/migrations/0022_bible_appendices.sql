-- Apêndices da Bíblia de Estudo, extraídos de data/nwt_st.sqlite (tabela
-- `appendices`, adicionada numa regeneração posterior à 0020 — ver
-- data/nwt_st_structure.md). Mesma forma de "reference content" das outras
-- tabelas da Bíblia: sem user_id, RLS só de leitura, escrita só pelo seed.
--
-- Resolve os 422 links `jwpub://p/T:{meps_document_id}/` que já existiam
-- dentro de bible_study_notes desde a migração 0020 e ficavam inertes
-- (data-jwpub-pubref, resolvido só contra publicações .jwpub que o próprio
-- usuário importou — a Bíblia de Estudo e seus apêndices não são uma
-- publicação na biblioteca de ninguém).
create table public.bible_appendices (
  -- DocumentId interno da fonte — não confundir com meps_document_id, que é
  -- o número que aparece nos links jwpub://p/T:{meps_document_id}/.
  id integer primary key,
  meps_document_id integer not null unique,
  section text not null check (section in ('header', 'article')),
  -- 'A' | 'B' | 'C'. Não vem pronta na fonte: derivada no seed pela ORDEM dos
  -- ids (cada header 'Apêndice A/B/C' é seguido pelos artigos daquela seção
  -- até o próximo header) — verificado que essa derivação bate 100% com o
  -- prefixo do título de cada artigo antes de confiar nela.
  appendix_letter text not null check (appendix_letter in ('A', 'B', 'C')),
  title text not null,
  content_html text not null
);

-- Sozinho já cobre "todos os artigos da seção A, em ordem" — os 3 headers
-- ficam junto no início de cada seção (id sequencial), então não precisa de
-- um índice separado por `section`.
create index bible_appendices_letter_idx on public.bible_appendices(appendix_letter, id);

alter table public.bible_appendices enable row level security;

create policy "bible_appendices_read_authenticated" on public.bible_appendices
  for select to authenticated using (true);
