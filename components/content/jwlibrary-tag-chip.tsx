"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JwlibraryTagView } from "@/app/(app)/jwlibrary-actions";

/**
 * Shared toggle-chip look for a jwlibrary tag — used for the /jwlibrary
 * filter row, the tag picker/editor toggles, and (with `onClick` omitted)
 * as a read-only display pill, e.g. jwlibrary-highlight-note-panel.tsx's
 * tag row.
 */
export function JwlibraryTagChip({
  tag,
  active,
  onClick,
}: {
  tag: JwlibraryTagView;
  active: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    // Fixed h-8 (not just vertical padding) so this lines up exactly with
    // the h-8 search Input next to it in the picker/editor tag rows.
    "flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
    active ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:bg-secondary"
  );
  const content = (
    <>
      {tag.tagType === 0 && <Star className="size-3 fill-current" />}
      {tag.name || "Sem nome"}
    </>
  );

  if (!onClick) {
    return <span className={className}>{content}</span>;
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}
