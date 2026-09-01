-- 1. Conversations table
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa',
  status text not null default 'active' check (status in ('active', 'archived', 'trashed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_status_idx
  on public.chat_conversations(user_id, status);

alter table public.chat_conversations enable row level security;

create policy "chat_conversations_owner_all" on public.chat_conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger chat_conversations_set_updated_at
  before update on public.chat_conversations
  for each row execute function public.set_updated_at();

-- 2. Messages table
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages(conversation_id, created_at);

alter table public.chat_messages enable row level security;

create policy "chat_messages_owner_all" on public.chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
