import postgres from "postgres";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL não configurada no .env");
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: "require" });

async function run() {
  console.log("Replacing RPC match_hybrid_embeddings...");

  await sql`
    CREATE OR REPLACE FUNCTION match_hybrid_embeddings(
      query_embedding vector(1536),
      user_id_param UUID,
      match_threshold FLOAT DEFAULT 0.20,
      match_count INT DEFAULT 8,
      allowed_types TEXT[] DEFAULT ARRAY['nota', 'pdf', 'jwpub', 'video']
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
    SET search_path = public, extensions
    AS $$
    BEGIN
      RETURN QUERY
      WITH user_notes AS (
        SELECT
          ne.id,
          ne.note_id,
          NULL::TEXT AS video_id,
          COALESCE(ne.metadata->>'type', n.type, 'nota')::TEXT AS source_type,
          ne.content,
          1 - (ne.embedding <=> query_embedding) AS similarity,
          ne.metadata
        FROM public.note_embeddings ne
        JOIN public.notes n ON n.id = ne.note_id
        WHERE ne.user_id = user_id_param
          AND (1 - (ne.embedding <=> query_embedding)) > match_threshold
          AND (COALESCE(ne.metadata->>'type', n.type, 'nota') = ANY(allowed_types))
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
        WHERE (1 - (ge.embedding <=> query_embedding)) > match_threshold
          AND ('video' = ANY(allowed_types))
      ),
      combined AS (
        SELECT * FROM user_notes
        UNION ALL
        SELECT * FROM global_vids
      )
      SELECT
        c.id,
        c.note_id,
        c.video_id,
        c.source_type,
        c.content,
        c.similarity,
        c.metadata
      FROM combined c
      ORDER BY c.similarity DESC
      LIMIT match_count;
    END;
    $$;
  `;

  console.log("RPC match_hybrid_embeddings updated successfully!");
  await sql.end();
}

run().catch((err) => {
  console.error("Erro:", err);
  process.exit(1);
});
