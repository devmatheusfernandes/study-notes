"use client";

import { notify } from "@/components/ui/toaster";
import {
  savePublication,
  saveChapterContent,
  saveFootnotes,
  saveExtracts,
  saveToc,
  markPublicationFailed,
} from "@/app/(app)/jwpub-actions";
import { parseJwpub } from "./parser";
import { useIngestProgressStore } from "@/lib/store/ingest-progress-store";
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
  // One overall percentage across the phases, weighted by how long each
  // tends to take: reading the archive 0–35, images 35–55, chapters 55–85,
  // excerpts 85–92, footnotes 92–96, table of contents 96–100. Never goes
  // backwards, so a phase that turns out to have nothing to do can't make the
  // bar jump back.
  let last = 0;
  const report = (percent: number, stage: string) => {
    last = Math.max(last, Math.min(100, Math.round(percent)));
    useIngestProgressStore.getState().set(noteId, { stage, percent: last });
    onProgress?.(stage);
  };
  const span = (from: number, to: number, current: number, total: number) =>
    from + ((to - from) * current) / Math.max(1, total);

  try {
    report(1, "Abrindo arquivo");
    const parsed = await parseJwpub(file, (stage, current, total) => {
      const label = total ? `${stage} (${current}/${total})` : stage;
      if (total && stage === "Decodificando capítulos") report(span(8, 32, current ?? 0, total), label);
      else if (stage === "Lendo publicação") report(5, label);
      else if (stage === "Extraindo imagens") report(33, label);
      else report(last, label);
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

    report(35, "Enviando imagens");
    const mediaUrls = await uploadMedia(publicationId, parsed.media, (uploaded, total) => {
      report(span(35, 55, uploaded, total), `Enviando imagens (${uploaded}/${total})`);
    });

    // Sanitize once here, at write time, so the database only ever holds
    // trusted markup and the reader can be a plain renderer.
    //
    // `parsed.extracts` turns a citation into another publication into
    // `data-jwpub-extract` whenever the archive already embeds the cited
    // text — which, for the publications this app is actually used to read,
    // is the common case and not an exotic one: every single citation in a
    // "Nossa Vida e Ministério Cristão" apostila carries its excerpt. Those
    // citations then need nothing downloaded at all; the ones with no
    // excerpt still come out as `data-jwpub-pubref` and keep the
    // resolve-or-download path.
    const citedExtractIds = new Set<number>();
    for (const [index, chapter] of parsed.chapters.entries()) {
      report(span(55, 85, index, parsed.chapters.length), `Salvando capítulos (${index + 1}/${parsed.chapters.length})`);
      const rewritten = rewriteJwpubLinks(
        rewriteMediaUrls(chapter.html, mediaUrls),
        parsed.bibleCitations,
        chapter.documentId,
        parsed.extracts
      );
      for (const match of rewritten.matchAll(/data-jwpub-extract="([\d,]+)"/g)) {
        for (const id of match[1].split(",")) citedExtractIds.add(Number(id));
      }
      const savedChapter = await saveChapterContent(publicationId, chapter.documentId, sanitizeChapterHtml(rewritten));
      if (savedChapter?.error) throw new Error(savedChapter.error);
    }

    if (citedExtractIds.size > 0) {
      report(85, "Salvando trechos citados");
      const rows = [...citedExtractIds]
        .map((id) => parsed.extracts.byExtractId.get(id))
        .filter((extract): extract is NonNullable<typeof extract> => extract !== undefined)
        .map((extract) => ({
          extractId: extract.extractId,
          // Same treatment the chapters get — the excerpt is third-party
          // markup from the same archive.
          html: sanitizeChapterHtml(rewriteJwpubLinks(rewriteMediaUrls(extract.html, mediaUrls))),
          caption: extract.caption === null ? null : sanitizeChapterHtml(extract.caption),
          refTitle: extract.refTitle,
          refSymbol: extract.refSymbol,
          refMepsDocumentId: extract.refMepsDocumentId,
        }));
      // Batched by SIZE, not just count: an excerpt can be a whole article,
      // and 50 of them in one upsert can outrun the database's statement
      // timeout. The result used to be ignored, so a failed batch left a
      // publication whose citations all pointed at excerpts that were never
      // stored ("Trecho não encontrado") with nothing to say why.
      let batch: typeof rows = [];
      let batchChars = 0;
      let savedRows = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        const saved = await saveExtracts(publicationId, batch);
        if (saved?.error) throw new Error(saved.error);
        savedRows += batch.length;
        report(span(85, 92, savedRows, rows.length), `Salvando trechos citados (${savedRows}/${rows.length})`);
        batch = [];
        batchChars = 0;
      };
      for (const row of rows) {
        const size = row.html.length + (row.caption?.length ?? 0);
        if (batch.length > 0 && (batch.length >= 25 || batchChars + size > 400_000)) await flush();
        batch.push(row);
        batchChars += size;
      }
      await flush();
    }

    if (parsed.footnotes.length > 0) {
      report(92, "Salvando notas de rodapé");
      const cleaned = parsed.footnotes.map((footnote) => ({
        footnoteId: footnote.footnoteId,
        html: sanitizeChapterHtml(
          rewriteJwpubLinks(rewriteMediaUrls(footnote.html, mediaUrls), parsed.bibleCitations)
        ),
      }));
      // Chunked for the same payload reason as chapters.
      for (let i = 0; i < cleaned.length; i += 100) {
        const savedFootnotes = await saveFootnotes(publicationId, cleaned.slice(i, i + 100));
        if (savedFootnotes?.error) throw new Error(savedFootnotes.error);
      }
    }

    // The contents tree is cosmetic — a failure here must not fail a
    // publication whose chapters all saved fine; it just opens on the plain
    // chapter list until it is reprocessed.
    report(96, "Salvando sumário");
    await saveToc(publicationId, parsed.toc).catch(() => undefined);

    // `savedTitle` is savePublication's own return -- it has already folded
    // the issue's month/year into the raw `Publication.Title` (see
    // withIssuePeriod in jwpub-actions.ts), which every monthly issue of the
    // same periodical otherwise shares verbatim. Falling back to the raw
    // title only if that write somehow didn't happen.
    const finalTitle = savedTitle ?? parsed.title;
    report(100, "Concluído");
    return { ok: true, title: finalTitle.trim() !== "" ? finalTitle : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    await markPublicationFailed(noteId).catch(() => {});
    return { ok: false, error: message };
  } finally {
    useIngestProgressStore.getState().clear(noteId);
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
