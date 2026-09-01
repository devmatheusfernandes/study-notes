import "server-only";
import { createClient } from "@/lib/supabase/server";
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

export async function extractContentForNote(noteId: string): Promise<ExtractedContent | null> {
  const supabase = await createClient();
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

      const fullText = `${decryptedTitle} - ${chTitle}\n\n${chText}`.trim();
      const chunks = splitTextIntoChunks(fullText);

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
