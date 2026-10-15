-- Security audit fix.
--
-- match_hybrid_embeddings is SECURITY DEFINER (it bypasses RLS) and took the
-- owner as a plain argument, with EXECUTE granted to PUBLIC — so anyone holding
-- the publishable key (which ships in the browser bundle), signed in or not,
-- could call it with another user's id and read that user's note/PDF text
-- chunks (`content`) straight out of note_embeddings. The caller is now pinned
-- to auth.uid(), and anon/PUBLIC lose EXECUTE.

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

-- Same default-PUBLIC exposure on the other two SECURITY DEFINER helpers.
revoke all on function public.count_unvectorized_videos() from public, anon;
grant execute on function public.count_unvectorized_videos() to authenticated;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
