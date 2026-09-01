"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useDevice } from "@/hooks/ui/use-device";
import { Vault, VaultContent, VaultTitle } from "@/components/ui/vault";
import { sanitizeChapterHtml } from "@/lib/jwpub/sanitize";

interface JwpubFootnoteSurfaceProps {
  open: boolean;
  html: string | null;
  isLoading: boolean;
  onClose: () => void;
}

function Body({ html, isLoading }: { html: string | null; isLoading: boolean }) {
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

/** Same split as the assistant: a Vault sheet on mobile, a side panel on desktop — never a modal. */
export function JwpubFootnoteSurface({ open, html, isLoading, onClose }: JwpubFootnoteSurfaceProps) {
  const { isMobile } = useDevice();

  if (isMobile) {
    return (
      <Vault open={open} onOpenChange={(next) => !next && onClose()}>
        <VaultContent aria-label="Nota de rodapé">
          <VaultTitle className="pb-3 font-heading text-base">Nota de rodapé</VaultTitle>
          <Body html={html} isLoading={isLoading} />
        </VaultContent>
      </Vault>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="hidden shrink-0 overflow-hidden border-l border-border bg-[#161413] md:block"
        >
          <div className="flex h-full w-[380px] flex-col">
            <header className="flex items-center gap-2.5 border-b border-border px-5 py-4">
              <span className="mr-auto font-heading text-base">Nota de rodapé</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar nota de rodapé"
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5">
              <Body html={html} isLoading={isLoading} />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
