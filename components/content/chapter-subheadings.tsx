"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How a chapter marks its subheadings: `h2`/`h3` in magazines, `p.ss` in books. */
const SUBHEADING_SELECTOR = "h2[data-pid], h3[data-pid], p.ss[data-pid]";

function readSubheadings(html: string): { pid: string; text: string }[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.body.querySelectorAll<HTMLElement>(SUBHEADING_SELECTOR)].flatMap((el) => {
    const text = el.textContent?.replace(/\s+/g, " ").trim();
    return text && el.dataset.pid ? [{ pid: el.dataset.pid, text }] : [];
  });
}

/** The chapter's subheadings, listed above it — each one scrolls the panel to its section. */
export function ChapterSubheadings({
  html,
  containerRef,
}: {
  /** The chapter being shown below. */
  html: string;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(true);
  const items = useMemo(() => readSubheadings(html), [html]);
  if (items.length === 0) return null;

  return (
    <nav aria-label="Subtítulos do capítulo" className="mb-3 w-full rounded-2xl border border-border/60 p-1.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        rightIcon={<ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />}
        className="w-full justify-between text-[12px] text-muted-foreground"
      >
        Subtítulos · {items.length}
      </Button>
      {open && (
        <div className="flex flex-col">
          {items.map((item) => (
            <Button
              key={item.pid}
              variant="ghost"
              size="sm"
              onClick={() =>
                containerRef.current
                  ?.querySelector(`[data-pid="${CSS.escape(item.pid)}"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="h-auto w-full justify-start whitespace-normal rounded-xl py-1.5 text-left text-[12.5px] leading-snug text-accent"
            >
              {item.text}
            </Button>
          ))}
        </div>
      )}
    </nav>
  );
}
