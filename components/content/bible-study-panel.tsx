"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { Film, Gem, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { InlineVideoCard } from "@/components/video/inline-video-card";
import { bodyToPlainText } from "@/lib/note-preview";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import type { ChapterVideo } from "@/app/(app)/bible-search-actions";
import { BibleStudyRowsSkeleton, BibleStudyVideosSkeleton } from "./bible-study-panel-skeleton";
import type {
  BibleBook,
  BibleFootnote,
  BibleStudyNote,
  CrossReference,
  CrossReferenceSource,
} from "@/app/(app)/bible-actions";
import type { BibleVerseHighlight } from "@/app/(app)/jwlibrary-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { BibleReferencesList, CROSS_REFERENCE_SOURCE_LABELS } from "./bible-references-panel";

export type BibleStudyTab = "referencias" | "notas" | "rodape" | "videos" | "pessoal";

/** A personal annotation (typed here or imported from a .jwlibrary backup), as opposed to `BibleStudyNote`'s official JW.org commentary. */
export interface BiblePersonalNote {
  id: string;
  title: string;
  content: string;
  userMarkId: string | null;
  colorIndex: number | null;
}

/** Whatever verse each item belongs to — needed for the whole-chapter view's headings. */
type WithVerse<T> = T & { verse: number | null };

interface BibleStudyPanelProps {
  open: boolean;
  onClose: () => void;
  tab: BibleStudyTab;
  onTabChange: (tab: BibleStudyTab) => void;

  bookName: string;
  chapter: number;
  /** `null` means "nothing tapped yet" — the panel then shows the whole chapter instead of an empty state. */
  selectedVerse: number | null;
  /** Clears the verse filter and goes back to the whole-chapter view. */
  onClearVerse: () => void;
  /** Narrows the panel to one verse — the whole-chapter view's headings. */
  onSelectVerse: (verse: number) => void;

  refs: WithVerse<CrossReference>[];
  refsLoading: boolean;
  refsTruncated: boolean;
  refsSource: CrossReferenceSource;
  onChangeRefsSource: (source: CrossReferenceSource) => void;
  books: BibleBook[];
  onSelectReference: (bookOrder: number, chapter: number, verse: number) => void;

  footnotes: WithVerse<BibleFootnote>[];
  studyNotes: BibleStudyNote[];
  studyLoading: boolean;

  /** A `data-bible-ref` link inside a study note or footnote was clicked. */
  onOpenBibleRef: (bookOrder: number, chapter: number, verse: number) => void;
  /** A `data-bible-appendix-ref` link inside a study note was clicked — 422 of them exist. */
  onOpenAppendix: (mepsDocumentId: number) => void;

  /** JW.org videos whose title or transcript cites this chapter — already scoped to `selectedVerse` by the caller. */
  videos: ChapterVideo[];
  videosLoading: boolean;

  personalNotes: WithVerse<BiblePersonalNote>[];
  /** "Editar" on an expanded personal note — opens the full editor vault. */
  onEditPersonalNote: (note: BiblePersonalNote) => void;
  /** "Excluir" on an expanded personal note, after the inline confirm below. */
  onDeletePersonalNote: (note: BiblePersonalNote) => void;

  /** The highlight just tapped in the reader, when it has no note yet — shown as a dismissible recolor/add-note/delete card at the top of the Pessoal tab instead of its own sidebar. `null` when nothing was just tapped. */
  activeHighlight?: (BibleVerseHighlight & { text?: string }) | null;
  onCloseActiveHighlight?: () => void;
  onAddNoteToActiveHighlight?: () => void;
  onColorChangeActiveHighlight?: (colorIndex: number) => void;
  onDeleteActiveHighlight?: () => void;
}

/**
 * Renders content_html straight from the database.
 *
 * `dangerouslySetInnerHTML` is safe here for the same reason it is in the
 * .jwpub reader: this HTML was rewritten (jwpub:// → inert `data-*`) and run
 * through DOMPurify at SEED time, before it was ever persisted — see
 * scripts/bible-study-html.mjs. The database only holds trusted markup, so
 * this component is a plain renderer and never has to sanitize at read time.
 */
function StudyHtml({ html }: { html: string }) {
  return (
    <div
      className="text-[13.5px] leading-relaxed text-foreground/90 [&_a]:cursor-pointer [&_a]:text-accent [&_a]:underline-offset-2 [&_a:hover]:underline [&_em]:italic [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_strong]:text-foreground"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Groups items by verse number, preserving the order they arrived in. */
function groupByVerse<T extends { verse: number | null }>(items: T[]): { verse: number | null; items: T[] }[] {
  const groups: { verse: number | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.verse === item.verse) last.items.push(item);
    else groups.push({ verse: item.verse, items: [item] });
  }
  return groups;
}

/** Clickable heading above each verse's block in the whole-chapter view. */
function VerseHeading({ verse, onClick }: { verse: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sticky top-0 z-10 -mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-1.5 bg-[#161413] px-1 py-1.5 text-left font-mono text-[11px] tracking-[0.04em] text-accent transition-colors hover:text-foreground"
    >
      {verse === null ? "sobrescrito" : `versículo ${verse}`}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted-foreground">{children}</p>;
}

/** "Salmo 37:11", "Salmo 37:11, 29", or just the chapter when the reference names no verse. */
function formatVideoVerses(chapter: number, verses: number[]): string {
  if (verses.length === 0) return `capítulo ${chapter}`;
  return `versículo${verses.length > 1 ? "s" : ""} ${verses.join(", ")}`;
}

interface VideoRowProps {
  video: ChapterVideo;
  chapter: number;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * How many "mencionam" rows show before the "ver todos" link. Romanos 12 is
 * cited by 69 different talks, and dropping all of them into a 420px panel
 * buries the handful of videos actually *about* the chapter under four
 * thousand pixels of scrolling.
 */
const MENTION_PREVIEW_COUNT = 8;

/** One video in the Vídeos tab: a compact row that expands in place into the real player. */
function VideoRow({ video, chapter, expanded, onToggle }: VideoRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex items-start gap-2.5 rounded-2xl px-2.5 py-2.5 text-left transition-colors",
          expanded ? "bg-surface-elevated" : "bg-secondary hover:bg-surface-elevated"
        )}
      >
        <span className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-lg bg-black/50">
          {video.coverImage && (
            // eslint-disable-next-line @next/next/no-img-element -- JW.org CDN host, not a local asset Next can optimize
            <img src={video.coverImage} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <Play className="size-3.5 text-white/90 drop-shadow" />
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[12.5px] leading-snug text-foreground/90">{video.title}</span>
          <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground">
            {formatVideoVerses(chapter, video.verses)}
            {video.durationFormatted ? ` · ${video.durationFormatted}` : ""}
          </span>
        </span>
      </button>

      {expanded && (
        <InlineVideoCard
          videoId={video.videoId}
          title={video.title}
          videoUrl={video.videoUrl ?? undefined}
          coverImage={video.coverImage ?? undefined}
          durationFormatted={video.durationFormatted ?? undefined}
          subtitlesUrl={video.subtitlesUrl ?? undefined}
          snippet={video.snippet ?? undefined}
        />
      )}
    </div>
  );
}

interface MentionListProps {
  videos: ChapterVideo[];
  chapter: number;
  openVideoId: string | null;
  onToggleVideo: (videoId: string) => void;
}

/** The "mencionam" section, collapsed to its first few rows until asked to expand. */
function MentionList({ videos, chapter, openVideoId, onToggleVideo }: MentionListProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? videos : videos.slice(0, MENTION_PREVIEW_COUNT);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">
        mencionam ({videos.length})
      </span>
      {visible.map((video) => (
        <VideoRow
          key={`transcript-${video.videoId}`}
          video={video}
          chapter={chapter}
          expanded={openVideoId === video.videoId}
          onToggle={() => onToggleVideo(video.videoId)}
        />
      ))}
      {!showAll && videos.length > MENTION_PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start rounded-full px-2 py-1 text-[12px] text-accent transition-colors hover:bg-accent/10"
        >
          Ver os outros {videos.length - MENTION_PREVIEW_COUNT}
        </button>
      )}
    </div>
  );
}

/**
 * The reader's study surface: cross references, study notes and footnotes,
 * behind one header toggle instead of three. Same `JwpubSidePanel` shell as
 * the .jwpub reader's footnotes — Vault sheet on mobile, content-pushing
 * panel on desktop, never a modal (see CLAUDE.md).
 *
 * With no verse tapped, every tab shows the WHOLE chapter grouped by verse,
 * rather than an "escolha um versículo" placeholder — opening the panel is
 * then immediately useful, and each verse heading narrows to that verse.
 *
 * Study notes only exist for Mateus–Filêmon (minus Tito), so an empty Notas
 * tab is the normal case for most of the Bible, not an error.
 */
export function BibleStudyPanel({
  open,
  onClose,
  tab,
  onTabChange,
  bookName,
  chapter,
  selectedVerse,
  onClearVerse,
  onSelectVerse,
  refs,
  refsLoading,
  refsTruncated,
  refsSource,
  onChangeRefsSource,
  books,
  onSelectReference,
  footnotes,
  studyNotes,
  studyLoading,
  onOpenBibleRef,
  onOpenAppendix,
  videos,
  videosLoading,
  personalNotes,
  onEditPersonalNote,
  onDeletePersonalNote,
  activeHighlight = null,
  onCloseActiveHighlight,
  onAddNoteToActiveHighlight,
  onColorChangeActiveHighlight,
  onDeleteActiveHighlight,
}: BibleStudyPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Which personal note (if any) is expanded inline — clicking a note used
  // to open a whole separate sidebar (JwlibraryHighlightNotePanel) for
  // exactly the content already listed here; expanding in place instead
  // means this tab is the one place to view/edit/delete a personal note.
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<BiblePersonalNote | null>(null);
  const [confirmDeleteHighlight, setConfirmDeleteHighlight] = useState(false);
  // Which video is expanded into a real player. One at a time — the panel is
  // 420px wide and two <video> elements side by side would both be tiny and
  // both be downloading.
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);

  // Delegated click for the `data-bible-ref="book:chapter:verse"` and
  // `data-bible-appendix-ref` links the seed left inside study notes and
  // footnotes. One listener on the container rather than rehydrating every
  // <a> into a React component — the HTML is injected as a string, so there
  // are no React nodes to attach to.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;

      const appendixLink = target?.closest<HTMLElement>("[data-bible-appendix-ref]");
      if (appendixLink) {
        const id = Number(appendixLink.dataset.bibleAppendixRef);
        if (Number.isFinite(id)) {
          event.preventDefault();
          onOpenAppendix(id);
        }
        return;
      }

      const anchor = target?.closest<HTMLElement>("[data-bible-ref]");
      if (!anchor) return;
      const parts = (anchor.dataset.bibleRef ?? "").split(":").map(Number);
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return;
      event.preventDefault();
      onOpenBibleRef(parts[0], parts[1], parts[2]);
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [onOpenBibleRef, onOpenAppendix]);

  const whole = selectedVerse === null;
  const scopeLabel = whole ? `${bookName} ${chapter}` : `${bookName} ${chapter}:${selectedVerse}`;

  const refGroups = useMemo(() => groupByVerse(refs), [refs]);
  const footnoteGroups = useMemo(() => groupByVerse(footnotes), [footnotes]);
  const studyNoteGroups = useMemo(() => groupByVerse(studyNotes), [studyNotes]);
  const personalNoteGroups = useMemo(() => groupByVerse(personalNotes), [personalNotes]);

  // "Tema" primeiro, "mencionam" depois — um discurso construído em cima do
  // capítulo vale muito mais para quem está lendo do que um que leu dois
  // versículos daqui de passagem, e misturar os dois numa lista só faria o
  // primeiro sumir no meio dos outros.
  const themeVideos = useMemo(() => videos.filter((v) => v.source === "title"), [videos]);
  const mentionVideos = useMemo(() => videos.filter((v) => v.source === "transcript"), [videos]);

  // A superscription has no verse number, so its heading is a label, not a
  // filter target — there is nothing to narrow to.
  const narrow = (verse: number | null) => () => {
    if (verse !== null) onSelectVerse(verse);
  };

  return (
    <>
    <JwpubSidePanel open={open} title="Estudo" onClose={onClose} width={420}>
      <div ref={contentRef} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-[0.04em] text-accent">{scopeLabel}</span>
          {!whole && (
            <button
              type="button"
              onClick={onClearVerse}
              className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              ver capítulo
            </button>
          )}
        </div>

        <Tabs value={tab} onValueChange={(value) => onTabChange(value as BibleStudyTab)}>
          {/* Cinco abas dentro de um painel de 420px: sem apertar a fonte e o
              espaçamento, a quinta ("Vídeos") estoura a linha em vez de
              caber, já que os gatilhos usam whitespace-nowrap. */}
          <TabsList className="w-full [&_[data-slot=tabs-trigger]]:px-1 [&_[data-slot=tabs-trigger]]:text-[12.5px]">
            <TabsTrigger value="referencias">
              Refs
              {refs.length > 0 && <span className="ml-1 font-mono text-[10px] text-accent">{refs.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="notas">
              Notas
              {studyNotes.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-accent">{studyNotes.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="rodape">
              Rodapé
              {footnotes.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-accent">{footnotes.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="videos">
              <Film className="size-3" />
              Vídeos
              {videos.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-accent">{videos.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="pessoal">
              <Gem className="size-3" />
              Pessoal
              {personalNotes.length > 0 && (
                <span className="ml-1 font-mono text-[10px] text-accent">{personalNotes.length}</span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="referencias" className="flex flex-col gap-3">
            <div className="flex items-center gap-0.5 self-start rounded-full bg-secondary p-0.5">
              {(Object.keys(CROSS_REFERENCE_SOURCE_LABELS) as CrossReferenceSource[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onChangeRefsSource(option)}
                  aria-pressed={refsSource === option}
                  className={cn(
                    "rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.04em] transition-colors",
                    refsSource === option
                      ? "bg-primary/[0.18] text-accent"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {CROSS_REFERENCE_SOURCE_LABELS[option]}
                </button>
              ))}
            </div>

            {refsTruncated && (
              <p className="text-[11.5px] leading-snug text-muted-foreground">
                Capítulo com muitas referências — mostrando as primeiras {refs.length}. Toque num versículo
                para ver todas as dele.
              </p>
            )}

            {refsLoading ? (
              <BibleStudyRowsSkeleton />
            ) : refs.length === 0 ? (
              <EmptyHint>
                {whole ? "Este capítulo não tem referências." : "Este versículo não tem referências."}
              </EmptyHint>
            ) : whole ? (
              <div className="flex flex-col gap-3">
                {refGroups.map((group) => (
                  <div key={group.verse ?? "sup"} className="flex flex-col gap-1.5">
                    <VerseHeading verse={group.verse} onClick={narrow(group.verse)} />
                    <BibleReferencesList
                      refs={group.items}
                      books={books}
                      onSelectReference={onSelectReference}
                      cacheKeyPrefix={`v${group.verse}-`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <BibleReferencesList refs={refs} books={books} onSelectReference={onSelectReference} />
            )}
          </TabsContent>

          <TabsContent value="notas">
            {studyLoading ? (
              <BibleStudyRowsSkeleton />
            ) : studyNotes.length === 0 ? (
              <EmptyHint>
                {whole
                  ? "Este capítulo não tem notas de estudo."
                  : "Este versículo não tem notas de estudo."}
              </EmptyHint>
            ) : (
              <div className="flex flex-col gap-3">
                {studyNoteGroups.map((group) => (
                  <div key={group.verse ?? "sup"} className="flex flex-col gap-1.5">
                    {whole && <VerseHeading verse={group.verse} onClick={narrow(group.verse)} />}
                    {group.items.map((note) => (
                      <div key={note.id} className="rounded-2xl bg-secondary px-4 py-3">
                        <StudyHtml html={note.contentHtml} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rodape">
            {studyLoading ? (
              <BibleStudyRowsSkeleton withIndex />
            ) : footnotes.length === 0 ? (
              <EmptyHint>
                {whole ? "Este capítulo não tem notas de rodapé." : "Este versículo não tem notas de rodapé."}
              </EmptyHint>
            ) : (
              <div className="flex flex-col gap-3">
                {footnoteGroups.map((group) => (
                  <div key={group.verse ?? "sup"} className="flex flex-col gap-1.5">
                    {whole && <VerseHeading verse={group.verse} onClick={narrow(group.verse)} />}
                    <ul className="flex flex-col gap-1.5">
                      {group.items.map((footnote, index) => (
                        <li key={footnote.id} className="flex gap-2.5 rounded-2xl bg-secondary px-4 py-3">
                          {/* Numbered by position within the verse — the stored
                              `index` is sequential per BOOK (it mirrors the
                              source's data-fnid), so showing it raw would print
                              "389" next to the last footnote of Genesis. */}
                          <span className="mt-0.5 font-mono text-[10px] text-accent">{index + 1}</span>
                          <StudyHtml html={footnote.contentHtml} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="videos" className="flex flex-col gap-4">
            {videosLoading ? (
              <BibleStudyVideosSkeleton />
            ) : videos.length === 0 ? (
              <EmptyHint>
                {whole
                  ? "Nenhum vídeo do JW.org cita este capítulo."
                  : "Nenhum vídeo do JW.org cita este versículo."}
              </EmptyHint>
            ) : (
              <>
                {themeVideos.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10.5px] tracking-[0.04em] text-accent">
                      tema do vídeo
                    </span>
                    {themeVideos.map((video) => (
                      <VideoRow
                        key={`title-${video.videoId}`}
                        video={video}
                        chapter={chapter}
                        expanded={openVideoId === video.videoId}
                        onToggle={() =>
                          setOpenVideoId(openVideoId === video.videoId ? null : video.videoId)
                        }
                      />
                    ))}
                  </div>
                )}

                {mentionVideos.length > 0 && (
                  // A chave inclui o escopo para que trocar de capítulo ou de
                  // versículo remonte a lista e volte a mostrá-la recolhida —
                  // sem precisar de um efeito só para zerar esse estado.
                  <MentionList
                    key={`${bookName}-${chapter}-${selectedVerse ?? "all"}`}
                    videos={mentionVideos}
                    chapter={chapter}
                    openVideoId={openVideoId}
                    onToggleVideo={(videoId) =>
                      setOpenVideoId(openVideoId === videoId ? null : videoId)
                    }
                  />
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="pessoal" className="flex flex-col gap-3">
            {activeHighlight && (
              <div className="flex flex-col gap-3 rounded-2xl bg-secondary px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] tracking-[0.04em] text-accent">Destaque</span>
                  <button
                    type="button"
                    onClick={onCloseActiveHighlight}
                    aria-label="Fechar destaque"
                    className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {activeHighlight.text && (
                  <blockquote className="rounded-xl border-l-2 border-accent/50 bg-surface px-3 py-2 text-[13px] italic leading-relaxed text-muted-foreground">
                    “{activeHighlight.text}”
                  </blockquote>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] text-muted-foreground">Cor do destaque</span>
                  <div className="flex items-center gap-1.5">
                    {Object.entries(JWLIBRARY_HIGHLIGHT_COLORS).map(([index, color]) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => onColorChangeActiveHighlight?.(Number(index))}
                        aria-label={color.name}
                        title={color.name}
                        className="size-7 shrink-0 rounded-full border-2 transition-transform hover:scale-110 active:scale-95"
                        style={{
                          backgroundColor: color.hex,
                          borderColor: activeHighlight.colorIndex === Number(index) ? "var(--foreground)" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={onAddNoteToActiveHighlight}
                    className="flex items-center gap-1.5 self-start rounded-full px-2 py-1.5 text-[13px] text-accent transition-colors hover:bg-accent/10"
                  >
                    <Plus className="size-3.5" />
                    Adicionar nota
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteHighlight(true)}
                    className="flex items-center gap-1.5 self-start rounded-full px-2 py-1.5 text-[13px] text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" />
                    Excluir destaque
                  </button>
                </div>
              </div>
            )}

            {personalNotes.length === 0 ? (
              <EmptyHint>
                {whole
                  ? "Este capítulo não tem notas pessoais."
                  : "Este versículo não tem notas pessoais."}
              </EmptyHint>
            ) : (
              <div className="flex flex-col gap-3">
                {personalNoteGroups.map((group) => (
                  <div key={group.verse ?? "sup"} className="flex flex-col gap-1.5">
                    {whole && <VerseHeading verse={group.verse} onClick={narrow(group.verse)} />}
                    {group.items.map((note) => {
                      const expanded = expandedNoteId === note.id;
                      return (
                        <div key={note.id} className="rounded-2xl bg-secondary px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedNoteId(expanded ? null : note.id)}
                            className="flex w-full flex-col gap-1 text-left"
                          >
                            {note.title && (
                              <span className="text-[13px] font-medium text-foreground/90">{note.title}</span>
                            )}
                            {/* note.content is Tiptap HTML (or plain text
                                imported from JW Library) — never raw text, so
                                the collapsed preview strips tags instead of
                                printing them literally. */}
                            {!expanded && note.content && (
                              <span className="line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
                                {bodyToPlainText(note.content)}
                              </span>
                            )}
                          </button>
                          {expanded && (
                            <>
                              {note.content && (
                                <div
                                  className="mt-1 text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2"
                                  dangerouslySetInnerHTML={{
                                    __html: DOMPurify.sanitize(note.content, { USE_PROFILES: { html: true } }),
                                  }}
                                />
                              )}
                              <div className="mt-2 flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => onEditPersonalNote(note)}
                                  aria-label="Editar nota"
                                  className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                                >
                                  <Pencil className="size-3.5" />
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteNote(note)}
                                  aria-label="Excluir nota"
                                  className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-destructive transition-colors hover:bg-destructive/10"
                                >
                                  <Trash2 className="size-3.5" />
                                  Excluir
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </JwpubSidePanel>

    <ConfirmVault
      open={confirmDeleteNote !== null}
      onOpenChange={(next) => {
        if (!next) setConfirmDeleteNote(null);
      }}
      title="Excluir nota?"
      description="Essa ação não pode ser desfeita."
      confirmLabel="Excluir"
      onConfirm={() => {
        if (confirmDeleteNote) onDeletePersonalNote(confirmDeleteNote);
        setConfirmDeleteNote(null);
        setExpandedNoteId(null);
      }}
    />

    <ConfirmVault
      open={confirmDeleteHighlight}
      onOpenChange={setConfirmDeleteHighlight}
      title="Excluir destaque?"
      description="Essa ação não pode ser desfeita."
      confirmLabel="Excluir"
      onConfirm={() => {
        setConfirmDeleteHighlight(false);
        onDeleteActiveHighlight?.();
      }}
    />
    </>
  );
}
