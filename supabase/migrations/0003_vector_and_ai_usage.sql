-- Enable pgvector extension for similarity search
create extension if not exists vector;

-- 1. Table for vector embeddings of notes, PDFs, and JWPUB chapters
create table if not exists public.note_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  jwpub_chapter_id uuid references public.jwpub_chapters(id) on delete cascade,
  
  chunk_index integer not null default 0,
  content text not null,
  embedding vector(1536) not null,
  
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- HNSW index for cosine distance similarity searches
create index if not exists note_embeddings_hnsw_idx 
  on public.note_embeddings 
  using hnsw (embedding vector_cosine_ops);

create index if not exists note_embeddings_user_note_idx 
  on public.note_embeddings(user_id, note_id);

alter table public.note_embeddings enable row level security;

create policy "note_embeddings_owner_all" on public.note_embeddings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Table for background vectorization queue
create table if not exists public.vectorization_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (note_id)
);

create index if not exists vectorization_queue_user_status_idx 
  on public.vectorization_queue(user_id, status);

alter table public.vectorization_queue enable row level security;

create policy "vectorization_queue_owner_all" on public.vectorization_queue
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. Table for tracking AI Usage and Costs (OpenAI API usage)
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  operation_type text not null, -- 'vectorization' or 'assistant_rag'
  model text not null, -- 'text-embedding-3-small', 'gpt-4o-mini', etc.
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_logs_user_idx 
  on public.ai_usage_logs(user_id);

alter table public.ai_usage_logs enable row level security;

create policy "ai_usage_logs_owner_all" on public.ai_usage_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Triggers for updated_at
create trigger note_embeddings_set_updated_at
  before update on public.note_embeddings
  for each row execute function public.set_updated_at();

create trigger vectorization_queue_set_updated_at
  before update on public.vectorization_queue
  for each row execute function public.set_updated_at();

-- 5. RPC function for semantic search with RLS matching auth.uid()
create or replace function public.match_embeddings(
  query_embedding vector(1536),
  match_threshold float default 0.25,
  match_count int default 8
)
returns table (
  id uuid,
  note_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
security invoker
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
