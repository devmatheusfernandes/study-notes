"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/ui/toaster";
import { batchBySize } from "@/lib/utils";
import {
  getGlobalPublicationStats,
  checkGlobalPublicationNeedsImport,
  beginGlobalPublicationImport,
  appendGlobalPublicationChapters,
  appendGlobalPublicationFootnotes,
  finishGlobalPublicationImport,
  type GlobalPublicationChapterInput,
  type GlobalPublicationFootnoteInput,
} from "@/app/(app)/global-publications-actions";
import { sanitizeChapterHtml, rewriteJwpubLinks } from "@/lib/jwpub/sanitize";
import { uploadGlobalMedia, rewriteMediaUrls } from "@/lib/jwpub/media";

/**
 * Bump whenever the parsing/rewriting pipeline below changes — see
 * checkGlobalPublicationNeedsImport's own comment for why a source-hash-only
 * check would wrongly skip a reupload after a bug fix here.
 *
 *   1 — initial import
 *   2 — stops emitting `data-jwpub-extract` here. Version 1 passed the
 *       archive's excerpt index into rewriteJwpubLinks, but nothing persists
 *       a GLOBAL publication's excerpts, so those citations rendered as
 *       links with nothing behind them (and, before the ExtractId fix, were
 *       pointing at the wrong excerpt anyway). Perspicaz's own citations are
 *       plain `data-jwpub-pubref` again.
 */
const INSIGHT_IMPORT_VERSION = 2;

const MAX_BATCH_BYTES = 1.5 * 1024 * 1024;

/**
 * Lets Perspicaz (Estudo Perspicaz das Escrituras, símbolo `it`) be imported
 * once for every signed-in user, the same way as the Guia de Pesquisa card
 * above it — by uploading its own `.jwpub` here, parsed entirely in the
 * browser (needs `sql.js`/`pako`/`DOMParser`, unavailable server-side).
 *
 * This is what fills in the "known gap" in publication-download-actions.ts:
 * a Research Guide citation into Perspicaz has no resolvable WOL download
 * link (it points at a library *section* slug, not a file), and even if it
 * did, the combined archive is ~354MB — comfortably over this app's own
 * 200MB per-download safety ceiling. Importing it once, globally, sidesteps
 * both problems: resolveJwpubReferences (jwpub-actions.ts) now finds these
 * citations in global_publication_chapters instead of offering "Baixar".
 */
export function InsightUploadCard() {
  const [stats, setStats] = useState<{ title: string | null; chapterCount: number; importedAt: string | null }>({
    title: null,
    chapterCount: 0,
    importedAt: null,
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => {
      void getGlobalPublicationStats("it").then((s) => {
        setStats(s);
        setIsLoadingStats(false);
      });
    });
  }, []);

  async function handleFile(file: File) {
    setIsImporting(true);
    setProgress("Verificando arquivo…");
    try {
      // Hashed before spending time decrypting a ~354MB archive — this is
      // shared global content (no user_id), so more than one person could
      // end up uploading the exact edition already imported.
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sourceHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const check = await checkGlobalPublicationNeedsImport("it", sourceHash, INSIGHT_IMPORT_VERSION);
      if (!check.needsImport) {
        notify.info("Já está atualizado", "Essa é a mesma edição que já está importada.");
        return;
      }

      setProgress("Abrindo arquivo…");
      const { parseJwpub } = await import("@/lib/jwpub/parser");
      const parsed = await parseJwpub(file, (stage, current, total) => {
        setProgress(total ? `${stage} (${current}/${total})` : stage);
      });

      if (!parsed.symbol.toLowerCase().startsWith("it")) {
        notify.error(
          "Arquivo inesperado",
          `Isso parece ser "${parsed.title || parsed.symbol}", não o Estudo Perspicaz.`
        );
        return;
      }

      const begin = await beginGlobalPublicationImport(
        "it",
        parsed.title || parsed.symbol,
        parsed.mepsLanguageIndex,
        sourceHash,
        INSIGHT_IMPORT_VERSION
      );
      if (!begin.ok || !begin.publicationId) {
        notify.error("Não foi possível iniciar a importação", begin.error);
        return;
      }
      const publicationId = begin.publicationId;

      setProgress("Enviando imagens…");
      const mediaUrls = await uploadGlobalMedia("it", parsed.media, (uploaded, total) => {
        setProgress(`Enviando imagens (${uploaded}/${total})`);
      });

      const chapters: GlobalPublicationChapterInput[] = parsed.chapters.map((chapter) => ({
        documentId: chapter.documentId,
        mepsDocumentId: chapter.mepsDocumentId,
        position: chapter.position,
        title: chapter.title,
        contentHtml: sanitizeChapterHtml(
          rewriteJwpubLinks(
            rewriteMediaUrls(chapter.html, mediaUrls),
            parsed.bibleCitations,
            // Deliberately NO `extracts` here: nothing persists this global
            // publication's own excerpts, so emitting data-jwpub-extract
            // would produce links with nothing behind them. Perspicaz's
            // citations stay ordinary data-jwpub-pubref.
            chapter.documentId
          )
        ),
      }));

      let sent = 0;
      for (const batch of batchBySize(chapters, (c) => c.contentHtml.length, MAX_BATCH_BYTES)) {
        setProgress(`Gravando artigos (${sent}/${chapters.length})`);
        const result = await appendGlobalPublicationChapters("it", publicationId, batch);
        if (!result.ok) {
          notify.error("A importação parou no meio", result.error);
          return;
        }
        sent += batch.length;
      }

      if (parsed.footnotes.length > 0) {
        const footnotes: GlobalPublicationFootnoteInput[] = parsed.footnotes.map((footnote) => ({
          footnoteId: footnote.footnoteId,
          contentHtml: sanitizeChapterHtml(
            rewriteJwpubLinks(rewriteMediaUrls(footnote.html, mediaUrls), parsed.bibleCitations)
          ),
        }));
        let footnotesSent = 0;
        for (const batch of batchBySize(footnotes, (f) => f.contentHtml.length, MAX_BATCH_BYTES)) {
          setProgress(`Gravando notas de rodapé (${footnotesSent}/${footnotes.length})`);
          const result = await appendGlobalPublicationFootnotes(publicationId, batch);
          if (!result.ok) {
            notify.error("A importação parou no meio (notas de rodapé)", result.error);
            return;
          }
          footnotesSent += batch.length;
        }
      }

      await finishGlobalPublicationImport("it");
      notify.success("Estudo Perspicaz importado!", `${chapters.length.toLocaleString("pt-BR")} artigos.`);
      setStats(await getGlobalPublicationStats("it"));
    } catch (error) {
      notify.error("Não foi possível importar o Estudo Perspicaz", error instanceof Error ? error.message : undefined);
    } finally {
      setIsImporting(false);
      setProgress("");
    }
  }

  return (
    <section className="flex w-full flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-accent" />
            <h2 className="font-heading text-base">Estudo Perspicaz</h2>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            Enciclopédia bíblica do jw.org (símbolo <code>it</code>), volumes 1 e 2 combinados (~350MB). Envie o{" "}
            <code>.jwpub</code> dela aqui — vale para todo mundo que usa o app, não só para você. Citações do Guia
            de Pesquisa que apontam para o Perspicaz passam a abrir o conteúdo direto, em vez de pedir download.
          </p>
        </div>
        <Badge variant="outline" className="h-auto shrink-0 rounded-full font-mono text-[10px]">
          {isLoadingStats ? "…" : stats.chapterCount.toLocaleString("pt-BR")} artigos
        </Badge>
      </div>

      <div className="flex flex-col gap-1 rounded-2xl border border-border/50 bg-secondary/50 p-3.5 text-[12px] text-muted-foreground">
        {stats.title ? (
          <>
            <span className="text-foreground/90">{stats.title}</span>
            <span>
              {stats.importedAt
                ? `Importado em ${new Date(stats.importedAt).toLocaleDateString("pt-BR")}`
                : "Importação em andamento ou incompleta — envie o arquivo de novo."}
            </span>
          </>
        ) : (
          <span>Nenhuma edição importada ainda.</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".jwpub"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />

      <Button
        variant="outline"
        size="sm"
        isLoading={isImporting}
        leftIcon={<Upload className="size-3.5 text-accent" />}
        onClick={() => inputRef.current?.click()}
        className="self-start rounded-full text-[12.5px]"
      >
        {isImporting ? progress || "Importando…" : "Enviar .jwpub do Estudo Perspicaz"}
      </Button>
    </section>
  );
}
