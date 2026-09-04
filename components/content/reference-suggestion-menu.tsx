"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { BookOpen, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReferenceSuggestionItem } from "@/lib/notes/reference-suggestions";

interface ReferenceSuggestionMenuProps {
  items: ReferenceSuggestionItem[];
  activeIndex: number;
  /** Viewport rect of the "/" that opened the menu. */
  rect: DOMRect;
  onSelect: (item: ReferenceSuggestionItem) => void;
  onHover: (index: number) => void;
}

const MENU_WIDTH = 288;
const ESTIMATED_ROW_HEIGHT = 44;

/**
 * The "/" reference picker.
 *
 * Rendered through a portal on `document.body` rather than inside the editor:
 * it is positioned with viewport coordinates (from ProseMirror's
 * `posToDOMRect`), and the note editor's entrance animation puts a
 * `transform` on an ancestor — which would make it the containing block for
 * `position: fixed` and drag the menu off-target.
 */
export function ReferenceSuggestionMenu({
  items,
  activeIndex,
  rect,
  onSelect,
  onHover,
}: ReferenceSuggestionMenuProps) {
  // No mount flag needed: the menu only ever renders in response to typing,
  // so it never runs during SSR — the guard is just belt and braces.
  if (typeof document === "undefined" || items.length === 0) return null;

  const estimatedHeight = Math.min(items.length, 7) * ESTIMATED_ROW_HEIGHT + 16;
  const flipUp = rect.bottom + estimatedHeight > window.innerHeight - 12;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: flipUp ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      role="listbox"
      aria-label="Sugestões de referência"
      style={{
        position: "fixed",
        width: MENU_WIDTH,
        left: Math.min(Math.max(8, rect.left), window.innerWidth - MENU_WIDTH - 8),
        top: flipUp ? undefined : rect.bottom + 6,
        bottom: flipUp ? window.innerHeight - rect.top + 6 : undefined,
      }}
      className="z-50 overflow-hidden rounded-2xl border border-border bg-card p-1 shadow-lg"
    >
      {items.map((item, index) => (
        <button
          key={`${item.type}-${item.label}-${index}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // The editor still owns the caret — a mousedown here would blur it
          // and collapse the very selection the insertion depends on.
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(item)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors",
            index === activeIndex ? "bg-primary/[0.18] text-accent" : "text-foreground/85 hover:bg-secondary"
          )}
        >
          {item.hint === "Bíblia" ? (
            <BookOpen className="size-3.5 shrink-0" />
          ) : (
            <Library className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13.5px]">{item.label}</span>
          <span className="shrink-0 font-mono text-[10px] tracking-[0.06em] text-muted-foreground">
            {item.type === "insert" ? "inserir" : item.hint}
          </span>
        </button>
      ))}
    </motion.div>,
    document.body
  );
}
