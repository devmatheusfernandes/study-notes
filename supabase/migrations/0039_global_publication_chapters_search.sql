-- Adds Perspicaz (and any future global_publications entry) to the Bible
-- page's own full-text search, alongside bible_verses/global_videos — same
-- machinery as migration 0025/0032-0035: pt_unaccent config, a weighted
-- search_vector (title 'A', body 'D', so a title match always outranks a
-- body-only match — the "prefer titles, fall back to the rest" the user
-- asked for), a parallel search_vector_exact for a quoted query, and the
-- same three-tier tsquery strategy (advanced boolean / websearch / OR
-- fallback) search_bible_verses and search_global_videos already use.
--
-- content_text (plain text, stripped of HTML) exists for the same reason
-- global_videos carries one alongside content_html: ts_headline needs to
-- excerpt real prose, not raw markup, and a generated column can't call an
-- HTML-stripping function inline without marking that function immutable
-- (a lie for anything HTML-shaped) -- so it's a plain stored column, filled
-- in once at import time by appendGlobalPublicationChapters.

alter table public.global_publication_chapters
  add column content_text text;

alter table public.global_publication_chapters
  add column search_vector tsvector generated always as (
    setweight(to_tsvector('pt_unaccent', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('pt_unaccent', coalesce(content_text, '')), 'D')
  ) stored;

alter table public.global_publication_chapters
  add column search_vector_exact tsvector generated always as (
    setweight(to_tsvector('pt_simple_unaccent', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('pt_simple_unaccent', coalesce(content_text, '')), 'D')
  ) stored;

create index global_publication_chapters_search_idx
  on public.global_publication_chapters using gin (search_vector);

create index global_publication_chapters_search_exact_idx
  on public.global_publication_chapters using gin (search_vector_exact);

create or replace function public.search_global_publication_chapters(
  query_text text,
  max_results integer default 20,
  result_offset integer default 0
)
returns table(
  id uuid,
  publication_id uuid,
  document_id integer,
  publication_title text,
  title text,
  headline text,
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
      select c.id, c.publication_id, c.document_id, c.title, c.content_text,
             ts_rank(c.search_vector_exact, tsq) as rank
      from public.global_publication_chapters c
      where c.search_vector_exact @@ tsq
      order by ts_rank(c.search_vector_exact, tsq) desc, c.id
      limit greatest(max_results, 0) offset greatest(result_offset, 0)
    )
    select h.id, h.publication_id, h.document_id, p.title, h.title,
           ts_headline(
             'public.pt_simple_unaccent', coalesce(h.content_text, ''), tsq,
             E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
           ),
           h.rank
    from hits h
    join public.global_publications p on p.id = h.publication_id
    order by h.rank desc, h.id;
    return;
  end if;

  if trimmed_query ~ '[&|!]' then
    tsq := public.pt_advanced_tsquery(trimmed_query);
  else
    tsq := websearch_to_tsquery('public.pt_unaccent', trimmed_query);

    if tsq is null or not exists (
      select 1 from public.global_publication_chapters c where c.search_vector @@ tsq
    ) then
      tsq := public.pt_or_tsquery(trimmed_query);
    end if;
  end if;

  if tsq is null then
    return;
  end if;

  return query
  with hits as (
    select c.id, c.publication_id, c.document_id, c.title, c.content_text,
           ts_rank(c.search_vector, tsq) as rank
    from public.global_publication_chapters c
    where c.search_vector @@ tsq
    order by ts_rank(c.search_vector, tsq) desc, c.id
    limit greatest(max_results, 0) offset greatest(result_offset, 0)
  )
  select h.id, h.publication_id, h.document_id, p.title, h.title,
         ts_headline(
           'public.pt_unaccent', coalesce(h.content_text, ''), tsq,
           E'StartSel=\x01, StopSel=\x02, MaxFragments=2, FragmentDelimiter=" … ", MinWords=8, MaxWords=26, ShortWord=2'
         ),
         h.rank
  from hits h
  join public.global_publications p on p.id = h.publication_id
  order by h.rank desc, h.id;
end;
$$;
