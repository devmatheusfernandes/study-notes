-- Lets clicking a video in the Bible study panel's "Vídeos" tab seek straight
-- to the moment the chapter is actually cited, instead of always starting at
-- 00:00 — the same jump-to-timestamp the search results screen already does
-- via a transcript excerpt (see InlineVideoCard's `snippet` prop).
--
-- `snippet` is computed in JS at index time (lib/bible/video-scripture-refs.ts
-- already has the full transcript in memory and needs its own alias-aware
-- book-name matching, not reachable from SQL), not derived here — this
-- migration only adds the column and teaches get_chapter_videos to return it.

alter table public.video_scripture_refs add column snippet text;

-- `create or replace` can't change a function's return type (adding the new
-- `snippet` output column) — Postgres rejects that outright, so the old
-- signature has to be dropped first.
drop function if exists public.get_chapter_videos(int, int);

create function public.get_chapter_videos(
  p_book_order int,
  p_chapter int
)
returns table (
  video_id text,
  title text,
  cover_image text,
  video_url text,
  subtitles_url text,
  duration_formatted text,
  first_published timestamptz,
  source text,
  verses smallint[],
  snippet text
)
language sql
stable
set search_path = public
as $$
  select g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
         g.duration_formatted, g.first_published, r.source,
         array_remove(array_agg(distinct r.verse), null) as verses,
         -- One video can carry several matched rows (several verses of the
         -- same chapter cited separately) — any one of their snippets gets
         -- the player close enough, so the first non-null one wins rather
         -- than picking a particular verse's.
         (array_agg(r.snippet) filter (where r.snippet is not null))[1] as snippet
  from public.video_scripture_refs r
  join public.global_videos g on g.id = r.video_id
  where r.book_order = p_book_order and r.chapter = p_chapter
  group by g.id, g.title, g.cover_image, g.video_url, g.subtitles_url,
           g.duration_formatted, g.first_published, r.source
  order by (r.source = 'title') desc, g.first_published desc nulls last;
$$;

grant execute on function public.get_chapter_videos(int, int) to authenticated;
