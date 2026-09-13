-- Shrinks the 3 vector-search indexes from HNSW to IVFFlat, to fit the
-- Supabase free tier's 500MB database cap -- this project's DB measured at
-- 659MB, and most of that turned out to be pure HNSW graph overhead sitting
-- on top of the actual embedding data, e.g. global_bible_embeddings: 8MB of
-- raw table data next to a 91MB HNSW index. IVFFlat trades a bit of query
-- recall/speed for a much smaller index -- the right trade for this app's
-- actual usage volume (a personal project, not a high-QPS product).
--
-- `lists` chosen per pgvector's own sizing guidance (~sqrt(row count) for a
-- table this size, rounded): 100 for global_bible_embeddings (11.7k rows)
-- and global_video_embeddings (10k rows), 50 for note_embeddings (4.7k rows
-- today, grows per-user over time). Unlike HNSW, IVFFlat's cluster centroids
-- are fixed at CREATE INDEX time and don't rebalance as rows are added --
-- if any of these tables grows past ~10x its current size, re-run the
-- matching CREATE INDEX below with a larger `lists` (drop the old one first)
-- to keep search quality from degrading.

-- IVFFlat's k-means build needs more scratch memory than this project's
-- default maintenance_work_mem (32MB) -- measured failing with "memory
-- required is 65 MB" on the first CREATE INDEX below. Transaction-scoped,
-- reverts automatically at commit.
set maintenance_work_mem = '128MB';

drop index if exists public.global_bible_embeddings_embedding_hnsw_idx;
create index global_bible_embeddings_embedding_ivfflat_idx
  on public.global_bible_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

drop index if exists public.global_video_embeddings_embedding_hnsw_idx;
create index global_video_embeddings_embedding_ivfflat_idx
  on public.global_video_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

drop index if exists public.note_embeddings_hnsw_idx;
create index note_embeddings_ivfflat_idx
  on public.note_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- IVFFlat only probes 1 list by default, which misses nearby matches that
-- landed in a neighboring cluster -- set per-function (not per-session) so
-- every RPC that searches these tables gets reasonable recall without any
-- app code needing to know this is an index-internal detail. 10 probes
-- against 100 lists is a standard starting point (~10% of clusters checked).
alter function public.match_embeddings(vector, double precision, integer)
  set ivfflat.probes = 10;

alter function public.match_hybrid_embeddings(vector, uuid, double precision, integer)
  set ivfflat.probes = 10;

alter function public.match_hybrid_embeddings(vector, uuid, double precision, integer, text[])
  set ivfflat.probes = 10;
