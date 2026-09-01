-- Migration: Global JW.org Videos and Hybrid RAG Match Function

-- 1. Table for global JW.org videos
CREATE TABLE IF NOT EXISTS public.global_videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_key TEXT,
  duration_formatted TEXT,
  duration_seconds INTEGER DEFAULT 0,
  cover_image TEXT,
  video_url TEXT,
  subtitles_url TEXT,
  content_text TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on global_videos
ALTER TABLE public.global_videos ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists then recreate
DROP POLICY IF EXISTS "Allow authenticated read on global_videos" ON public.global_videos;
CREATE POLICY "Allow authenticated read on global_videos"
  ON public.global_videos FOR SELECT
  TO authenticated
  USING (true);

-- 2. Table for global video vector embeddings
CREATE TABLE IF NOT EXISTS public.global_video_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES public.global_videos(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on global_video_embeddings
ALTER TABLE public.global_video_embeddings ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists then recreate
DROP POLICY IF EXISTS "Allow authenticated read on global_video_embeddings" ON public.global_video_embeddings;
CREATE POLICY "Allow authenticated read on global_video_embeddings"
  ON public.global_video_embeddings FOR SELECT
  TO authenticated
  USING (true);

-- Create HNSW index for fast similarity search on global_video_embeddings
CREATE INDEX IF NOT EXISTS global_video_embeddings_embedding_hnsw_idx
  ON public.global_video_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- 3. Hybrid search RPC function (searches both personal note_embeddings and global_video_embeddings)
CREATE OR REPLACE FUNCTION match_hybrid_embeddings(
  query_embedding vector(1536),
  user_id_param UUID,
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  note_id UUID,
  video_id TEXT,
  source_type TEXT,
  content TEXT,
  similarity FLOAT,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH user_notes AS (
    SELECT
      ne.id,
      ne.note_id,
      NULL::TEXT AS video_id,
      COALESCE((ne.metadata->>'type')::TEXT, 'nota') AS source_type,
      ne.content,
      1 - (ne.embedding <=> query_embedding) AS similarity,
      ne.metadata
    FROM public.note_embeddings ne
    WHERE ne.user_id = user_id_param
      AND 1 - (ne.embedding <=> query_embedding) > match_threshold
  ),
  global_vids AS (
    SELECT
      ge.id,
      NULL::UUID AS note_id,
      ge.video_id,
      'video'::TEXT AS source_type,
      ge.content,
      1 - (ge.embedding <=> query_embedding) AS similarity,
      ge.metadata
    FROM public.global_video_embeddings ge
    WHERE 1 - (ge.embedding <=> query_embedding) > match_threshold
  ),
  combined AS (
    SELECT * FROM user_notes
    UNION ALL
    SELECT * FROM global_vids
  )
  SELECT * FROM combined
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
