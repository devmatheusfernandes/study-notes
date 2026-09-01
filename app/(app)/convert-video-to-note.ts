"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText } from "@/lib/encryption";

export async function createNoteFromVideo(videoId: string): Promise<{
  ok: boolean;
  noteId?: string;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Sessão expirada." };

  try {
    const admin = createAdminClient();

    // 1. Get video details from global_videos
    const { data: video, error: fetchErr } = await admin
      .from("global_videos")
      .select("*")
      .eq("id", videoId)
      .single();

    if (fetchErr || !video) {
      return { ok: false, error: "Vídeo não encontrado na base global." };
    }

    // 2. Prepare note content
    const titleText = `Transcrição: ${video.title}`;
    const encryptedTitle = encryptText(titleText);

    const bodyText = `<p><strong>Vídeo original:</strong> <a href="${video.video_url || "#"}" target="_blank" rel="noopener noreferrer">${video.title}</a> (${video.duration_formatted})</p>\n\n<h3>Transcrição Completa</h3>\n\n${(video.content_text || "").split("\n\n").map((p: string) => `<p>${p}</p>`).join("\n")}`;

    const encryptedBody = encryptText(bodyText);

    // 3. Insert new note in notes table for the user
    const { data: noteRow, error: insertErr } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        title: encryptedTitle,
        body: encryptedBody,
        type: "nota",
        is_archived: false,
        is_trashed: false,
      })
      .select("id")
      .single();

    if (insertErr || !noteRow) {
      return { ok: false, error: "Erro ao criar nota pessoal." };
    }

    // 4. Enqueue note for vectorization in user's personal RAG
    await supabase.from("vectorization_queue").insert({
      note_id: noteRow.id,
      user_id: user.id,
      status: "pending",
      attempts: 0,
      error_message: null,
      note_type: "nota",
    });

    return { ok: true, noteId: noteRow.id };
  } catch (err) {
    console.error("Erro ao transformar vídeo em nota:", err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Não foi possível criar a nota.",
    };
  }
}
