"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearFind, getFindState, setFindQuery, stepFind } from "@/lib/tiptap/find-in-note";

interface NoteFindBarProps {
  editor: Editor;
  /** Seed for the box when it opens — usually whatever text was selected. */
  initialQuery: string;
  /** Bumped every time the bar is asked for, so asking again while it is open refocuses it. */
  focusSignal: number;
  onClose: () => void;
}

/**
 * Find in the open note: a small floating bar pinned to the top of the note
 * (it stays put while the note scrolls underneath), with the match counter,
 * previous/next and close. Enter/Shift+Enter step through the matches, Esc
 * closes. Matches are highlighted in the text; the current one is stronger and
 * scrolled into view, and a match inside a collapsed section opens it.
 */
export function NoteFindBar({ editor, initialQuery, focusSignal, onClose }: NoteFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  // The match list lives in the editor's own state; this only re-reads it when a transaction changes it.
  const [, rerender] = useState(0);

  useEffect(() => {
    const handler = () => rerender((n) => n + 1);
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  // Seed and search on open, then keep the highlights in sync with the box.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (initialQuery) setFindQuery(editor, initialQuery);
  }, [editor, initialQuery]);

  // Cleared with the bar, so no highlight is left behind.
  useEffect(() => () => clearFind(editor), [editor]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const { matches, index } = getFindState(editor);
  const hasQuery = query.trim() !== "";
  const counter = !hasQuery ? "" : matches.length === 0 ? "0" : `${index + 1}/${matches.length}`;

  function close() {
    onClose();
    editor.commands.focus();
  }

  return (
    <div className="sticky top-3 z-20 h-0">
      <div
        role="search"
        className="absolute right-0 top-0 flex items-center gap-1 rounded-full border border-foreground/12 bg-glass/95 py-1 pl-1 pr-1 shadow-[0_12px_36px_var(--shadow)] backdrop-blur-2xl"
      >
        <Input
          ref={inputRef}
          value={query}
          placeholder="Buscar na nota"
          aria-label="Buscar na nota"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setFindQuery(editor, event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              stepFind(editor, event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          className="h-8 w-44 border-0 bg-transparent px-3 text-[13px] sm:w-56"
        />
        <span
          aria-live="polite"
          className="min-w-9 text-center font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {counter}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Anterior"
          title="Anterior (Shift+Enter)"
          disabled={matches.length === 0}
          onClick={() => stepFind(editor, -1)}
          className="size-7 rounded-full"
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Próximo"
          title="Próximo (Enter)"
          disabled={matches.length === 0}
          onClick={() => stepFind(editor, 1)}
          className="size-7 rounded-full"
        >
          <ChevronDown className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Fechar busca"
          title="Fechar (Esc)"
          onClick={close}
          className="size-7 rounded-full"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
