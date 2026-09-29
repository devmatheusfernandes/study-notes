-- Full-text search over the Research Guide's embedded excerpts
-- (bible_research_guide_extracts), so the Bible page's "Perspicaz" results tab
-- can list them next to the Perspicaz articles themselves.
--
-- Same machinery as 0039 (global_publication_chapters): pt_unaccent config, a
-- weighted search_vector (caption/title 'A', body 'D'), a parallel
-- search_vector_exact for quoted queries, and the same three-tier tsquery
-- strategy (advanced boolean / websearch / OR fallback).
--
-- The excerpts are stored as HTML, and 0039 needed a plain-text column filled
-- at import time because HTML can't be stripped inline in a generated column
-- "without marking a function immutable". `regexp_replace` IS immutable, so
-- here the stripping lives in a small immutable SQL function and the vectors
-- stay generated — no import-path change, and existing rows are backfilled by
-- the ALTER itself.

create or replace function public.strip_html_text(html text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    regexp_replace(coalesce(html, ''), '<[^>]*>', ' ', 'g'),
    '&(#[0-9]+|[a-zA-Z]+);', ' ', 'g'
  );
$$;

alter table public.bible_research_guide_extracts
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('pt_unaccent', public.strip_html_text(caption)), 'A') ||
    setweight(to_tsvector('pt_unaccent', public.strip_html_text(content_html)), 'D')
  ) stored;

alter table public.bible_research_guide_extracts
  add column search_vector_exact tsvector generated always as (
    setweight(to_tsvector('pt_simple_unaccent', public.strip_html_text(caption)), 'A') ||
    setweight(to_tsvector('pt_simple_unaccent', public.strip_html_text(content_html)), 'D')
  ) stored;

create index bible_research_guide_extracts_search_idx
  on public.bible_research_guide_extracts using gin (search_vector);

create index bible_research_guide_extracts_search_exact_idx
  on public.bible_research_guide_extracts using gin (search_vector_exact);

-- An excerpt doesn't know which verse cites it — that link lives in the guide
-- entries' own HTML (`data-jwpub-extract="5807,5808,…"`). The function looks
-- up the first citing verse for each of the (at most `max_results`) hits, so
-- a result can offer "ir ao versículo". Every column reference is qualified:
-- the RETURNS TABLE names would otherwise be ambiguous with table columns.
create or replace function public.search_research_guide_extracts(
  query_text text,
  max_results integer default 20,
  result_offset integer default 0
)
returns table(
  extract_id integer,
  caption text,
  ref_title text,
  headline text,
  book text,
  book_order smallint,
  chapter smallint,
  verse smallint,
  rank real
)
language plpgsql
stable
set search_path to 'public'
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
      select e.extract_id, e.caption, e.ref_title, e.content_html,
             ts_rank(e.search_vector_exact, tsq) as rank
      from public.bible_research_guide_extracts e
      where e.search_vector_exact @@ tsq
      order by ts_rank(e.search_vector_exact, tsq) desc, e.extract_id
      limit greatest(max_results, 0) offset greatest(result_offset, 0)
    )
    select h.extract_id,
           btrim(public.strip_html_text(h.caption)),
           h.ref_title,
           ts_headline(
             'public.pt_simple_unaccent', public.strip_html_text(h.content_html), tsq,
             E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
           ),
           b.book, g.book_order, g.chapter, g.verse,
           h.rank
    from hits h
    left join lateral (
      select rg.book_order, rg.chapter, rg.verse
      from public.bible_research_guide rg
      where rg.content_html ~ ('data-jwpub-extract="([0-9]+,)*' || h.extract_id::text || '(,[0-9]+)*"')
      order by rg.book_order, rg.chapter, rg.verse
      limit 1
    ) g on true
    left join lateral (
      select v.book from public.bible_verses v where v.book_order = g.book_order limit 1
    ) b on true
    order by h.rank desc, h.extract_id;
    return;
  end if;

  if trimmed_query ~ '[&|!]' then
    tsq := public.pt_advanced_tsquery(trimmed_query);
  else
    tsq := websearch_to_tsquery('public.pt_unaccent', trimmed_query);

    if tsq is null or not exists (
      select 1 from public.bible_research_guide_extracts e where e.search_vector @@ tsq
    ) then
      tsq := public.pt_or_tsquery(trimmed_query);
    end if;
  end if;

  if tsq is null then
    return;
  end if;

  return query
  with hits as (
    select e.extract_id, e.caption, e.ref_title, e.content_html,
           ts_rank(e.search_vector, tsq) as rank
    from public.bible_research_guide_extracts e
    where e.search_vector @@ tsq
    order by ts_rank(e.search_vector, tsq) desc, e.extract_id
    limit greatest(max_results, 0) offset greatest(result_offset, 0)
  )
  select h.extract_id,
         btrim(public.strip_html_text(h.caption)),
         h.ref_title,
         ts_headline(
           'public.pt_unaccent', public.strip_html_text(h.content_html), tsq,
           E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
         ),
         b.book, g.book_order, g.chapter, g.verse,
         h.rank
  from hits h
  left join lateral (
    select rg.book_order, rg.chapter, rg.verse
    from public.bible_research_guide rg
    where rg.content_html ~ ('data-jwpub-extract="([0-9]+,)*' || h.extract_id::text || '(,[0-9]+)*"')
    order by rg.book_order, rg.chapter, rg.verse
    limit 1
  ) g on true
  left join lateral (
    select v.book from public.bible_verses v where v.book_order = g.book_order limit 1
  ) b on true
  order by h.rank desc, h.extract_id;
end;
$$;

grant execute on function public.strip_html_text(text) to authenticated;
grant execute on function public.search_research_guide_extracts(text, integer, integer) to authenticated;
