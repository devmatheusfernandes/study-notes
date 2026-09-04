"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, List, NotebookPen, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { getChapter, getFootnote, getPublication, getAnswers } from "@/app/(app)/jwpub-actions";
import { getBibleVerses, type BibleVerseRow } from "@/app/(app)/bible-actions";
import { getFileUrl } from "@/app/(app)/files-actions";
import { getChapterHighlights, type ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import { useNotesStore } from "@/lib/store/notes-store";
import type { ChapterSummary, PublicationSummary } from "@/lib/jwpub/types";
import { JwpubChapterView } from "./jwpub-chapter-view";
import { JwpubChapterSkeleton } from "./jwpub-chapter-skeleton";
import { JwpubFootnoteSurface } from "./jwpub-footnote-surface";
import { JwpubBibleSurface } from "./jwpub-bible-surface";
import {
  JwlibraryNoteEditorVault,
  type PrefilledJwlibraryLocation,
  type EditableJwlibraryNote,
} from "./jwlibrary-note-editor-vault";
import { JwlibraryHighlightNotePanel } from "./jwlibrary-highlight-note-panel";

interface JwpubReaderProps {
  noteId: string;
  initialPublication: PublicationSummary;
  initialChapters: ChapterSummary[];
  initialChapterParam?: string;
  initialDocParam?: string;
}

export function JwpubReader({
  noteId,
  initialPublication,
  initialChapters,
  initialChapterParam,
  initialDocParam,
}: JwpubReaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const notes = useNotesStore((s) => s.notes);
  const note = notes.find((n) => n.id === noteId);

  const [publication, setPublication] = useState(initialPublication);
  const [chapters, setChapters] = useState(initialChapters);

  // `doc` (JWPUB documentId) is a stable, unique-per-chapter number — resolve
  // it with an exact match ONLY, no title heuristics. Some books have a
  // chapter whose title equals the book's own cover title except for
  // capitalization ("Organizados para Fazer a Vontade de Jeová" is both the
  // cover, documentId 0, and a real chapter, documentId 4) — a title-based
  // lookup can't tell those apart since it normalizes case, but documentId can.
  const findChapterIndexByDocId = useCallback(
    (docParam?: string | null): number | undefined => {
      if (!docParam) return undefined;
      const num = parseInt(docParam, 10);
      if (!Number.isFinite(num)) return undefined;
      const docMatch = chapters.findIndex((c) => c.documentId === num);
      return docMatch !== -1 ? docMatch : undefined;
    },
    [chapters]
  );

  // Title-based lookup — kept for links that only have a chapter title
  // (no documentId), matched case-insensitively.
  const findChapterIndexByTitle = useCallback(
    (paramVal?: string | null) => {
      if (!paramVal || chapters.length === 0) return 0;

      const trimmed = paramVal.trim().toLowerCase();

      // 1. Exact or partial title match
      const titleIndex = chapters.findIndex((c) => {
        const t = c.title.toLowerCase();
        return t === trimmed || t.includes(trimmed) || trimmed.includes(t);
      });
      if (titleIndex !== -1) return titleIndex;

      // 2. Numeric match (chapter number or position — NOT documentId, which
      // goes through findChapterIndexByDocId instead)
      const numMatch = paramVal.match(/\d+/);
      if (numMatch) {
        const num = parseInt(numMatch[0], 10);

        const numTitleIndex = chapters.findIndex((c) => {
          const t = c.title.toLowerCase();
          return (
            t.includes(`capítulo ${num}`) ||
            t.includes(`capitulo ${num}`) ||
            t.includes(`cap. ${num}`) ||
            t.includes(`seção ${num}`) ||
            t.includes(`secao ${num}`)
          );
        });
        if (numTitleIndex !== -1) return numTitleIndex;

        const posMatch = chapters.findIndex((c) => c.position === num - 1 || c.position === num);
        if (posMatch !== -1) return posMatch;
      }

      return 0;
    },
    [chapters]
  );

  const resolveChapterIndex = useCallback(
    (docParam?: string | null, chapterParam?: string | null) =>
      findChapterIndexByDocId(docParam) ?? findChapterIndexByTitle(chapterParam),
    [findChapterIndexByDocId, findChapterIndexByTitle]
  );

  const [activeIndex, setActiveIndex] = useState(() =>
    resolveChapterIndex(initialDocParam, initialChapterParam)
  );

  // Sync activeIndex with URL search parameters on client-side navigation
  useEffect(() => {
    const docParam = searchParams.get("doc");
    const chapterParam = searchParams.get("chapter");
    if (!docParam && !chapterParam) return;
    const targetIdx = resolveChapterIndex(docParam, chapterParam);
    if (targetIdx !== activeIndex) {
      queueMicrotask(() => {
        setActiveIndex(targetIdx);
      });
    }
  }, [searchParams, resolveChapterIndex, activeIndex]);

  // Moving between chapters (prev/next, the chapter list) also writes `?doc=`
  // to the URL — otherwise a reload always lands back on the first chapter.
  // `replace` (not `push`) so flipping through chapters doesn't pile up
  // browser-history entries; the URL→state effect above is a no-op once this
  // runs since targetIdx already matches the index we just set.
  const navigateToIndex = useCallback(
    (index: number) => {
      setActiveIndex(index);
      const chapter = chapters[index];
      if (!chapter) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("doc", String(chapter.documentId));
      params.delete("chapter");
      params.delete("text");
      params.delete("pid");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [chapters, pathname, router, searchParams]
  );

  const [html, setHtml] = useState<string | null>(null);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [footnoteHtml, setFootnoteHtml] = useState<string | null>(null);
  const [isLoadingFootnote, setIsLoadingFootnote] = useState(false);

  const [bibleOpen, setBibleOpen] = useState(false);
  const [bibleVerses, setBibleVerses] = useState<BibleVerseRow[] | null>(null);
  const [bibleError, setBibleError] = useState<string | null>(null);
  const [isLoadingBible, setIsLoadingBible] = useState(false);

  // "Anotar" mode (Fase 2): while true, clicking a paragraph in
  // JwpubChapterView opens the note editor pre-anchored to it instead of the
  // normal footnote/bible-ref handling.
  const [pickingParagraph, setPickingParagraph] = useState(false);
  const [pendingNoteLocation, setPendingNoteLocation] = useState<PrefilledJwlibraryLocation | null>(null);
  // Clicking a highlight's margin marker opens a read-only side panel first
  // (JwlibraryHighlightNotePanel); tapping "Editar" inside it sets
  // highlightEditMode, promoting the same note into the full editor vault.
  const [highlightNote, setHighlightNote] = useState<EditableJwlibraryNote | null>(null);
  const [highlightEditMode, setHighlightEditMode] = useState(false);

  // Fetched once per publication (not per chapter) — cheap, and every
  // chapter switch would otherwise re-fetch the whole set.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void getAnswers(publication.id).then((result) => {
      if (!cancelled) setAnswers(result.answers ?? {});
    });
    return () => {
      cancelled = true;
    };
  }, [publication.id]);

  const activeChapter = chapters[activeIndex];

  // Fetched per chapter (unlike answers, which are per-publication) — each
  // chapter has its own meps_document_id, and the query is already scoped
  // directly to it (see getChapterHighlights), so this stays cheap.
  const [highlights, setHighlights] = useState<ParagraphHighlight[]>([]);
  const refreshHighlights = useCallback(() => {
    if (!activeChapter) return;
    void getChapterHighlights(
      publication.symbol,
      publication.mepsLanguageIndex,
      publication.issueTagNumber,
      activeChapter.mepsDocumentId
    ).then((result) => setHighlights(result.highlights ?? []));
  }, [publication.symbol, publication.mepsLanguageIndex, publication.issueTagNumber, activeChapter]);

  useEffect(() => {
    if (!activeChapter) return;
    let cancelled = false;
    void getChapterHighlights(
      publication.symbol,
      publication.mepsLanguageIndex,
      publication.issueTagNumber,
      activeChapter.mepsDocumentId
    ).then((result) => {
      if (!cancelled) setHighlights(result.highlights ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [publication.symbol, publication.mepsLanguageIndex, publication.issueTagNumber, activeChapter]);

  useEffect(() => {
    if (!activeChapter) return;
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setIsLoadingChapter(true);
    });

    void getChapter(publication.id, activeChapter.documentId).then((result) => {
      if (cancelled) return;
      setHtml(result.html ?? "");
      setIsLoadingChapter(false);
      if (result.error) notify.error("Não foi possível abrir o capítulo", result.error);
    });

    return () => {
      cancelled = true;
    };
  }, [publication.id, activeChapter]);

  const handleFootnote = useCallback(
    (footnoteId: number) => {
      setFootnoteOpen(true);
      setFootnoteHtml(null);
      setIsLoadingFootnote(true);
      void getFootnote(publication.id, footnoteId).then((result) => {
        setFootnoteHtml(result.html ?? null);
        setIsLoadingFootnote(false);
      });
    },
    [publication.id]
  );

  const handleBibleRef = useCallback((firstVerseId: number, lastVerseId: number) => {
    setBibleOpen(true);
    setBibleVerses(null);
    setBibleError(null);
    setIsLoadingBible(true);
    void getBibleVerses(firstVerseId, lastVerseId).then((result) => {
      setBibleVerses(result.verses ?? null);
      setBibleError(result.error ?? null);
      setIsLoadingBible(false);
    });
  }, []);

  const handlePickParagraph = useCallback(
    (pid: string) => {
      setPickingParagraph(false);
      setPendingNoteLocation({
        blockType: 1,
        blockIdentifier: Number(pid),
        location: {
          bookNumber: null,
          chapterNumber: null,
          keySymbol: publication.symbol,
          mepsLanguage: publication.mepsLanguageIndex,
          issueTagNumber: publication.issueTagNumber,
          mepsDocumentId: activeChapter?.mepsDocumentId ?? null,
          track: null,
          locationType: 0,
        },
        label: `${publication.title} — ${activeChapter?.title ?? ""}`,
      });
    },
    [publication, activeChapter]
  );

  const handlePickParagraphSpan = useCallback(
    (pid: string, startToken: number, endToken: number, colorIndex?: number, selectedText?: string) => {
      setPickingParagraph(false);
      setPendingNoteLocation({
        blockType: 1,
        blockIdentifier: Number(pid),
        location: {
          bookNumber: null,
          chapterNumber: null,
          keySymbol: publication.symbol,
          mepsLanguage: publication.mepsLanguageIndex,
          issueTagNumber: publication.issueTagNumber,
          mepsDocumentId: activeChapter?.mepsDocumentId ?? null,
          track: null,
          locationType: 0,
        },
        label: `${publication.title} — ${activeChapter?.title ?? ""}`,
        tokenRange: { start: startToken, end: endToken },
        initialColorIndex: colorIndex,
        selectedText,
      });
    },
    [publication, activeChapter]
  );

  /** Recovery path: re-download the original from Storage and parse it again. */
  async function reprocess() {
    if (!note?.storagePath) return;
    setIsReprocessing(true);
    try {
      const { url, error } = await getFileUrl(note.storagePath);
      if (error || !url) throw new Error(error ?? "Não foi possível baixar o arquivo.");

      const blob = await fetch(url).then((r) => r.blob());
      const { ingestJwpub } = await import("@/lib/jwpub/ingest");
      const result = await ingestJwpub(blob, noteId);
      if (!result.ok) throw new Error(result.error);

      const refreshed = await getPublication(noteId);
      if (refreshed.publication) {
        setPublication(refreshed.publication);
        setChapters(refreshed.chapters ?? []);
        setActiveIndex(0);
      }
      notify.success("Publicação processada");
    } catch (error) {
      notify.error(
        "Não foi possível processar a publicação",
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsReprocessing(false);
    }
  }

  const failed = publication.status === "failed" || chapters.length === 0;

  return (
    <div className="flex min-h-dvh w-full">
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft />}
            onClick={() => router.push("/notes")}
            className="max-sm:px-2"
          >
            <span className="hidden sm:inline">Voltar</span>
          </Button>

          <div className="mx-2 flex min-w-0 flex-1 flex-col">
            <span className="truncate font-heading text-[15px] leading-tight">
              {publication.title || note?.title || "Publicação"}
            </span>
            {publication.symbol && (
              <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
                {publication.symbol.toUpperCase()}
              </span>
            )}
          </div>

          {chapters.length > 0 && (
            <button
              type="button"
              onClick={() => setPickingParagraph((v) => !v)}
              aria-label="Anotar parágrafo"
              aria-pressed={pickingParagraph}
              title="Toque num parágrafo pra criar uma nota nele"
              className={cn(
                "shrink-0 rounded-full p-2 transition-colors",
                pickingParagraph
                  ? "bg-primary/[0.18] text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <NotebookPen className="size-4" />
            </button>
          )}

          {chapters.length > 0 && (
            <button
              type="button"
              onClick={() => setShowChapters((v) => !v)}
              aria-label="Capítulos"
              aria-pressed={showChapters}
              className={cn(
                "shrink-0 rounded-full p-2 transition-colors",
                showChapters
                  ? "bg-primary/[0.18] text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <List className="size-4" />
            </button>
          )}
        </header>

        {failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <p className="max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              Esta publicação ainda não foi processada — sem isso não dá para ler o conteúdo aqui
              dentro.
            </p>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw />}
              isLoading={isReprocessing}
              onClick={() => void reprocess()}
            >
              Processar publicação
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 px-4 py-6 sm:px-6">
              {isLoadingChapter ? (
                <JwpubChapterSkeleton />
              ) : (
                <JwpubChapterView
                  html={html ?? ""}
                  publicationId={publication.id}
                  documentId={activeChapter.documentId}
                  answers={answers}
                  onFootnote={handleFootnote}
                  onBibleRef={handleBibleRef}
                  pickingParagraph={pickingParagraph}
                  onPickParagraph={handlePickParagraph}
                  onPickParagraphSpan={handlePickParagraphSpan}
                  highlights={highlights}
                  onHighlightNote={setHighlightNote}
                />
              )}
            </div>

            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ChevronLeft />}
                disabled={activeIndex === 0}
                onClick={() => navigateToIndex(Math.max(0, activeIndex - 1))}
              >
                Anterior
              </Button>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {activeIndex + 1} / {chapters.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                rightIcon={<ChevronRight />}
                disabled={activeIndex >= chapters.length - 1}
                onClick={() => navigateToIndex(Math.min(chapters.length - 1, activeIndex + 1))}
              >
                Próximo
              </Button>
            </div>
          </>
        )}
      </motion.main>

      <AnimatePresence>
        {showChapters && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowChapters(false)}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xs flex-col border-l border-border bg-background shadow-2xl sm:max-w-sm"
            >
              <header className="flex items-center justify-between border-b border-border px-5 py-4">
                <span className="font-heading text-base font-medium">Capítulos</span>
                <button
                  type="button"
                  onClick={() => setShowChapters(false)}
                  aria-label="Fechar capítulos"
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </header>
              <nav className="flex-1 overflow-y-auto p-3">
                <ul className="flex flex-col gap-1">
                  {chapters.map((chapter, index) => (
                    <li key={chapter.documentId}>
                      <button
                        type="button"
                        onClick={() => {
                          navigateToIndex(index);
                          setShowChapters(false);
                        }}
                        className={cn(
                          "w-full rounded-lg px-3.5 py-2.5 text-left text-[13.5px] transition-colors",
                          index === activeIndex
                            ? "bg-primary/[0.18] text-accent font-medium"
                            : "text-foreground/80 hover:bg-secondary"
                        )}
                      >
                        {chapter.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <JwpubFootnoteSurface
        open={footnoteOpen}
        html={footnoteHtml}
        isLoading={isLoadingFootnote}
        onClose={() => setFootnoteOpen(false)}
      />

      <JwpubBibleSurface
        open={bibleOpen}
        verses={bibleVerses}
        error={bibleError}
        isLoading={isLoadingBible}
        onClose={() => setBibleOpen(false)}
      />

      <JwlibraryHighlightNotePanel
        open={highlightNote !== null && !highlightEditMode}
        note={highlightNote}
        onClose={() => setHighlightNote(null)}
        onEdit={() => setHighlightEditMode(true)}
        onDeleted={() => {
          setHighlightNote(null);
          void refreshHighlights();
        }}
      />

      <JwlibraryNoteEditorVault
        open={pendingNoteLocation !== null || (highlightNote !== null && highlightEditMode)}
        onOpenChange={(next) => {
          if (!next) {
            setPendingNoteLocation(null);
            setHighlightNote(null);
            setHighlightEditMode(false);
          }
        }}
        note={highlightEditMode ? highlightNote : null}
        prefilledLocation={pendingNoteLocation}
        onSaved={refreshHighlights}
      />
    </div>
  );
}

