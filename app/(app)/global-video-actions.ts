"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { crawlCategory } from "@/lib/video/video-crawler";
import { formatVttToText } from "@/lib/video/video-utils";

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

  const { count: pendingCount } = await supabase
    .from("vectorization_queue")
    .select("*", { count: "exact", head: true })
    .eq("note_type", "video")
    .neq("status", "completed");

  const total = totalVideos ?? 0;
  const pending = pendingCount ?? 0;
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
            duration_seconds: v.durationSeconds,
            cover_image: v.coverImage,
            video_url: v.videoUrl,
            subtitles_url: v.subtitlesUrl,
            content_text: contentText,
            metadata: {
              jwVideoId: v.id,
              videoUrl: v.videoUrl,
              coverImage: v.coverImage,
              durationFormatted: v.durationFormatted,
            },
          });

          if (!insertErr) {
            addedCount++;

            // Queue for global vectorization
            await admin.from("vectorization_queue").insert({
              note_id: null,
              user_id: user.id,
              status: "pending",
              attempts: 0,
              error_message: null,
              note_type: "video",
              video_id: v.id,
            });
          }
        })
      );
    }

    return {
      ok: true,
      addedCount,
      message: `${addedCount} novos vídeos foram importados e enfileirados para vetorização com sucesso!`,
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
