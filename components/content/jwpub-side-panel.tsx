"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useDevice } from "@/hooks/ui/use-device";
import { Vault, VaultContent, VaultTitle } from "@/components/ui/vault";

interface JwpubSidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Desktop panel width in px. Defaults to the footnote panel's width. */
  width?: number;
}

/**
 * Shared shell for the reader's auxiliary surfaces (footnotes, bible
 * references): a `Vault` sheet on mobile, a side panel that pushes the
 * chapter content on desktop — never a modal. It's a flex sibling of
 * `JwpubReader`'s main column (not `fixed`), so animating its width is what
 * makes the reader content shrink alongside it instead of the panel floating
 * over it.
 *
 * `sticky top-0 h-dvh` pins it to the viewport (same pattern as the app's own
 * left sidebar, components/layout/sidebar.tsx) — the reader has no internal
 * scroll container of its own (the page itself scrolls, see JwpubReader's
 * `min-h-dvh`), so without this the panel would scroll away with the chapter
 * text instead of staying in view.
 */
export function JwpubSidePanel({ open, title, onClose, children, width = 380 }: JwpubSidePanelProps) {
  const { isMobile } = useDevice();

  if (isMobile) {
    return (
      <Vault open={open} onOpenChange={(next) => !next && onClose()}>
        <VaultContent aria-label={title}>
          <VaultTitle className="pb-3 font-heading text-base">{title}</VaultTitle>
          {children}
        </VaultContent>
      </Vault>
    );
  }

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-l border-border bg-[#161413] md:block"
        >
          <div className="flex h-full flex-col" style={{ width }}>
            <header className="flex items-center gap-2.5 border-b border-border px-5 py-4">
              <span className="mr-auto font-heading text-base">{title}</span>
              <button
                type="button"
                onClick={onClose}
                aria-label={`Fechar ${title.toLowerCase()}`}
                className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            {/*
              Padding lives on this INNER div, not on the scrollable one
              itself — a `position: sticky` child sticks to its containing
              block's *padding* edge, so `top-0` on a sticky element inside a
              container that has its own top padding leaves that padding's
              height uncovered by both the sticky element and `overflow`
              clipping (padding is inside the scrollport's border-box, so
              scrolled-past content keeps rendering through it). Verified:
              this is exactly what made a scrolled-past note's last line
              bleed through above BibleStudyPanel's sticky "versículo N"
              divider. Moving the padding one level in gives the scrollport
              itself zero padding, so `top-0` sits flush with its real edge
              and fully covers whatever scrolls underneath.
            */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <div className="p-5">{children}</div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
