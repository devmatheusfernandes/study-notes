"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
import { downloadAndIngestPublication } from "@/lib/jwpub/download-publication";
import { JwpubSidePanel } from "./jwpub-side-panel";

export interface JwpubReferenceTarget {
  noteId: string;
  publicationTitle: string;
  chapterTitle: string;
  documentId: number;
  /** The cited paragraph, if the reference carried one — scrolled to and briefly highlighted once the content renders. Best-effort: a miss just means no scroll, not a bug. */
  pid?: string;
}

interface JwpubReferenceSurfaceProps {
  open: boolean;
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
  /** Called after a successful download — the caller re-resolves and reopens with the newly-available `target`, same click, no re-navigation needed. */
  onResolved?: (mepsDocumentId: number, noteId: string) => void;
  onClose: () => void;
}

function DownloadPrompt({ mepsDocumentId, onResolved }: { mepsDocumentId: number; onResolved?: (mepsDocumentId: number, noteId: string) => void }) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const result = await downloadAndIngestPublication(mepsDocumentId);
      if (!result.ok || !result.noteId) {
        notify.error("Não foi possível baixar", result.error);
        return;
      }
      notify.success(`"${result.title ?? "Publicação"}" baixada`);
      onResolved?.(mepsDocumentId, result.noteId);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[13.5px] text-muted-foreground">
        Essa publicação ainda não está na sua biblioteca. O jw.org disponibiliza o arquivo original —
        dá para trazer ela para cá.
      </p>
      <Button
        variant="outline"
        size="sm"
        isLoading={isDownloading}
        leftIcon={<Download className="size-3.5 text-accent" />}
        onClick={() => void handleDownload()}
      >
        Baixar publicação
      </Button>
    </div>
  );
}

function Body({
  target,
  html,
  isLoading,
  error,
  unresolvedMepsDocumentId,
  onResolved,
}: {
  target: JwpubReferenceTarget | null;
  html: string | null;
  isLoading: boolean;
  error?: string | null;
  unresolvedMepsDocumentId?: number | null;
  onResolved?: (mepsDocumentId: number, noteId: string) => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

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
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          className="size-1.5 rounded-full bg-accent"
        />
        carregando…
      </div>
    );
  }

  if (!target || !html) {
    if (!error && unresolvedMepsDocumentId) {
      return <DownloadPrompt mepsDocumentId={unresolvedMepsDocumentId} onResolved={onResolved} />;
    }
    return <p className="text-[13.5px] text-muted-foreground">{error ?? "Conteúdo não encontrado."}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        leftIcon={<ExternalLink />}
        onClick={() => router.push(`/notes/${target.noteId}?doc=${target.documentId}`)}
      >
        Abrir publicação completa
      </Button>
      <div
        ref={containerRef}
        className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-xl"
        dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }}
      />
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
  onResolved,
  onClose,
}: JwpubReferenceSurfaceProps) {
  return (
    <JwpubSidePanel open={open} title={target ? `${target.publicationTitle} — ${target.chapterTitle}` : "Referência"} onClose={onClose}>
      <Body
        target={target}
        html={html}
        isLoading={isLoading}
        error={error}
        unresolvedMepsDocumentId={unresolvedMepsDocumentId}
        onResolved={onResolved}
      />
    </JwpubSidePanel>
  );
}
