"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { RsvpButton } from "@/components/content/rsvp-button";
import { ReferenceContentSkeleton } from "./reference-surface-skeleton";
import { SidebarHighlightedHtml } from "./sidebar-highlighted-html";

/** The cited article's name out of `Extract.Caption`'s `<span class="etitle">…</span>`. */
function captionTitle(caption: string | null): string | null {
  const match = caption?.match(/class="etitle"[^>]*>([^<]*)</);
  return match ? match[1].replace(/&nbsp;/g, " ").trim() || null : null;
}

/** The location line out of the caption's `<span class="eloc">…</span>` ("nwt p. 1788"). */
function captionLocation(caption: string | null): string | null {
  const match = caption?.match(/class="eloc"[^>]*>([^<]*)</);
  return match ? match[1].replace(/&nbsp;/g, " ").trim() || null : null;
}

/** One embedded excerpt, already sanitized at write time. Mirrors JwpubExtract in lib/jwpub/types.ts. */
export interface JwpubExtractItem {
  extractId: number;
  html: string;
  /** `Extract.Caption` markup — `<span class="eloc">it-1 “Criação” par. 4</span> <span class="etitle">Criação</span>`. */
  caption: string | null;
  refTitle: string | null;
  refSymbol: string | null;
  refMepsDocumentId: number | null;
}

interface JwpubExtractSurfaceProps {
  open: boolean;
  raiseKey?: number;
  extracts: JwpubExtractItem[];
  isLoading?: boolean;
  onClose: () => void;
  /**
   * "Abrir publicação" on one excerpt — hands the source document's
   * MepsDocumentId back to the host, which owns the normal
   * resolve-against-the-library-or-offer-Baixar state (see
   * JwpubReferenceSurface). Omit to hide the affordance.
   */
  onOpenSource?: (mepsDocumentId: number) => void;
}

/**
 * Renders the excerpt(s) behind one citation link — the `data-jwpub-extract`
 * counterpart to `JwpubReferenceSurface`'s `data-jwpub-pubref`.
 *
 * Takes a LIST, not one excerpt, because a single citation routinely stands
 * for several: "Perspicaz, Volume 1," at Gênesis 1:1 is one `<a>` covering
 * six different Perspicaz articles. Showing only the first is what made
 * clicking a Perspicaz citation look like it "always opens the same thing".
 *
 * Each excerpt leads with its own `Extract.Caption`, which is normally the
 * only place the cited article's NAME appears — the guide's visible link text
 * for a Perspicaz citation stops at "Perspicaz, Volume 1,".
 */
export function JwpubExtractSurface({
  open,
  extracts,
  isLoading = false,
  onClose,
  onOpenSource,
  raiseKey,
}: JwpubExtractSurfaceProps) {
  // While one of the excerpt's notes is open, the header takes over that excerpt's caption (article name over
  // the "nwt p. 1788" location) and its back button, so the body doesn't spend lines on either.
  const [openNote, setOpenNote] = useState<{ extractId: number; back: () => void; title?: string } | null>(null);
  const noteExtract = openNote ? extracts.find((e) => e.extractId === openNote.extractId) : undefined;

  const articleTitle = noteExtract ? (captionTitle(noteExtract.caption) ?? noteExtract.refTitle ?? "Trecho") : null;
  // A Bible passage opened from the excerpt takes the header ("1 João 4:16") with the article's name under it.
  const title =
    openNote?.title ??
    articleTitle ??
    (extracts.length > 1 ? `${extracts.length} trechos` : (extracts[0]?.refTitle ?? "Trecho"));
  const subtitle = noteExtract ? (openNote?.title ? articleTitle : captionLocation(noteExtract.caption)) : null;

  return (
    <JwpubSidePanel
      open={open}
      title={title}
      subtitle={subtitle}
      onBack={openNote ? openNote.back : undefined}
      onClose={onClose}
      raiseKey={raiseKey}
      headerActions={<RsvpButton size="sm" title={title} html={isLoading ? null : extracts.map((e) => e.html).join(" ")} />}
    >
      {isLoading ? (
        <ReferenceContentSkeleton paragraphs={2} withHeading />
      ) : extracts.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground">Trecho não encontrado.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {extracts.map((extract, index) => (
            <article
              key={extract.extractId}
              className={index > 0 ? "border-t border-border/60 pt-6" : undefined}
            >
              {openNote?.extractId === extract.extractId ? null : extract.caption ? (
                <div
                  className="mb-2 [&_.eloc]:block [&_.eloc]:font-mono [&_.eloc]:text-[10.5px] [&_.eloc]:uppercase [&_.eloc]:tracking-wide [&_.eloc]:text-muted-foreground [&_.etitle]:block [&_.etitle]:font-heading [&_.etitle]:text-[14px] [&_.etitle]:text-foreground"
                  dangerouslySetInnerHTML={{ __html: extract.caption }}
                />
              ) : extract.refTitle ? (
                <p className="mb-2 font-heading text-[14px]">{extract.refTitle}</p>
              ) : null}

              {/* The user's highlights and a margin square for each note, which opens in place with a "Voltar ao trecho" (see SidebarHighlightedHtml). */}
              <SidebarHighlightedHtml
                html={extract.html}
                mepsDocumentId={extract.refMepsDocumentId}
                symbolHint={extract.refSymbol}
                titleHint={captionTitle(extract.caption)}
                onNoteChange={(back, passageTitle) => {
                  const id = extract.extractId;
                  setOpenNote((prev) =>
                    back ? { extractId: id, back, title: passageTitle } : prev?.extractId === id ? null : prev
                  );
                }}
                className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_img]:my-2 [&_img]:max-w-full"
              />

              {onOpenSource && extract.refMepsDocumentId !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<BookOpen className="size-3.5 text-accent" />}
                  onClick={() => onOpenSource(extract.refMepsDocumentId!)}
                  className="mt-3 rounded-full text-[12px]"
                >
                  Abrir publicação
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </JwpubSidePanel>
  );
}
