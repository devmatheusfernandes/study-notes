-- Handwriting/drawing notes with an optional voice recording synced to the
-- strokes (the Samsung Notes model: playing the audio replays the strokes in
-- the order and rhythm they were drawn).
--
-- The strokes live in their own table rather than in `notes.body`: a drawing
-- is a vector document that can reach hundreds of KB, `notes.body` is what
-- feeds card previews/search/vectorization (all of which would choke on
-- stroke JSON), and this way deleting a note drops the drawing via cascade
-- while the note row itself stays exactly the shape every other feature
-- already expects.

alter table public.notes drop constraint notes_type_check;
alter table public.notes add constraint notes_type_check
  check (type in ('nota', 'pdf', 'docx', 'xlsx', 'jwpub', 'jwlibrary', 'desenho', 'arquivo'));

create table public.note_drawings (
  note_id uuid primary key references public.notes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Encrypted JSON (see lib/encryption.ts), same treatment as notes.title/body:
  -- handwriting is as personal as typed text, so it gets the same protection.
  strokes text not null default '',
  -- Object path in the private `note-audio` bucket, or null when the drawing
  -- has no recording. Storage cleanup is explicit (see drawing-actions.ts) —
  -- this cascade only drops the row.
  audio_path text,
  audio_duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index note_drawings_user_idx on public.note_drawings(user_id);

create trigger note_drawings_set_updated_at
  before update on public.note_drawings
  for each row execute function public.set_updated_at();

alter table public.note_drawings enable row level security;

create policy "note_drawings_owner_all" on public.note_drawings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
