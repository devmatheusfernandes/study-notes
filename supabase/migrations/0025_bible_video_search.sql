-- Busca textual na Bíblia e nas transcrições dos vídeos, mais a associação
-- vídeo → livro/capítulo que alimenta a aba "Vídeos" do painel de estudo.
--
-- Tudo aqui é conteúdo de referência público (bible_verses e global_videos já
-- são legíveis por qualquer usuário autenticado, sem user_id) — nada de dado
-- pessoal passa por estes índices. As notas do usuário continuam de fora: o
-- corpo delas é criptografado em repouso (lib/encryption.ts), então não há
-- texto em claro para indexar.

-- 1. Configuração de busca em português, insensível a acento.
--
-- Um dicionário `unaccent` no meio da configuração, em vez do truque comum de
-- embrulhar unaccent() numa função marcada IMMUTABLE à força: uma configuração
-- de busca é resolvida por OID e `to_tsvector(regconfig, text)` já é IMMUTABLE,
-- então isto é indexável sem mentir sobre a volatilidade de nada.
create extension if not exists unaccent with schema extensions;

create text search configuration public.pt_unaccent ( copy = portuguese );

alter text search configuration public.pt_unaccent
  alter mapping for hword, hword_part, word
  with extensions.unaccent, portuguese_stem;

-- 2. Versículos.
alter table public.bible_verses
  add column search_vector tsvector
  generated always as (to_tsvector('public.pt_unaccent', coalesce(text, ''))) stored;

create index bible_verses_search_idx on public.bible_verses using gin (search_vector);

-- 3. Vídeos: título e transcrição no mesmo vetor, com pesos diferentes — quem
-- procura "mansos" quer primeiro o discurso que se chama "Os mansos possuirão
-- a terra", não o que menciona a palavra uma vez no meio de 7.000 caracteres.
alter table public.global_videos
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('public.pt_unaccent', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('public.pt_unaccent', coalesce(content_text, '')), 'D')
  ) stored;

create index global_videos_search_idx on public.global_videos using gin (search_vector);

-- 4. Referências bíblicas citadas por cada vídeo.
--
-- `source` separa as duas origens porque elas significam coisas diferentes: no
-- título, a referência é o TEMA do discurso (o vídeo é sobre aquele texto); na
-- transcrição, é só uma passagem lida de passagem. O painel mostra as duas em
-- seções distintas, e nunca mistura a ordem.
create table public.video_scripture_refs (
  id bigint generated always as identity primary key,
  video_id text not null references public.global_videos(id) on delete cascade,
  book_order smallint not null check (book_order between 1 and 66),
  chapter smallint not null check (chapter > 0),
  -- null = referência só de capítulo ("Daniel, capítulo 11").
  verse smallint,
  end_verse smallint,
  source text not null check (source in ('title', 'transcript')),
  created_at timestamptz not null default now(),
  -- `nulls not distinct` (PG 15+) para que duas referências de capítulo
  -- inteiro do mesmo vídeo colidam de verdade — com o padrão, cada `verse`
  -- nulo contaria como um valor diferente e a reindexação duplicaria linhas.
  constraint video_scripture_refs_unique
    unique nulls not distinct (video_id, book_order, chapter, verse, source)
);

-- A consulta da barra lateral: "quais vídeos falam deste capítulo?".
create index video_scripture_refs_chapter_idx
  on public.video_scripture_refs (book_order, chapter, source);

-- Marca de "já passou pelo parser", em vez de deduzir isso da presença de
-- linhas acima: a maioria dos vídeos legitimamente não cita nenhum texto, e
-- sem esta coluna eles seriam reprocessados em toda execução, para sempre.
alter table public.global_videos
  add column scriptures_indexed_at timestamptz;

create index global_videos_scriptures_pending_idx
  on public.global_videos (id) where scriptures_indexed_at is null;

create index video_scripture_refs_video_idx on public.video_scripture_refs (video_id);

alter table public.video_scripture_refs enable row level security;

create policy "video_scripture_refs_read_authenticated" on public.video_scripture_refs
  for select
  to authenticated
  using (true);

-- Escrita só pelo service role (app/(app)/video-scripture-actions.ts), igual a
-- global_videos: nenhuma policy de insert/update/delete é criada de propósito.

-- 5. Busca nos versículos.
--
-- `ts_headline` roda numa subconsulta DEPOIS do limit, não na projeção da
-- consulta principal — senão o Postgres monta o trecho destacado de todas as
-- linhas que casaram antes de descartar as que não cabem na página.
--
-- StartSel/StopSel são os caracteres de controle \x01 e \x02, não "<mark>":
-- ts_headline NÃO escapa o texto de origem, e a transcrição vem das legendas
-- do JW.org (conteúdo de terceiros). Devolver marcação pronta faria a única
-- coisa que as regras do projeto proíbem — tratar texto de terceiros como
-- markup. O chamador escapa o HTML da string inteira e só então troca as
-- sentinelas por <mark>; nenhum "<" que venha da legenda sobrevive a isso.
-- Ver toHighlightedHtml em app/(app)/bible-search-actions.ts.

-- Todos os termos da frase, com "|" no lugar do "&" — a consulta de reserva
-- quando exigir todas as palavras não devolve nada.
--
-- Isso não é um detalhe teórico: "mansos herdarão a terra" vira
-- 'mans' & 'herdar' & 'terr', e nenhum versículo casa, porque a Tradução do
-- Novo Mundo diz "possuirão", não "herdarão". Sem a reserva, uma busca por
-- uma citação levemente mal lembrada — o caso mais comum de todos — devolve
-- tela vazia em vez do versículo certo em primeiro lugar.
create or replace function public.pt_or_tsquery(query_text text)
returns tsquery
language sql
immutable
parallel safe
set search_path = public
as $$
  select nullif(
    string_agg(quote_literal(lexeme), ' | '),
    ''
  )::tsquery
  from unnest(to_tsvector('public.pt_unaccent', coalesce(query_text, '')));
$$;

create or replace function public.search_bible_verses(
  query_text text,
  max_results int default 20,
  result_offset int default 0
)
returns table (
  id integer,
  book text,
  book_order integer,
  chapter integer,
  verse integer,
  text text,
  headline text,
  rank real
)
language plpgsql
stable
set search_path = public
as $$
declare
  tsq tsquery;
begin
  -- `websearch_to_tsquery` em vez de `plainto_tsquery` para que aspas e o
  -- prefixo "-" funcionem como a pessoa já espera de uma caixa de busca.
  tsq := websearch_to_tsquery('public.pt_unaccent', coalesce(query_text, ''));

  if tsq is null or not exists (
    select 1 from public.bible_verses v where v.search_vector @@ tsq
  ) then
    tsq := public.pt_or_tsquery(query_text);
  end if;

  if tsq is null then
    return;
  end if;

  return query
  with hits as (
    select v.id, v.book, v.book_order, v.chapter, v.verse, v.text,
           ts_rank(v.search_vector, tsq) as rank
    from public.bible_verses v
    where v.search_vector @@ tsq
    order by ts_rank(v.search_vector, tsq) desc, v.id
    limit greatest(max_results, 0) offset greatest(result_offset, 0)
  )
  select h.id, h.book, h.book_order, h.chapter, h.verse, h.text,
         ts_headline(
           'public.pt_unaccent', coalesce(h.text, ''), tsq,
           E'StartSel=\x01, StopSel=\x02, MaxFragments=1, MinWords=12, MaxWords=36, ShortWord=2'
         ),
         h.rank
  from hits h
  order by h.rank desc, h.id;
end;
$$;

-- 6. Busca nos vídeos (título + transcrição).
create or replace function public.search_global_videos(
  query_text text,
  max_results int default 20,
  result_offset int default 0
)
returns table (
  id text,
  title text,
  cover_image text,
  video_url text,
  subtitles_url text,
  duration_formatted text,
  first_published timestamptz,
  headline text,
  rank real
)
language plpgsql
stable
set search_path = public
as $$
declare
  tsq tsquery;
begin
  tsq := websearch_to_tsquery('public.pt_unaccent', coalesce(query_text, ''));

  if tsq is null or not exists (
    select 1 from public.global_videos g where g.search_vector @@ tsq
  ) then
    tsq := public.pt_or_tsquery(query_text);
  end if;

  if tsq is null then
    return;
  end if;

  return query
  with hits as (
    select g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
           g.duration_formatted, g.first_published, g.content_text,
           ts_rank(g.search_vector, tsq) as rank
    from public.global_videos g
    where g.search_vector @@ tsq
    order by ts_rank(g.search_vector, tsq) desc, g.first_published desc nulls last
    limit greatest(max_results, 0) offset greatest(result_offset, 0)
  )
  select h.id, h.title, h.cover_image, h.video_url, h.subtitles_url,
         h.duration_formatted, h.first_published,
         ts_headline(
           'public.pt_unaccent',
           -- O trecho destacado sai dos primeiros 12.000 caracteres, não da
           -- transcrição inteira: o custo do ts_headline cresce com o tamanho
           -- do documento, e a transcrição mais longa do acervo tem 88.000
           -- caracteres. Medido com 20 resultados: 12.000 custa ~60 ms contra
           -- ~95 ms sem corte, e a transcrição média tem 7.011 caracteres, ou
           -- seja, a maioria cabe inteira. Quem casou só depois do corte ainda
           -- aparece no resultado (o índice leu o texto todo) — só vem com o
           -- começo da transcrição no lugar do trecho destacado.
           left(coalesce(h.content_text, ''), 12000), tsq,
           E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
         ),
         h.rank
  from hits h
  order by h.rank desc, h.first_published desc nulls last;
end;
$$;

-- 7. Vídeos de um capítulo, para a aba "Vídeos" do painel de estudo.
--
-- Uma linha por (vídeo, origem) com os versículos agregados, para que o painel
-- consiga dizer "Salmo 37:11" ao lado do vídeo sem uma segunda consulta.
create or replace function public.get_chapter_videos(
  p_book_order int,
  p_chapter int
)
returns table (
  video_id text,
  title text,
  cover_image text,
  video_url text,
  subtitles_url text,
  duration_formatted text,
  first_published timestamptz,
  source text,
  verses smallint[]
)
language sql
stable
set search_path = public
as $$
  select g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
         g.duration_formatted, g.first_published, r.source,
         array_remove(array_agg(distinct r.verse), null) as verses
  from public.video_scripture_refs r
  join public.global_videos g on g.id = r.video_id
  where r.book_order = p_book_order and r.chapter = p_chapter
  group by g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
           g.duration_formatted, g.first_published, r.source
  order by (r.source = 'title') desc, g.first_published desc nulls last;
$$;

grant execute on function public.pt_or_tsquery(text) to authenticated;
grant execute on function public.search_bible_verses(text, int, int) to authenticated;
grant execute on function public.search_global_videos(text, int, int) to authenticated;
grant execute on function public.get_chapter_videos(int, int) to authenticated;
