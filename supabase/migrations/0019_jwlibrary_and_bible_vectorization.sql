-- Adds two new RAG sources:
--   1. Estudo Pessoal (jwlibrary) notes — per-user, live-vectorized on
--      create/edit via the same vectorization_queue/note_embeddings tables
--      as regular notes. `jwlibrary_notes` is a separate table from `notes`
--      (own encryption, no `status` column, hard delete) with no `notes.id`
--      to point at, so both tables gain a second, mutually-exclusive FK
--      instead of trying to force a jwlibrary_notes id into the existing
--      `notes`-only `note_id` column.
--   2. The Bible — global, identical for every user, so it gets its own
--      global_bible_embeddings table (mirroring global_video_embeddings)
--      seeded once by scripts/seed-bible-embeddings.mjs, never touched by
--      the per-user queue.
--
-- Also recreates match_hybrid_embeddings from its actual *live* definition
-- (previously only applied ad hoc via scripts/update-rpc-match-hybrid.mjs,
-- never captured in a tracked migration) plus the two new source branches,
-- so a fresh database now ends up in the same state as the deployed one.

alter table public.note_embeddings
  alter column note_id drop not null,
  add column if not exists jwlibrary_note_id uuid references public.jwlibrary_notes(id) on delete cascade;

alter table public.note_embeddings
  add constraint note_embeddings_exactly_one_owner
  check ((note_id is not null) <> (jwlibrary_note_id is not null));

create index if not exists note_embeddings_user_jwlibrary_note_idx
  on public.note_embeddings(user_id, jwlibrary_note_id);

alter table public.vectorization_queue
  alter column note_id drop not null,
  add column if not exists jwlibrary_note_id uuid references public.jwlibrary_notes(id) on delete cascade;

alter table public.vectorization_queue
  add constraint vectorization_queue_exactly_one_owner
  check ((note_id is not null) <> (jwlibrary_note_id is not null));

alter table public.vectorization_queue
  add constraint vectorization_queue_jwlibrary_note_id_key unique (jwlibrary_note_id);

create table public.global_bible_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_index integer not null default 0,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.global_bible_embeddings enable row level security;

create policy "global_bible_embeddings_read_authenticated" on public.global_bible_embeddings
  for select
  to authenticated
  using (true);

create index global_bible_embeddings_embedding_hnsw_idx
  on public.global_bible_embeddings
  using hnsw (embedding vector_cosine_ops);

create or replace function match_hybrid_embeddings(
  query_embedding vector(1536),
  user_id_param uuid,
  match_threshold float default 0.20,
  match_count int default 8,
  allowed_types text[] default array['nota', 'pdf', 'jwpub', 'video', 'estudo_pessoal', 'biblia']
)
returns table (
  id uuid,
  note_id uuid,
  video_id text,
  source_type text,
  content text,
  similarity float,
  metadata jsonb
)
language plpgsql
security definer
set search_path = public, extensions
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
