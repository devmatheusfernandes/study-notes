-- Videos are vectorized inline (sync action / seed script), never through
-- vectorization_queue, so the settings card's "pendentes" count is "has a
-- transcript but no embedding chunks yet". An anti-join isn't expressible
-- through PostgREST filters, hence the function.
create or replace function public.count_unvectorized_videos()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from public.global_videos g
  where coalesce(g.content_text, '') <> ''
    and not exists (
      select 1 from public.global_video_embeddings e where e.video_id = g.id
    );
$$;

revoke all on function public.count_unvectorized_videos() from public;
grant execute on function public.count_unvectorized_videos() to authenticated;
