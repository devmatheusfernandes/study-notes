-- Note & folder locking (PIN / biometric gate against someone using an already-unlocked device).
--
-- `locked` is a client-enforced privacy gate, not encryption: locked content is
-- hidden in the UI until the user re-authenticates. What the SERVER can do, it
-- does here: the AI assistant must never answer from a locked note, so every
-- retrieval path excludes them.

alter table public.notes add column if not exists locked boolean not null default false;
alter table public.folders add column if not exists locked boolean not null default false;

-- One PIN per user, stored as a salted scrypt hash. RLS is on with NO policy and
-- all grants revoked: the only way in is the service-role client inside
-- lock-actions.ts, which verifies the session first. (An owner-writable row would
-- let someone with a live session reset `failed_attempts` and brute-force the PIN.)
create table if not exists public.user_lock_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.user_lock_pins enable row level security;
revoke all on table public.user_lock_pins from anon, authenticated;

-- Ids of the caller's notes that are locked directly or sit anywhere inside a locked folder.
create or replace function public.locked_note_ids()
returns setof uuid
language sql
stable
as $$
  with recursive locked_folders as (
    select id from public.folders where user_id = auth.uid() and locked
    union
    select f.id from public.folders f join locked_folders lf on f.parent_id = lf.id
  )
  select n.id from public.notes n
  where n.user_id = auth.uid()
    and (n.locked or n.folder_id in (select id from locked_folders));
$$;
grant execute on function public.locked_note_ids() to authenticated;
revoke execute on function public.locked_note_ids() from anon, public;

-- Older single-source search used by assistant-actions.ts.
create or replace function public.match_embeddings(
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
    and ne.note_id not in (select public.locked_note_ids())
    and 1 - (ne.embedding <=> query_embedding) > match_threshold
  order by ne.embedding <=> query_embedding
  limit match_count;
end;
$$;

alter function public.match_embeddings(halfvec(1536), double precision, integer)
  set ivfflat.probes = 10;

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
as $$
begin
  if auth.uid() is null or user_id_param is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

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
    where ne.user_id = auth.uid()
      and ne.note_id not in (select public.locked_note_ids())
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
      and ne.user_id = auth.uid()
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

alter function public.match_hybrid_embeddings(halfvec(1536), uuid, double precision, integer, text[])
  set ivfflat.probes = 10;

revoke all on function public.match_hybrid_embeddings(halfvec(1536), uuid, double precision, integer, text[]) from public, anon;
grant execute on function public.match_hybrid_embeddings(halfvec(1536), uuid, double precision, integer, text[]) to authenticated;

revoke all on function public.match_embeddings(halfvec(1536), double precision, integer) from public, anon;
grant execute on function public.match_embeddings(halfvec(1536), double precision, integer) to authenticated;
