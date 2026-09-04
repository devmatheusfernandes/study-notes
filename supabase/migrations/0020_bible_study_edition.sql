-- Conteúdo da Bíblia de Estudo, extraído de data/nwt_st.sqlite (ver
-- data/nwt_st_structure.md) e populado por `npm run seed:bible-study`.
--
-- Mesma forma de "reference content" das migrações 0006/0015: conteúdo
-- público idêntico para todo mundo, então sem `user_id`, RLS só com um
-- `select` liberado para `authenticated`, e escrita exclusivamente pelo
-- script de seed via DATABASE_URL — nunca pelo app.
--
-- SOBRE `verse_id` NÃO SER FOREIGN KEY para bible_verses:
-- é deliberado. `scripts/seed-bible.mjs` faz `truncate table
-- public.bible_verses`, e o Postgres recusa truncar uma tabela referenciada
-- sem `cascade` — com `cascade`, re-seedar a Bíblia apagaria silenciosamente
-- todo o conteúdo de estudo. As duas alternativas são ruins, e a FK
-- protegeria pouco de qualquer forma: ela só pega id inexistente, não id
-- existente-mas-errado, que é justamente a classe de bug que motivou a troca
-- da fonte (João 8 numerado com 11 de deslocamento). A checagem real está no
-- seed, que valida cada verse_id contra bible_verses dentro da transação e
-- aborta se algum não bater.

-- Notas de rodapé (9.227). `footnote_index` é sequencial POR LIVRO — não por
-- versículo, apesar do que diz nwt_st_structure.md — e corresponde ao
-- `data-fnid` do HTML original.
create table public.bible_footnotes (
  id integer primary key,
  verse_id integer not null,
  -- Desnormalizados de propósito: o leitor carrega "todos os rodapés deste
  -- capítulo" numa query só, e sem estas colunas cada troca de capítulo
  -- precisaria de um join com bible_verses ou de calcular a faixa de ids no
  -- cliente. É dado estático, então não há risco de divergir.
  book_order integer not null,
  chapter integer not null,
  footnote_index integer not null,
  content_html text not null
);

create index bible_footnotes_chapter_idx on public.bible_footnotes(book_order, chapter);
create index bible_footnotes_verse_idx on public.bible_footnotes(verse_id);

-- Notas de estudo (3.354). Exatamente uma linha por versículo: quando o
-- versículo tem vários comentários, todos vêm concatenados no mesmo
-- `content_html` como blocos <p class="s5"> separados.
--
-- Cobertura parcial e esperada: só Mateus–Filêmon, sem Tito. Hebreus a
-- Apocalipse e as Escrituras Hebraicas não têm notas de estudo nesta
-- publicação. A UI precisa tratar "sem notas" como estado vazio normal,
-- não como erro.
create table public.bible_study_notes (
  id integer primary key,
  verse_id integer not null,
  book_order integer not null,
  chapter integer not null,
  verse integer,
  -- Cabeçalho da nota ("1:1") — pequeno e sempre exibido junto do corpo.
  label_html text,
  content_html text not null
);

create index bible_study_notes_chapter_idx on public.bible_study_notes(book_order, chapter);
create index bible_study_notes_verse_idx on public.bible_study_notes(verse_id);

-- Esboço temático de cada livro (5.758 linhas, 66 livros). Árvore por
-- `parent_id`, montada recursivamente no cliente.
--
-- A FK é `deferrable initially deferred` porque o seed insere em lote: os
-- ids da fonte já vêm com pai antes de filho, mas depender dessa ordem para
-- o lote não falhar seria frágil.
create table public.bible_outline (
  id integer primary key,
  parent_id integer references public.bible_outline(id) on delete cascade
    deferrable initially deferred,
  level integer not null,
  book_order integer not null,
  begin_chapter integer,
  begin_verse integer,
  end_chapter integer,
  end_verse integer,
  -- Texto puro do <li> mais profundo, extraído no seed. O `content_html` da
  -- fonte traz a lista inteira aninhada até aquele ponto (é assim que o
  -- formato original guarda), o que é inútil para exibir nível a nível.
  title text not null,
  content_html text
);

create index bible_outline_book_idx on public.bible_outline(book_order, begin_chapter);
create index bible_outline_parent_idx on public.bible_outline(parent_id);

alter table public.bible_footnotes enable row level security;
alter table public.bible_study_notes enable row level security;
alter table public.bible_outline enable row level security;

create policy "bible_footnotes_read_authenticated" on public.bible_footnotes
  for select to authenticated using (true);

create policy "bible_study_notes_read_authenticated" on public.bible_study_notes
  for select to authenticated using (true);

create policy "bible_outline_read_authenticated" on public.bible_outline
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────
-- Referências cruzadas: coexistência de duas fontes na mesma tabela.
--
-- As 60.884 referências da Bíblia de Estudo são as referências marginais
-- OFICIAIS da NWT (o que o JW Library mostra) e são um conjunto diferente
-- das ~687 mil já seedadas de data/cross_references.sqlite (fonte terceira,
-- bem mais ampla): só 16.022 pares coincidem. Nenhuma das duas é
-- "a versão nova" da outra, então as duas ficam, discriminadas por `source`.
alter table public.bible_cross_references
  add column source text not null default 'extended'
    check (source in ('extended', 'nwt')),
  -- Letra marginal (a, b, c…) que originou a referência, derivada de
  -- `sort_order / 1000` na fonte. Só existe para `source = 'nwt'`; permite
  -- agrupar várias referências sob a mesma letra, como no JW Library.
  -- Continua sem saber QUAL palavra do versículo gerou a letra — essa
  -- granularidade exigiria decodificar BibleChapter.Content.
  add column marker integer;

-- 52 referências da fonte nova nascem numa superescrição de Salmo, que não
-- tem número de versículo (bible_verses.verse é NULL nessas linhas).
alter table public.bible_cross_references alter column verse drop not null;

-- Substitui o índice de 0015 por um que também cobre o filtro de `source`,
-- presente em toda query nova. Mantém (book_order, chapter, verse) como
-- prefixo, então nada que usava o antigo regride.
drop index if exists bible_cross_references_verse_idx;

create index bible_cross_references_verse_source_idx
  on public.bible_cross_references(book_order, chapter, verse, source, rank);
