-- Lets the Settings upload card skip a full reimport when someone uploads
-- the exact same .jwpub the guide is already built from — any signed-in user
-- can trigger this import (see CLAUDE.md's note on syncGlobalJwVideos being
-- the same trust model already in place for other global content), so a
-- second person re-uploading the same file they downloaded from jw.org
-- shouldn't pay for a multi-minute reparse+rewrite for nothing.
alter table public.bible_research_guide_meta
  add column source_hash text;
