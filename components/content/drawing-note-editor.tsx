"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { SyncStatusIndicator } from "@/components/content/sync-status";
import { DrawingCanvas } from "@/components/content/drawing-canvas";
import { DrawingToolbar } from "@/components/content/drawing-toolbar";
import { DrawingAudioBar } from "@/components/content/drawing-audio-bar";
import { useNotesStore } from "@/lib/store/notes-store";
import { useHydrated } from "@/components/providers/store-hydration";
import { useAudioRecorder, type Recording } from "@/hooks/use-audio-recorder";
import { createClient } from "@/lib/supabase/client";
import { NOTE_AUDIO_BUCKET } from "@/lib/storage-config";
import {
  INK_COLORS,
  PEN_SIZES,
  HIGHLIGHTER_SIZE,
  parseDoc,
  serializeDoc,
  type DrawTool,
  type Stroke,
} from "@/lib/drawing/strokes";
import {
  deleteDrawingAudio,
  finalizeAudioUpload,
  getAudioUrl,
  requestAudioUploadSlot,
  type DrawingRow,
} from "@/app/(app)/drawing-actions";

interface DrawingNoteEditorProps {
  noteId?: string;
  initialNote?: { id: string; title: string } | null;
  initialDrawing?: DrawingRow | null;
}

export function DrawingNoteEditor({ noteId, initialNote, initialDrawing }: DrawingNoteEditorProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const searchParams = useSearchParams();
  const folderId = noteId ? undefined : searchParams.get("folder") ?? undefined;

  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const togglePin = useNotesStore((s) => s.togglePin);
  const saveDrawingStrokes = useNotesStore((s) => s.saveDrawingStrokes);

  const [createdId, setCreatedId] = useState<string | null>(noteId ?? null);
  const [title, setTitle] = useState(initialNote?.title ?? "");

  const [strokes, setStrokes] = useState<Stroke[]>(() => parseDoc(initialDrawing?.strokes).strokes);
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);

  const [tool, setTool] = useState<DrawTool>("pen");
  const [color, setColor] = useState<string>(INK_COLORS[0]);
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1]);
  const [clearOpen, setClearOpen] = useState(false);

  // ── Audio ────────────────────────────────────────────────────────────────
  const recorder = useAudioRecorder();
  const [audioPath, setAudioPath] = useState<string | null>(initialDrawing?.audioPath ?? null);
  const [audioDurationMs, setAudioDurationMs] = useState(initialDrawing?.audioDurationMs ?? 0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const pendingRecordingRef = useRef<Recording | null>(null);
  const [pendingUpload, setPendingUpload] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const current = createdId ? notes.find((n) => n.id === createdId) : undefined;
  const pinned = current?.pinned ?? false;

  // Read through a ref so `ensureNote` keeps a stable identity while the user
  // types a title — otherwise every keystroke re-creates it and restarts the
  // drawing's own save debounce below.
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  /** Creates the note row on first use, so merely opening the screen never leaves an empty note behind. */
  const ensureNote = useCallback(
    (nextTitle?: string) => {
      if (createdId) return createdId;
      const id = addNote({
        title: (nextTitle ?? titleRef.current).trim() || "Novo desenho",
        body: "",
        folderId,
        type: "desenho",
      });
      setCreatedId(id);
      // Same reasoning as NoteEditor: a router.replace would remount this
      // screen (losing the canvas mid-stroke), a history swap just relabels it.
      window.history.replaceState(null, "", `/notes/${id}`);
      return id;
    },
    [createdId, addNote, folderId]
  );

  // ── Persistence ───────────────────────────────────────────────────────────
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!hydrated || !dirtyRef.current) return;
    const timer = setTimeout(() => {
      const id = ensureNote();
      saveDrawingStrokes(id, serializeDoc({ version: 1, strokes }));
      dirtyRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [strokes, hydrated, ensureNote, saveDrawingStrokes]);

  const titleSavedRef = useRef(initialNote?.title ?? "");
  useEffect(() => {
    if (!hydrated) return;
    if (title === titleSavedRef.current) return;
    const timer = setTimeout(() => {
      titleSavedRef.current = title;
      const id = ensureNote(title);
      updateNote(id, { title: title.trim() || "Novo desenho" });
    }, 600);
    return () => clearTimeout(timer);
  }, [title, hydrated, ensureNote, updateNote]);

  // ── Stroke editing ────────────────────────────────────────────────────────
  const pushHistory = useCallback((previous: Stroke[]) => {
    // 40 steps is plenty for a page of handwriting and keeps the snapshots
    // (whole stroke arrays) from growing without bound.
    setPast((stack) => [...stack.slice(-39), previous]);
    setFuture([]);
    dirtyRef.current = true;
  }, []);

  const commitStroke = useCallback(
    (stroke: Stroke) => {
      setStrokes((previous) => {
        pushHistory(previous);
        return [...previous, stroke];
      });
    },
    [pushHistory]
  );

  const eraseStrokes = useCallback(
    (ids: string[], startsGesture: boolean) => {
      setStrokes((previous) => {
        const remaining = previous.filter((s) => !ids.includes(s.id));
        if (remaining.length === previous.length) return previous;
        // One sweep of the eraser is one undo step: only the first hit of the
        // drag snapshots, the rest just keep removing.
        if (startsGesture) pushHistory(previous);
        else dirtyRef.current = true;
        return remaining;
      });
    },
    [pushHistory]
  );

  function undo() {
    setPast((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setFuture((f) => [strokes, ...f]);
      setStrokes(previous);
      dirtyRef.current = true;
      return stack.slice(0, -1);
    });
  }

  function redo() {
    setFuture((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[0];
      setPast((p) => [...p, strokes]);
      setStrokes(next);
      dirtyRef.current = true;
      return stack.slice(1);
    });
  }

  // ── Audio: recording ──────────────────────────────────────────────────────
  async function uploadRecording(recording: Recording) {
    const id = ensureNote();
    const slot = await requestAudioUploadSlot(id, recording.extension);
    if (slot.error || !slot.storagePath || !slot.token) {
      pendingRecordingRef.current = recording;
      setPendingUpload(true);
      notify.error("Não foi possível enviar a gravação", slot.error);
      return;
    }

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(NOTE_AUDIO_BUCKET)
      .uploadToSignedUrl(slot.storagePath, slot.token, recording.blob, {
        contentType: recording.blob.type,
      });
    if (uploadError) {
      pendingRecordingRef.current = recording;
      setPendingUpload(true);
      notify.error("Não foi possível enviar a gravação");
      return;
    }

    const result = await finalizeAudioUpload(id, slot.storagePath, recording.durationMs);
    if (result.error) {
      pendingRecordingRef.current = recording;
      setPendingUpload(true);
      notify.error("Não foi possível salvar a gravação", result.error);
      return;
    }

    pendingRecordingRef.current = null;
    setPendingUpload(false);
    setAudioPath(slot.storagePath);
    setAudioDurationMs(recording.durationMs);
    setAudioUrl(URL.createObjectURL(recording.blob));
    notify.success("Gravação salva", "O áudio já acompanha os traços desta nota.");
  }

  async function startRecording() {
    // The row must exist before Storage can accept a path under its id.
    ensureNote();
    const result = await recorder.start();
    if (result.error) notify.error("Gravação indisponível", result.error);
  }

  async function stopRecording() {
    const recording = await recorder.stop();
    if (!recording) return;
    await uploadRecording(recording);
  }

  // ── Audio: playback ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!audioPath || audioUrl) return;
    let cancelled = false;
    void getAudioUrl(audioPath).then((res) => {
      if (!cancelled && res.url) setAudioUrl(res.url);
    });
    return () => {
      cancelled = true;
    };
  }, [audioPath, audioUrl]);

  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setPositionMs(audio.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    // Replaying from the end would show nothing new — start over instead.
    if (positionMs >= audioDurationMs - 200) {
      audio.currentTime = 0;
      setPositionMs(0);
    }
    void audio.play().then(() => setIsPlaying(true));
  }

  function seek(ms: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    setPositionMs(ms);
  }

  async function removeAudio() {
    const id = createdId;
    if (!id) return;
    const result = await deleteDrawingAudio(id);
    if (result.error) {
      notify.error("Não foi possível remover", result.error);
      return;
    }
    audioRef.current?.pause();
    setIsPlaying(false);
    setPositionMs(0);
    setAudioPath(null);
    setAudioUrl(null);
    setAudioDurationMs(0);
  }

  // Playback reveals the page as it was drawn; any other time the full page
  // is on screen (including strokes added outside a recording, which carry no
  // timeline position at all — see `Stroke.t`).
  const revealUntilMs = isPlaying || (audioPath !== null && positionMs > 0) ? positionMs : undefined;

  return (
    <div className="flex h-dvh w-full flex-col">
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex items-center gap-2 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="sm" leftIcon={<ArrowLeft />} onClick={() => router.push("/notes")}>
            <span className="hidden sm:inline">Voltar</span>
          </Button>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título do desenho"
            aria-label="Título do desenho"
            className="min-w-0 flex-1 bg-transparent font-heading text-lg leading-tight outline-none placeholder:text-muted-foreground/50"
          />

          <SyncStatusIndicator status={current?.syncStatus ?? "local"} />

          {current && (
            <button
              type="button"
              onClick={() => togglePin(current.id)}
              aria-label={pinned ? "Desafixar nota" : "Fixar nota"}
              aria-pressed={pinned}
              className={cn(
                "rounded-full p-2 transition-colors",
                pinned
                  ? "bg-primary/[0.18] text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Pin className={cn("size-4", pinned && "fill-current")} />
            </button>
          )}
        </header>

        <div className="flex justify-center px-3 pb-2">
          <DrawingToolbar
            tool={tool}
            color={color}
            size={tool === "highlighter" ? HIGHLIGHTER_SIZE : penSize}
            canUndo={past.length > 0}
            canRedo={future.length > 0}
            onToolChange={setTool}
            onColorChange={setColor}
            onSizeChange={setPenSize}
            onUndo={undo}
            onRedo={redo}
            onClear={() => setClearOpen(true)}
          />
        </div>

        <DrawingCanvas
          strokes={strokes}
          tool={tool}
          color={color}
          size={tool === "highlighter" ? HIGHLIGHTER_SIZE : penSize}
          readOnly={isPlaying}
          revealUntilMs={revealUntilMs}
          recordingElapsed={recorder.elapsedNow}
          onCommitStroke={commitStroke}
          onEraseStrokes={eraseStrokes}
          className="px-3 pb-2"
        />

        <div className="flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <DrawingAudioBar
            recorderState={recorder.state}
            recordingElapsedMs={recorder.elapsedMs}
            hasAudio={audioPath !== null}
            isPlaying={isPlaying}
            positionMs={positionMs}
            durationMs={audioDurationMs}
            pendingUpload={pendingUpload}
            onStartRecording={() => void startRecording()}
            onStopRecording={() => void stopRecording()}
            onTogglePlay={togglePlay}
            onSeek={seek}
            onRetryUpload={() => {
              const recording = pendingRecordingRef.current;
              if (recording) void uploadRecording(recording);
            }}
            onDeleteAudio={() => void removeAudio()}
          />
        </div>
      </motion.main>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onLoadedMetadata={(e) => {
            // MediaRecorder's WebM carries no duration in its header, so the
            // element reports Infinity and refuses to seek. Forcing the
            // playhead past the end makes the browser scan the file and
            // resolve a real duration; it then seeks normally. Harmless for
            // formats (mp4) that already declare one.
            const audio = e.currentTarget;
            if (audio.duration === Infinity) {
              audio.currentTime = 1e101;
              audio.currentTime = 0;
            }
          }}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          hidden
        />
      )}

      <ConfirmVault
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Apagar todo o desenho?"
        description="Todos os traços desta página serão removidos. A gravação de áudio, se houver, é mantida."
        confirmLabel="Apagar"
        onConfirm={() => {
          pushHistory(strokes);
          setStrokes([]);
        }}
      />
    </div>
  );
}
