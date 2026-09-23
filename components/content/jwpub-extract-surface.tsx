"use client";

import { motion } from "framer-motion";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JwpubSidePanel } from "./jwpub-side-panel";

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
}: JwpubExtractSurfaceProps) {
  const title = extracts.length > 1 ? `${extracts.length} trechos` : (extracts[0]?.refTitle ?? "Trecho");

  return (
    <JwpubSidePanel open={open} title={title} onClose={onClose}>
      {isLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="size-1.5 rounded-full bg-accent"
          />
          carregando…
        </div>
      ) : extracts.length === 0 ? (
        <p className="text-[13.5px] text-muted-foreground">Trecho não encontrado.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {extracts.map((extract, index) => (
            <article
              key={extract.extractId}
              className={index > 0 ? "border-t border-border/60 pt-6" : undefined}
            >
              {extract.caption ? (
                <div
                  className="mb-2 [&_.eloc]:block [&_.eloc]:font-mono [&_.eloc]:text-[10.5px] [&_.eloc]:uppercase [&_.eloc]:tracking-wide [&_.eloc]:text-muted-foreground [&_.etitle]:block [&_.etitle]:font-heading [&_.etitle]:text-[14px] [&_.etitle]:text-foreground"
                  dangerouslySetInnerHTML={{ __html: extract.caption }}
                />
              ) : extract.refTitle ? (
                <p className="mb-2 font-heading text-[14px]">{extract.refTitle}</p>
              ) : null}

              <div
                className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-xl"
                dangerouslySetInnerHTML={{ __html: extract.html }}
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
