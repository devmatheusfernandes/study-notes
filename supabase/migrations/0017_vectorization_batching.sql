-- Resumable, batch-friendly vectorization queue: tracks per-item chunk
-- progress and adds an atomic claim function so a Vercel Cron tick (or a
-- concurrent manual "Processar Agora" click) can never double-process the
-- same row.

alter table public.vectorization_queue
  add column if not exists total_chunks integer,
  add column if not exists processed_chunks integer not null default 0;

create index if not exists vectorization_queue_status_created_idx
  on public.vectorization_queue(status, created_at);

-- No `security definer`: runs as whichever role calls it. Called via the
-- per-request (RLS-scoped) client from the manual "Processar Agora" button,
-- where ordinary RLS on vectorization_queue already restricts it to the
-- caller's own rows; called via the service-role client from the cron route,
-- which bypasses RLS to claim across every user. `for update skip locked`
-- is what makes concurrent callers safe — each claims a disjoint set.
create or replace function public.claim_vectorization_queue_batch(
  p_batch_size int default 5,
  p_stale_after interval default interval '3 minutes'
)
returns setof public.vectorization_queue
language sql
as $$
  update public.vectorization_queue q
  set status = 'processing'
  from (
    select id from public.vectorization_queue
    where status = 'pending'
       or (status = 'processing' and updated_at < now() - p_stale_after)
    order by created_at asc
    limit p_batch_size
    for update skip locked
  ) claimed
  where q.id = claimed.id
  returning q.*;
$$;
