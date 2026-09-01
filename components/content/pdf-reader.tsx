"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/ui/toaster";
import { getFileUrl } from "@/app/(app)/files-actions";
import { useNotesStore, type Note } from "@/lib/store/notes-store";
import type { NoteRow } from "@/app/(app)/notes-actions";

interface PdfReaderProps {
  noteId: string;
  initialNote?: NoteRow | Note | null;
}

export function PdfReader({ noteId, initialNote }: PdfReaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notes = useNotesStore((s) => s.notes);
  const storeNote = notes.find((n) => n.id === noteId);

  const note = storeNote ?? initialNote;

  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const storagePath = note?.storagePath;

  const loadPdf = async () => {
    if (!storagePath) {
      setError("Caminho do arquivo não encontrado.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    const res = await getFileUrl(storagePath);
    if (res.error || !res.url) {
      setError(res.error ?? "Não foi possível carregar o arquivo PDF.");
      notify.error("Erro ao abrir PDF", res.error);
    } else {
      setUrl(res.url);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;

    if (!storagePath) {
      queueMicrotask(() => {
        if (!cancelled) {
          setError("Caminho do arquivo não encontrado.");
          setIsLoading(false);
        }
      });
      return;
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }
    });

    void getFileUrl(storagePath).then((res) => {
      if (cancelled) return;
      if (res.error || !res.url) {
        setError(res.error ?? "Não foi possível carregar o arquivo PDF.");
        notify.error("Erro ao abrir PDF", res.error);
      } else {
        setUrl(res.url);
      }
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  const title = note?.title || "Documento PDF";

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft />}
            onClick={() => router.push("/notes")}
            className="max-sm:px-2"
          >
            <span className="hidden sm:inline">Voltar</span>
          </Button>

          <div className="mx-2 flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-heading text-[15px] leading-tight">
              {title}
            </span>
            <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase">
              PDF
            </Badge>
          </div>

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
            >
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ExternalLink className="size-4" />}
                className="max-sm:px-2"
              >
                <span className="hidden sm:inline">Abrir em nova aba</span>
              </Button>
            </a>
          )}
        </header>

        <div className="flex flex-1 flex-col p-3 sm:p-5">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 py-20 text-[13px] text-muted-foreground">
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="size-2 rounded-full bg-accent"
              />
              Carregando PDF…
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
              <FileText className="size-10 text-muted-foreground/60" />
              <p className="max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
                {error}
              </p>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw />}
                onClick={() => void loadPdf()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="flex-1 w-full min-h-[calc(100dvh-6rem)] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <iframe
                src={searchParams.get("page") ? `${url}#page=${searchParams.get("page")}` : url!}
                title={title}
                className="h-full w-full border-0 bg-card"
              />
            </div>
          )}
        </div>
      </motion.main>
    </div>
  );
}
