"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildVideoScriptureRows } from "@/lib/bible/video-scripture-refs";

/**
 * How many videos one call parses. Each carries ~7 KB of transcript, so a
 * batch reads well under a megabyte — small enough to finish inside a Server
 * Action's budget, and the settings card just calls again until `remaining`
 * hits zero.
 */
const INDEX_BATCH_SIZE = 100;

export interface ScriptureIndexStats {
  totalVideos: number;
  indexedVideos: number;
  pendingVideos: number;
  totalRefs: number;
}

export interface ScriptureIndexProgress {
  processedVideos: number;
  refsAdded: number;
  pendingVideos: number;
}

export async function getVideoScriptureStats(): Promise<ScriptureIndexStats> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { totalVideos: 0, indexedVideos: 0, pendingVideos: 0, totalRefs: 0 };

  const [{ count: totalVideos }, { count: pendingVideos }, { count: totalRefs }] = await Promise.all([
    supabase.from("global_videos").select("*", { count: "exact", head: true }),
    supabase
      .from("global_videos")
      .select("*", { count: "exact", head: true })
      .is("scriptures_indexed_at", null),
    supabase.from("video_scripture_refs").select("*", { count: "exact", head: true }),
  ]);

  const total = totalVideos ?? 0;
  const pending = pendingVideos ?? 0;

  return {
    totalVideos: total,
    indexedVideos: Math.max(0, total - pending),
    pendingVideos: pending,
    totalRefs: totalRefs ?? 0,
  };
}

/**
 * Parses the next batch of unindexed videos into `video_scripture_refs`.
 *
 * The admin client does the writing because `video_scripture_refs` has no
 * insert policy at all (same shape as `global_videos`: shared catalog data
 * that only server code may write). The session is verified first with the
 * regular client, per the rule in CLAUDE.md — the service-role client bypasses
 * RLS entirely, so it must never run before the caller is known. There's no
 * per-row ownership check to make here because these rows belong to nobody:
 * they're derived from a public catalog every signed-in user reads the same
 * way.
 */
export async function indexVideoScriptureRefs(): Promise<{
  ok: boolean;
  progress?: ScriptureIndexProgress;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  try {
    const admin = createAdminClient();

    const { data: batch, error: readError } = await admin
      .from("global_videos")
      .select("id, title, content_text")
      .is("scriptures_indexed_at", null)
      .order("id")
      .limit(INDEX_BATCH_SIZE);

    if (readError) return { ok: false, error: "Não foi possível ler os vídeos." };
    if (!batch || batch.length === 0) {
      return { ok: true, progress: { processedVideos: 0, refsAdded: 0, pendingVideos: 0 } };
    }

    const ids = batch.map((video) => video.id);
    const rows = batch.flatMap((video) =>
      buildVideoScriptureRows(video.id, video.title, video.content_text)
    );

    // Delete-then-insert rather than upsert, so re-running after a change to
    // the parser replaces a video's references instead of leaving whatever it
    // produced last time sitting alongside the new rows.
    const { error: deleteError } = await admin
      .from("video_scripture_refs")
      .delete()
      .in("video_id", ids);
    if (deleteError) return { ok: false, error: "Não foi possível limpar as referências antigas." };

    if (rows.length > 0) {
      const { error: insertError } = await admin.from("video_scripture_refs").insert(rows);
      if (insertError) return { ok: false, error: "Não foi possível gravar as referências." };
    }

    // Marked only after the rows landed — a failure above leaves the batch
    // pending, so the next call retries it instead of skipping it forever.
    const { error: markError } = await admin
      .from("global_videos")
      .update({ scriptures_indexed_at: new Date().toISOString() })
      .in("id", ids);
    if (markError) return { ok: false, error: "Não foi possível marcar os vídeos como indexados." };

    const { count: pendingVideos } = await admin
      .from("global_videos")
      .select("*", { count: "exact", head: true })
      .is("scriptures_indexed_at", null);

    return {
      ok: true,
      progress: {
        processedVideos: batch.length,
        refsAdded: rows.length,
        pendingVideos: pendingVideos ?? 0,
      },
    };
  } catch (error) {
    console.error("Erro ao indexar referências bíblicas dos vídeos:", error);
    return { ok: false, error: "Não foi possível indexar as referências no momento." };
  }
}

/**
 * Clears every reference and marks the whole catalog unindexed, so the next
 * run re-parses it from scratch. The one thing that makes an improvement to
 * `lib/bible/parse-reference.ts` reach the videos that were already processed
 * under the old rules.
 */
export async function resetVideoScriptureIndex(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  try {
    const admin = createAdminClient();

    // `neq` on the primary key is how PostgREST expresses "every row" — a bare
    // delete with no filter is rejected.
    const { error: deleteError } = await admin
      .from("video_scripture_refs")
      .delete()
      .gte("id", 0);
    if (deleteError) return { ok: false, error: "Não foi possível limpar as referências." };

    const { error: resetError } = await admin
      .from("global_videos")
      .update({ scriptures_indexed_at: null })
      .not("scriptures_indexed_at", "is", null);
    if (resetError) return { ok: false, error: "Não foi possível reiniciar a indexação." };

    return { ok: true };
  } catch (error) {
    console.error("Erro ao reiniciar a indexação de referências:", error);
    return { ok: false, error: "Não foi possível reiniciar a indexação no momento." };
  }
}
