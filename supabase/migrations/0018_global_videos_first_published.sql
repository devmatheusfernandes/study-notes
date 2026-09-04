-- The JW.org mediator API returns a `firstPublished` timestamp per video
-- (verified against the live API) that the seed script previously discarded —
-- needed to answer "a última adoração matinal"-style questions, since
-- semantic similarity alone has no notion of recency.
alter table public.global_videos
  add column if not exists first_published timestamptz;

create index if not exists global_videos_first_published_idx
  on public.global_videos(first_published desc);
