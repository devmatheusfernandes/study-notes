-- Busca avançada com operadores explícitos ("frase", &, |, !) para
-- search_bible_verses / search_global_videos, além do texto livre que já
-- funcionava. Motivação real: o stemmer 'portuguese' às vezes reduz palavras
-- sem relação nenhuma à mesma raiz (verificado: "rispa", "ríspido" e
-- "ríspida" caem todos em 'risp', já que -a residual de substantivo e
-- -ido/-ida de particípio verbal colidem por acaso) — deixar a pessoa
-- excluir um termo (!) ou travar numa frase exata ("...") dá uma saída
-- manual para esse tipo de falso positivo, sem enfraquecer o stemmer para
-- todo mundo.

-- 1. "frase entre aspas" -> uma expressão de proximidade (a<->b<->...), via
-- phraseto_tsquery (que já lematiza cada palavra com a config certa) — assim
-- uma frase pode se combinar com & / | / ! ao redor dela, coisa que
-- to_tsquery sozinho não entende (ele não tem sintaxe de aspas).
create or replace function public.pt_quote_phrases_to_tsquery_text(query_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  work text := coalesce(query_text, '');
  m text[];
  phrase_tsq tsquery;
begin
  for m in
    select regexp_matches(work, '"([^"]*)"', 'g')
  loop
    phrase_tsq := phraseto_tsquery('public.pt_unaccent', m[1]);
    work := replace(
      work,
      '"' || m[1] || '"',
      case when phrase_tsq::text = '' then '' else '(' || phrase_tsq::text || ')' end
    );
  end loop;
  return work;
end;
$$;

-- 2. Query inteira com sintaxe explícita de operadores. Só é chamada quando o
-- texto digitado já contém & / | / ! — texto livre continua indo pelo
-- caminho de sempre (websearch_to_tsquery + reserva OR), porque to_tsquery
-- não aceita duas palavras soltas sem operador entre elas (erro de sintaxe),
-- ao contrário de websearch_to_tsquery.
--
-- "||" e "&&" são aceitos como sinônimo de "|" e "&" — alguém vindo de
-- qualquer linguagem de programação vai tentar isso primeiro.
--
-- Sintaxe inválida (parênteses desbalanceados, "&" sem nada de um lado etc.)
-- não vira erro pra quem está buscando: a função devolve null e quem chamou
-- trata isso como "sem resultado para essa sintaxe", igual a uma tsquery
-- vazia.
create or replace function public.pt_advanced_tsquery(query_text text)
returns tsquery
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  work text;
begin
  work := public.pt_quote_phrases_to_tsquery_text(query_text);
  work := regexp_replace(work, '\|\|+', '|', 'g');
  work := regexp_replace(work, '&&+', '&', 'g');

  if trim(work) = '' then
    return null;
  end if;

  return to_tsquery('public.pt_unaccent', work);
exception
  when others then
    return null;
end;
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
  if query_text ~ '[&|!]' then
    tsq := public.pt_advanced_tsquery(query_text);
  else
    tsq := websearch_to_tsquery('public.pt_unaccent', coalesce(query_text, ''));

    if tsq is null or not exists (
      select 1 from public.bible_verses v where v.search_vector @@ tsq
    ) then
      tsq := public.pt_or_tsquery(query_text);
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
begin
  if query_text ~ '[&|!]' then
    tsq := public.pt_advanced_tsquery(query_text);
  else
    tsq := websearch_to_tsquery('public.pt_unaccent', coalesce(query_text, ''));

    if tsq is null or not exists (
      select 1 from public.global_videos g where g.search_vector @@ tsq
    ) then
      tsq := public.pt_or_tsquery(query_text);
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

grant execute on function public.pt_quote_phrases_to_tsquery_text(text) to authenticated;
grant execute on function public.pt_advanced_tsquery(text) to authenticated;
