"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FoldVertical, Loader2, UnfoldVertical } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { IngestProgress } from "@/lib/store/ingest-progress-store";
import { notify } from "@/components/ui/toaster";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
import { excerptOfChapter } from "@/lib/notes/cited-excerpt";
import { ChapterSubheadingsButton } from "./chapter-subheadings";
import { downloadAndIngestPublication } from "@/lib/jwpub/download-publication";
import { getWolArticle } from "@/app/(app)/wol-lookup-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { RsvpButton } from "@/components/content/rsvp-button";
import { SidebarHighlightedHtml } from "./sidebar-highlighted-html";
import { ReferenceContentSkeleton } from "./reference-surface-skeleton";

export interface JwpubReferenceTarget {
  /** `null` for a shared global publication (Perspicaz etc.) — there's no per-user note to open, so "abrir publicação completa" is hidden. */
  noteId: string | null;
  publicationTitle: string;
  chapterTitle: string;
  documentId: number;
  /** The document's global MepsDocumentId — lets the panel show the user's highlights and notes on it. */
  mepsDocumentId?: number | null;
  /** The cited paragraph, if the reference carried one — scrolled to and briefly highlighted once the content renders. Best-effort: a miss just means no scroll, not a bug. */
  pid?: string;
  /** The cited pages as paragraph ids — when set, only those are shown until the whole chapter is asked for. */
  citedRange?: [number, number] | null;
  /** The citation as typed ("jv 631-633"), shown under the title. */
  query?: string;
}

interface JwpubReferenceSurfaceProps {
  open: boolean;
  /** Bump to bring the panel back to the top when it is asked for again while already open. */
  raiseKey?: number;
  target: JwpubReferenceTarget | null;
  html: string | null;
  isLoading: boolean;
  /** Shown instead of the content when the reference could not be resolved at all (e.g. the publication is not in this user's library). */
  error?: string | null;
  /**
   * The citation's own `MepsDocumentId`, carried whenever `target` is `null`
   * because nothing in this user's library resolves it — lets the panel
   * offer "Baixar" (see downloadAndIngestPublication) instead of just an
   * error. Omitted (or `undefined`) when the caller has no such id to offer
   * — e.g. a citation shape this app doesn't parse a MepsDocumentId out of.
   */
  unresolvedMepsDocumentId?: number | null;
  /** Paragraph of that unresolved publication the citation points at — the WOL text scrolls to it. */
  unresolvedPid?: string | null;
  /** The cited paragraphs saved in the note — shown right away, no network. */
  unresolvedSnapshot?: string | null;
  /** The citation as typed ("w24.01 32"), shown under the title. */
  unresolvedQuery?: string | null;
  /** Called after a successful download — the caller re-resolves and reopens with the newly-available `target`, same click, no re-navigation needed. */
  onResolved?: (mepsDocumentId: number, noteId: string) => void;
  onClose: () => void;
}

/** Download state lives in the surface (not the body) so the header's icon button and the body's progress bar share it. */
function usePublicationDownload(
  mepsDocumentId: number | null | undefined,
  onResolved?: (mepsDocumentId: number, noteId: string) => void
) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<IngestProgress | null>(null);

  async function download() {
    if (!mepsDocumentId || isDownloading) return;
    setIsDownloading(true);
    setProgress({ stage: "Iniciando", percent: 0 });
    try {
      const result = await downloadAndIngestPublication(mepsDocumentId, setProgress);
      if (!result.ok || !result.noteId) {
        notify.error("Não foi possível baixar", result.error);
        return;
      }
      notify.success(`"${result.title ?? "Publicação"}" baixada`);
      onResolved?.(mepsDocumentId, result.noteId);
    } finally {
      setIsDownloading(false);
      setProgress(null);
    }
  }

  return { isDownloading, progress, download };
}

function DownloadPrompt({
  mepsDocumentId,
  pid,
  snapshot,
  progress,
  onArticleHtml,
}: {
  mepsDocumentId: number;
  pid?: string | null;
  snapshot?: string | null;
  progress: IngestProgress | null;
  /** The full WOL article now on screen (null when it isn't) — the header lists its subheadings. */
  onArticleHtml: (html: string | null) => void;
}) {

  // The publication isn't in the library, but WOL has the text: show it now,
  // and keep "Baixar" for when the user wants it in the library for good.
  const [article, setArticle] = useState<{ id: number; html: string | null } | null>(null);
  // With a copy saved in the note the full article is only fetched on request.
  const [wantsFullArticle, setWantsFullArticle] = useState(false);
  const fetchArticle = !snapshot || wantsFullArticle;
  useEffect(() => {
    if (!fetchArticle) return;
    let cancelled = false;
    getWolArticle(mepsDocumentId)
      .then((result) => {
        if (!cancelled) setArticle({ id: mepsDocumentId, html: result.html ?? null });
      })
      .catch(() => {
        if (!cancelled) setArticle({ id: mepsDocumentId, html: null });
      });
    return () => {
      cancelled = true;
    };
  }, [mepsDocumentId, fetchArticle]);
  const loadingArticle = fetchArticle && article?.id !== mepsDocumentId;
  const articleRef = useRef<HTMLDivElement>(null);

  const shownHtml = article?.id === mepsDocumentId ? article.html : null;
  useEffect(() => {
    onArticleHtml(shownHtml);
    return () => onArticleHtml(null);
  }, [shownHtml, onArticleHtml]);

  // Images come straight from wol.jw.org; offline (or on a miss) they would show a broken-image icon with
  // alt text, so a failed one is hidden. `error` doesn't bubble, hence the capture-phase listener.
  const hasArticleHtml = Boolean(article?.html);
  useEffect(() => {
    const el = articleRef.current;
    if (!el) return;
    const hide = (event: Event) => {
      if (event.target instanceof HTMLImageElement) event.target.style.display = "none";
    };
    el.addEventListener("error", hide, true);
    return () => el.removeEventListener("error", hide, true);
  }, [hasArticleHtml, fetchArticle]);

  // Scroll to (and briefly mark) the cited paragraph once the text is on screen.
  useEffect(() => {
    if (!pid || !fetchArticle || !article?.html || article.id !== mepsDocumentId) return;
    const el = articleRef.current?.querySelector<HTMLElement>(`[data-pid="${CSS.escape(pid)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-accent", "bg-accent/20", "rounded-xl", "p-2.5", "transition-all", "duration-500");
    const timer = setTimeout(() => el.classList.remove("ring-2", "ring-accent", "bg-accent/20"), 4500);
    return () => clearTimeout(timer);
  }, [article, pid, mepsDocumentId, fetchArticle]);

  return (
    <div className="flex flex-col items-start gap-3">
      {snapshot && !wantsFullArticle && (
        <>
          <div className="w-full">
            <SidebarHighlightedHtml
              html={sanitizeChapterHtml(snapshot)}
              mepsDocumentId={mepsDocumentId}
              className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_strong]:font-semibold"
            />
          </div>
          <p className="text-[12px] text-muted-foreground">
            Trecho salvo na sua nota — disponível offline.{" "}
            <button
              type="button"
              onClick={() => setWantsFullArticle(true)}
              className="underline underline-offset-2 transition-colors hover:text-foreground"
            >
              Ver artigo inteiro
            </button>
          </p>
        </>
      )}
      {loadingArticle ? (
        <div className="w-full" role="status" aria-label="Carregando do WOL">
          <ReferenceContentSkeleton paragraphs={4} withHeading />
        </div>
      ) : article?.html ? (
        <div ref={articleRef} className="w-full">
          <SidebarHighlightedHtml
            html={sanitizeChapterHtml(article.html)}
            mepsDocumentId={mepsDocumentId}
            // WOL names the publication on the article element ("pub-jv").
            symbolHint={/\bpub-([a-z][a-z0-9-]*)/.exec(article.html)?.[1] ?? null}
            className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_strong]:font-semibold"
          />
        </div>
      ) : null}
      {!snapshot && !article?.html && !loadingArticle && (
        <p className="text-[13.5px] text-muted-foreground">
          Essa publicação ainda não está na sua biblioteca. Use o ícone de download no topo para trazer ela do jw.org.
        </p>
      )}
      {progress && (
        <div className="flex w-full max-w-xs flex-col gap-1.5" role="status" aria-live="polite">
          <Progress value={progress.percent} />
          <p className="font-mono text-[11px] text-muted-foreground">
            {progress.percent}% · {progress.stage}
          </p>
        </div>
      )}
    </div>
  );
}

function Body({
  target,
  html,
  isLoading,
  error,
  unresolvedMepsDocumentId,
  unresolvedPid,
  unresolvedSnapshot,
  downloadProgress,
  safeHtml,
  excerpt,
  showingExcerpt,
  onArticleHtml,
}: {
  target: JwpubReferenceTarget | null;
  html: string | null;
  isLoading: boolean;
  error?: string | null;
  unresolvedMepsDocumentId?: number | null;
  unresolvedPid?: string | null;
  unresolvedSnapshot?: string | null;
  downloadProgress: IngestProgress | null;
  safeHtml: string;
  /** The cited pages alone, when the reference named some and the chapter has them. */
  excerpt: string | null;
  showingExcerpt: boolean;
  onArticleHtml: (html: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Same scroll-and-flash treatment JwpubChapterView gives its own `?pid=`
  // deep link — best-effort, since the cited paragraph number isn't
  // guaranteed to line up with the target document's own `data-pid`s.
  useEffect(() => {
    if (!target?.pid || !html || showingExcerpt) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-pid="${target.pid}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-accent", "bg-accent/20", "rounded-xl", "p-2.5", "transition-all", "duration-500");
    const timer = setTimeout(() => el.classList.remove("ring-2", "ring-accent", "bg-accent/20"), 4500);
    return () => clearTimeout(timer);
  }, [html, target?.pid, showingExcerpt]);

  if (isLoading) {
    return (
      <ReferenceContentSkeleton paragraphs={4} withHeading />
    );
  }

  if (!target || !html) {
    if (!error && unresolvedMepsDocumentId) {
      return <DownloadPrompt mepsDocumentId={unresolvedMepsDocumentId} pid={unresolvedPid} snapshot={unresolvedSnapshot} progress={downloadProgress} onArticleHtml={onArticleHtml} />;
    }
    return <p className="text-[13.5px] text-muted-foreground">{error ?? "Conteúdo não encontrado."}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={containerRef}>
        {/* The user's own highlights, with a square in the margin for each note — tapping one opens it right here (see SidebarHighlightedHtml). */}
        <SidebarHighlightedHtml
          key={showingExcerpt ? "excerpt" : "chapter"}
          html={showingExcerpt && excerpt !== null ? excerpt : safeHtml}
          mepsDocumentId={target.mepsDocumentId ?? null}
          className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_img]:my-2 [&_img]:max-w-full"
        />
      </div>
    </div>
  );
}

/**
 * Same side-panel-on-desktop/Vault-on-mobile shell as footnotes — opened by
 * tapping a `data-jwpub-pubref` cross-reference (e.g. "th study 5"). Renders
 * one of three states: the resolved content (already in this user's
 * library), a loading placeholder, or — when `unresolvedMepsDocumentId` is
 * given — a "Baixar" prompt that fetches the publication from jw.org and
 * ingests it in place (see downloadAndIngestPublication).
 */
export function JwpubReferenceSurface({
  open,
  target,
  html,
  isLoading,
  error,
  unresolvedMepsDocumentId,
  unresolvedPid,
  unresolvedSnapshot,
  unresolvedQuery,
  onResolved,
  onClose,
  raiseKey,
}: JwpubReferenceSurfaceProps) {
  const { isDownloading, progress, download } = usePublicationDownload(unresolvedMepsDocumentId, onResolved);
  const router = useRouter();
  const canDownload = !isLoading && !error && !(target && html) && Boolean(unresolvedMepsDocumentId);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [wholeChapterFor, setWholeChapterFor] = useState<JwpubReferenceTarget | null>(null);
  const [articleHtml, setArticleHtml] = useState<string | null>(null);

  const safeHtml = useMemo(() => (html ? sanitizeChapterHtml(html) : ""), [html]);
  const citedRange = target?.citedRange ?? null;
  const excerpt = useMemo(
    () => (safeHtml && citedRange ? excerptOfChapter(safeHtml, citedRange) : null),
    [safeHtml, citedRange]
  );
  const showingExcerpt = excerpt !== null && wholeChapterFor !== target;

  function goToSubheading(pid: string) {
    setWholeChapterFor(target);
    // After the Vault has slid away (and the whole chapter, if only the excerpt was showing, is on screen).
    setTimeout(() => {
      bodyRef.current?.querySelector(`[data-pid="${CSS.escape(pid)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
  }

  return (
    <JwpubSidePanel
      open={open}
      title={target ? `${target.publicationTitle} — ${target.chapterTitle}` : "Referência"}
      subtitle={target ? target.query : unresolvedQuery}
      headerActions={
        <>
          <RsvpButton
            size="sm"
            title={target ? `${target.publicationTitle} — ${target.chapterTitle}` : "Referência"}
            html={html}
          />
          <ChapterSubheadingsButton html={target ? html : articleHtml} onSelect={goToSubheading} />
          {excerpt !== null && (
            <button
              type="button"
              onClick={() => setWholeChapterFor(showingExcerpt ? target : null)}
              aria-label={showingExcerpt ? "Ver capítulo inteiro" : "Só o trecho citado"}
              title={showingExcerpt ? "Ver capítulo inteiro" : "Só o trecho citado"}
              aria-pressed={!showingExcerpt}
              className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {showingExcerpt ? <UnfoldVertical className="size-4" /> : <FoldVertical className="size-4" />}
            </button>
          )}
          {target?.noteId && html ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push(`/notes/${target.noteId}?doc=${target.documentId}`);
              }}
              aria-label="Abrir publicação completa"
              title="Abrir publicação completa"
              className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ExternalLink className="size-4" />
            </button>
          ) : null}
          {canDownload ? (
          <button
            type="button"
            onClick={() => void download()}
            disabled={isDownloading}
            aria-label="Baixar publicação"
            title="Baixar publicação para a biblioteca — com marcações e leitura offline"
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
          >
            {isDownloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          </button>
          ) : null}
        </>
      }
      onClose={onClose}
      raiseKey={raiseKey}
    >
      {/* data-page-markers: the printed page numbers show in the margin (globals.css). */}
      <div ref={bodyRef} data-page-markers>
      <Body
        safeHtml={safeHtml}
        excerpt={excerpt}
        showingExcerpt={showingExcerpt}
        onArticleHtml={setArticleHtml}
        target={target}
        html={html}
        isLoading={isLoading}
        error={error}
        unresolvedMepsDocumentId={unresolvedMepsDocumentId}
        unresolvedPid={unresolvedPid}
        unresolvedSnapshot={unresolvedSnapshot}
        downloadProgress={progress}
      />
      </div>
    </JwpubSidePanel>
  );
}
