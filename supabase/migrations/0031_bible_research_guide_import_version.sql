-- Lets a change to the PARSING/rewriting logic (lib/jwpub/sanitize.ts,
-- lib/bible/research-guide-parse.ts) force a reimport even when someone
-- reuploads the exact same .jwpub file the hash check would otherwise
-- recognize as already done — without this, the very first real bug found in
-- the extract-embedding feature couldn't be fixed by simply reuploading:
-- checkResearchGuideNeedsImport only ever compared the file's own hash,
-- which stayed identical across the code change.
alter table public.bible_research_guide_meta
  add column import_version integer not null default 0;
