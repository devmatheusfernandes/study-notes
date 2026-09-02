"use client";

import { notify } from "@/components/ui/toaster";
import { savePublication, saveChapterContent, saveFootnotes, markPublicationFailed } from "@/app/(app)/jwpub-actions";
import { parseJwpub } from "./parser";
import { uploadMedia, rewriteMediaUrls } from "./media";
import { sanitizeChapterHtml, rewriteJwpubLinks } from "./sanitize";

/**
 * Parses a `.jwpub` in the browser and persists the result.
 *
 * Deliberately non-fatal: by the time this runs the note row and the Storage
 * object already exist, so any failure just leaves a perfectly usable plain
 * file card that the user can retry from the reader.
 */
export async function ingestJwpub(
  file: Blob,
  noteId: string,
  onProgress?: (stage: string) => void
): Promise<{ ok: boolean; error?: string }> {
  try {
    const parsed = await parseJwpub(file, (stage, current, total) => {
      onProgress?.(total ? `${stage} (${current}/${total})` : stage);
    });

    const { publicationId, error } = await savePublication({
      noteId,
      symbol: parsed.symbol,
      title: parsed.title,
      mepsLanguageIndex: parsed.mepsLanguageIndex,
      year: parsed.year,
      issueTagNumber: parsed.issueTagNumber,
      chapters: parsed.chapters.map((chapter) => ({
        documentId: chapter.documentId,
        position: chapter.position,
        title: chapter.title,
      })),
    });

    if (error || !publicationId) throw new Error(error ?? "Falha ao registrar a publicação.");

    onProgress?.("Enviando imagens");
    const mediaUrls = await uploadMedia(publicationId, parsed.media, (uploaded, total) => {
      onProgress?.(`Enviando imagens (${uploaded}/${total})`);
    });

    // Sanitize once here, at write time, so the database only ever holds
    // trusted markup and the reader can be a plain renderer.
    for (const [index, chapter] of parsed.chapters.entries()) {
      onProgress?.(`Salvando capítulos (${index + 1}/${parsed.chapters.length})`);
      const html = sanitizeChapterHtml(
        rewriteJwpubLinks(
          rewriteMediaUrls(chapter.html, mediaUrls),
          parsed.bibleCitations,
          chapter.documentId
        )
      );
      await saveChapterContent(publicationId, chapter.documentId, html);
    }

    if (parsed.footnotes.length > 0) {
      onProgress?.("Salvando notas de rodapé");
      const cleaned = parsed.footnotes.map((footnote) => ({
        footnoteId: footnote.footnoteId,
        html: sanitizeChapterHtml(
          rewriteJwpubLinks(rewriteMediaUrls(footnote.html, mediaUrls), parsed.bibleCitations)
        ),
      }));
      // Chunked for the same payload reason as chapters.
      for (let i = 0; i < cleaned.length; i += 100) {
        await saveFootnotes(publicationId, cleaned.slice(i, i + 100));
      }
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    await markPublicationFailed(noteId).catch(() => {});
    return { ok: false, error: message };
  }
}

/** Fire-and-forget wrapper used by the upload flow, with its own toasts. */
export async function ingestJwpubWithFeedback(file: Blob, noteId: string, fileName: string) {
  const result = await ingestJwpub(file, noteId);
  if (result.ok) {
    notify.success(`"${fileName}" pronta para leitura`);
    const { enqueueNoteForVectorization } = await import("@/lib/vector/queue-actions");
    void enqueueNoteForVectorization(noteId);
  } else {
    notify.error("Não foi possível abrir esta publicação", result.error);
  }
  return result;
}
