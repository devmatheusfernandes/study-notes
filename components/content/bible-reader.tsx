"use client";

import { useCallback, useEffect, useState } from "react";
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
  type BibleBook,
  type BibleVerseRow,
  type CrossReference,
} from "@/app/(app)/bible-actions";
import { getBibleChapterHighlights, type BibleVerseHighlight } from "@/app/(app)/jwlibrary-actions";
import { BibleBookGrid } from "./bible-book-grid";
import { BibleChapterGrid } from "./bible-chapter-grid";
import { BibleChapterView } from "./bible-chapter-view";
import { BibleReferencesPanel } from "./bible-references-panel";
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
  referencesOpen?: boolean;
  onToggleReferences?: () => void;
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
function BibleTopHeader({ title, onBack, referencesOpen, onToggleReferences, userEmail }: BibleTopHeaderProps) {
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
        {onToggleReferences && (
          <button
            type="button"
            onClick={onToggleReferences}
            aria-label="Referências"
            aria-pressed={referencesOpen}
            className={cn(
              "shrink-0 rounded-full p-2 transition-colors",
              referencesOpen
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

  const [screen, setScreen] = useState<BibleScreen>(
    initialBookOrder !== null && initialChapter !== null ? "reading" : "books"
  );
  const [bookOrder, setBookOrder] = useState(initialBookOrder ?? 1);
  const [chapter, setChapter] = useState(initialChapter ?? 1);
  const [targetVerse, setTargetVerse] = useState<number | null>(initialVerse ?? null);
  const [chapterCount, setChapterCount] = useState<number | null>(null);

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

  // References panel — hidden by default; while open, tapping/selecting any
  // verse (the same gesture that opens the highlight-color popup) also
  // refreshes this panel for that verse. While closed, no extra API call.
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [referenceVerse, setReferenceVerse] = useState<number | null>(null);
  const [refs, setRefs] = useState<CrossReference[]>([]);
  const [isLoadingRefs, setIsLoadingRefs] = useState(false);

  const handleVerseSelected = useCallback(
    (verse: number) => {
      setReferenceVerse(verse);
      if (!referencesOpen) return;
      setIsLoadingRefs(true);
      void getVerseCrossReferences(bookOrder, chapter, verse).then((result) => {
        setRefs(result.refs ?? []);
        setIsLoadingRefs(false);
      });
    },
    [referencesOpen, bookOrder, chapter]
  );

  function handleSelectReference(refBookOrder: number, refChapter: number, refVerse: number) {
    enterReading(refBookOrder, refChapter, refVerse);
  }

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
        <BibleBookGrid books={books} onSelectBook={pickBook} />
      </>
    );
  }

  if (screen === "chapters") {
    return (
      <>
        <BibleTopHeader title="Bíblia" userEmail={userEmail} />
        <BibleChapterGrid
          bookName={currentBook?.book ?? ""}
          chapterCount={chapterCount}
          onSelectChapter={(chapterNum) => enterReading(bookOrder, chapterNum)}
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
          referencesOpen={referencesOpen}
          onToggleReferences={() => setReferencesOpen((v) => !v)}
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

      <BibleReferencesPanel
        open={referencesOpen}
        onClose={() => setReferencesOpen(false)}
        currentLabel={referenceVerse ? `${currentBook?.book ?? ""} ${chapter}:${referenceVerse}` : ""}
        refs={refs}
        books={books ?? []}
        isLoading={isLoadingRefs}
        onSelectReference={handleSelectReference}
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
