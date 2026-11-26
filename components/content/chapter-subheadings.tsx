"use client";

import { useMemo, useState } from "react";
import { List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Vault, VaultContent, VaultTitle } from "@/components/ui/vault";

/** How a chapter marks its subheadings: `h2`/`h3` in magazines, `p.ss` in books. */
const SUBHEADING_SELECTOR = "h2[data-pid], h3[data-pid], p.ss[data-pid]";

function readSubheadings(html: string): { pid: string; text: string }[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.body.querySelectorAll<HTMLElement>(SUBHEADING_SELECTOR)].flatMap((el) => {
    const text = el.textContent?.replace(/\s+/g, " ").trim();
    return text && el.dataset.pid ? [{ pid: el.dataset.pid, text }] : [];
  });
}

/**
 * A header button listing the chapter's subheadings in a Vault. Renders
 * nothing for a text that has none.
 */
export function ChapterSubheadingsButton({
  html,
  onSelect,
}: {
  /** The whole chapter — read for its headings only, never rendered. */
  html: string | null;
  /** A subheading was picked; the Vault is already closing. */
  onSelect: (pid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // `html` only ever arrives from a client-side fetch, so DOMParser exists whenever it does.
  const items = useMemo(() => (html ? readSubheadings(html) : []), [html]);
  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Subtítulos do capítulo"
        title="Subtítulos"
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <List className="size-4" />
      </button>
      <Vault open={open} onOpenChange={setOpen}>
        <VaultContent aria-label="Subtítulos do capítulo">
          <VaultTitle className="pb-3 font-heading text-base">Subtítulos</VaultTitle>
          <nav className="flex flex-col gap-0.5">
            {items.map((item) => (
              <Button
                key={item.pid}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onSelect(item.pid);
                }}
                className="h-auto w-full justify-start whitespace-normal rounded-xl py-2 text-left text-[13.5px] leading-snug"
              >
                {item.text}
              </Button>
            ))}
          </nav>
        </VaultContent>
      </Vault>
    </>
  );
}
