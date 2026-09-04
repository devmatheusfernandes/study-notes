import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptText } from "@/lib/encryption";
import { stripHtmlTags, splitTextIntoChunks } from "./chunker";
import { FILES_BUCKET } from "@/lib/storage-config";

export interface ExtractedChunk {
  chunkIndex: number;
  content: string;
  jwpubChapterId?: string;
  metadata: Record<string, unknown>;
}

export interface ExtractedContent {
  title: string;
  type: string;
  chunks: ExtractedChunk[];
}

/**
 * Takes the caller's own Supabase client rather than creating one itself —
 * the per-request (RLS-scoped) client for the manual "Processar Agora"
 * button, or the admin client when called from the cron route, which has no
 * user session to scope a client to.
 */
export async function extractContentForNote(
  noteId: string,
  supabase: SupabaseClient
): Promise<ExtractedContent | null> {
  const { data: note, error } = await supabase
    .from("notes")
    .select("id, type, title, body, storage_path, user_id")
    .eq("id", noteId)
    .single();

  if (error || !note) return null;

  const decryptedTitle = decryptText(note.title) || "Sem título";
  const decryptedBody = decryptText(note.body) || "";

  // 1. Plain Text Note
  if (note.type === "nota") {
    const plainBody = stripHtmlTags(decryptedBody);
    const fullText = `${decryptedTitle}\n\n${plainBody}`.trim();
    const chunks = splitTextIntoChunks(fullText);
    return {
      title: decryptedTitle,
      type: note.type,
      chunks: chunks.map((c) => ({
        chunkIndex: c.index,
        content: c.content,
        metadata: { title: decryptedTitle, type: note.type },
      })),
    };
  }

  // 2. PDF Document
  if (note.type === "pdf" && note.storage_path) {
    try {
      const admin = createAdminClient();
      const { data: fileData, error: downloadError } = await admin.storage
        .from(FILES_BUCKET)
        .download(note.storage_path);

      if (downloadError || !fileData) {
        console.error("Erro ao baixar PDF para vetorização:", downloadError);
        return null;
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());
      const pdfModule = (await import("pdf-parse")) as unknown as { default?: (b: Buffer) => Promise<{ text: string; numpages: number }> } | ((b: Buffer) => Promise<{ text: string; numpages: number }>);
      const pdfFn = typeof pdfModule === "function" ? pdfModule : (pdfModule.default ?? (pdfModule as unknown as (b: Buffer) => Promise<{ text: string; numpages: number }>));
      const parsed = await pdfFn(buffer);
      const pdfText = parsed.text || "";
      const fullText = `${decryptedTitle}\n\n${pdfText}`.trim();
      const chunks = splitTextIntoChunks(fullText);

      return {
        title: decryptedTitle,
        type: note.type,
        chunks: chunks.map((c) => ({
          chunkIndex: c.index,
          content: c.content,
          metadata: { title: decryptedTitle, type: note.type, totalPages: parsed.numpages },
        })),
      };
    } catch (err) {
      console.error("Erro ao extrair texto do PDF:", err);
      return null;
    }
  }

  // 3. JWPUB Publication
  if (note.type === "jwpub") {
    const { data: publication } = await supabase
      .from("jwpub_publications")
      .select("id")
      .eq("note_id", noteId)
      .single();

    if (!publication) return null;

    const { data: chapters } = await supabase
      .from("jwpub_chapters")
      .select("id, document_id, title, content_html, position")
      .eq("publication_id", publication.id)
      .order("position", { ascending: true });

    if (!chapters || chapters.length === 0) {
      return null;
    }

    const allChunks: ExtractedChunk[] = [];
    let globalChunkIndex = 0;

    for (const ch of chapters) {
      const chTitle = ch.title || `Capítulo ${ch.position + 1}`;
      const chText = stripHtmlTags(ch.content_html || "");
      if (!chText) continue;

      // Chunk the chapter's own text only — title/chapterTitle already ride
      // along in `metadata` below (and get labeled back in for the LLM's
      // context). Gluing "{title} - {chapterTitle}" onto the front of the
      // text used to consume part of every chapter's first chunk, so its
      // cited snippet started with junk like "od_T.jwpub - Capítulo X" that
      // never appears in the actual rendered chapter — the reader's
      // highlight-by-text search could never find it there.
      const chunks = splitTextIntoChunks(chText);

      for (const c of chunks) {
        allChunks.push({
          chunkIndex: globalChunkIndex++,
          content: c.content,
          jwpubChapterId: ch.id,
          metadata: {
            title: decryptedTitle,
            chapterTitle: chTitle,
            documentId: ch.document_id,
            type: note.type,
          },
        });
      }
    }

    return {
      title: decryptedTitle,
      type: note.type,
      chunks: allChunks,
    };
  }

  // Fallback for other file types
  const plainBody = stripHtmlTags(decryptedBody);
  const fullText = `${decryptedTitle}\n\n${plainBody}`.trim();
  const chunks = splitTextIntoChunks(fullText);
  return {
    title: decryptedTitle,
    type: note.type,
    chunks: chunks.map((c) => ({
      chunkIndex: c.index,
      content: c.content,
      metadata: { title: decryptedTitle, type: note.type },
    })),
  };
}

/**
 * Mirrors extractContentForNote's plain-text branch, but reads
 * `jwlibrary_notes` — a separate table from `notes` (own encryption, no
 * `notes.id` to share), so it can't just call that function with a
 * different id.
 */
export async function extractContentForJwlibraryNote(
  jwlibraryNoteId: string,
  supabase: SupabaseClient
): Promise<ExtractedContent | null> {
  const { data: note, error } = await supabase
    .from("jwlibrary_notes")
    .select("id, title, content")
    .eq("id", jwlibraryNoteId)
    .single();

  if (error || !note) return null;

  const decryptedTitle = decryptText(note.title) || "Sem título";
  const plainBody = stripHtmlTags(decryptText(note.content) || "");
  const fullText = `${decryptedTitle}\n\n${plainBody}`.trim();
  const chunks = splitTextIntoChunks(fullText);

  return {
    title: decryptedTitle,
    type: "estudo_pessoal",
    chunks: chunks.map((c) => ({
      chunkIndex: c.index,
      content: c.content,
      metadata: { title: decryptedTitle, type: "estudo_pessoal", jwlibraryNoteId: note.id },
    })),
  };
}

export async function extractContentForGlobalVideo(videoId: string): Promise<ExtractedContent | null> {
  const admin = createAdminClient();
  const { data: video, error } = await admin
    .from("global_videos")
    .select("id, title, content_text, duration_formatted, cover_image, video_url")
    .eq("id", videoId)
    .single();

  if (error || !video || !video.content_text) return null;

  const fullText = `Vídeo: ${video.title}\n\n${video.content_text}`.trim();
  const chunks = splitTextIntoChunks(fullText);

  return {
    title: video.title,
    type: "video",
    chunks: chunks.map((c) => ({
      chunkIndex: c.index,
      content: c.content,
      metadata: {
        title: video.title,
        type: "video",
        videoId: video.id,
        videoUrl: video.video_url,
        coverImage: video.cover_image,
        durationFormatted: video.duration_formatted,
      },
    })),
  };
}
