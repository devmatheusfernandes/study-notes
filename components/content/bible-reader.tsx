"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { SidebarToggleButton } from "@/components/layout/sidebar-toggle-button";
import { UserMenuClient } from "@/components/layout/user-menu-client";
import {
  listBibleBooks,
  getBibleChapterCount,
  getBibleChapterVerses,
  getVerseCrossReferences,
  getChapterCrossReferences,
  getChapterStudyContent,
  listBibleAppendixHeaders,
  type BibleBook,
  type BibleVerseRow,
  type CrossReference,
  type CrossReferenceSource,
  type BibleFootnote,
  type BibleStudyNote,
  type BibleAppendixHeader,
} from "@/app/(app)/bible-actions";
import { getBibleChapterHighlights, type BibleVerseHighlight } from "@/app/(app)/jwlibrary-actions";
import { BibleBookGrid } from "./bible-book-grid";
import { BibleChapterGrid } from "./bible-chapter-grid";
import { BibleChapterView } from "./bible-chapter-view";
import { BibleStudyPanel, type BibleStudyTab } from "./bible-study-panel";
import { BibleAppendixSurface } from "./bible-appendix-surface";
import { JwpubChapterSkeleton } from "./jwpub-chapter-skeleton";
import {
  JwlibraryNoteEditorVault,
  type PrefilledJwlibraryLocation,
  type EditableJwlibraryNote,
} from "./jwlibrary-note-editor-vault";
import { JwlibraryHighlightNotePanel } from "./jwlibrary-highlight-note-panel";

interface BibleReaderProps {
  /** null when /bible was opened with no ?book=/?chapter= — starts on the book-grid screen instead of jumping straight to reading. */
  initialBookOrder: number | null;
  initialChapter: number | null;
  initialVerse?: number | null;
  userEmail?: string;
}

type BibleScreen = "books" | "chapters" | "reading";

interface BibleTopHeaderProps {
  title: string;
  onBack?: () => void;
  studyOpen?: boolean;
  onToggleStudy?: () => void;
  userEmail?: string;
}

/**
 * The one sticky header row for all three /bible screens — BibleReader owns
 * this itself (SidebarToggleButton + UserMenuClient reused directly) instead
 * of the shared components/layout/header.tsx, because that component's
 * title is static per-page while this one changes with the current
 * book/chapter (and UserMenu, the version Header uses, is an async Server
 * Component that can't be rendered from inside a Client Component — hence
 * UserMenuClient + the email passed down from app/(app)/bible/page.tsx).
 * Previously this was a second bar stacked below the shared Header's own
 * "Bíblia" title, which is the redundant double-header this replaces.
 */
function BibleTopHeader({ title, onBack, studyOpen, onToggleStudy, userEmail }: BibleTopHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      <SidebarToggleButton />
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Trocar de capítulo"
          className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate font-heading text-lg tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {onToggleStudy && (
          <button
            type="button"
            onClick={onToggleStudy}
            aria-label="Estudo"
            aria-pressed={studyOpen}
            className={cn(
              "shrink-0 rounded-full p-2 transition-colors",
              studyOpen
                ? "bg-primary/[0.18] text-accent"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            <Layers className="size-4" />
          </button>
        )}
        <UserMenuClient email={userEmail} />
      </div>
    </header>
  );
}

/**
 * `/bible`'s content — three full-page screens (book grid → chapter grid →
 * reading), matching the JW Library app's own Bible navigation rather than
 * a Vault/drawer picker. Only the reading screen is deep-linkable
 * (`?book=&chapter=&verse=`); moving between the three screens is local
 * state, not its own URL. Reading itself mirrors jwpub-reader.tsx closely
 * (chapter switching, highlighting, notes), reusing JwlibraryNoteEditorVault
 * and JwlibraryHighlightNotePanel unchanged.
 */
export function BibleReader({ initialBookOrder, initialChapter, initialVerse, userEmail }: BibleReaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [books, setBooks] = useState<BibleBook[] | null>(null);
  useEffect(() => {
    void listBibleBooks().then((result) => setBooks(result.books ?? []));
  }, []);

  const [appendixHeaders, setAppendixHeaders] = useState<BibleAppendixHeader[] | null>(null);
  useEffect(() => {
    void listBibleAppendixHeaders().then((result) => setAppendixHeaders(result.headers ?? []));
  }, []);

  // Which appendix (by meps_document_id) the appendix reader is showing —
  // opened either from the book-grid entry point or from a link inside a
  // study note / another appendix. `null` means the surface is closed.
  const [openAppendixId, setOpenAppendixId] = useState<number | null>(null);

  const [screen, setScreen] = useState<BibleScreen>(
    initialBookOrder !== null && initialChapter !== null ? "reading" : "books"
  );
  const [bookOrder, setBookOrder] = useState(initialBookOrder ?? 1);
  const [chapter, setChapter] = useState(initialChapter ?? 1);
  const [targetVerse, setTargetVerse] = useState<number | null>(initialVerse ?? null);
  const [chapterCount, setChapterCount] = useState<number | null>(null);
  // Which verse the study panel is scoped to; null means "the whole chapter".
  // Declared up here, not down with the rest of the panel state, because
  // enterReading below re-scopes it on every navigation and the React
  // Compiler refuses to memoize a callback that reads a binding declared
  // after it.
  const [selectedVerse, setSelectedVerse] = useState<number | null>(initialVerse ?? null);

  const currentBook = books?.find((b) => b.bookOrder === bookOrder) ?? null;
  const bookIndex = books?.findIndex((b) => b.bookOrder === bookOrder) ?? -1;

  useEffect(() => {
    // Reset before fetching, not just after — otherwise switching books
    // briefly shows the PREVIOUS book's chapter count (e.g. the chapter grid
    // flashing 50 buttons before snapping down to 10) instead of the
    // "carregando…" state bible-chapter-grid.tsx already has for `null`.
    queueMicrotask(() => setChapterCount(null));
    void getBibleChapterCount(bookOrder).then((result) => setChapterCount(result.count ?? null));
  }, [bookOrder]);

  function pickBook(order: number) {
    setBookOrder(order);
    setScreen("chapters");
  }

  const enterReading = useCallback(
    (nextBookOrder: number, nextChapter: number, verse?: number | null) => {
      setBookOrder(nextBookOrder);
      setChapter(nextChapter);
      setTargetVerse(verse ?? null);
      // The study panel is scoped to a verse of the CURRENT chapter, so any
      // navigation has to re-scope it: to the verse we are jumping to, or back
      // to the whole chapter when there isn't one.
      setSelectedVerse(verse ?? null);
      setScreen("reading");
      const params = new URLSearchParams(searchParams.toString());
      params.set("book", String(nextBookOrder));
      params.set("chapter", String(nextChapter));
      if (verse) params.set("verse", String(verse));
      else params.delete("verse");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  async function goToPrevChapter() {
    if (chapter > 1) {
      enterReading(bookOrder, chapter - 1);
      return;
    }
    const prevBook = bookIndex > 0 && books ? books[bookIndex - 1] : null;
    if (!prevBook) return;
    const result = await getBibleChapterCount(prevBook.bookOrder);
    enterReading(prevBook.bookOrder, result.count ?? 1);
  }

  function goToNextChapter() {
    if (chapterCount !== null && chapter < chapterCount) {
      enterReading(bookOrder, chapter + 1);
      return;
    }
    const nextBook = books && bookIndex !== -1 && bookIndex < books.length - 1 ? books[bookIndex + 1] : null;
    if (!nextBook) return;
    enterReading(nextBook.bookOrder, 1);
  }

  const isFirstChapter = bookIndex === 0 && chapter === 1;
  const isLastChapter =
    bookIndex !== -1 && books !== null && bookIndex === books.length - 1 && chapterCount !== null && chapter === chapterCount;

  const [verses, setVerses] = useState<BibleVerseRow[] | null>(null);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);

  useEffect(() => {
    if (screen !== "reading") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoadingChapter(true);
    });
    void getBibleChapterVerses(bookOrder, chapter).then((result) => {
      if (cancelled) return;
      setVerses(result.verses ?? []);
      setIsLoadingChapter(false);
      if (result.error) notify.error("Não foi possível abrir o capítulo", result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [screen, bookOrder, chapter]);

  const [highlights, setHighlights] = useState<BibleVerseHighlight[]>([]);
  const refreshHighlights = useCallback(() => {
    void getBibleChapterHighlights(bookOrder, chapter).then((result) => setHighlights(result.highlights ?? []));
  }, [bookOrder, chapter]);

  useEffect(() => {
    if (screen !== "reading") return;
    let cancelled = false;
    void getBibleChapterHighlights(bookOrder, chapter).then((result) => {
      if (!cancelled) setHighlights(result.highlights ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [screen, bookOrder, chapter]);

  // Footnotes + study notes for the whole chapter, in one request alongside
  // the verses. Fetching per chapter rather than per tapped verse means
  // opening the panel is instant and the in-text markers can be drawn
  // immediately — the worst chapter in the Bible is 92 footnotes (Salmo 119).
  const [footnotes, setFootnotes] = useState<BibleFootnote[]>([]);
  const [studyNotes, setStudyNotes] = useState<BibleStudyNote[]>([]);
  const [isLoadingStudy, setIsLoadingStudy] = useState(false);

  useEffect(() => {
    if (screen !== "reading") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoadingStudy(true);
    });
    void getChapterStudyContent(bookOrder, chapter).then((result) => {
      if (cancelled) return;
      setFootnotes(result.footnotes ?? []);
      setStudyNotes(result.studyNotes ?? []);
      setIsLoadingStudy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [screen, bookOrder, chapter]);

  // bible_footnotes stores `verse_id` (the global BibleVerseId) and no verse
  // number — there's no FK to embed through, so the mapping is done here with
  // the chapter's verses, which are already in memory, instead of paying for
  // a join server-side. See getChapterStudyContent.
  const verseNumberById = useMemo(
    () => new Map((verses ?? []).map((v) => [v.id, v.verse])),
    [verses]
  );

  const footnoteCountByVerse = useMemo(() => {
    const counts = new Map<number, number>();
    for (const footnote of footnotes) {
      const verse = verseNumberById.get(footnote.verseId);
      if (verse === null || verse === undefined) continue;
      counts.set(verse, (counts.get(verse) ?? 0) + 1);
    }
    return counts;
  }, [footnotes, verseNumberById]);

  const studyNoteVerses = useMemo(
    () => new Set(studyNotes.map((note) => note.verse).filter((v): v is number => v !== null)),
    [studyNotes]
  );

  // Study panel — hidden by default; while open, tapping/selecting any verse
  // (the same gesture that opens the highlight-color popup) re-scopes it to
  // that verse. While closed, no cross-reference request is made.
  const [studyOpen, setStudyOpen] = useState(false);
  const [studyTab, setStudyTab] = useState<BibleStudyTab>("referencias");
  const [refs, setRefs] = useState<(CrossReference & { verse: number | null })[]>([]);
  const [isLoadingRefs, setIsLoadingRefs] = useState(false);
  const [refsTruncated, setRefsTruncated] = useState(false);
  const [refsSource, setRefsSource] = useState<CrossReferenceSource>("nwt");

  const handleVerseSelected = useCallback((verse: number) => setSelectedVerse(verse), []);

  // Driven by an effect rather than the tap handler so that switching the
  // reference source (marginais ↔ estendidas) or clearing the verse refetches
  // without duplicating the request in three places.
  //
  // With no verse selected the panel shows the whole chapter, so this fetches
  // the chapter's references instead of nothing — that's what makes opening
  // the panel useful before tapping anything.
  useEffect(() => {
    if (!studyOpen) return;
    let cancelled = false;
    // Deferred a tick rather than set synchronously in the effect body — same
    // pattern as the chapter/highlight loads above.
    queueMicrotask(() => {
      if (!cancelled) setIsLoadingRefs(true);
    });

    const request =
      selectedVerse === null
        ? getChapterCrossReferences(bookOrder, chapter, refsSource)
        : getVerseCrossReferences(bookOrder, chapter, selectedVerse, refsSource).then((result) => ({
            // The per-verse action doesn't echo the verse back (the caller
            // already knows it); the panel groups on it, so it's added here.
            refs: result.refs?.map((ref) => ({ ...ref, verse: selectedVerse })),
            truncated: false,
          }));

    void request.then((result) => {
      if (cancelled) return;
      setRefs(result.refs ?? []);
      setRefsTruncated(result.truncated ?? false);
      setIsLoadingRefs(false);
    });
    return () => {
      cancelled = true;
    };
  }, [studyOpen, selectedVerse, refsSource, bookOrder, chapter]);

  const handleOpenStudy = useCallback((verse: number, tab: BibleStudyTab) => {
    setSelectedVerse(verse);
    setStudyTab(tab);
    setStudyOpen(true);
  }, []);

  function handleSelectReference(refBookOrder: number, refChapter: number, refVerse: number) {
    enterReading(refBookOrder, refChapter, refVerse);
  }

  // Footnotes carry a verse *id*; the panel groups and labels by verse
  // *number*, so the mapping happens once here. With no verse selected the
  // whole chapter goes through, which is the panel's default view.
  const panelFootnotes = useMemo(() => {
    const withVerse = footnotes.map((f) => ({ ...f, verse: verseNumberById.get(f.verseId) ?? null }));
    return selectedVerse === null ? withVerse : withVerse.filter((f) => f.verse === selectedVerse);
  }, [footnotes, verseNumberById, selectedVerse]);

  const panelStudyNotes = useMemo(
    () => (selectedVerse === null ? studyNotes : studyNotes.filter((n) => n.verse === selectedVerse)),
    [studyNotes, selectedVerse]
  );

  const [pendingNoteLocation, setPendingNoteLocation] = useState<PrefilledJwlibraryLocation | null>(null);
  const [highlightNote, setHighlightNote] = useState<EditableJwlibraryNote | null>(null);
  const [highlightEditMode, setHighlightEditMode] = useState(false);

  const handlePickVerseSpan = useCallback(
    (verse: number, startToken: number, endToken: number, colorIndex?: number, selectedText?: string) => {
      setPendingNoteLocation({
        blockType: 2,
        blockIdentifier: verse,
        location: {
          bookNumber: bookOrder,
          chapterNumber: chapter,
          keySymbol: null,
          mepsLanguage: null,
          issueTagNumber: null,
          mepsDocumentId: null,
          track: null,
          locationType: 0,
        },
        label: `${currentBook?.book ?? ""} ${chapter}:${verse}`,
        tokenRange: { start: startToken, end: endToken },
        initialColorIndex: colorIndex,
        selectedText,
      });
    },
    [bookOrder, chapter, currentBook]
  );

  if (screen === "books") {
    return (
      <>
        <BibleTopHeader title="Bíblia" userEmail={userEmail} />
        <BibleBookGrid
          books={books}
          onSelectBook={pickBook}
          appendixHeaders={appendixHeaders}
          onSelectAppendix={setOpenAppendixId}
        />
        <BibleAppendixSurface
          mepsDocumentId={openAppendixId}
          onClose={() => setOpenAppendixId(null)}
          onOpenAppendix={setOpenAppendixId}
          onOpenBibleRef={(refBookOrder, refChapter, refVerse) => {
            setOpenAppendixId(null);
            enterReading(refBookOrder, refChapter, refVerse);
          }}
        />
      </>
    );
  }

  if (screen === "chapters") {
    return (
      <>
        <BibleTopHeader title="Bíblia" userEmail={userEmail} />
        <BibleChapterGrid
          bookName={currentBook?.book ?? ""}
          bookOrder={bookOrder}
          chapterCount={chapterCount}
          onSelectChapter={(chapterNum) => enterReading(bookOrder, chapterNum)}
          onSelectSection={(chapterNum, verse) => enterReading(bookOrder, chapterNum, verse)}
          onBack={() => setScreen("books")}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <BibleTopHeader
          title={`${currentBook?.book ?? ""} ${chapter}`}
          onBack={() => setScreen("chapters")}
          studyOpen={studyOpen}
          onToggleStudy={() => setStudyOpen((v) => !v)}
          userEmail={userEmail}
        />

        <div className="flex-1 px-4 py-6 sm:px-6">
          {isLoadingChapter ? (
            <JwpubChapterSkeleton />
          ) : (
            <BibleChapterView
              verses={verses ?? []}
              onPickVerseSpan={handlePickVerseSpan}
              onVerseSelected={handleVerseSelected}
              highlights={highlights}
              onHighlightNote={setHighlightNote}
              targetVerse={targetVerse}
              footnoteCountByVerse={footnoteCountByVerse}
              studyNoteVerses={studyNoteVerses}
              onOpenStudy={handleOpenStudy}
            />
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ChevronLeft />}
            disabled={isFirstChapter}
            onClick={() => void goToPrevChapter()}
          >
            Anterior
          </Button>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {currentBook?.book} {chapter}
          </span>
          <Button variant="ghost" size="sm" rightIcon={<ChevronRight />} disabled={isLastChapter} onClick={goToNextChapter}>
            Próximo
          </Button>
        </div>
      </div>

      <BibleStudyPanel
        open={studyOpen}
        onClose={() => setStudyOpen(false)}
        tab={studyTab}
        onTabChange={setStudyTab}
        bookName={currentBook?.book ?? ""}
        chapter={chapter}
        selectedVerse={selectedVerse}
        onClearVerse={() => setSelectedVerse(null)}
        onSelectVerse={setSelectedVerse}
        refs={refs}
        refsLoading={isLoadingRefs}
        refsTruncated={refsTruncated}
        refsSource={refsSource}
        onChangeRefsSource={setRefsSource}
        books={books ?? []}
        onSelectReference={handleSelectReference}
        footnotes={panelFootnotes}
        studyNotes={panelStudyNotes}
        studyLoading={isLoadingStudy}
        onOpenBibleRef={enterReading}
        onOpenAppendix={setOpenAppendixId}
      />

      <BibleAppendixSurface
        mepsDocumentId={openAppendixId}
        onClose={() => setOpenAppendixId(null)}
        onOpenAppendix={setOpenAppendixId}
        onOpenBibleRef={(refBookOrder, refChapter, refVerse) => {
          setOpenAppendixId(null);
          enterReading(refBookOrder, refChapter, refVerse);
        }}
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
