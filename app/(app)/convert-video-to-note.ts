"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText, decryptText } from "@/lib/encryption";
import { enqueueNoteForVectorization } from "@/lib/vector/queue-actions";
import { formatVttToText, parseVttToSegments } from "@/lib/video/video-utils";

export async function createNoteFromVideo(videoId: string): Promise<{
  ok: boolean;
  noteId?: string;
  alreadyExisted?: boolean;
  note?: { id: string; title: string; body: string };
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

    // 2. Guard: Check if a note for this video was already created by this user
    const { data: userNotes } = await supabase
      .from("notes")
      .select("id, title, body, status")
      .eq("user_id", user.id)
      .neq("status", "trashed");

    if (userNotes && userNotes.length > 0) {
      for (const n of userNotes) {
        const decTitle = decryptText(n.title) ?? "";
        const decBody = decryptText(n.body) ?? "";
        if (
          (video.video_url && decBody.includes(video.video_url)) ||
          decTitle === `Transcrição: ${video.title}` ||
          (decBody.includes(video.title) && decBody.includes("Vídeo original:"))
        ) {
          return {
            ok: true,
            noteId: n.id,
            alreadyExisted: true,
            note: { id: n.id, title: decTitle, body: decBody },
          };
        }
      }
    }

    // 3. Prepare transcript content (fetch VTT from subtitles_url if content_text is empty)
    let transcriptText = (video.content_text || "").trim();

    if (!transcriptText && video.subtitles_url) {
      try {
        const res = await fetch(video.subtitles_url);
        if (res.ok) {
          const vttText = await res.text();
          const segments = parseVttToSegments(vttText);
          if (segments.length > 0) {
            transcriptText = segments.map((s) => s.text).join(" ");
          } else {
            transcriptText = formatVttToText(vttText);
          }
          if (transcriptText) {
            void admin
              .from("global_videos")
              .update({ content_text: transcriptText })
              .eq("id", videoId);
          }
        }
      } catch (err) {
        console.error("Erro ao baixar legendas VTT:", err);
      }
    }

    const titleText = `Transcrição: ${video.title}`;
    const encryptedTitle = encryptText(titleText);

    // Build structured HTML paragraphs from transcript
    let formattedParagraphs = "";
    if (transcriptText) {
      const parts = transcriptText.split(/\r?\n\r?\n/).filter((p: string) => p.trim().length > 0);
      if (parts.length > 1) {
        formattedParagraphs = parts.map((p: string) => `<p>${p.trim()}</p>`).join("\n");
      } else {
        // Chunk long continuous text every ~350 characters
        const chunks = transcriptText.match(/.{1,350}(\s+|$)/g) || [transcriptText];
        formattedParagraphs = chunks.map((c: string) => `<p>${c.trim()}</p>`).join("\n");
      }
    } else {
      formattedParagraphs = "<p><em>Transcrição em vídeo. Assista ao vídeo original no player da nota.</em></p>";
    }

    const bodyText = `<p><strong>Vídeo original:</strong> <a href="${video.video_url || "#"}" target="_blank" rel="noopener noreferrer">${video.title}</a> (${video.duration_formatted || "00:00"})</p>\n\n<h3>Transcrição Completa</h3>\n\n${formattedParagraphs}`;

    const encryptedBody = encryptText(bodyText);

    // 4. Insert new note in notes table for the user
    const { data: noteRow, error: insertErr } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        title: encryptedTitle,
        body: encryptedBody,
        type: "nota",
        status: "active",
      })
      .select("id")
      .single();

    if (insertErr || !noteRow) {
      console.error("Erro ao inserir nota a partir do vídeo:", insertErr);
      return { ok: false, error: "Erro ao criar nota pessoal." };
    }

    // 5. Enqueue note for vectorization in user's personal RAG
    void enqueueNoteForVectorization(noteRow.id);

    return {
      ok: true,
      noteId: noteRow.id,
      alreadyExisted: false,
      note: { id: noteRow.id, title: titleText, body: bodyText },
    };
  } catch (err) {
    console.error("Erro ao transformar vídeo em nota:", err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Não foi possível criar a nota.",
    };
  }
}
