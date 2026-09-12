-- "Guia de Pesquisa para Testemunhas de Jeová" (símbolo rsg, JW.org), ingerido
-- pelo card de Configurações (components/settings/research-guide-upload-card.tsx)
-- em vez de um seed script — reenviar o .jwpub quando o JW.org atualizar a
-- publicação basta para atualizar todo o conteúdo aqui.
--
-- Mesmo padrão de "reference content" das outras tabelas da Bíblia: sem
-- user_id, RLS só de leitura, escrita apenas pelo service role.

create table public.bible_research_guide (
  id bigint generated always as identity primary key,
  book_order smallint not null check (book_order between 1 and 66),
  chapter smallint not null check (chapter > 0),
  verse smallint not null check (verse > 0),
  -- HTML já sanitizado e com jwpub:// reescrito para data-jwpub-pubref, na
  -- ingestão (mesma sanitizeChapterHtml/rewriteJwpubLinks de qualquer .jwpub)
  -- — este é um renderizador puro, igual bible_study_notes.
  content_html text not null,
  created_at timestamptz not null default now(),
  unique (book_order, chapter, verse)
);

create index bible_research_guide_chapter_idx on public.bible_research_guide (book_order, chapter);

alter table public.bible_research_guide enable row level security;

create policy "bible_research_guide_read_authenticated" on public.bible_research_guide
  for select
  to authenticated
  using (true);

-- Escrita só pelo service role (app/(app)/research-guide-actions.ts) — nenhuma
-- policy de insert/update/delete criada de propósito, mesma convenção de
-- global_videos/video_scripture_refs.

-- Marca de "publicação já processada", para o card de Configurações mostrar
-- quando foi feita a última importação e detectar se ainda não há nada.
create table public.bible_research_guide_meta (
  id boolean primary key default true check (id),
  publication_title text,
  entry_count integer not null default 0,
  imported_at timestamptz
);
insert into public.bible_research_guide_meta (id) values (true);

alter table public.bible_research_guide_meta enable row level security;

create policy "bible_research_guide_meta_read_authenticated" on public.bible_research_guide_meta
  for select
  to authenticated
  using (true);
