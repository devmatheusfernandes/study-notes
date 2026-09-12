"use client";

import { useEffect, useRef, useState } from "react";
import { BookMarked, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/ui/toaster";
import {
  getResearchGuideStats,
  checkResearchGuideNeedsImport,
  beginResearchGuideImport,
  appendResearchGuideEntries,
  appendResearchGuideExtracts,
  finishResearchGuideImport,
  type ResearchGuideEntryInput,
  type ResearchGuideExtractInput,
} from "@/app/(app)/research-guide-actions";
import { splitResearchGuideDocument, RESEARCH_GUIDE_IMPORT_VERSION } from "@/lib/bible/research-guide-parse";
import { sanitizeChapterHtml, rewriteJwpubLinks } from "@/lib/jwpub/sanitize";
import type { JwpubExtract } from "@/lib/jwpub/types";

/** How many parsed verse entries go up per Server Action call — keeps each request small regardless of how much HTML the whole guide adds up to. */
const BATCH_SIZE = 500;

/**
 * Lets the "Guia de Pesquisa" (símbolo `rsg`, JW.org) be (re)imported by
 * uploading its own `.jwpub` file — no seed script, no DATABASE_URL. When
 * JW.org publishes a new edition, re-uploading it here replaces the old one
 * entirely (see beginResearchGuideImport's full wipe).
 *
 * Parsing happens in the browser, same as any other `.jwpub` in this app
 * (needs `DOMParser`-adjacent APIs `sql.js`/`pako` provide, not available
 * server-side) — this card calls the low-level `lib/jwpub/parser.ts` directly
 * rather than `ingestJwpub`, since the result here is global reference
 * content in its own table, not a per-user note.
 */
export function ResearchGuideUploadCard() {
  const [stats, setStats] = useState<{
    publicationTitle: string | null;
    entryCount: number;
    importedAt: string | null;
    sourceHash: string | null;
  }>({
    publicationTitle: null,
    entryCount: 0,
    importedAt: null,
    sourceHash: null,
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    queueMicrotask(() => {
      void getResearchGuideStats().then((s) => {
        setStats(s);
        setIsLoadingStats(false);
      });
    });
  }, []);

  async function handleFile(file: File) {
    setIsImporting(true);
    setProgress("Verificando arquivo…");
    try {
      // Um SHA-256 do arquivo cru, antes de gastar tempo decifrando 70MB —
      // isso é conteúdo global e compartilhado (sem user_id, ver CLAUDE.md),
      // então mais de uma pessoa pode acabar enviando a mesma edição já
      // importada. Só pula quando bate com uma importação que REALMENTE
      // terminou (checkResearchGuideNeedsImport ignora uma tentativa anterior
      // que ficou pela metade, mesmo com o mesmo arquivo).
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sourceHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

      const check = await checkResearchGuideNeedsImport(sourceHash, RESEARCH_GUIDE_IMPORT_VERSION);
      if (!check.needsImport) {
        notify.info("Já está atualizado", "Essa é a mesma edição que já está importada.");
        return;
      }

      setProgress("Abrindo arquivo…");
      const { parseJwpub } = await import("@/lib/jwpub/parser");
      const parsed = await parseJwpub(file, (stage, current, total) => {
        setProgress(total ? `${stage} (${current}/${total})` : stage);
      });

      if (!parsed.symbol.toLowerCase().startsWith("rsg")) {
        notify.error(
          "Arquivo inesperado",
          `Isso parece ser "${parsed.title || parsed.symbol}", não o Guia de Pesquisa.`
        );
        return;
      }

      setProgress("Separando por versículo…");
      const entries: ResearchGuideEntryInput[] = [];
      // Deduped by extractId here (a story cited from many verses shares the
      // same excerpt) — sending it once per verse would multiply a possibly
      // sizable HTML blob for nothing.
      const extractsById = new Map<number, ResearchGuideExtractInput>();
      // extractsByHyperlinkId is keyed by the CITING id (one per citation
      // instance, so tens of thousands of entries) — this reverse map, keyed
      // by the excerpt's own (far fewer, shared) id, is what the loop below
      // actually needs, and avoids an O(citations × excerpts) linear scan.
      const extractsByExtractId = new Map<number, JwpubExtract>();
      for (const extract of parsed.extractsByHyperlinkId.values()) {
        if (!extractsByExtractId.has(extract.extractId)) extractsByExtractId.set(extract.extractId, extract);
      }

      for (const chapter of parsed.chapters) {
        for (const block of splitResearchGuideDocument(chapter.html)) {
          // See lib/jwpub/sanitize.ts: a citation whose data-xtid resolves to
          // an embedded excerpt gets data-jwpub-extract instead of
          // data-jwpub-pubref — this is the one call site that hands it
          // parsed.extractsByHyperlinkId, so this behavior is specific to
          // the Research Guide until something else needs it too.
          const rewritten = rewriteJwpubLinks(block.html, new Map(), -1, parsed.extractsByHyperlinkId);
          entries.push({
            bookOrder: block.bookOrder,
            chapter: block.chapter,
            verse: block.verse,
            // Same treatment any other jwpub content gets before it's ever
            // persisted (see lib/jwpub/ingest.ts) — the database only holds
            // trusted markup, so the study panel that renders this later is a
            // plain, unsanitizing renderer.
            contentHtml: sanitizeChapterHtml(rewritten),
          });

          for (const id of [...rewritten.matchAll(/data-jwpub-extract="(\d+)"/g)].map((m) => Number(m[1]))) {
            if (extractsById.has(id)) continue;
            const extract = extractsByExtractId.get(id);
            if (extract) {
              extractsById.set(id, {
                extractId: id,
                contentHtml: sanitizeChapterHtml(rewriteJwpubLinks(extract.html)),
                refTitle: extract.refTitle,
                refSymbol: extract.refSymbol,
              });
            }
          }
        }
      }

      if (entries.length === 0) {
        notify.error("Nenhuma citação encontrada", "O arquivo abriu, mas não achei nenhum versículo indexado nele.");
        return;
      }

      const begin = await beginResearchGuideImport(parsed.title || parsed.symbol, sourceHash, RESEARCH_GUIDE_IMPORT_VERSION);
      if (!begin.ok) {
        notify.error("Não foi possível iniciar a importação", begin.error);
        return;
      }

      let sent = 0;
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        setProgress(`Gravando citações (${sent}/${entries.length})`);
        const result = await appendResearchGuideEntries(batch);
        if (!result.ok) {
          notify.error("A importação parou no meio", result.error);
          return;
        }
        sent += batch.length;
      }

      const extracts = [...extractsById.values()];
      let extractsSent = 0;
      for (let i = 0; i < extracts.length; i += BATCH_SIZE) {
        const batch = extracts.slice(i, i + BATCH_SIZE);
        setProgress(`Gravando trechos embutidos (${extractsSent}/${extracts.length})`);
        const result = await appendResearchGuideExtracts(batch);
        if (!result.ok) {
          notify.error("A importação parou no meio (trechos embutidos)", result.error);
          return;
        }
        extractsSent += batch.length;
      }

      await finishResearchGuideImport();
      notify.success(
        "Guia de Pesquisa importado!",
        `${entries.length.toLocaleString("pt-BR")} citações, ${extracts.length.toLocaleString("pt-BR")} com trecho embutido.`
      );
      setStats(await getResearchGuideStats());
    } catch (error) {
      notify.error(
        "Não foi possível importar o Guia de Pesquisa",
        error instanceof Error ? error.message : undefined
      );
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
            <BookMarked className="size-4 text-accent" />
            <h2 className="font-heading text-base">Guia de Pesquisa</h2>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            Publicação do jw.org (símbolo <code>rsg</code>) que liga versículos a artigos de outras
            publicações. Envie o <code>.jwpub</code> dela aqui — vale para todo mundo que usa o app,
            não só para você, e reenviar uma edição nova substitui a anterior inteira. Enviar o
            mesmo arquivo de novo não refaz a importação.
          </p>
        </div>
        <Badge variant="outline" className="h-auto shrink-0 rounded-full font-mono text-[10px]">
          {isLoadingStats ? "…" : stats.entryCount.toLocaleString("pt-BR")} citações
        </Badge>
      </div>

      <div className="flex flex-col gap-1 rounded-2xl border border-border/50 bg-secondary/50 p-3.5 text-[12px] text-muted-foreground">
        {stats.publicationTitle ? (
          <>
            <span className="text-foreground/90">{stats.publicationTitle}</span>
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
        {isImporting ? progress || "Importando…" : "Enviar .jwpub do Guia de Pesquisa"}
      </Button>
    </section>
  );
}
