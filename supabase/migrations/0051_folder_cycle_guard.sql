-- Folders can be moved under one another. The app rejects a move that would
-- put a folder inside itself, but moves also replay from an offline outbox (two
-- devices can queue A→B and B→A), so the database refuses a cycle on its own.

create or replace function public.prevent_folder_cycle()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a folder cannot be its own parent' using errcode = '23514';
  end if;

  -- Walk up from the new parent; reaching this folder means it is an ancestor of itself.
  if exists (
    with recursive ancestors as (
      select id, parent_id from public.folders where id = new.parent_id
      union
      select f.id, f.parent_id from public.folders f join ancestors a on f.id = a.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'moving this folder would create a cycle' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists folders_prevent_cycle on public.folders;
create trigger folders_prevent_cycle
  before update of parent_id on public.folders
  for each row execute function public.prevent_folder_cycle();
