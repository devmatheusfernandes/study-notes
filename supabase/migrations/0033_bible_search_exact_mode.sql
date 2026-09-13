-- Segundo índice, sem stemming, para "aspas = palavra exata".
--
-- A migração 0032 fez as aspas virarem phraseto_tsquery('pt_unaccent', ...)
-- — mas pt_unaccent ainda reduz cada palavra à raiz antes de comparar, então
-- "rispa" entre aspas virava a mesma raiz 'risp' de "ríspido"/"ríspida" (ver
-- comentário de 0032). As aspas nunca chegavam a pular o stemming, só
-- controlavam se as palavras precisavam ficar coladas.
--
-- Esta migração dá às aspas um comportamento realmente diferente: quando a
-- busca não tem nenhum operador booleano (& | !), aspas passam a rodar
-- inteiramente contra um SEGUNDO tsvector, gerado com uma configuração
-- 'simple' (só minúsculas + unaccent, sem stemmer nenhum). Nesse índice
-- "rispa" e "rispido" são duas palavras literalmente diferentes — não tem
-- colisão de raiz porque não existe raiz, existe a palavra como foi escrita.

-- 1. Configuração 'simple' + unaccent — mesmo truque de config (não função
-- fingindo IMMUTABLE) que pt_unaccent already usa, só que copiando de
-- 'simple' em vez de 'portuguese' para não herdar nenhuma regra de stemmer.
create text search configuration public.pt_simple_unaccent ( copy = simple );

alter text search configuration public.pt_simple_unaccent
  alter mapping for hword, hword_part, word
  with extensions.unaccent;

-- 2. Segundo vetor por tabela — não dá para reaproveitar search_vector
-- (aquele já é gerado com a config que faz stemming); precisa de outra
-- coluna GENERATED ALWAYS AS, com seu próprio índice GIN.
alter table public.bible_verses
  add column search_vector_exact tsvector
  generated always as (to_tsvector('public.pt_simple_unaccent', coalesce(text, ''))) stored;

create index bible_verses_search_exact_idx on public.bible_verses using gin (search_vector_exact);

alter table public.global_videos
  add column search_vector_exact tsvector
  generated always as (
    setweight(to_tsvector('public.pt_simple_unaccent', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('public.pt_simple_unaccent', coalesce(content_text, '')), 'D')
  ) stored;

create index global_videos_search_exact_idx on public.global_videos using gin (search_vector_exact);

-- 3. Monta a tsquery do modo exato: cada "frase entre aspas" vira uma
-- expressão de proximidade sem stemming (via phraseto_tsquery com a config
-- simple+unaccent); texto fora de aspas na mesma busca (raro, mas possível —
-- ex.: `"rispa" áspero`) é tratado do mesmo jeito, só que sem exigir aspas.
-- Tudo isso é E (&&) entre si: cada trecho digitado precisa aparecer.
create or replace function public.pt_exact_tsquery(query_text text)
returns tsquery
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  work text := coalesce(query_text, '');
  m text[];
  part_tsq tsquery;
  result tsquery := null;
  leftover text;
begin
  for m in
    select regexp_matches(work, '"([^"]*)"', 'g')
  loop
    part_tsq := phraseto_tsquery('public.pt_simple_unaccent', m[1]);
    if part_tsq::text <> '' then
      result := case when result is null then part_tsq else result && part_tsq end;
    end if;
    work := replace(work, '"' || m[1] || '"', '');
  end loop;

  leftover := trim(work);
  if leftover <> '' then
    part_tsq := phraseto_tsquery('public.pt_simple_unaccent', leftover);
    if part_tsq::text <> '' then
      result := case when result is null then part_tsq else result && part_tsq end;
    end if;
  end if;

  return result;
end;
$$;

-- 4. As três funções de busca ganham um terceiro caminho: aspas sem & | !
-- vai para o modo exato (search_vector_exact, sem a reserva de "OU" — o
-- modo exato existe para SER restritivo, então devolver menos resultado não
-- é um bug a compensar). Continua tudo como antes quando não há aspas nem
-- operadores, e quando há & | ! (0032, inalterado nesse caso).
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
  trimmed_query text := trim(coalesce(query_text, ''));
begin
  if trimmed_query ~ '"' and trimmed_query !~ '[&|!]' then
    tsq := public.pt_exact_tsquery(trimmed_query);
    if tsq is null then
      return;
    end if;

    return query
    with hits as (
      select v.id, v.book, v.book_order, v.chapter, v.verse, v.text,
             ts_rank(v.search_vector_exact, tsq) as rank
      from public.bible_verses v
      where v.search_vector_exact @@ tsq
      order by ts_rank(v.search_vector_exact, tsq) desc, v.id
      limit greatest(max_results, 0) offset greatest(result_offset, 0)
    )
    select h.id, h.book, h.book_order, h.chapter, h.verse, h.text,
           ts_headline(
             'public.pt_simple_unaccent', coalesce(h.text, ''), tsq,
             E'StartSel=\x01, StopSel=\x02, MaxFragments=1, MinWords=12, MaxWords=36, ShortWord=2'
           ),
           h.rank
    from hits h
    order by h.rank desc, h.id;
    return;
  end if;

  if trimmed_query ~ '[&|!]' then
    tsq := public.pt_advanced_tsquery(trimmed_query);
  else
    tsq := websearch_to_tsquery('public.pt_unaccent', trimmed_query);

    if tsq is null or not exists (
      select 1 from public.bible_verses v where v.search_vector @@ tsq
    ) then
      tsq := public.pt_or_tsquery(trimmed_query);
    end if;
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
  trimmed_query text := trim(coalesce(query_text, ''));
begin
  if trimmed_query ~ '"' and trimmed_query !~ '[&|!]' then
    tsq := public.pt_exact_tsquery(trimmed_query);
    if tsq is null then
      return;
    end if;

    return query
    with hits as (
      select g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
             g.duration_formatted, g.first_published, g.content_text,
             ts_rank(g.search_vector_exact, tsq) as rank
      from public.global_videos g
      where g.search_vector_exact @@ tsq
      order by ts_rank(g.search_vector_exact, tsq) desc, g.first_published desc nulls last
      limit greatest(max_results, 0) offset greatest(result_offset, 0)
    )
    select h.id, h.title, h.cover_image, h.video_url, h.subtitles_url,
           h.duration_formatted, h.first_published,
           ts_headline(
             'public.pt_simple_unaccent',
             left(coalesce(h.content_text, ''), 12000), tsq,
             E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
           ),
           h.rank
    from hits h
    order by h.rank desc, h.first_published desc nulls last;
    return;
  end if;

  if trimmed_query ~ '[&|!]' then
    tsq := public.pt_advanced_tsquery(trimmed_query);
  else
    tsq := websearch_to_tsquery('public.pt_unaccent', trimmed_query);

    if tsq is null or not exists (
      select 1 from public.global_videos g where g.search_vector @@ tsq
    ) then
      tsq := public.pt_or_tsquery(trimmed_query);
    end if;
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
           left(coalesce(h.content_text, ''), 12000), tsq,
           E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
         ),
         h.rank
  from hits h
  order by h.rank desc, h.first_published desc nulls last;
end;
$$;

grant execute on function public.pt_exact_tsquery(text) to authenticated;
