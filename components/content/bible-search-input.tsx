"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface BibleSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter — forces the search immediately instead of waiting out the debounce. */
  onSubmit: () => void;
  /** Emptied the field (X, or Escape) — the reader goes back to whatever screen it was on. */
  onClear: () => void;
}

/**
 * The search field in the Bible reader's own header.
 *
 * Two layouts rather than one that shrinks: the header already carries a
 * sidebar toggle, a back arrow, the current book and chapter, the study toggle
 * and the user menu, and squeezing a text field between them leaves nothing
 * legible on a phone. So from `sm` up the field sits inline; below that it's an
 * icon that expands over the whole header row and collapses again when emptied.
 */
export function BibleSearchInput({ value, onChange, onSubmit, onClear }: BibleSearchInputProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
      // Let the on-screen keyboard go away once the search has been asked for
      // — on a phone it covers most of the results otherwise.
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onChange("");
      onClear();
      setMobileOpen(false);
    }
  }

  function clear() {
    onChange("");
    onClear();
  }

  return (
    <>
      {/* Inline field, sm and up. */}
      <div className="relative hidden min-w-0 sm:block sm:w-56 lg:w-72">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar na Bíblia e nos vídeos…"
          aria-label="Buscar na Bíblia e nas transcrições dos vídeos"
          className="h-9 pl-10 pr-9 text-[13px]"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={clear}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Trigger, below sm. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Buscar"
        className={cn(
          "shrink-0 rounded-full p-2 transition-colors sm:hidden",
          value.length > 0
            ? "bg-primary/[0.18] text-accent"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        <Search className="size-4" />
      </button>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            // Covers the header's own contents instead of displacing them, so
            // nothing behind it reflows while the field is open.
            className="absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] z-10 flex items-center gap-2 bg-background px-4 sm:hidden"
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={mobileInputRef}
                type="search"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Buscar na Bíblia e nos vídeos…"
                aria-label="Buscar na Bíblia e nas transcrições dos vídeos"
                className="h-9 pl-10 pr-9 text-[13px]"
              />
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                clear();
                setMobileOpen(false);
              }}
              className="shrink-0 rounded-full px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancelar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
