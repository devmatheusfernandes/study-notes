-- Sharing notes and folders with other users (invite → accept), plus the
-- persisted Yjs state for real-time collaborative editing of shared notes.
--
-- Access to a shared note is COMPUTED, never copied: a folder share grants
-- whatever sits in that folder tree right now. A note created (or moved) into
-- a shared folder later is included; locking a note, a subfolder or any folder
-- above it removes it on the next read; unlocking brings it back. Only plain
-- text notes (type 'nota') that are active (not archived/trashed) are shared.
--
-- The SECURITY DEFINER functions below read notes/folders/shares as their
-- owner (bypassing RLS), which is what lets the notes/folders policies call
-- them without recursing into themselves. Every one of them is scoped to
-- auth.uid().

-- ---------------------------------------------------------------------------
-- Profiles: just enough to show who shared something and to match invites.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_email_lower_idx on public.profiles (lower(email));
alter table public.profiles enable row level security;
create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Shares
-- ---------------------------------------------------------------------------
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  -- Always lower-cased. An invite to an e-mail with no account yet stays
  -- pending with invitee_id null until someone signs up with it.
  invitee_email text not null check (invitee_email = lower(invitee_email) and char_length(invitee_email) between 3 and 320),
  invitee_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'left')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint shares_one_target check ((note_id is null) <> (folder_id is null))
);
create unique index if not exists shares_note_invitee_idx on public.shares (note_id, invitee_email) where note_id is not null;
create unique index if not exists shares_folder_invitee_idx on public.shares (folder_id, invitee_email) where folder_id is not null;
create index if not exists shares_invitee_idx on public.shares (invitee_id, status);
create index if not exists shares_owner_idx on public.shares (owner_id);

alter table public.shares enable row level security;

-- The owner manages their own shares, and only for things they own.
create policy "shares_owner_all" on public.shares
  for all
  using (auth.uid() = owner_id)
  with check (
    auth.uid() = owner_id
    and (note_id is null or exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid()))
    and (folder_id is null or exists (select 1 from public.folders f where f.id = folder_id and f.user_id = auth.uid()))
  );

create policy "shares_invitee_select" on public.shares
  for select using (auth.uid() = invitee_id);

create policy "shares_invitee_update" on public.shares
  for update using (auth.uid() = invitee_id) with check (auth.uid() = invitee_id);

-- What each side may change. The invitee answers (pending → accepted/declined)
-- and may leave (accepted → left); nothing else. The owner can't forge an
-- acceptance: re-inviting sets the row back to pending.
create or replace function public.shares_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- service role / migrations
  end if;

  if auth.uid() = old.owner_id then
    if new.owner_id is distinct from old.owner_id
       or new.note_id is distinct from old.note_id
       or new.folder_id is distinct from old.folder_id
       or new.invitee_email is distinct from old.invitee_email
       or new.invitee_id is distinct from old.invitee_id then
      raise exception 'share target cannot change' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('pending', 'revoked') then
      raise exception 'only the invitee can accept or decline' using errcode = '42501';
    end if;
    return new;
  end if;

  if auth.uid() = old.invitee_id then
    if (to_jsonb(new) - 'status' - 'responded_at') is distinct from (to_jsonb(old) - 'status' - 'responded_at') then
      raise exception 'the invitee can only answer' using errcode = '42501';
    end if;
    if not (
      (old.status = 'pending' and new.status in ('accepted', 'declined'))
      or (old.status = 'accepted' and new.status = 'left')
      or new.status = old.status
    ) then
      raise exception 'invalid share transition' using errcode = '42501';
    end if;
    new.responded_at = now();
    return new;
  end if;

  raise exception 'not allowed' using errcode = '42501';
end;
$$;

drop trigger if exists shares_guard on public.shares;
create trigger shares_guard
  before update on public.shares
  for each row execute function public.shares_guard();

-- Keep profiles in sync and attach pending invites to the account that owns
-- the e-mail, at sign-up and on e-mail change.
create or replace function public.handle_auth_user_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do update set email = excluded.email;

  if new.email is not null then
    update public.shares
      set invitee_id = new.id
      where invitee_id is null and invitee_email = lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_sync on auth.users;
create trigger on_auth_user_sync
  after insert or update of email on auth.users
  for each row execute function public.handle_auth_user_sync();

insert into public.profiles (id, email, display_name)
select u.id, coalesce(u.email, ''), split_part(coalesce(u.email, ''), '@', 1)
from auth.users u
on conflict (id) do nothing;

-- Resolves an invite's e-mail to an account at invite time (the trigger above
-- covers accounts created later). Returns nothing to the caller about whether
-- the e-mail exists — the Server Action answers the same either way.
create or replace function public.resolve_invitee(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.resolve_invitee(text) from public, anon, authenticated;
-- Only callable from SECURITY DEFINER code / the service role.

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Folders shared with the caller: each accepted folder share's tree, minus any
-- folder the owner has locked or that sits under a locked folder (above or
-- below the shared one). When two shares overlap, the stronger role wins.
create or replace function public.shared_folder_access()
returns table (folder_id uuid, role text, share_id uuid, owner_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with recursive my_shares as (
    select s.id, s.folder_id, s.role, s.owner_id
    from public.shares s
    where s.invitee_id = auth.uid() and s.status = 'accepted' and s.folder_id is not null
  ),
  owner_locked as (
    select f.id from public.folders f
    where f.locked and f.user_id in (select ms.owner_id from my_shares ms)
    union
    select c.id from public.folders c join owner_locked l on c.parent_id = l.id
  ),
  tree as (
    select f.id, ms.role, ms.id as share_id, ms.owner_id
    from my_shares ms
    join public.folders f on f.id = ms.folder_id and f.user_id = ms.owner_id
    where f.id not in (select id from owner_locked)
    union
    select c.id, t.role, t.share_id, t.owner_id
    from public.folders c join tree t on c.parent_id = t.id
    where c.id not in (select id from owner_locked)
  )
  select distinct on (t.id) t.id, t.role, t.share_id, t.owner_id
  from tree t
  order by t.id, t.role asc; -- 'editor' < 'viewer'
$$;

-- Notes shared with the caller, directly or through a shared folder.
create or replace function public.shared_note_access()
returns table (note_id uuid, role text, share_id uuid, owner_id uuid, via_folder boolean)
language sql
stable
security definer
set search_path = public
as $$
  with recursive direct_shares as (
    select s.id, s.note_id, s.role, s.owner_id
    from public.shares s
    where s.invitee_id = auth.uid() and s.status = 'accepted' and s.note_id is not null
  ),
  owner_locked as (
    select f.id from public.folders f
    where f.locked and f.user_id in (select ds.owner_id from direct_shares ds)
    union
    select c.id from public.folders c join owner_locked l on c.parent_id = l.id
  ),
  candidates as (
    select n.id as note_id, ds.role, ds.id as share_id, ds.owner_id, false as via_folder
    from direct_shares ds
    join public.notes n on n.id = ds.note_id and n.user_id = ds.owner_id
    where not n.locked and n.type = 'nota' and n.status = 'active'
      and (n.folder_id is null or n.folder_id not in (select id from owner_locked))
    union all
    select n.id, fa.role, fa.share_id, fa.owner_id, true
    from public.shared_folder_access() fa
    join public.notes n on n.folder_id = fa.folder_id and n.user_id = fa.owner_id
    where not n.locked and n.type = 'nota' and n.status = 'active'
  )
  select distinct on (c.note_id) c.note_id, c.role, c.share_id, c.owner_id, c.via_folder
  from candidates c
  order by c.note_id, c.role asc, c.via_folder asc;
$$;

-- 'owner' | 'editor' | 'viewer' | null for one note.
create or replace function public.note_share_role(p_note_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from public.notes n where n.id = p_note_id and n.user_id = auth.uid()) then 'owner'
    else (select a.role from public.shared_note_access() a where a.note_id = p_note_id limit 1)
  end;
$$;

-- True when the caller and `p_other` are linked by an accepted share in either
-- direction — used to let collaborators see each other's note images.
create or replace function public.shares_connect(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_other = auth.uid() or exists (
    select 1 from public.shares s
    where s.status = 'accepted'
      and ((s.owner_id = auth.uid() and s.invitee_id = p_other)
        or (s.owner_id = p_other and s.invitee_id = auth.uid()))
  );
$$;

-- Display names of the people on the other end of the caller's shares.
create or replace function public.share_peer_profiles()
returns table (id uuid, email text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.display_name
  from public.profiles p
  where p.id in (
    select s.owner_id from public.shares s where s.invitee_id = auth.uid()
    union
    select s.invitee_id from public.shares s where s.owner_id = auth.uid() and s.invitee_id is not null
  );
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.shared_folder_access()',
    'public.shared_note_access()',
    'public.note_share_role(uuid)',
    'public.shares_connect(uuid)',
    'public.share_peer_profiles()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- notes / folders: extra policies (the owner policies stay as they are)
-- ---------------------------------------------------------------------------
create policy "notes_shared_select" on public.notes
  for select using (id in (select a.note_id from public.shared_note_access() a));

create policy "notes_shared_update" on public.notes
  for update
  using (id in (select a.note_id from public.shared_note_access() a where a.role = 'editor'))
  with check (id in (select a.note_id from public.shared_note_access() a where a.role = 'editor'));

create policy "folders_shared_select" on public.folders
  for select using (id in (select a.folder_id from public.shared_folder_access() a));

-- A collaborator edits the text and nothing else: pin, folder, tags, status,
-- lock and ownership stay the owner's. (scriptures_indexed_at is a derived
-- stamp the save path writes.) Named so it sorts before notes_set_updated_at.
create or replace function public.notes_collaborator_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and old.user_id is distinct from auth.uid() then
    if (to_jsonb(new) - 'title' - 'body' - 'updated_at' - 'scriptures_indexed_at')
       is distinct from (to_jsonb(old) - 'title' - 'body' - 'updated_at' - 'scriptures_indexed_at') then
      raise exception 'collaborators can only edit the text' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notes_collaborator_guard on public.notes;
create trigger notes_collaborator_guard
  before update on public.notes
  for each row execute function public.notes_collaborator_guard();

-- ---------------------------------------------------------------------------
-- Collaborative state (Yjs document, base64 update, encrypted by the app)
-- ---------------------------------------------------------------------------
create table if not exists public.note_collab_state (
  note_id uuid primary key references public.notes(id) on delete cascade,
  state text not null,
  updated_at timestamptz not null default now()
);
alter table public.note_collab_state enable row level security;

create policy "note_collab_state_select" on public.note_collab_state
  for select using (public.note_share_role(note_id) is not null);
create policy "note_collab_state_insert" on public.note_collab_state
  for insert with check (public.note_share_role(note_id) in ('owner', 'editor'));
create policy "note_collab_state_update" on public.note_collab_state
  for update
  using (public.note_share_role(note_id) in ('owner', 'editor'))
  with check (public.note_share_role(note_id) in ('owner', 'editor'));

-- ---------------------------------------------------------------------------
-- Realtime: private channel "note:<uuid>" per shared note
-- ---------------------------------------------------------------------------
create or replace function public.collab_topic_role(p_topic text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_topic !~ '^note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return public.note_share_role(substring(p_topic from 6)::uuid);
end;
$$;
revoke all on function public.collab_topic_role(text) from public, anon;
grant execute on function public.collab_topic_role(text) to authenticated;

drop policy if exists "collab_note_receive" on realtime.messages;
create policy "collab_note_receive" on realtime.messages
  for select to authenticated
  using (public.collab_topic_role(realtime.topic()) is not null);

-- Presence (who is here) for anyone with access; broadcasting edits only for
-- owner/editor — a viewer receives but cannot send.
drop policy if exists "collab_note_send" on realtime.messages;
create policy "collab_note_send" on realtime.messages
  for insert to authenticated
  with check (
    (realtime.messages.extension = 'presence' and public.collab_topic_role(realtime.topic()) is not null)
    or (realtime.messages.extension = 'broadcast' and public.collab_topic_role(realtime.topic()) in ('owner', 'editor'))
  );
