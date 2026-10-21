"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toaster";
import {
  getGlobalPublicationIndex,
  getGlobalPublicationChapterContent,
  getGlobalPublicationExtracts,
  getGlobalPublicationFootnote,
  type GlobalPublicationIndex,
  type GlobalPublicationIndexEntry,
} from "@/app/(app)/global-publications-actions";
import { getChapter, resolveJwpubReferences } from "@/app/(app)/jwpub-actions";
import { getBibleVersesBatch, type BibleVerseRow } from "@/app/(app)/bible-actions";
import { useOpenPublicationSource } from "@/hooks/use-open-publication-source";
import { isResearchGuideIntroduction, isResearchGuideTopic } from "@/lib/bible/research-guide-topics";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { JwpubExtractSurface, type JwpubExtractItem } from "./jwpub-extract-surface";
import { JwpubReferenceSurface, type JwpubReferenceTarget } from "./jwpub-reference-surface";
import { JwpubChapterSkeleton } from "./jwpub-chapter-skeleton";
import { ReferenceContentSkeleton } from "./reference-surface-skeleton";

export type GlobalPublicationSymbol = "it" | "rsg";

/** The two shared publications the Bible page opens, and how each one's index is cut. */
const PUBLICATIONS: Record<GlobalPublicationSymbol, { label: string; isIndexEntry: (e: GlobalPublicationIndexEntry) => boolean }> = {
  it: { label: "Perspicaz", isIndexEntry: (e) => e.title.trim().length > 0 },
  rsg: { label: "Guia de Pesquisa", isIndexEntry: isResearchGuideTopic },
};

export const GLOBAL_PUBLICATION_LABELS: Record<GlobalPublicationSymbol, string> = {
  it: PUBLICATIONS.it.label,
  rsg: PUBLICATIONS.rsg.label,
};

/** Fetched once per symbol per session — Perspicaz's list is ~5.000 titles, not worth refetching on every visit. */
const indexCache = new Map<string, GlobalPublicationIndex>();
const contentCache = new Map<string, string>();

function letterOf(title: string): string {
  const first = title.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Same typography as the appendix page, plus the Guia's collapsible `<details>` sections and Perspicaz's illustrations. */
const ARTICLE_CLASS =
  "text-[15px] leading-relaxed text-foreground/90 sm:text-base [&_a]:cursor-pointer [&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline [&_em]:italic [&_h1]:mb-3 [&_h1]:font-heading [&_h1]:text-2xl [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-lg [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-foreground [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-xl [&_figure]:my-3 [&_figcaption]:text-[13px] [&_figcaption]:text-muted-foreground [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5 [&_details]:border-t [&_details]:border-border/60 [&_details]:py-1 [&_summary]:cursor-pointer [&_summary]:py-2 [&_summary]:text-foreground";

type SidePanel =
  | { kind: "extract"; extracts: JwpubExtractItem[]; loading: boolean }
  | {
      kind: "reference";
      target: JwpubReferenceTarget | null;
      html: string | null;
      loading: boolean;
      unresolvedMepsDocumentId: number | null;
    }
  | { kind: "footnote"; html: string | null; loading: boolean }
  | { kind: "bible"; verses: BibleVerseRow[] | null; error: string | null };

interface GlobalPublicationReaderProps {
  symbol: GlobalPublicationSymbol;
  /** `null` shows the A–Z index; otherwise that article. */
  documentId: number | null;
  onOpenDocument: (documentId: number | null) => void;
  /** An excerpt's "Abrir publicação" pointed into a DIFFERENT global publication (e.g. from the Guia into Perspicaz). */
  onOpenGlobalPublication: (symbol: GlobalPublicationSymbol, documentId: number) => void;
  /** Renders the page header — the host owns it (BibleTopHeader) so search etc. stay in one place. */
  renderHeader: (title: string, onBack: () => void) => ReactNode;
  /** Back from the index itself — leaves the publication. */
  onExit: () => void;
  onOpenBibleVerse: (bookOrder: number, chapter: number, verse: number | null) => void;
}

/**
 * The Bible page's reader for a shared global publication (Perspicaz, the
 * 2026 Guia de Pesquisa): an A–Z index, then the article itself as a full
 * page. Citations inside an article open alongside it, the same way the
 * publication reader does — an embedded excerpt, a cross reference (opened in
 * place when it points back into this same publication, as the Guia's
 * "veja também" links and Perspicaz's article-to-article links do), a
 * footnote or a Bible passage.
 */
export function GlobalPublicationReader({
  symbol,
  documentId,
  onOpenDocument,
  onOpenGlobalPublication,
  renderHeader,
  onExit,
  onOpenBibleVerse,
}: GlobalPublicationReaderProps) {
  const config = PUBLICATIONS[symbol];
  const [index, setIndex] = useState<GlobalPublicationIndex | null>(() => indexCache.get(symbol) ?? null);
  const [indexError, setIndexError] = useState<string | null>(null);

  useEffect(() => {
    if (indexCache.has(symbol)) return;
    let cancelled = false;
    void getGlobalPublicationIndex(symbol).then((result) => {
      if (cancelled) return;
      if (result.index) {
        indexCache.set(symbol, result.index);
        setIndex(result.index);
      } else {
        setIndexError(result.error ?? "Não foi possível carregar o índice.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const entries = useMemo(() => {
    if (!index) return [];
    return index.entries
      .filter(config.isIndexEntry)
      .sort((a, b) => a.title.localeCompare(b.title, "pt", { sensitivity: "base" }));
  }, [index, config]);

  const introduction = useMemo(
    () => (symbol === "rsg" ? (index?.entries.find(isResearchGuideIntroduction) ?? null) : null),
    [index, symbol]
  );

  const activeEntry = useMemo(
    () => (documentId === null ? null : (index?.entries.find((e) => e.documentId === documentId) ?? null)),
    [index, documentId]
  );

  // Back from an article lands where the list was, not at its top.
  const indexScrollRef = useRef(0);
  const openDocument = useCallback(
    (id: number) => {
      if (documentId === null) indexScrollRef.current = window.scrollY;
      onOpenDocument(id);
    },
    [documentId, onOpenDocument]
  );
  useEffect(() => {
    if (documentId === null) {
      const y = indexScrollRef.current;
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      window.scrollTo(0, 0);
    }
  }, [documentId]);

  const title = activeEntry?.title ?? config.label;
  const header = renderHeader(title, documentId === null ? onExit : () => onOpenDocument(null));

  if (documentId === null) {
    return (
      <>
        {header}
        <PublicationIndex
          label={config.label}
          publicationTitle={index?.title ?? null}
          entries={index ? entries : null}
          error={indexError}
          introduction={introduction}
          onOpen={openDocument}
        />
      </>
    );
  }

  return (
    <PublicationArticle
      key={documentId}
      header={header}
      publicationId={index?.publicationId ?? null}
      documentId={documentId}
      onOpenDocument={openDocument}
      // An excerpt's "Abrir publicação": another article of this same
      // publication is just the next page; a different one is the host's call.
      onOpenGlobal={(targetSymbol, targetDocumentId) => {
        if (targetSymbol === symbol) openDocument(targetDocumentId);
        else onOpenGlobalPublication(targetSymbol, targetDocumentId);
      }}
      onOpenBibleVerse={onOpenBibleVerse}
    />
  );
}

function PublicationIndex({
  label,
  publicationTitle,
  entries,
  error,
  introduction,
  onOpen,
}: {
  label: string;
  publicationTitle: string | null;
  entries: GlobalPublicationIndexEntry[] | null;
  error: string | null;
  introduction: GlobalPublicationIndexEntry | null;
  onOpen: (documentId: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const [letter, setLetter] = useState<string | null>(null);

  const byLetter = useMemo(() => {
    const groups = new Map<string, GlobalPublicationIndexEntry[]>();
    for (const entry of entries ?? []) {
      const key = letterOf(entry.title);
      const list = groups.get(key);
      if (list) list.push(entry);
      else groups.set(key, [entry]);
    }
    return groups;
  }, [entries]);

  const letters = useMemo(() => [...byLetter.keys()].sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))), [byLetter]);
  const activeLetter = letter && byLetter.has(letter) ? letter : (letters[0] ?? null);

  const query = normalize(filter.trim());
  const MAX_MATCHES = 300;
  const matches = useMemo(() => {
    if (!query || !entries) return null;
    return entries.filter((e) => normalize(e.title).includes(query)).slice(0, MAX_MATCHES);
  }, [entries, query]);

  const visible = matches ?? (activeLetter ? (byLetter.get(activeLetter) ?? []) : []);

  return (
    <div className="flex flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
          {entries ? `${entries.length.toLocaleString("pt-BR")} ASSUNTOS` : "ÍNDICE"}
        </span>
        <span className="font-heading text-xl">{publicationTitle ?? label}</span>
      </div>

      {error ? (
        <p className="text-[13.5px] text-muted-foreground">
          {error} A importação é feita em Configurações, enviando o arquivo <code>.jwpub</code>.
        </p>
      ) : entries === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full max-w-md rounded-full" />
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 22 }, (_, i) => (
              <Skeleton key={i} className="size-8 rounded-full" />
            ))}
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full max-w-xl rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filtrar ${label}…`}
                className="pl-10"
                aria-label={`Filtrar ${label}`}
              />
            </div>
            {introduction && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<BookOpen className="size-3.5 text-accent" />}
                onClick={() => onOpen(introduction.documentId)}
              >
                {introduction.title}
              </Button>
            )}
          </div>

          {!matches && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Letra inicial">
              {letters.map((l) => (
                <Button
                  key={l}
                  role="tab"
                  aria-selected={l === activeLetter}
                  variant={l === activeLetter ? "secondary" : "ghost"}
                  size="xs"
                  className={cn("min-w-8 font-mono", l === activeLetter && "text-accent")}
                  onClick={() => setLetter(l)}
                >
                  {l}
                </Button>
              ))}
            </div>
          )}

          {matches && matches.length === 0 ? (
            <p className="text-[13.5px] text-muted-foreground">Nenhum assunto com “{filter.trim()}”.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((entry) => (
                <li key={entry.documentId} className="border-b border-border/50">
                  <Button
                    variant="ghost"
                    fullWidth
                    className="h-auto justify-start rounded-xl px-2 py-2.5 text-left font-sans text-[14px] whitespace-normal"
                    onClick={() => onOpen(entry.documentId)}
                  >
                    {entry.title}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {matches && matches.length === MAX_MATCHES && (
            <p className="text-[12px] text-muted-foreground">Mostrando os primeiros {MAX_MATCHES}. Refine o filtro.</p>
          )}
        </>
      )}
    </div>
  );
}

function PublicationArticle({
  header,
  publicationId,
  documentId,
  onOpenDocument,
  onOpenGlobal,
  onOpenBibleVerse,
}: {
  header: ReactNode;
  publicationId: string | null;
  documentId: number;
  onOpenDocument: (documentId: number) => void;
  onOpenGlobal: (symbol: GlobalPublicationSymbol, documentId: number) => void;
  onOpenBibleVerse: (bookOrder: number, chapter: number, verse: number | null) => void;
}) {
  const cacheKey = publicationId ? `${publicationId}:${documentId}` : null;
  const [html, setHtml] = useState<string | null>(() => (cacheKey ? (contentCache.get(cacheKey) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<SidePanel | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!publicationId || !cacheKey || contentCache.has(cacheKey)) return;
    let cancelled = false;
    void getGlobalPublicationChapterContent(publicationId, documentId).then((result) => {
      if (cancelled) return;
      if (result.html !== undefined) {
        contentCache.set(cacheKey, result.html);
        setHtml(result.html);
      } else {
        setError(result.error ?? "Artigo não encontrado.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [publicationId, documentId, cacheKey]);

  const { openSource, surfaceProps: sourceSurfaceProps } = useOpenPublicationSource({ onOpenGlobal });

  const openReference = useCallback(
    (mepsDocumentId: number, pid?: string) => {
      setPanel({ kind: "reference", target: null, html: null, loading: true, unresolvedMepsDocumentId: null });
      void resolveJwpubReferences([mepsDocumentId]).then(({ resolved }) => {
        const hit = resolved[0];
        if (!hit) {
          setPanel({ kind: "reference", target: null, html: null, loading: false, unresolvedMepsDocumentId: mepsDocumentId });
          return;
        }
        // A link back into this same publication ("veja também", another
        // Perspicaz article) is just the next page to read, not a side note.
        if (hit.isGlobal && hit.publicationId === publicationId) {
          setPanel(null);
          onOpenDocument(hit.documentId);
          return;
        }
        const target: JwpubReferenceTarget = {
          noteId: hit.noteId,
          publicationTitle: hit.publicationTitle,
          chapterTitle: hit.chapterTitle,
          documentId: hit.documentId,
          pid,
        };
        if (hit.isGlobal) {
          setPanel({ kind: "reference", target, html: hit.contentHtml ?? null, loading: false, unresolvedMepsDocumentId: null });
          return;
        }
        setPanel({ kind: "reference", target, html: null, loading: true, unresolvedMepsDocumentId: null });
        void getChapter(hit.publicationId, hit.documentId).then((result) => {
          setPanel({ kind: "reference", target, html: result.html ?? null, loading: false, unresolvedMepsDocumentId: null });
        });
      });
    },
    [publicationId, onOpenDocument]
  );

  useEffect(() => {
    const container = contentRef.current;
    if (!container || !publicationId) return;

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      // `<summary>` toggles its `<details>` natively — leave those alone.
      const link = target?.closest<HTMLElement>("a");
      if (!link) return;
      const data = link.dataset;

      if (data.jwpubExtract) {
        event.preventDefault();
        const ids = data.jwpubExtract.split(",").map(Number);
        setPanel({ kind: "extract", extracts: [], loading: true });
        void getGlobalPublicationExtracts(publicationId!, ids).then((result) => {
          setPanel({ kind: "extract", extracts: result.extracts ?? [], loading: false });
          if (result.error) notify.error("Não foi possível abrir o trecho", result.error);
        });
        return;
      }

      if (data.jwpubPubref) {
        event.preventDefault();
        openReference(Number(data.jwpubPubref), data.jwpubPubrefPid);
        return;
      }

      if (data.jwpubFootnote) {
        event.preventDefault();
        setPanel({ kind: "footnote", html: null, loading: true });
        void getGlobalPublicationFootnote(publicationId!, Number(data.jwpubFootnote)).then((result) => {
          setPanel({ kind: "footnote", html: result.html ?? result.error ?? null, loading: false });
        });
        return;
      }

      if (data.jwpubBibleFirst && data.jwpubBibleLast) {
        event.preventDefault();
        setPanel({ kind: "bible", verses: null, error: null });
        void getBibleVersesBatch([
          { firstVerseId: Number(data.jwpubBibleFirst), lastVerseId: Number(data.jwpubBibleLast) },
        ]).then((result) => {
          setPanel({ kind: "bible", verses: result.verses ?? [], error: result.error ?? null });
        });
      }
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [publicationId, openReference, html]);

  const closePanel = useCallback(() => setPanel(null), []);
  const firstVerse = panel?.kind === "bible" ? panel.verses?.[0] : undefined;
  const bibleTitle = firstVerse
    ? `${firstVerse.book} ${firstVerse.chapter}${firstVerse.verse !== null ? `:${firstVerse.verse}` : ""}`
    : "Bíblia";

  return (
    <div className="flex min-h-dvh w-full flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {error ? (
              <p className="text-[13.5px] text-muted-foreground">{error}</p>
            ) : html === null ? (
              <JwpubChapterSkeleton />
            ) : (
              // Trusted markup: rewritten and run through DOMPurify at import
              // time (GlobalPublicationUploadCard), before ever being stored.
              <div ref={contentRef} className={ARTICLE_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        </div>
      </div>

      <JwpubExtractSurface
        open={panel?.kind === "extract"}
        extracts={panel?.kind === "extract" ? panel.extracts : []}
        isLoading={panel?.kind === "extract" && panel.loading}
        onClose={closePanel}
        onOpenSource={(mepsDocumentId) => {
          closePanel();
          openSource(mepsDocumentId);
        }}
      />

      <JwpubReferenceSurface {...sourceSurfaceProps} />

      <JwpubReferenceSurface
        open={panel?.kind === "reference"}
        target={panel?.kind === "reference" ? panel.target : null}
        html={panel?.kind === "reference" ? panel.html : null}
        isLoading={panel?.kind === "reference" && panel.loading}
        unresolvedMepsDocumentId={panel?.kind === "reference" ? panel.unresolvedMepsDocumentId : null}
        onResolved={(mepsDocumentId) => openReference(mepsDocumentId)}
        onClose={closePanel}
      />

      <JwpubSidePanel open={panel?.kind === "footnote"} title="Nota de rodapé" onClose={closePanel}>
        {panel?.kind === "footnote" && panel.loading ? (
          <ReferenceContentSkeleton paragraphs={2} />
        ) : (
          <div
            className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2"
            dangerouslySetInnerHTML={{ __html: panel?.kind === "footnote" ? (panel.html ?? "") : "" }}
          />
        )}
      </JwpubSidePanel>

      <JwpubSidePanel open={panel?.kind === "bible"} title={bibleTitle} onClose={closePanel}>
        {panel?.kind === "bible" && panel.verses === null ? (
          <ReferenceContentSkeleton paragraphs={2} />
        ) : panel?.kind === "bible" && (panel.error || panel.verses?.length === 0) ? (
          <p className="text-[13.5px] text-muted-foreground">{panel.error ?? "Versículo não encontrado."}</p>
        ) : panel?.kind === "bible" && panel.verses ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-foreground/90">
              {panel.verses.map((v) => (
                <p key={v.id}>
                  {v.verse !== null && (
                    <span className="mr-1.5 font-mono text-[11px] text-accent">{v.verse}</span>
                  )}
                  {v.text}
                </p>
              ))}
            </div>
            {firstVerse && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                leftIcon={<BookOpen className="size-3.5 text-accent" />}
                onClick={() => onOpenBibleVerse(firstVerse.bookOrder, firstVerse.chapter, firstVerse.verse)}
              >
                Abrir na Bíblia
              </Button>
            )}
          </div>
        ) : null}
      </JwpubSidePanel>
    </div>
  );
}
