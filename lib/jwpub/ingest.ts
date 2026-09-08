"use client";

import { notify } from "@/components/ui/toaster";
import { savePublication, saveChapterContent, saveFootnotes, markPublicationFailed } from "@/app/(app)/jwpub-actions";
import { parseJwpub } from "./parser";
import { uploadMedia, rewriteMediaUrls } from "./media";
import { sanitizeChapterHtml, rewriteJwpubLinks } from "./sanitize";

/**
 * Recent periodicals (Watchtower Study, Awake!) embed the issue's own
 * 2-digit year straight into `Publication.Symbol` inside the .jwpub itself
 * ("w26", not "w") — confirmed against a real archive (its own Symbol column
 * literally reads "w26") and, independently, against that same publication's
 * OWN natively-created jwlibrary Location row (inspected directly in a live
 * JW Library userData.db): `KeySymbol` there is the bare "w", with the year
 * carried only by `IssueTagNumber`. Storing the raw year-suffixed symbol
 * works fine for everything *inside* Study Notes (this app only ever
 * compares its own stored symbol against itself), but a note/highlight
 * exported with "w26" as `Location.KeySymbol` doesn't match anything in the
 * real app's own publication catalog (keyed by "w") — surfaces as a note
 * that saves fine but never resolves to its publication after import.
 * Stripping the suffix only when it matches THIS publication's own parsed
 * `Year` (rather than blindly regexing any trailing digits) avoids
 * mis-firing on a symbol that just happens to end in two digits for an
 * unrelated reason. Deliberately applied here, after parseJwpub has already
 * returned — not inside it — since `deriveJwpubKeys` needs the untouched raw
 * symbol to derive the correct decryption key; by this point every chapter
 * is already decrypted, so normalizing what gets *stored* is safe.
 */
function stripYearSuffix(symbol: string, year: number | null): string {
  if (year === null) return symbol;
  const suffix = String(year % 100).padStart(2, "0");
  return symbol.length > suffix.length && symbol.toLowerCase().endsWith(suffix)
    ? symbol.slice(0, -suffix.length)
    : symbol;
}

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
): Promise<{ ok: boolean; error?: string; title?: string }> {
  try {
    const parsed = await parseJwpub(file, (stage, current, total) => {
      onProgress?.(total ? `${stage} (${current}/${total})` : stage);
    });

    const { publicationId, title: savedTitle, error } = await savePublication({
      noteId,
      symbol: stripYearSuffix(parsed.symbol, parsed.year),
      title: parsed.title,
      mepsLanguageIndex: parsed.mepsLanguageIndex,
      year: parsed.year,
      issueTagNumber: parsed.issueTagNumber,
      chapters: parsed.chapters.map((chapter) => ({
        documentId: chapter.documentId,
        mepsDocumentId: chapter.mepsDocumentId,
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

    // `savedTitle` is savePublication's own return -- it has already folded
    // the issue's month/year into the raw `Publication.Title` (see
    // withIssuePeriod in jwpub-actions.ts), which every monthly issue of the
    // same periodical otherwise shares verbatim. Falling back to the raw
    // title only if that write somehow didn't happen.
    const finalTitle = savedTitle ?? parsed.title;
    return { ok: true, title: finalTitle.trim() !== "" ? finalTitle : undefined };
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
