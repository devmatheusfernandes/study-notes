"use client";

import { motion } from "framer-motion";
import type { BibleVerseRow } from "@/app/(app)/bible-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";

interface JwpubBibleSurfaceProps {
  open: boolean;
  verses: BibleVerseRow[] | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}

function reference(verses: BibleVerseRow[]): string {
  const first = verses.find((v) => !v.isSuperscription) ?? verses[0];
  const last = verses[verses.length - 1];
  if (!first) return "";
  if (first.chapter === last.chapter && first.verse === last.verse) {
    return `${first.book} ${first.chapter}:${first.verse ?? ""}`;
  }
  if (first.chapter === last.chapter) {
    return `${first.book} ${first.chapter}:${first.verse ?? ""}-${last.verse ?? ""}`;
  }
  return `${first.book} ${first.chapter}:${first.verse ?? ""}–${last.chapter}:${last.verse ?? ""}`;
}

function Body({
  verses,
  isLoading,
  error,
}: {
  verses: BibleVerseRow[] | null;
  isLoading: boolean;
  error: string | null;
}) {
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

  if (error || !verses || verses.length === 0) {
    return (
      <p className="text-[13.5px] text-muted-foreground">
        {error ?? "Referência bíblica não encontrada."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="font-mono text-[11px] tracking-[0.06em] text-accent">
        {reference(verses)}
      </span>
      <div className="text-[14.5px] leading-relaxed text-foreground/90">
        {/* whitespace-pre-line: see the comment in bible-chapter-view.tsx — verse text carries real `\n` for poetry. */}
        {verses.map((v) =>
          v.isSuperscription ? (
            <p key={v.id} className="my-2 whitespace-pre-line italic text-muted-foreground">
              {v.text ?? ""}
            </p>
          ) : (
            <p key={v.id} className="my-2 whitespace-pre-line">
              <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{v.verse}</span>
              {v.text ?? (
                <span className="italic text-muted-foreground">
                  texto não disponível nesta tradução
                </span>
              )}
            </p>
          )
        )}
      </div>
    </div>
  );
}

/** Same shell as footnotes: Vault sheet on mobile, a content-pushing panel on desktop. */
export function JwpubBibleSurface({ open, verses, isLoading, error, onClose }: JwpubBibleSurfaceProps) {
  return (
    <JwpubSidePanel open={open} title="Referência bíblica" onClose={onClose}>
      <Body verses={verses} isLoading={isLoading} error={error} />
    </JwpubSidePanel>
  );
}
