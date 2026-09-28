"use client";

import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { ReferenceContentSkeleton } from "./reference-surface-skeleton";

interface JwpubFootnoteSurfaceProps {
  open: boolean;
  html: string | null;
  isLoading: boolean;
  onClose: () => void;
}

function Body({ html, isLoading }: { html: string | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <ReferenceContentSkeleton paragraphs={2} />
    );
  }

  if (!html) {
    return <p className="text-[13.5px] text-muted-foreground">Nota de rodapé não encontrada.</p>;
  }

  return (
    <div
      className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-xl"
      dangerouslySetInnerHTML={{ __html: sanitizeChapterHtml(html) }}
    />
  );
}

export function JwpubFootnoteSurface({ open, html, isLoading, onClose }: JwpubFootnoteSurfaceProps) {
  return (
    <JwpubSidePanel open={open} title="Nota de rodapé" onClose={onClose}>
      <Body html={html} isLoading={isLoading} />
    </JwpubSidePanel>
  );
}
