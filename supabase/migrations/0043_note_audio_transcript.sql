-- Transcript of the note's voice recording. Encrypted with the same
-- encryptText/decryptText as the rest of the note's text; cleared whenever the
-- recording itself is replaced or removed.
alter table public.note_drawings add column audio_transcript text;
