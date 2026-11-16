"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { RsvpReader } from "@/components/content/rsvp-reader";

interface RsvpButtonProps {
  /** Shown as the reader's title. */
  title: string;
  /** What to read — only its text is used. The button hides itself when there is none. */
  html: string | null | undefined;
  /** `md` for page headers, `sm` for the tighter side-panel headers. */
  size?: "md" | "sm";
  className?: string;
}

/**
 * Icon-only entry to the RSVP speed reader. Owns its own open state, so any
 * surface (a note, a chapter, a footnote or reference panel) can offer
 * "read just this" by dropping it into its header.
 */
export function RsvpButton({ title, html, size = "md", className }: RsvpButtonProps) {
  const [open, setOpen] = useState(false);
  if (!html || !html.trim()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Leitura rápida"
        title="Leitura rápida"
        className={cn(
          "shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          size === "md" ? "p-2" : "p-1",
          className
        )}
      >
        <Zap className="size-4" />
      </button>
      <RsvpReader open={open} onOpenChange={setOpen} title={title} html={html} />
    </>
  );
}
