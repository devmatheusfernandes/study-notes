-- The HNSW→IVFFlat swap in 0036 barely moved the needle (measured: DB size
-- actually went UP slightly) -- both index types store the full vector
-- inside the index itself, so the real cost is the vector's own size
-- (1536 dims * 4 bytes = 6KB/row), not the index bookkeeping around it.
--
-- pgvector's `halfvec` type stores each dimension as a 16-bit float instead
-- of 32-bit, halving that 6KB/row *and* every index built on it, for a
-- semantic-search precision loss that doesn't matter at this app's
-- similarity thresholds (0.20-0.42, tuned in app/(app)/assistant/stream/route.ts
-- and app/(app)/chats/[id]/stream/route.ts). No re-embedding/OpenAI call
-- needed -- this is a lossy-but-fine reinterpretation of the embeddings
-- already stored, not a different model.

set maintenance_work_mem = '128MB';

drop index if exists public.global_bible_embeddings_embedding_ivfflat_idx;
drop index if exists public.global_video_embeddings_embedding_ivfflat_idx;
drop index if exists public.note_embeddings_ivfflat_idx;

alter table public.global_bible_embeddings
  alter column embedding type halfvec(1536) using embedding::halfvec(1536);

alter table public.global_video_embeddings
  alter column embedding type halfvec(1536) using embedding::halfvec(1536);

alter table public.note_embeddings
  alter column embedding type halfvec(1536) using embedding::halfvec(1536);

create index global_bible_embeddings_embedding_ivfflat_idx
  on public.global_bible_embeddings
  using ivfflat (embedding halfvec_cosine_ops)
  with (lists = 100);

create index global_video_embeddings_embedding_ivfflat_idx
  on public.global_video_embeddings
  using ivfflat (embedding halfvec_cosine_ops)
  with (lists = 100);

create index note_embeddings_ivfflat_idx
  on public.note_embeddings
  using ivfflat (embedding halfvec_cosine_ops)
  with (lists = 50);

-- Every function comparing against these columns must take a matching
-- halfvec param -- `<=>` doesn't implicitly cross-cast vector<->halfvec.
-- Dropped and recreated (not ALTERed) since the parameter type itself is
-- changing, which Postgres treats as a different function signature.

drop function if exists public.match_embeddings(vector, double precision, integer);

create function public.match_embeddings(
  query_embedding halfvec(1536),
  match_threshold double precision default 0.25,
  match_count integer default 8
)
returns table(id uuid, note_id uuid, content text, metadata jsonb, similarity double precision)
language plpgsql
as $$
begin
  return query
  select
    ne.id,
    ne.note_id,
    ne.content,
    ne.metadata,
    1 - (ne.embedding <=> query_embedding) as similarity
  from public.note_embeddings ne
  where ne.user_id = auth.uid()
    and 1 - (ne.embedding <=> query_embedding) > match_threshold
  order by ne.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- The 4-param match_hybrid_embeddings overload (no allowed_types) was
-- superseded by the 6-param one below well before this migration -- neither
-- app/(app)/assistant/stream/route.ts nor app/(app)/chats/[id]/stream/route.ts
-- (the only two callers) has passed anything but the 6-param shape for a
-- while. Dropped outright rather than carried forward as dead halfvec code.
drop function if exists public.match_hybrid_embeddings(vector, uuid, double precision, integer);

drop function if exists public.match_hybrid_embeddings(vector, uuid, double precision, integer, text[]);

create function public.match_hybrid_embeddings(
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
as $$
begin
  return query
  with user_notes as (
    select
      ne.id,
      ne.note_id,
      null::text as video_id,
      coalesce(ne.metadata->>'type', n.type, 'nota')::text as source_type,
      ne.content,
      1 - (ne.embedding <=> query_embedding) as similarity,
      ne.metadata
    from public.note_embeddings ne
    join public.notes n on n.id = ne.note_id
    where ne.user_id = user_id_param
      and (1 - (ne.embedding <=> query_embedding)) > match_threshold
      and (coalesce(ne.metadata->>'type', n.type, 'nota') = any(allowed_types))
  ),
  user_jwlibrary_notes as (
    select
      ne.id,
      null::uuid as note_id,
      null::text as video_id,
      'estudo_pessoal'::text as source_type,
      ne.content,
      1 - (ne.embedding <=> query_embedding) as similarity,
      ne.metadata
    from public.note_embeddings ne
    join public.jwlibrary_notes jn on jn.id = ne.jwlibrary_note_id
    where ne.jwlibrary_note_id is not null
      and ne.user_id = user_id_param
      and (1 - (ne.embedding <=> query_embedding)) > match_threshold
      and ('estudo_pessoal' = any(allowed_types))
  ),
  global_vids as (
    select
      ge.id,
      null::uuid as note_id,
      ge.video_id,
      'video'::text as source_type,
      ge.content,
      1 - (ge.embedding <=> query_embedding) as similarity,
      ge.metadata
    from public.global_video_embeddings ge
    where (1 - (ge.embedding <=> query_embedding)) > match_threshold
      and ('video' = any(allowed_types))
  ),
  global_bible as (
    select
      be.id,
      null::uuid as note_id,
      null::text as video_id,
      'biblia'::text as source_type,
      be.content,
      1 - (be.embedding <=> query_embedding) as similarity,
      be.metadata
    from public.global_bible_embeddings be
    where (1 - (be.embedding <=> query_embedding)) > match_threshold
      and ('biblia' = any(allowed_types))
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
  select
    c.id,
    c.note_id,
    c.video_id,
    c.source_type,
    c.content,
    c.similarity,
    c.metadata
  from combined c
  order by c.similarity desc
  limit match_count;
end;
$$;

alter function public.match_embeddings(halfvec(1536), double precision, integer)
  set ivfflat.probes = 10;

alter function public.match_hybrid_embeddings(halfvec(1536), uuid, double precision, integer, text[])
  set ivfflat.probes = 10;
