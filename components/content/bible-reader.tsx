"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { useWakeLock } from "@/hooks/use-wake-lock";
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
import {
  getBibleChapterHighlights,
  createJwlibraryHighlight,
  updateJwlibraryHighlightColor,
  deleteJwlibraryHighlight,
  deleteJwlibraryNote,
  type BibleVerseHighlight,
} from "@/app/(app)/jwlibrary-actions";
import { BibleBookGrid } from "./bible-book-grid";
import { BibleChapterGrid } from "./bible-chapter-grid";
import { BibleChapterView } from "./bible-chapter-view";
import { BibleStudyPanel, type BibleStudyTab, type BiblePersonalNote } from "./bible-study-panel";
import { BibleAppendixSurface } from "./bible-appendix-surface";
import { JwpubChapterSkeleton } from "./jwpub-chapter-skeleton";
import {
  JwlibraryNoteEditorVault,
  type PrefilledJwlibraryLocation,
  type EditableJwlibraryNote,
} from "./jwlibrary-note-editor-vault";

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
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-border bg-background/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:gap-3 sm:px-6">
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
 * for the actual editing. Unlike jwpub-reader.tsx, this reader has no
 * separate highlight/note viewing panel — the Estudo panel's Pessoal tab
 * (bible-study-panel.tsx) is the one place a highlight or note is viewed,
 * recolored, annotated, or deleted from here.
 */
export function BibleReader({ initialBookOrder, initialChapter, initialVerse, userEmail }: BibleReaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Long, hands-off reading — don't let the screen sleep mid-chapter.
  useWakeLock(true);

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
  // Also declared up here rather than with the rest of the highlight/note
  // panel state below, for the same reason as selectedVerse above —
  // enterReading resets them on every chapter navigation.
  const [pendingNoteLocation, setPendingNoteLocation] = useState<PrefilledJwlibraryLocation | null>(null);
  const [highlightNote, setHighlightNote] = useState<EditableJwlibraryNote | null>(null);
  const [highlightEditMode, setHighlightEditMode] = useState(false);
  // Clicking a highlight with NO note (a "destaque puro") opens the same
  // panel in its note-less mode (recolor/add note/delete) instead.
  const [highlightMark, setHighlightMark] = useState<(BibleVerseHighlight & { text?: string }) | null>(null);

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
      // A highlight/note panel left open from the previous chapter shouldn't
      // follow the reader into the new one showing stale content.
      setHighlightNote(null);
      setHighlightMark(null);
      setHighlightEditMode(false);
      setPendingNoteLocation(null);
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

  // The user's own annotations (typed directly here, or imported from a
  // .jwlibrary backup) for this chapter — `highlights` already carries them
  // (see getBibleChapterHighlights), so this is just the subset that has a
  // note attached, reshaped for the study panel's "Pessoal" tab instead of
  // needing a whole separate sidebar just to list them.
  const panelPersonalNotes = useMemo(() => {
    const withNotes = highlights
      .filter((h): h is typeof h & { note: NonNullable<(typeof h)["note"]> } => h.note !== null)
      .map((h) => ({
        id: h.note.id,
        title: h.note.title,
        content: h.note.content,
        userMarkId: h.colorIndex !== null ? h.id : null,
        colorIndex: h.colorIndex,
        verse: h.verse,
      }));
    return selectedVerse === null ? withNotes : withNotes.filter((n) => n.verse === selectedVerse);
  }, [highlights, selectedVerse]);

  // Clicking a note-less highlight used to open its own third sidebar
  // (JwlibraryHighlightNotePanel's note-less branch) — same redundancy as
  // handleViewHighlightNote below, since the Estudo panel's Pessoal tab is
  // now where every highlight/note (with or without a note) is viewed. This
  // just scopes that panel to the highlight's verse and keeps it (as
  // `highlightMark`) around for the recolor/add-note/delete controls the
  // Pessoal tab renders for it — see BibleStudyPanel's `activeHighlight`.
  const openHighlightMark = useCallback((mark: (BibleVerseHighlight & { text?: string }) | null) => {
    setHighlightMark(mark);
    setHighlightNote(null);
    setHighlightEditMode(false);
    if (mark) {
      setSelectedVerse(mark.verse);
      setStudyTab("pessoal");
      setStudyOpen(true);
    }
  }, []);

  const handleHighlightMarkColorChange = useCallback(
    (colorIndex: number) => {
      if (!highlightMark) return;
      const id = highlightMark.id;
      // Local patch, no refetch — matches handleCreateHighlight's optimistic
      // pattern above.
      setHighlightMark((prev) => (prev ? { ...prev, colorIndex } : prev));
      setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, colorIndex } : h)));
      void updateJwlibraryHighlightColor(id, colorIndex).then((result) => {
        if (result.error) notify.error("Não foi possível trocar a cor", result.error);
      });
    },
    [highlightMark]
  );

  const handleDeleteHighlightMark = useCallback(() => {
    if (!highlightMark) return;
    const id = highlightMark.id;
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    setHighlightMark(null);
    void deleteJwlibraryHighlight(id).then((result) => {
      if (result.error) notify.error("Não foi possível excluir o destaque", result.error);
    });
  }, [highlightMark]);

  const handlePickVerseSpan = useCallback(
    (verse: number, startToken: number, endToken: number, selectedText?: string) => {
      setPendingNoteLocation({
        blockType: 2,
        blockIdentifier: verse,
        location: {
          bookNumber: bookOrder,
          chapterNumber: chapter,
          // This reader always presents the Study Bible experience (the
          // permanent "Estudo" panel with cross-references/notes/footnotes,
          // never a bare plain-NWT view) — so a note/highlight made here
          // should carry the same KeySymbol the real app writes for one made
          // in its own Study Bible screen ("nwtsty"), not a bare "Nota
          // geral" (which null previously produced unconditionally, mislabeling
          // every Bible note/highlight made in this app).
          keySymbol: "nwtsty",
          mepsLanguage: null,
          issueTagNumber: null,
          mepsDocumentId: null,
          track: null,
          locationType: 0,
        },
        label: `${currentBook?.book ?? ""} ${chapter}:${verse}`,
        tokenRange: { start: startToken, end: endToken },
        selectedText,
      });
    },
    [bookOrder, chapter, currentBook]
  );

  // Selecting a span and tapping a color swatch directly creates a
  // "destaque puro" right away — no editor vault (see bible-chapter-view.tsx's
  // onCreateHighlight / jwpub-reader.tsx's mirrored handleCreateHighlight).
  // Drawn optimistically (temp `optimistic:` id) so the mark appears
  // instantly; refreshHighlights() afterward swaps it for the real row, or
  // it's rolled back on failure.
  const handleCreateHighlight = useCallback(
    (verse: number, startToken: number, endToken: number, colorIndex: number) => {
      const tempId = `optimistic:${crypto.randomUUID()}`;
      setHighlights((prev) => [...prev, { id: tempId, verse, colorIndex, startToken, endToken, note: null }]);

      void createJwlibraryHighlight({
        blockType: 2,
        blockIdentifier: verse,
        location: {
          bookNumber: bookOrder,
          chapterNumber: chapter,
          keySymbol: "nwtsty", // see the comment on the identical field above
          mepsLanguage: null,
          issueTagNumber: null,
          mepsDocumentId: null,
          track: null,
          locationType: 0,
        },
        colorIndex,
        startToken,
        endToken,
      }).then((result) => {
        if (result.error || !result.id) {
          setHighlights((prev) => prev.filter((h) => h.id !== tempId));
          notify.error("Não foi possível criar o destaque", result.error);
          return;
        }
        // See the identical comment in jwpub-reader.tsx's handleCreateHighlight
        // — patches the optimistic id in place instead of a second round trip.
        const realId = result.id;
        setHighlights((prev) => prev.map((h) => (h.id === tempId ? { ...h, id: realId } : h)));
      });
    },
    [bookOrder, chapter]
  );

  // "Adicionar nota" inside the note-less highlight panel — opens the full
  // editor vault attached to that highlight's existing UserMark.
  const handleAddNoteToHighlight = useCallback(() => {
    if (!highlightMark) return;
    setPendingNoteLocation({
      blockType: 2,
      blockIdentifier: highlightMark.verse,
      location: {
        bookNumber: bookOrder,
        chapterNumber: chapter,
        keySymbol: "nwtsty", // see the comment on the identical field above
        mepsLanguage: null,
        issueTagNumber: null,
        mepsDocumentId: null,
        track: null,
        locationType: 0,
      },
      label: `${currentBook?.book ?? ""} ${chapter}:${highlightMark.verse}`,
      existingUserMarkId: highlightMark.id,
      initialColorIndex: highlightMark.colorIndex,
    });
    setHighlightMark(null);
  }, [highlightMark, bookOrder, chapter, currentBook]);

  // Clicking a highlight/marker that already has a note used to open a
  // third sidebar (JwlibraryHighlightNotePanel's "note" branch) stacked on
  // top of the Estudo panel — but the Estudo panel already has a "Pessoal"
  // tab listing exactly this note, so that extra panel was redundant.
  // Instead, just scope the Estudo panel to this note's verse and switch it
  // to that tab; the note itself is expandable there (see BibleStudyPanel).
  const handleViewHighlightNote = useCallback((note: { verse: number }) => {
    setHighlightMark(null);
    setSelectedVerse(note.verse);
    setStudyTab("pessoal");
    setStudyOpen(true);
  }, []);

  // "Editar" on a note inside the Pessoal tab — opens the same full editor
  // vault the note-less highlight panel's "Adicionar nota" uses.
  const handleEditPersonalNote = useCallback((note: BiblePersonalNote) => {
    setHighlightNote({ id: note.id, title: note.title, content: note.content, userMarkId: note.userMarkId, colorIndex: note.colorIndex });
    setHighlightEditMode(true);
  }, []);

  // "Excluir" on a note inside the Pessoal tab — same optimistic local
  // patch as JwlibraryHighlightNotePanel's own note delete (see its
  // handleDelete): the underlying UserMark (if any) keeps existing with no
  // note, a highlight-less note entry disappears entirely.
  const handleDeletePersonalNote = useCallback((note: BiblePersonalNote) => {
    setHighlights((prev) =>
      prev
        .map((h) => (h.note?.id === note.id ? { ...h, note: null } : h))
        .filter((h) => h.colorIndex !== null || h.note !== null)
    );
    void deleteJwlibraryNote(note.id).then((result) => {
      if (result.error) notify.error("Não foi possível excluir a nota", result.error);
    });
  }, []);

  if (screen === "books") {
    return (
      // JwpubSidePanel (rendered inside BibleAppendixSurface) is a flex
      // sibling that animates its own width to push the content beside it —
      // it only does that inside a flex ROW. Without this wrapper it just
      // stacked in normal document flow, full-width, underneath the book
      // grid instead of opening as a side panel next to it.
      <div className="flex min-h-dvh w-full flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <BibleTopHeader title="Bíblia" userEmail={userEmail} />
          <BibleBookGrid
            books={books}
            onSelectBook={pickBook}
            appendixHeaders={appendixHeaders}
            onSelectAppendix={setOpenAppendixId}
          />
        </div>
        <BibleAppendixSurface
          mepsDocumentId={openAppendixId}
          onClose={() => setOpenAppendixId(null)}
          onOpenAppendix={setOpenAppendixId}
          onOpenBibleRef={(refBookOrder, refChapter, refVerse) => {
            setOpenAppendixId(null);
            enterReading(refBookOrder, refChapter, refVerse);
          }}
        />
      </div>
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
              onCreateHighlight={handleCreateHighlight}
              onVerseSelected={handleVerseSelected}
              highlights={highlights}
              onHighlightNote={handleViewHighlightNote}
              onHighlightMark={openHighlightMark}
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
        personalNotes={panelPersonalNotes}
        onEditPersonalNote={handleEditPersonalNote}
        onDeletePersonalNote={handleDeletePersonalNote}
        activeHighlight={highlightMark}
        onCloseActiveHighlight={() => setHighlightMark(null)}
        onAddNoteToActiveHighlight={handleAddNoteToHighlight}
        onColorChangeActiveHighlight={handleHighlightMarkColorChange}
        onDeleteActiveHighlight={handleDeleteHighlightMark}
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
        onHighlightColorChanged={(userMarkId, colorIndex) => {
          setHighlights((prev) => prev.map((h) => (h.id === userMarkId ? { ...h, colorIndex } : h)));
        }}
      />
    </div>
  );
}
