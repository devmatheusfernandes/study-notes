"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, FileText, PenLine, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toaster";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { DrawingToolbar } from "@/components/content/drawing-toolbar";
import { PdfPages, PdfSkeleton } from "@/components/content/pdf-pages";
import {
  INK_COLORS,
  HIGHLIGHTER_SIZE,
  PEN_SIZES,
  parseDoc,
  serializeDoc,
  type DrawTool,
  type Stroke,
} from "@/lib/drawing/strokes";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import type { DrawingRow } from "@/app/(app)/drawing-actions";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { getFileUrl } from "@/app/(app)/files-actions";
import { useNotesStore, type Note } from "@/lib/store/notes-store";
import { useNavigationHistoryStore } from "@/lib/store/navigation-history-store";
import type { NoteRow } from "@/app/(app)/notes-actions";

interface PdfReaderProps {
  noteId: string;
  initialNote?: NoteRow | Note | null;
  initialDrawing?: DrawingRow | null;
}

export function PdfReader({ noteId, initialNote, initialDrawing }: PdfReaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notes = useNotesStore((s) => s.notes);
  const storeNote = notes.find((n) => n.id === noteId);

  const note = storeNote ?? initialNote;

  // Long, hands-off reading — don't let the screen sleep mid-document.
  useWakeLock(true);

  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const storagePath = note?.storagePath;

  const recordHistoryVisit = useNavigationHistoryStore((s) => s.recordVisit);
  const noteTitle = note?.title;
  useEffect(() => {
    if (noteTitle === undefined) return;
    recordHistoryVisit({
      id: noteId,
      type: "publication",
      title: noteTitle.trim() || "PDF",
      href: `/notes/${noteId}`,
    });
  }, [noteId, noteTitle, recordHistoryVisit]);

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

  const updateNote = useNotesStore((s) => s.updateNote);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const commitTitle = () => {
    if (draftTitle === null) return;
    const next = draftTitle.trim();
    setDraftTitle(null);
    if (next && next !== note?.title) updateNote(noteId, { title: next });
  };

  // ── Handwriting over the pages ────────────────────────────────────────────
  // Same ink model as a typed note's layer (lib/drawing/strokes.ts, saved
  // through the same offline outbox into `note_drawings`), with each stroke
  // tagged by page — there is no second annotation format to keep in sync.
  const saveDrawingStrokes = useNotesStore((s) => s.saveDrawingStrokes);
  const penOnly = usePreferencesStore((s) => s.penOnly);
  const setPenOnly = usePreferencesStore((s) => s.setPenOnly);
  const [penMode, setPenMode] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>(() => parseDoc(initialDrawing?.strokes).strokes);
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[1]);
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[0]);
  const [clearInkOpen, setClearInkOpen] = useState(false);
  const inkDirtyRef = useRef(false);

  useEffect(() => {
    if (!inkDirtyRef.current) return;
    const timer = setTimeout(() => {
      saveDrawingStrokes(noteId, serializeDoc({ version: 1, strokes }));
      inkDirtyRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [strokes, noteId, saveDrawingStrokes]);

  const pushInkHistory = useCallback((previous: Stroke[]) => {
    setPast((stack) => [...stack.slice(-39), previous]);
    setFuture([]);
    inkDirtyRef.current = true;
  }, []);

  const commitStroke = useCallback(
    (stroke: Stroke) => {
      setStrokes((previous) => {
        pushInkHistory(previous);
        return [...previous, stroke];
      });
    },
    [pushInkHistory]
  );

  const eraseStrokes = useCallback(
    (ids: string[], startsGesture: boolean) => {
      setStrokes((previous) => {
        const remaining = previous.filter((s) => !ids.includes(s.id));
        if (remaining.length === previous.length) return previous;
        if (startsGesture) pushInkHistory(previous);
        else inkDirtyRef.current = true;
        return remaining;
      });
    },
    [pushInkHistory]
  );

  function undoInk() {
    if (past.length === 0) return;
    setFuture((f) => [strokes, ...f]);
    setStrokes(past[past.length - 1]);
    setPast(past.slice(0, -1));
    inkDirtyRef.current = true;
  }

  function redoInk() {
    if (future.length === 0) return;
    setPast((p) => [...p, strokes]);
    setStrokes(future[0]);
    setFuture(future.slice(1));
    inkDirtyRef.current = true;
  }

  const ink = {
    active: penMode,
    tool,
    color: inkColor,
    size: tool === "highlighter" ? HIGHLIGHTER_SIZE : penSize,
    penOnly,
    onPenDetected: () => setPenOnly(true),
    onCommitStroke: commitStroke,
    onEraseStrokes: eraseStrokes,
  };

  const pageParam = Number(searchParams.get("page"));
  const initialPage = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : undefined;

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
            <Input
              variant="underline"
              value={draftTitle ?? note?.title ?? ""}
              placeholder="Documento PDF"
              aria-label="Nome do arquivo"
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setDraftTitle(null);
                  e.currentTarget.blur();
                }
              }}
              className="h-9 min-w-0 flex-1 font-heading text-[15px]"
            />
            <Badge variant="outline" className="shrink-0 font-mono text-[10px] uppercase">
              PDF
            </Badge>
          </div>

          {url && !error && (
            <Button
              variant={penMode ? "secondary" : "ghost"}
              size="sm"
              aria-label={penMode ? "Parar de escrever" : "Escrever no PDF"}
              aria-pressed={penMode}
              leftIcon={<PenLine className="size-4" />}
              onClick={() => setPenMode((on) => !on)}
              className={penMode ? "shrink-0 text-accent max-sm:px-2" : "shrink-0 max-sm:px-2"}
            >
              <span className="hidden sm:inline">{penMode ? "Escrevendo" : "Escrever"}</span>
            </Button>
          )}

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

        {penMode && url && !error && (
          <div className="sticky top-14 z-20 flex items-center border-b border-border bg-background/85 px-4 py-1.5 backdrop-blur-md sm:px-6">
            <DrawingToolbar
              tool={tool}
              color={inkColor}
              size={penSize}
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              penOnly={penOnly}
              appearance="light"
              onToolChange={setTool}
              onColorChange={setInkColor}
              onSizeChange={setPenSize}
              onUndo={undoInk}
              onRedo={redoInk}
              onClear={() => setClearInkOpen(true)}
              onPenOnlyChange={setPenOnly}
            />
          </div>
        )}

        <div className="flex flex-1 flex-col">
          {isLoading ? (
            <PdfSkeleton progress={null} />
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
            <PdfPages
              url={url!}
              initialPage={initialPage}
              strokes={strokes}
              ink={ink}
              onError={(message) => setError(`Não foi possível exibir o PDF. ${message}`)}
            />
          )}
        </div>
      </motion.main>

      <ConfirmVault
        open={clearInkOpen}
        onOpenChange={setClearInkOpen}
        title="Apagar tudo o que foi escrito?"
        description="Todos os traços feitos sobre este PDF serão removidos. O arquivo original não é alterado."
        confirmLabel="Apagar"
        onConfirm={() => {
          pushInkHistory(strokes);
          setStrokes([]);
        }}
      />
    </div>
  );
}
