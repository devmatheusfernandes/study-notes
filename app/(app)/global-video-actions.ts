"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { crawlCategory } from "@/lib/video/video-crawler";
import { formatVttToText } from "@/lib/video/video-utils";
import { buildVideoScriptureRows } from "@/lib/bible/video-scripture-refs";
import { splitTextIntoChunks } from "@/lib/vector/chunker";
import { generateEmbeddings } from "@/lib/vector/openai";

export interface GlobalVideoStats {
  totalVideos: number;
  vectorizedCount: number;
  pendingCount: number;
}

export async function getGlobalVideoStats(): Promise<GlobalVideoStats> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { totalVideos: 0, vectorizedCount: 0, pendingCount: 0 };

  const { count: totalVideos } = await supabase
    .from("global_videos")
    .select("*", { count: "exact", head: true });

  // Videos are embedded inline (syncGlobalJwVideos / scripts/seed-all-videos.mjs),
  // not through vectorization_queue, so "pending" is whatever has a transcript
  // but no embedding chunks yet.
  const { data: pendingData } = await supabase.rpc("count_unvectorized_videos");
  const pendingCount = Number(pendingData ?? 0);

  const total = totalVideos ?? 0;
  const pending = pendingCount;
  const vectorized = Math.max(0, total - pending);

  return {
    totalVideos: total,
    vectorizedCount: vectorized,
    pendingCount: pending,
  };
}

export async function syncGlobalJwVideos(): Promise<{
  ok: boolean;
  addedCount?: number;
  message?: string;
  error?: string;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  try {
    const admin = createAdminClient();

    // 1. Fetch existing video IDs from global_videos
    const { data: existingRows } = await admin
      .from("global_videos")
      .select("id");

    const existingIds = new Set((existingRows ?? []).map((r) => r.id));

    // 2. Crawl JW.org catalog
    const crawledVideos = await crawlCategory("VideoOnDemand");

    // Deduplicate by ID
    const uniqueCrawled = new Map<string, typeof crawledVideos[0]>();
    for (const v of crawledVideos) {
      if (!uniqueCrawled.has(v.id)) {
        uniqueCrawled.set(v.id, v);
      }
    }

    // 3. Filter out videos already present in database
    const newVideos = Array.from(uniqueCrawled.values()).filter(
      (v) => !existingIds.has(v.id)
    );

    if (newVideos.length === 0) {
      return {
        ok: true,
        addedCount: 0,
        message: "A biblioteca global de vídeos já está 100% atualizada!",
      };
    }

    // 4. Batch fetch VTT subtitles and save to global_videos
    let addedCount = 0;
    let failedCount = 0;
    const batchSize = 10;

    for (let i = 0; i < newVideos.length; i += batchSize) {
      const batch = newVideos.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (v) => {
          let contentText = "";
          if (v.subtitlesUrl) {
            try {
              const res = await fetch(v.subtitlesUrl);
              if (res.ok) {
                const vttText = await res.text();
                contentText = formatVttToText(vttText);
              }
            } catch (err) {
              console.error(`Erro ao baixar VTT para vídeo ${v.id}:`, err);
            }
          }

          // Insert into global_videos
          const { error: insertErr } = await admin.from("global_videos").insert({
            id: v.id,
            title: v.title,
            category_key: v.categoryKey,
            duration_formatted: v.durationFormatted,
            // The column is INTEGER but the API reports fractional seconds
            // (873.706167) — an unrounded value makes Postgres reject the row.
            duration_seconds: Math.round(v.durationSeconds || 0),
            cover_image: v.coverImage,
            video_url: v.videoUrl,
            subtitles_url: v.subtitlesUrl,
            first_published: v.firstPublished ?? null,
            content_text: contentText,
            metadata: {
              jwVideoId: v.id,
              videoUrl: v.videoUrl,
              coverImage: v.coverImage,
              durationFormatted: v.durationFormatted,
            },
          });

          if (insertErr) {
            console.error(`Erro ao inserir vídeo ${v.id}:`, insertErr.message);
            failedCount++;
          } else {
            addedCount++;

            // Link the video to whatever Bible chapters its title and
            // transcript cite, right here — the title and transcript are
            // already in memory, so a new video shows up in the Bible reader's
            // "Vídeos" tab immediately instead of waiting for the settings
            // page's backfill pass to come around to it. Best-effort: a parse
            // that finds nothing still marks the video indexed, and a failed
            // write just leaves `scriptures_indexed_at` null for the backfill
            // to pick up.
            const scriptureRows = buildVideoScriptureRows(v.id, v.title, contentText);
            const { error: refsErr } = scriptureRows.length
              ? await admin.from("video_scripture_refs").insert(scriptureRows)
              : { error: null };
            if (!refsErr) {
              await admin
                .from("global_videos")
                .update({ scriptures_indexed_at: new Date().toISOString() })
                .eq("id", v.id);
            }

            // Embed right away so the video is searchable in the chat. A
            // failure only leaves it counted as "pendente" (and the seed
            // script picks it up) — the video row itself is already saved.
            if (contentText) {
              try {
                const chunks = splitTextIntoChunks(`Vídeo: ${v.title}

${contentText}`, 350);
                const { embeddings } = await generateEmbeddings(chunks.map((c) => c.content));
                const { error: embErr } = await admin.from("global_video_embeddings").insert(
                  chunks.map((chunk, idx) => ({
                    video_id: v.id,
                    chunk_index: chunk.index,
                    content: chunk.content,
                    embedding: `[${embeddings[idx].join(",")}]`,
                    metadata: {
                      title: v.title,
                      type: "video",
                      videoId: v.id,
                      videoUrl: v.videoUrl,
                      coverImage: v.coverImage,
                      durationFormatted: v.durationFormatted,
                      subtitlesUrl: v.subtitlesUrl,
                    },
                  }))
                );
                if (embErr) throw new Error(embErr.message);
              } catch (err) {
                console.error(`Erro ao vetorizar vídeo ${v.id}:`, err);
              }
            }
          }
        })
      );
    }

    return {
      ok: true,
      addedCount,
      message:
        `${addedCount} novos vídeos foram importados e vetorizados.` +
        (failedCount ? ` ${failedCount} falharam ao salvar (veja o log do servidor).` : ""),
    };
  } catch (err) {
    console.error("Erro ao sincronizar vídeos do JW.org:", err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Não foi possível sincronizar os vídeos no momento.",
    };
  }
}

export async function getGlobalVideoById(videoId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("global_videos")
    .select("id, title, video_url, cover_image, subtitles_url, duration_formatted")
    .eq("id", videoId)
    .single();

  return data;
}
