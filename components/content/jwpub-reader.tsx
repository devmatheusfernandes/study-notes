"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ChevronLeft, ChevronRight, List, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { getChapter, getFootnote, getPublication } from "@/app/(app)/jwpub-actions";
import { getFileUrl } from "@/app/(app)/files-actions";
import { useNotesStore } from "@/lib/store/notes-store";
import type { ChapterSummary, PublicationSummary } from "@/lib/jwpub/types";
import { JwpubChapterView } from "./jwpub-chapter-view";
import { JwpubFootnoteSurface } from "./jwpub-footnote-surface";

interface JwpubReaderProps {
  noteId: string;
  initialPublication: PublicationSummary;
  initialChapters: ChapterSummary[];
}

export function JwpubReader({ noteId, initialPublication, initialChapters }: JwpubReaderProps) {
  const router = useRouter();
  const notes = useNotesStore((s) => s.notes);
  const note = notes.find((n) => n.id === noteId);

  const [publication, setPublication] = useState(initialPublication);
  const [chapters, setChapters] = useState(initialChapters);
  const [activeIndex, setActiveIndex] = useState(0);
  const [html, setHtml] = useState<string | null>(null);
  const [isLoadingChapter, setIsLoadingChapter] = useState(false);
  const [showChapters, setShowChapters] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [footnoteHtml, setFootnoteHtml] = useState<string | null>(null);
  const [isLoadingFootnote, setIsLoadingFootnote] = useState(false);

  const activeChapter = chapters[activeIndex];

  useEffect(() => {
    if (!activeChapter) return;
    let cancelled = false;
    setIsLoadingChapter(true);

    void getChapter(publication.id, activeChapter.documentId).then((result) => {
      if (cancelled) return;
      setHtml(result.html ?? "");
      setIsLoadingChapter(false);
      if (result.error) notify.error("Não foi possível abrir o capítulo", result.error);
    });

    return () => {
      cancelled = true;
    };
  }, [publication.id, activeChapter]);

  const handleFootnote = useCallback(
    (footnoteId: number) => {
      setFootnoteOpen(true);
      setFootnoteHtml(null);
      setIsLoadingFootnote(true);
      void getFootnote(publication.id, footnoteId).then((result) => {
        setFootnoteHtml(result.html ?? null);
        setIsLoadingFootnote(false);
      });
    },
    [publication.id]
  );

  /** Recovery path: re-download the original from Storage and parse it again. */
  async function reprocess() {
    if (!note?.storagePath) return;
    setIsReprocessing(true);
    try {
      const { url, error } = await getFileUrl(note.storagePath);
      if (error || !url) throw new Error(error ?? "Não foi possível baixar o arquivo.");

      const blob = await fetch(url).then((r) => r.blob());
      const { ingestJwpub } = await import("@/lib/jwpub/ingest");
      const result = await ingestJwpub(blob, noteId);
      if (!result.ok) throw new Error(result.error);

      const refreshed = await getPublication(noteId);
      if (refreshed.publication) {
        setPublication(refreshed.publication);
        setChapters(refreshed.chapters ?? []);
        setActiveIndex(0);
      }
      notify.success("Publicação processada");
    } catch (error) {
      notify.error(
        "Não foi possível processar a publicação",
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsReprocessing(false);
    }
  }

  const failed = publication.status === "failed" || chapters.length === 0;

  return (
    <div className="flex min-h-dvh w-full">
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} onClick={() => router.push("/notes")}>
            Voltar
          </Button>

          <div className="mx-2 flex min-w-0 flex-1 flex-col">
            <span className="truncate font-heading text-[15px] leading-tight">
              {publication.title || note?.title || "Publicação"}
            </span>
            {publication.symbol && (
              <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
                {publication.symbol.toUpperCase()}
              </span>
            )}
          </div>

          {chapters.length > 0 && (
            <button
              type="button"
              onClick={() => setShowChapters((v) => !v)}
              aria-label="Capítulos"
              aria-pressed={showChapters}
              className={cn(
                "shrink-0 rounded-full p-2 transition-colors",
                showChapters
                  ? "bg-primary/[0.18] text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <List className="size-4" />
            </button>
          )}
        </header>

        {failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <p className="max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              Esta publicação ainda não foi processada — sem isso não dá para ler o conteúdo aqui
              dentro.
            </p>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCw />}
              isLoading={isReprocessing}
              onClick={() => void reprocess()}
            >
              Processar publicação
            </Button>
          </div>
        ) : (
          <>
            {showChapters && (
              <nav className="border-b border-border bg-secondary/40 px-4 py-3 sm:px-6">
                <ul className="mx-auto flex w-full max-w-2xl flex-col gap-0.5">
                  {chapters.map((chapter, index) => (
                    <li key={chapter.documentId}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveIndex(index);
                          setShowChapters(false);
                        }}
                        className={cn(
                          "w-full rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors",
                          index === activeIndex
                            ? "bg-primary/[0.18] text-accent"
                            : "text-foreground/80 hover:bg-secondary"
                        )}
                      >
                        {chapter.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            <div className="flex-1 px-4 py-6 sm:px-6">
              {isLoadingChapter ? (
                <p className="mx-auto max-w-2xl text-[13px] text-muted-foreground">carregando…</p>
              ) : (
                <JwpubChapterView html={html ?? ""} onFootnote={handleFootnote} />
              )}
            </div>

            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ChevronLeft />}
                disabled={activeIndex === 0}
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              >
                Anterior
              </Button>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {activeIndex + 1} / {chapters.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                rightIcon={<ChevronRight />}
                disabled={activeIndex >= chapters.length - 1}
                onClick={() => setActiveIndex((i) => Math.min(chapters.length - 1, i + 1))}
              >
                Próximo
              </Button>
            </div>
          </>
        )}
      </motion.main>

      <JwpubFootnoteSurface
        open={footnoteOpen}
        html={footnoteHtml}
        isLoading={isLoadingFootnote}
        onClose={() => setFootnoteOpen(false)}
      />
    </div>
  );
}
