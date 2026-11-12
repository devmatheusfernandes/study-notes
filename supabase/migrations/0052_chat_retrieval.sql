-- Chat/assistant retrieval overhaul.
--
-- 1. match_hybrid_embeddings was timing out. It computed the cosine distance of
--    EVERY row in four tables (the WHERE filtered on the similarity expression,
--    with no `order by <=> ... limit` the ivfflat indexes could serve), took
--    3-9 s and hit `authenticated`'s 8 s statement_timeout on a good share of
--    calls. The routes ignored the error, so the chat answered "não encontrei"
--    with the right passage sitting in the database. Each source now does its
--    own index-ordered top-N first; only those few rows are filtered.
--
-- 2. It returned the best N rows OVERALL, so one source type crowded the others
--    out (eight video chunks, zero publications). It now returns up to
--    `match_count` rows PER source; the caller balances them.
--
-- 3. Every global_video_embeddings.metadata was a JSON *string* (the seed
--    script inserted JSON.stringify(...) into a jsonb column), so
--    `metadata->>'title'` was null for all 10k chunks: sources showed as
--    "Vídeo JW" and the model was handed "[Fonte N: Conteúdo]". The rows are
--    unwrapped below, and the function builds a video's metadata from
--    global_videos itself, so a chunk can never disagree with its video again.
--
-- 4. Full-text search for the chat over video transcripts, global publications
--    (Perspicaz, Guia de Pesquisa topics) and the Research Guide's embedded
--    excerpts. Unlike the /bible page's search functions these return a long
--    excerpt (context for the model, not a two-line highlight) and say how
--    strictly the query matched.

update public.global_video_embeddings
set metadata = (metadata #>> '{}')::jsonb
where jsonb_typeof(metadata) = 'string';

create or replace function public.match_hybrid_embeddings(
  query_embedding halfvec(1536),
  user_id_param uuid,
  match_threshold double precision default 0.20,
  match_count integer default 8,
  allowed_types text[] default array['nota','pdf','jwpub','video','estudo_pessoal','biblia']
)
returns table(id uuid, note_id uuid, video_id text, source_type text, content text, similarity double precision, metadata jsonb)
language plpgsql
security definer
set search_path to 'public', 'extensions'
set ivfflat.probes = 10
as $$
begin
  if auth.uid() is null or user_id_param is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with
  -- The caller's own rows are few enough (thousands) that an exact scan is
  -- cheap, and an approximate index scan filtered by user afterwards could
  -- come back short. Over-fetched, then narrowed by type/lock below.
  own_nearest as materialized (
    select ne.id, ne.note_id, ne.jwlibrary_note_id, ne.content, ne.metadata,
           ne.embedding <=> query_embedding as distance
    from public.note_embeddings ne
    where ne.user_id = auth.uid()
    order by ne.embedding <=> query_embedding
    limit greatest(match_count, 1) * 6
  ),
  user_notes as (
    select o.id, o.note_id, null::text as video_id,
           coalesce(o.metadata->>'type', n.type, 'nota')::text as source_type,
           o.content, 1 - o.distance as similarity, o.metadata
    from own_nearest o
    join public.notes n on n.id = o.note_id
    where o.note_id not in (select public.locked_note_ids())
      and coalesce(o.metadata->>'type', n.type, 'nota') = any(allowed_types)
    order by o.distance
    limit match_count
  ),
  user_jwlibrary_notes as (
    select o.id, null::uuid as note_id, null::text as video_id,
           'estudo_pessoal'::text as source_type,
           o.content, 1 - o.distance as similarity, o.metadata
    from own_nearest o
    where o.jwlibrary_note_id is not null
      and 'estudo_pessoal' = any(allowed_types)
    order by o.distance
    limit match_count
  ),
  video_nearest as materialized (
    select ge.id, ge.video_id, ge.content,
           ge.embedding <=> query_embedding as distance
    from public.global_video_embeddings ge
    where 'video' = any(allowed_types)
    order by ge.embedding <=> query_embedding
    limit match_count
  ),
  global_vids as (
    select v.id, null::uuid as note_id, v.video_id, 'video'::text as source_type,
           v.content, 1 - v.distance as similarity,
           jsonb_build_object(
             'title', g.title,
             'type', 'video',
             'videoId', g.id,
             'videoUrl', g.video_url,
             'coverImage', g.cover_image,
             'durationFormatted', g.duration_formatted,
             'subtitlesUrl', g.subtitles_url,
             'publishedAt', g.first_published
           ) as metadata
    from video_nearest v
    join public.global_videos g on g.id = v.video_id
  ),
  bible_nearest as materialized (
    select be.id, be.content, be.metadata,
           be.embedding <=> query_embedding as distance
    from public.global_bible_embeddings be
    where 'biblia' = any(allowed_types)
    order by be.embedding <=> query_embedding
    limit match_count
  ),
  global_bible as (
    select b.id, null::uuid as note_id, null::text as video_id, 'biblia'::text as source_type,
           b.content, 1 - b.distance as similarity, b.metadata
    from bible_nearest b
  ),
  combined as (
    select * from user_notes
    union all
    select * from user_jwlibrary_notes
    union all
    select * from global_vids
    union all
    select * from global_bible
  )
  select c.id, c.note_id, c.video_id, c.source_type, c.content, c.similarity, c.metadata
  from combined c
  where c.similarity > match_threshold
  order by c.similarity desc;
end;
$$;

revoke all on function public.match_hybrid_embeddings(halfvec(1536), uuid, double precision, integer, text[]) from public, anon;
grant execute on function public.match_hybrid_embeddings(halfvec(1536), uuid, double precision, integer, text[]) to authenticated;

-- The query tiers the chat's full-text search walks, strictest first:
--   1. every word            ("presos" & "russia" & "experiencia")
--   2. all words but any one (only with 3+ words) — a question usually carries
--      one word the right document doesn't use
--   3. any word
-- A plain "all, else any" (what the /bible search does for a typed quote) drops
-- straight from a precise match to one ranked by whichever common word repeats
-- most. Each element is null when that tier doesn't apply.
create or replace function public.chat_tsquery_tiers(query_text text)
returns tsquery[]
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  lexemes text[];
  n int;
  all_q tsquery;
  most_q tsquery;
  any_q tsquery;
  part tsquery;
  i int;
  j int;
begin
  select array_agg(distinct t.lexeme)
  into lexemes
  from unnest(to_tsvector('public.pt_unaccent', coalesce(query_text, ''))) t;

  n := coalesce(array_length(lexemes, 1), 0);
  if n = 0 then
    return array[null, null, null]::tsquery[];
  end if;
  -- A long question would build a huge all-but-one query; the caller sends keywords.
  if n > 8 then
    lexemes := lexemes[1:8];
    n := 8;
  end if;

  for i in 1..n loop
    part := quote_literal(lexemes[i])::tsquery;
    all_q := case when all_q is null then part else all_q && part end;
    any_q := case when any_q is null then part else any_q || part end;
  end loop;

  if n >= 3 then
    for i in 1..n loop
      part := null;
      for j in 1..n loop
        if j <> i then
          part := case when part is null then quote_literal(lexemes[j])::tsquery
                       else part && quote_literal(lexemes[j])::tsquery end;
        end if;
      end loop;
      most_q := case when most_q is null then part else most_q || part end;
    end loop;
  end if;

  return array[all_q, most_q, case when n >= 2 then any_q else null end]::tsquery[];
end;
$$;

-- Video transcripts + titles. `excerpt` is ~200 words around the densest match.
create or replace function public.chat_search_videos(
  query_text text,
  max_results int default 8,
  published_from date default null,
  published_to date default null
)
returns table (
  id text,
  title text,
  cover_image text,
  video_url text,
  subtitles_url text,
  duration_formatted text,
  first_published timestamptz,
  excerpt text,
  title_match boolean,
  tier int,
  rank real
)
language plpgsql
stable
set search_path = public
as $$
declare
  tiers tsquery[] := public.chat_tsquery_tiers(query_text);
  tsq tsquery;
  t int;
begin
  for t in 1..3 loop
    tsq := tiers[t];
    continue when tsq is null;

    return query
    with hits as (
      select g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
             g.duration_formatted, g.first_published, g.content_text,
             ts_rank(g.search_vector, tsq) as rank
      from public.global_videos g
      where g.search_vector @@ tsq
        and (published_from is null or g.first_published >= published_from)
        and (published_to is null or g.first_published < published_to + 1)
      order by ts_rank(g.search_vector, tsq) desc, g.first_published desc nulls last
      limit greatest(max_results, 0)
    )
    select h.id, h.title, h.cover_image, h.video_url, h.subtitles_url,
           h.duration_formatted, h.first_published,
           ts_headline(
             'public.pt_unaccent', coalesce(h.content_text, ''), tsq,
             'StartSel="", StopSel="", MaxFragments=0, MinWords=120, MaxWords=220, ShortWord=2'
           ),
           to_tsvector('public.pt_unaccent', coalesce(h.title, '')) @@ tsq,
           t,
           h.rank
    from hits h
    order by h.rank desc, h.first_published desc nulls last;

    if found then
      return;
    end if;
  end loop;
end;
$$;

-- Global publications (Perspicaz, the 2026 Guia de Pesquisa topics). `lead` is
-- the start of the article: for a "quem foi X?" question whose answer is the
-- article NAMED X, the opening paragraphs beat a window around the word.
create or replace function public.chat_search_publications(
  query_text text,
  max_results int default 6
)
returns table (
  id uuid,
  symbol text,
  publication_title text,
  document_id integer,
  meps_document_id integer,
  title text,
  excerpt text,
  lead text,
  title_match boolean,
  tier int,
  rank real
)
language plpgsql
stable
set search_path = public
as $$
declare
  tiers tsquery[] := public.chat_tsquery_tiers(query_text);
  tsq tsquery;
  t int;
begin
  for t in 1..3 loop
    tsq := tiers[t];
    continue when tsq is null;

    return query
    with hits as (
      select c.id, c.publication_id, c.document_id, c.meps_document_id, c.title, c.content_text,
             ts_rank(c.search_vector, tsq) as rank
      from public.global_publication_chapters c
      where c.search_vector @@ tsq
      order by ts_rank(c.search_vector, tsq) desc, c.id
      limit greatest(max_results, 0)
    )
    select h.id, p.symbol, p.title, h.document_id, h.meps_document_id, h.title,
           ts_headline(
             'public.pt_unaccent', left(coalesce(h.content_text, ''), 20000), tsq,
             'StartSel="", StopSel="", MaxFragments=0, MinWords=120, MaxWords=220, ShortWord=2'
           ),
           left(coalesce(h.content_text, ''), 2600),
           to_tsvector('public.pt_unaccent', coalesce(h.title, '')) @@ tsq,
           t,
           h.rank
    from hits h
    join public.global_publications p on p.id = h.publication_id
    order by h.rank desc, h.id;

    if found then
      return;
    end if;
  end loop;
end;
$$;

-- The Research Guide's embedded excerpts: 32k paragraphs quoted from magazines,
-- books and Perspicaz — the closest thing in this database to searching WOL.
--
-- Ranking needs every matching row's tsvector, and a common word matches
-- thousands of these: ranked in full, the query ran past the 8 s statement
-- timeout. So at most 1500 matches are ranked (the GIN scan stops there), and
-- the "any one word" tier is not offered at all — over this many passages it
-- is both the slow case and the useless one.
create or replace function public.chat_search_guide_extracts(
  query_text text,
  max_results int default 6
)
returns table (
  extract_id integer,
  caption text,
  ref_title text,
  ref_meps_document_id bigint,
  excerpt text,
  tier int,
  rank real
)
language plpgsql
stable
set search_path = public
as $$
declare
  tiers tsquery[] := public.chat_tsquery_tiers(query_text);
  tsq tsquery;
  t int;
begin
  for t in 1..2 loop
    tsq := tiers[t];
    continue when tsq is null;

    return query
    with candidates as materialized (
      select e.extract_id, e.search_vector
      from public.bible_research_guide_extracts e
      where e.search_vector @@ tsq
      limit 1500
    ),
    ranked as (
      select c.extract_id, ts_rank(c.search_vector, tsq) as rank
      from candidates c
      order by ts_rank(c.search_vector, tsq) desc, c.extract_id
      limit greatest(max_results, 0)
    ),
    hits as (
      select e.extract_id, e.caption, e.ref_title, e.ref_meps_document_id, e.content_html, r.rank
      from ranked r
      join public.bible_research_guide_extracts e on e.extract_id = r.extract_id
    )
    select h.extract_id,
           btrim(regexp_replace(public.strip_html_text(h.caption), '\s+', ' ', 'g')),
           h.ref_title,
           h.ref_meps_document_id,
           left(btrim(regexp_replace(public.strip_html_text(h.content_html), '\s+', ' ', 'g')), 1800),
           t,
           h.rank
    from hits h
    order by h.rank desc, h.extract_id;

    if found then
      return;
    end if;
  end loop;
end;
$$;

revoke all on function public.chat_tsquery_tiers(text) from public, anon;
revoke all on function public.chat_search_videos(text, int, date, date) from public, anon;
revoke all on function public.chat_search_publications(text, int) from public, anon;
revoke all on function public.chat_search_guide_extracts(text, int) from public, anon;
grant execute on function public.chat_tsquery_tiers(text) to authenticated;
grant execute on function public.chat_search_videos(text, int, date, date) to authenticated;
grant execute on function public.chat_search_publications(text, int) to authenticated;
grant execute on function public.chat_search_guide_extracts(text, int) to authenticated;
