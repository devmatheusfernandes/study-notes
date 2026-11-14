-- What each of the user's devices has downloaded for offline use.
--
-- Offline copies live in the browser's own storage (IndexedDB / Cache Storage),
-- so no device can see what another one holds. Each device therefore reports a
-- small inventory here — which publications and whether the Bible are on it,
-- and how large — purely so Settings can show "phone has the Bible and these
-- publications, desktop has these". Nothing in this table is the downloaded
-- content itself, and a row never grants access to anything.
--
-- One row per (user, device). `device_id` is a random id each browser profile
-- generates once and keeps; titles and sizes only, so no encryption needed.
create table public.device_offline_inventory (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id uuid not null,
  name text not null,
  -- 'phone' | 'tablet' | 'desktop' — only picks an icon.
  platform text not null default 'desktop',
  -- Opened as an installed app (display-mode: standalone) the last time it reported.
  is_pwa boolean not null default false,
  -- [{ kind: 'bible' | 'publication', title, bytes, downloadedAt, noteId? }]
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.device_offline_inventory enable row level security;

create policy "device_offline_inventory_owner_all" on public.device_offline_inventory
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
