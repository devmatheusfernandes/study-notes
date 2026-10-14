"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/ui/toaster";
import { batchBySize } from "@/lib/utils";
import {
  getGlobalPublicationStats,
  checkGlobalPublicationNeedsImport,
  beginGlobalPublicationImport,
  appendGlobalPublicationChapters,
  appendGlobalPublicationExtracts,
  appendGlobalPublicationFootnotes,
  finishGlobalPublicationImport,
  type GlobalPublicationChapterInput,
  type GlobalPublicationExtract,
  type GlobalPublicationFootnoteInput,
} from "@/app/(app)/global-publications-actions";
import { sanitizeChapterHtml, rewriteJwpubLinks } from "@/lib/jwpub/sanitize";
import { uploadGlobalMedia, rewriteMediaUrls } from "@/lib/jwpub/media";
import type { JwpubChapter, ParsedJwpub } from "@/lib/jwpub/types";

const MAX_BATCH_BYTES = 1.5 * 1024 * 1024;

export interface GlobalPublicationUploadCardProps {
  /** `global_publications.symbol` this card imports into. */
  symbol: string;
  /** Bump whenever the pipeline below changes — see checkGlobalPublicationNeedsImport. */
  importVersion: number;
  heading: string;
  icon: ReactNode;
  description: ReactNode;
  /** Label for the count badge ("artigos", "assuntos"). */
  countLabel: string;
  /** Returns an error message when the parsed file is not the publication this card expects. */
  validate: (parsed: ParsedJwpub) => string | null;
  /** Which documents to keep. Defaults to all of them. */
  includeChapter?: (chapter: JwpubChapter) => boolean;
}

/**
 * Imports one shared, single-copy publication (see
 * supabase/migrations/0038_global_publications.sql) from its own `.jwpub`,
 * parsed entirely in the browser — needs `sql.js`/`pako`/`DOMParser`, none of
 * which run server-side.
 *
 * Citations that embed their own excerpt are rewritten to
 * `data-jwpub-extract` and the cited excerpts persisted alongside
 * (global_publication_extracts, migration 0047) — only the ones a kept
 * document actually cites, since an archive carries far more than its pages
 * reference.
 */
export function GlobalPublicationUploadCard({
  symbol,
  importVersion,
  heading,
  icon,
  description,
  countLabel,
  validate,
  includeChapter,
}: GlobalPublicationUploadCardProps) {
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
      void getGlobalPublicationStats(symbol).then((s) => {
        setStats(s);
        setIsLoadingStats(false);
      });
    });
  }, [symbol]);

  async function handleFile(file: File) {
    setIsImporting(true);
    setProgress("Verificando arquivo…");
    try {
      // Hashed before spending time decrypting a multi-hundred-MB archive —
      // this is shared content, so more than one person could upload the
      // edition already imported.
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sourceHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const check = await checkGlobalPublicationNeedsImport(symbol, sourceHash, importVersion);
      if (!check.needsImport) {
        notify.info("Já está atualizado", "Essa é a mesma edição que já está importada.");
        return;
      }

      setProgress("Abrindo arquivo…");
      const { parseJwpub } = await import("@/lib/jwpub/parser");
      const parsed = await parseJwpub(file, (stage, current, total) => {
        setProgress(total ? `${stage} (${current}/${total})` : stage);
      });

      const invalid = validate(parsed);
      if (invalid) {
        notify.error("Arquivo inesperado", invalid);
        return;
      }

      const kept = includeChapter ? parsed.chapters.filter(includeChapter) : parsed.chapters;

      const begin = await beginGlobalPublicationImport(
        symbol,
        parsed.title || parsed.symbol,
        parsed.mepsLanguageIndex,
        sourceHash,
        importVersion
      );
      if (!begin.ok || !begin.publicationId) {
        notify.error("Não foi possível iniciar a importação", begin.error);
        return;
      }
      const publicationId = begin.publicationId;

      setProgress("Enviando imagens…");
      const keptMediaRefs = new Set(kept.flatMap((c) => c.mediaRefs));
      const media = new Map([...parsed.media].filter(([name]) => keptMediaRefs.has(name)));
      const mediaUrls = await uploadGlobalMedia(symbol, media, (uploaded, total) => {
        setProgress(`Enviando imagens (${uploaded}/${total})`);
      });

      const citedExtractIds = new Set<number>();
      const chapters: GlobalPublicationChapterInput[] = kept.map((chapter) => {
        const rewritten = rewriteJwpubLinks(
          rewriteMediaUrls(chapter.html, mediaUrls),
          parsed.bibleCitations,
          chapter.documentId,
          parsed.extracts
        );
        // One citation link can name several excerpts, comma-joined.
        for (const match of rewritten.matchAll(/data-jwpub-extract="([\d,]+)"/g)) {
          for (const id of match[1].split(",")) citedExtractIds.add(Number(id));
        }
        return {
          documentId: chapter.documentId,
          mepsDocumentId: chapter.mepsDocumentId,
          position: chapter.position,
          title: chapter.title,
          sectionNumber: chapter.sectionNumber,
          docClass: chapter.docClass,
          contentHtml: sanitizeChapterHtml(rewritten),
        };
      });

      let sent = 0;
      for (const batch of batchBySize(chapters, (c) => c.contentHtml.length, MAX_BATCH_BYTES)) {
        setProgress(`Gravando ${countLabel} (${sent}/${chapters.length})`);
        const result = await appendGlobalPublicationChapters(symbol, publicationId, batch);
        if (!result.ok) {
          notify.error("A importação parou no meio", result.error);
          return;
        }
        sent += batch.length;
      }

      // Built lazily per batch rather than all at once: the Guia's cited
      // excerpts alone are well over 100 MB of HTML, and holding a second,
      // sanitized copy of every one of them at the same time doubles that.
      const extractIds = [...citedExtractIds].filter((id) => parsed.extracts.byExtractId.has(id));
      let extractsSent = 0;
      let batch: GlobalPublicationExtract[] = [];
      let batchBytes = 0;
      const flush = async () => {
        if (batch.length === 0) return true;
        setProgress(`Gravando trechos citados (${extractsSent}/${extractIds.length})`);
        const result = await appendGlobalPublicationExtracts(publicationId, batch);
        if (!result.ok) {
          notify.error("A importação parou no meio (trechos citados)", result.error);
          return false;
        }
        extractsSent += batch.length;
        batch = [];
        batchBytes = 0;
        return true;
      };
      for (const id of extractIds) {
        const extract = parsed.extracts.byExtractId.get(id)!;
        const html = sanitizeChapterHtml(rewriteJwpubLinks(rewriteMediaUrls(extract.html, mediaUrls)));
        if (batchBytes + html.length > MAX_BATCH_BYTES && !(await flush())) return;
        batch.push({
          extractId: id,
          html,
          caption: extract.caption === null ? null : sanitizeChapterHtml(extract.caption),
          refTitle: extract.refTitle,
          refSymbol: extract.refSymbol,
          refMepsDocumentId: extract.refMepsDocumentId,
        });
        batchBytes += html.length;
      }
      if (!(await flush())) return;

      if (parsed.footnotes.length > 0) {
        const footnotes: GlobalPublicationFootnoteInput[] = parsed.footnotes.map((footnote) => ({
          footnoteId: footnote.footnoteId,
          contentHtml: sanitizeChapterHtml(
            rewriteJwpubLinks(rewriteMediaUrls(footnote.html, mediaUrls), parsed.bibleCitations)
          ),
        }));
        let footnotesSent = 0;
        for (const footnoteBatch of batchBySize(footnotes, (f) => f.contentHtml.length, MAX_BATCH_BYTES)) {
          setProgress(`Gravando notas de rodapé (${footnotesSent}/${footnotes.length})`);
          const result = await appendGlobalPublicationFootnotes(publicationId, footnoteBatch);
          if (!result.ok) {
            notify.error("A importação parou no meio (notas de rodapé)", result.error);
            return;
          }
          footnotesSent += footnoteBatch.length;
        }
      }

      await finishGlobalPublicationImport(symbol);
      notify.success(
        `${heading} importado!`,
        `${chapters.length.toLocaleString("pt-BR")} ${countLabel}, ${extractsSent.toLocaleString("pt-BR")} trechos citados.`
      );
      setStats(await getGlobalPublicationStats(symbol));
    } catch (error) {
      notify.error(`Não foi possível importar: ${heading}`, error instanceof Error ? error.message : undefined);
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
            {icon}
            <h2 className="font-heading text-base">{heading}</h2>
          </div>
          <p className="text-[12.5px] text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className="h-auto shrink-0 rounded-full font-mono text-[10px]">
          {isLoadingStats ? "…" : stats.chapterCount.toLocaleString("pt-BR")} {countLabel}
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
        {isImporting ? progress || "Importando…" : `Enviar .jwpub: ${heading}`}
      </Button>
    </section>
  );
}
