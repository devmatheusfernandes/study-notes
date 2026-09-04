"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
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
  onClose: () => void;
}

function Body({
  target,
  html,
  isLoading,
}: {
  target: JwpubReferenceTarget | null;
  html: string | null;
  isLoading: boolean;
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
    return <p className="text-[13.5px] text-muted-foreground">Conteúdo não encontrado.</p>;
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

/** Same side-panel-on-desktop/Vault-on-mobile shell as footnotes — opened by tapping a resolved `data-jwpub-pubref` cross-reference (e.g. "th study 5") in another already-uploaded publication. */
export function JwpubReferenceSurface({ open, target, html, isLoading, onClose }: JwpubReferenceSurfaceProps) {
  return (
    <JwpubSidePanel open={open} title={target ? `${target.publicationTitle} — ${target.chapterTitle}` : "Referência"} onClose={onClose}>
      <Body target={target} html={html} isLoading={isLoading} />
    </JwpubSidePanel>
  );
}
