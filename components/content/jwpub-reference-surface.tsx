"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { IngestProgress } from "@/lib/store/ingest-progress-store";
import { notify } from "@/components/ui/toaster";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
import { downloadAndIngestPublication } from "@/lib/jwpub/download-publication";
import { getWolArticle } from "@/app/(app)/wol-lookup-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
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
  /** Called after a successful download — the caller re-resolves and reopens with the newly-available `target`, same click, no re-navigation needed. */
  onResolved?: (mepsDocumentId: number, noteId: string) => void;
  onClose: () => void;
}

function DownloadPrompt({
  mepsDocumentId,
  pid,
  snapshot,
  onResolved,
}: {
  mepsDocumentId: number;
  pid?: string | null;
  snapshot?: string | null;
  onResolved?: (mepsDocumentId: number, noteId: string) => void;
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<IngestProgress | null>(null);

  async function handleDownload() {
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
          <div
            className="w-full text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(snapshot) }}
          />
          <p className="text-[12.5px] text-muted-foreground">Trecho salvo na sua nota — disponível offline.</p>
          <Button variant="outline" size="sm" onClick={() => setWantsFullArticle(true)}>
            Ver artigo inteiro
          </Button>
        </>
      )}
      {loadingArticle ? (
        <div className="w-full" role="status" aria-label="Carregando do WOL">
          <ReferenceContentSkeleton paragraphs={4} withHeading />
        </div>
      ) : article?.html ? (
        <div
          ref={articleRef}
          className="w-full text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_strong]:font-semibold"
          dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(article.html) }}
        />
      ) : null}
      <p className="text-[13.5px] text-muted-foreground">
        {snapshot && !wantsFullArticle
          ? "Quer a publicação completa, com marcações e leitura offline? Baixe para a biblioteca."
          : article?.html
          ? "Texto exibido a partir do WOL. Baixe a publicação para ter ela na sua biblioteca, com marcações e leitura offline."
          : "Essa publicação ainda não está na sua biblioteca. O jw.org disponibiliza o arquivo original — dá para trazer ela para cá."}
      </p>
      <Button
        variant="outline"
        size="sm"
        isLoading={isDownloading}
        leftIcon={<Download className="size-3.5 text-accent" />}
        onClick={() => void handleDownload()}
      >
        {progress ? `Baixando… ${progress.percent}%` : "Baixar publicação"}
      </Button>
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
  onResolved,
  onClose,
}: {
  target: JwpubReferenceTarget | null;
  html: string | null;
  isLoading: boolean;
  error?: string | null;
  unresolvedMepsDocumentId?: number | null;
  unresolvedPid?: string | null;
  unresolvedSnapshot?: string | null;
  onResolved?: (mepsDocumentId: number, noteId: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const safeHtml = useMemo(() => (html ? sanitizeChapterHtml(html) : ""), [html]);

  // Same scroll-and-flash treatment JwpubChapterView gives its own `?pid=`
  // deep link — best-effort, since the cited paragraph number isn't
  // guaranteed to line up with the target document's own `data-pid`s.
  useEffect(() => {
    if (!target?.pid || !html) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-pid="${target.pid}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-accent", "bg-accent/20", "rounded-xl", "p-2.5", "transition-all", "duration-500");
    const timer = setTimeout(() => el.classList.remove("ring-2", "ring-accent", "bg-accent/20"), 4500);
    return () => clearTimeout(timer);
  }, [html, target?.pid]);

  if (isLoading) {
    return (
      <ReferenceContentSkeleton paragraphs={4} withHeading />
    );
  }

  if (!target || !html) {
    if (!error && unresolvedMepsDocumentId) {
      return <DownloadPrompt mepsDocumentId={unresolvedMepsDocumentId} pid={unresolvedPid} snapshot={unresolvedSnapshot} onResolved={onResolved} />;
    }
    return <p className="text-[13.5px] text-muted-foreground">{error ?? "Conteúdo não encontrado."}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {target.noteId && (
        <Button
          variant="outline"
          size="sm"
          leftIcon={<ExternalLink />}
          onClick={() => {
            onClose();
            router.push(`/notes/${target.noteId}?doc=${target.documentId}`);
          }}
        >
          Abrir publicação completa
        </Button>
      )}
      <div ref={containerRef}>
        {/* The user's own highlights, with a square in the margin for each note — tapping one opens it right here (see SidebarHighlightedHtml). */}
        <SidebarHighlightedHtml
          html={safeHtml}
          mepsDocumentId={target.mepsDocumentId ?? null}
          className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-xl"
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
  onResolved,
  onClose,
  raiseKey,
}: JwpubReferenceSurfaceProps) {
  return (
    <JwpubSidePanel
      open={open}
      title={target ? `${target.publicationTitle} — ${target.chapterTitle}` : "Referência"}
      onClose={onClose}
      raiseKey={raiseKey}
    >
      <Body
        target={target}
        html={html}
        isLoading={isLoading}
        error={error}
        unresolvedMepsDocumentId={unresolvedMepsDocumentId}
        unresolvedPid={unresolvedPid}
        unresolvedSnapshot={unresolvedSnapshot}
        onResolved={onResolved}
        onClose={onClose}
      />
    </JwpubSidePanel>
  );
}
