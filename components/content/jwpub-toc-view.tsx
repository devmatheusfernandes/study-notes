"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildTocTabs } from "@/lib/jwpub/toc";
import type { JwpubTocItem } from "@/lib/jwpub/types";
import { cn } from "@/lib/utils";

interface JwpubTocViewProps {
  title: string;
  toc: JwpubTocItem[];
  /** `Document.DocumentId` of the chapter currently open, to mark it in the list. */
  activeDocumentId?: number;
  /** An entry was chosen. */
  onOpen: (documentId: number) => void;
}

/**
 * The publication's own contents screen — what JW Library opens a publication
 * on: tabs for its top-level sections (Conteúdo / Apêndice / Índice) when it
 * has more than one, then its entries, with "CAPÍTULO N" over a numbered one.
 * Built from the archive's own table of contents (lib/jwpub/toc.ts), not from
 * the flat chapter list, so grouping and order match the original.
 */
export function JwpubTocView({ title, toc, activeDocumentId, onOpen }: JwpubTocViewProps) {
  const tabs = useMemo(() => buildTocTabs(toc), [toc]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (tabs.length === 0) return null;
  const current = tabs.find((tab) => tab.key === selectedKey) ?? tabs[0];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <h1 className="font-heading text-2xl leading-tight">{title}</h1>

      {tabs.length > 1 && (
        <Tabs value={current.key} onValueChange={(value) => setSelectedKey(String(value))}>
          <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="flex-none px-3 py-2 text-[12px] font-medium uppercase tracking-wide"
              >
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <ul className="flex flex-col">
        {current.entries.map((entry) =>
          entry.kind === "group" ? (
            <li
              key={entry.key}
              className="mt-4 px-3 pb-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground"
            >
              {entry.title}
            </li>
          ) : (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => onOpen(entry.documentId)}
                className={cn(
                  "flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  entry.documentId === activeDocumentId
                    ? "bg-primary/[0.18] text-accent"
                    : "text-foreground/90 hover:bg-secondary"
                )}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  {entry.label && (
                    <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      {entry.label}
                    </span>
                  )}
                  <span className="text-[14px] leading-snug">{entry.title}</span>
                </span>
                {entry.page && (
                  <span className="mt-0.5 shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    p. {entry.page}
                  </span>
                )}
              </button>
            </li>
          )
        )}
      </ul>
    </div>
  );
}
