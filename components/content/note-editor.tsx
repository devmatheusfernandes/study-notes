"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ImagePlus, PenLine, Pin, Share } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { SyncStatusIndicator } from "@/components/content/sync-status";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/content/rich-text-editor";
import { NoteReferenceSurface } from "@/components/content/note-reference-surface";
import { DrawingCanvas } from "@/components/content/drawing-canvas";
import { DrawingToolbar } from "@/components/content/drawing-toolbar";
import { NoteAudioPlayer } from "@/components/content/note-audio-player";
import { useNotesStore } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { bodyToPlainText } from "@/lib/note-preview";
import { shareNote } from "@/lib/share";
import { useHydrated } from "@/components/providers/store-hydration";
import { useAudioRecorder, type Recording } from "@/hooks/use-audio-recorder";
import { createClient } from "@/lib/supabase/client";
import { NOTE_AUDIO_BUCKET } from "@/lib/storage-config";
import {
  HIGHLIGHTER_SIZE,
  INK_COLORS,
  PAGE_WIDTH,
  PEN_SIZES,
  lowestInkY,
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
import { listPublicationSymbols } from "@/app/(app)/jwpub-actions";
import { listGlobalPublicationSymbols } from "@/app/(app)/global-publications-actions";
import type { NoteOption, PublicationOption } from "@/lib/notes/reference-suggestions";
import type { NoteReference } from "@/lib/notes/note-reference";

interface NoteEditorProps {
  /** Existing note id, or undefined for a brand-new note. */
  noteId?: string;
  initialNote?: {
    id: string;
    title: string;
    body: string;
  } | null;
  /** The note's handwriting layer and voice recording, if it has either. */
  initialDrawing?: DrawingRow | null;
  /**
   * Overrides the "Voltar" button's navigation. Used by OfflineNoteView (the
   * Service Worker's fallback body for a failed /notes/[id] navigation — see
   * app/sw.ts): that page's embedded route tree is /notes-offline's own, not
   * /notes/[id]'s, so a Next `router.push` from there would navigate against
   * a mismatched client router state. A real `window.location` assignment
   * (full reload) sidesteps that entirely.
   */
  onBack?: () => void;
}

export function NoteEditor({ noteId, initialNote, initialDrawing, onBack }: NoteEditorProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  // Read client-side (not as server searchParams) so /notes/new stays a
  // static shell — see the comment on that page.
  const searchParams = useSearchParams();
  const initialBody = noteId ? "" : searchParams.get("q") ?? "";
  const folderId = noteId ? undefined : searchParams.get("folder") ?? undefined;
  // Same `?text=` convention chat-message.tsx already sends jwpub notes to
  // (see JwpubChapterView's own highlight effect) — reused here so a note
  // opened from a search result (see notes-collection.tsx) or a chat source
  // jumps straight to where the term appears instead of just opening at the top.
  const highlight = searchParams.get("text");

  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const togglePin = useNotesStore((s) => s.togglePin);
  const saveDrawingStrokes = useNotesStore((s) => s.saveDrawingStrokes);

  const existing = noteId ? (notes.find((n) => n.id === noteId) ?? initialNote) : undefined;

  const effectiveTitle =
    existing?.title && existing.title.trim().length > 0
      ? existing.title
      : initialNote?.title && initialNote.title.trim().length > 0
      ? initialNote.title
      : "";

  const effectiveBody =
    existing?.body && existing.body.trim().length > 0
      ? existing.body
      : initialNote?.body && initialNote.body.trim().length > 0
      ? initialNote.body
      : initialBody;

  const [title, setTitle] = useState(effectiveTitle);
  const [body, setBody] = useState(effectiveBody);
  // Once a new note is persisted we keep writing to that same id.
  const [createdId, setCreatedId] = useState<string | null>(noteId ?? null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  // "@" note-linking candidates — plain notes only (not files/publications),
  // excludes this note itself so it can't reference its own text, and reads
  // straight from the already-hydrated store rather than a server round trip
  // (the whole point of the offline-first store is that every note the user
  // owns is already sitting in memory).
  const noteMentionOptions: NoteOption[] = useMemo(
    () =>
      notes
        .filter((n) => n.type === "nota" && n.status === "active" && n.id !== createdId && n.title.trim())
        .map((n) => ({ id: n.id, title: n.title })),
    [notes, createdId]
  );

  // ── Handwriting layer ─────────────────────────────────────────────────────
  // Any note can carry ink over its text — there is no separate "drawing note"
  // type, the same way Samsung Notes lets one page hold both.
  const [penMode, setPenMode] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>(() => parseDoc(initialDrawing?.strokes).strokes);
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<DrawTool>("pen");
  const [inkColor, setInkColor] = useState<string>(INK_COLORS[0]);
  const [penSize, setPenSize] = useState<number>(PEN_SIZES[1]);
  const [clearInkOpen, setClearInkOpen] = useState(false);
  const inkDirtyRef = useRef(false);
  const penOnly = usePreferencesStore((s) => s.penOnly);
  const setPenOnly = usePreferencesStore((s) => s.setPenOnly);

  // The ink layer must stay tall enough to hold every stroke even if the text
  // under it later shrinks — otherwise handwriting past the new bottom is
  // clipped, and can't be erased because it no longer has a surface.
  const inkWrapRef = useRef<HTMLDivElement>(null);
  const [inkWrapWidth, setInkWrapWidth] = useState(0);
  useEffect(() => {
    const wrap = inkWrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => setInkWrapWidth(wrap.getBoundingClientRect().width));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);
  const inkMinHeight = inkWrapWidth > 0 ? (lowestInkY(strokes) + 40) * (inkWrapWidth / PAGE_WIDTH) : 0;

  // ── Voice recording ───────────────────────────────────────────────────────
  const recorder = useAudioRecorder();
  const [audioPath, setAudioPath] = useState<string | null>(initialDrawing?.audioPath ?? null);
  const [audioDurationMs, setAudioDurationMs] = useState(initialDrawing?.audioDurationMs ?? 0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [pendingUpload, setPendingUpload] = useState(false);
  const pendingRecordingRef = useRef<Recording | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Baseline to diff autosaves against, for an EXISTING note only — `null`
  // for a brand-new one, so its very first save still goes through
  // unconditionally (see the autosave effect below) whether or not the user
  // has typed anything beyond an initial `?q=` draft.
  const lastSaved = useRef<{ title: string; body: string } | null>(
    noteId ? { title: effectiveTitle, body: effectiveBody } : null
  );

  // The user's .jwpub library, for in-note references: it decides whether a
  // typed "(th 2)" is a real reference and it populates the "/" menu. Fetched
  // once here rather than per keystroke — a note is edited far more often
  // than the library changes.
  const [publications, setPublications] = useState<PublicationOption[]>([]);
  const [openReference, setOpenReference] = useState<NoteReference | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listPublicationSymbols(), listGlobalPublicationSymbols()]).then(
      ([own, global]) => {
        if (cancelled) return;
        // Own entries win on a symbol collision — they're what the user
        // actually has open in their own library, so "(th 2)" should resolve
        // there even if a shared copy also exists.
        const ownSymbols = new Set(own.publications.map((p) => p.symbol));
        const merged = [
          ...own.publications,
          ...global.publications.filter((p) => !ownSymbols.has(p.symbol)),
        ];
        setPublications(merged);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Read through refs so `ensureNote` keeps a stable identity while the user
  // types — otherwise every keystroke re-creates it and restarts the ink
  // save debounce that depends on it.
  const titleRef = useRef(title);
  const bodyRef = useRef(body);
  useEffect(() => {
    titleRef.current = title;
    bodyRef.current = body;
  }, [title, body]);

  /**
   * Creates the note row on first use — by typing, by drawing, or by hitting
   * record — so every one of those paths lands on the same single note instead
   * of racing each other into two.
   */
  const ensureNote = useCallback(
    (seed?: { title?: string; body?: string }) => {
      if (createdId) return createdId;
      const id = addNote({
        title: (seed?.title ?? titleRef.current).trim() || "Nova nota",
        body: seed?.body ?? bodyRef.current,
        folderId,
      });
      setCreatedId(id);
      // Not router.replace(): that navigates from the /notes/new route tree
      // to /notes/[id], which remounts this whole component (replaying the
      // entrance animation and dropping focus — the "flicker"). A plain
      // history update keeps this same instance alive and just relabels
      // the URL bar, since nothing here actually depends on route params.
      window.history.replaceState(null, "", `/notes/${id}`);
      return id;
    },
    [createdId, addNote, folderId]
  );

  // Debounced autosave. Guarded against re-saving content that's identical
  // to what was already loaded/persisted — merely opening an existing note
  // was re-triggering this (once `hydrated` flips true, `title`/`body`
  // change as dependencies even though nothing in them actually changed),
  // which through updateNoteRow unconditionally re-queues the note for
  // vectorization (a real OpenAI embedding call) on every open, not just
  // every real edit.
  useEffect(() => {
    if (!hydrated) return;
    if (!title.trim() && !body.trim()) return;
    if (lastSaved.current && title === lastSaved.current.title && body === lastSaved.current.body) return;

    const timer = setTimeout(() => {
      lastSaved.current = { title, body };
      if (createdId) updateNote(createdId, { title: title.trim() || "Nova nota", body });
      else ensureNote({ title, body });
    }, 600);

    return () => clearTimeout(timer);
  }, [title, body, hydrated, ensureNote, updateNote, createdId]);

  // Ink is saved on its own debounce — a stroke is a bigger, less frequent
  // change than a keystroke, and it goes to `note_drawings`, not `notes.body`.
  useEffect(() => {
    if (!hydrated || !inkDirtyRef.current) return;
    const timer = setTimeout(() => {
      const id = ensureNote();
      saveDrawingStrokes(id, serializeDoc({ version: 1, strokes }));
      inkDirtyRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [strokes, hydrated, ensureNote, saveDrawingStrokes]);

  // Jumps to (and selects, so it's visually highlighted) the first
  // occurrence of the search term once the editor has real content to search —
  // `body` only carries the note's actual text once the store has hydrated,
  // so this keeps retrying (cheaply — it's just a doc walk) until that lands
  // instead of firing once too early and silently finding nothing. Left in
  // the URL afterward rather than stripped, matching JwpubChapterView's own
  // `?text=` handling — reloading the same link re-highlights the same spot.
  const highlightApplied = useRef(false);
  useEffect(() => {
    if (!highlight || highlightApplied.current || !body) return;

    // `body` being non-empty doesn't guarantee the Tiptap editor itself has
    // finished mounting yet — RichTextEditor's own `useEditor` returns null
    // for a render or two (`immediatelyRender: false`), and this effect only
    // re-fires when `highlight`/`body` change, neither of which happens again
    // once the note is loaded. So poll briefly instead of trying once.
    const target = highlight;
    let cancelled = false;
    let attempts = 0;
    function attempt() {
      if (cancelled) return;
      if (editorRef.current?.scrollToText(target)) {
        highlightApplied.current = true;
        return;
      }
      attempts += 1;
      if (attempts < 20) setTimeout(attempt, 150);
    }
    attempt();
    return () => {
      cancelled = true;
    };
  }, [highlight, body]);

  // ── Ink editing ───────────────────────────────────────────────────────────
  const pushInkHistory = useCallback((previous: Stroke[]) => {
    // 40 steps is plenty for a page of handwriting and keeps the snapshots
    // (whole stroke arrays) from growing without bound.
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
        // One sweep of the eraser is one undo step: only the first hit of the
        // drag snapshots, the rest just keep removing.
        if (startsGesture) pushInkHistory(previous);
        else inkDirtyRef.current = true;
        return remaining;
      });
    },
    [pushInkHistory]
  );

  function undoInk() {
    setPast((stack) => {
      if (stack.length === 0) return stack;
      setFuture((f) => [strokes, ...f]);
      setStrokes(stack[stack.length - 1]);
      inkDirtyRef.current = true;
      return stack.slice(0, -1);
    });
  }

  function redoInk() {
    setFuture((stack) => {
      if (stack.length === 0) return stack;
      setPast((p) => [...p, strokes]);
      setStrokes(stack[0]);
      inkDirtyRef.current = true;
      return stack.slice(1);
    });
  }

  // ── Recording ─────────────────────────────────────────────────────────────
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
  }

  async function startRecording() {
    // The row must exist before Storage can accept a path under its id.
    ensureNote();
    const result = await recorder.start();
    if (result.error) notify.error("Gravação indisponível", result.error);
  }

  async function stopRecording() {
    const recording = await recorder.stop();
    if (recording) await uploadRecording(recording);
  }

  const isRecordingNow = recorder.state === "recording" || recorder.state === "paused";

  /** Leaving mid-recording would drop the take on the floor — close it out first, then navigate. */
  async function leaveNote() {
    if (isRecordingNow) await stopRecording();
    if (onBack) onBack();
    else router.push("/notes");
  }

  // Reloading or closing the tab can't be awaited, so all this can do is ask.
  useEffect(() => {
    if (!isRecordingNow) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isRecordingNow]);

  // ── Playback ──────────────────────────────────────────────────────────────
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
    if (!createdId) return;
    const result = await deleteDrawingAudio(createdId);
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

  // Playback rewinds the handwriting along with the audio; any other time the
  // full page is on screen (including strokes written outside a recording,
  // which carry no timeline position at all — see `Stroke.t`).
  const revealUntilMs = isPlaying || (audioPath !== null && positionMs > 0) ? positionMs : undefined;

  const current = createdId ? notes.find((n) => n.id === createdId) : undefined;
  const pinned = current?.pinned ?? false;

  return (
    // Row, not just the main column: the reference panel is a flex sibling
    // (same arrangement as JwpubReader), so opening it narrows the note
    // instead of floating over the text the user is writing.
    <div className="flex min-h-dvh w-full">
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="flex items-center gap-2 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft />}
            onClick={() => void leaveNote()}
          >
            Voltar
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const result = await shareNote(title || "Nova nota", bodyToPlainText(body));
                if (result === "copied") notify.success("Copiado", "O conteúdo da nota foi copiado.");
              }}
              aria-label="Compartilhar nota"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Share className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => editorRef.current?.openImagePicker()}
              aria-label="Inserir imagem"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ImagePlus className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPenMode((on) => !on)}
              aria-label={penMode ? "Voltar a digitar" : "Escrever à mão"}
              aria-pressed={penMode}
              className={cn(
                "rounded-full p-2 transition-colors",
                penMode
                  ? "bg-primary/[0.18] text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <PenLine className="size-4" />
            </button>
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
          </div>
        </header>

        {(penMode || audioPath !== null || pendingUpload) && (
          <div className="sticky top-0 z-20 flex flex-col gap-2 bg-background/85 px-3 py-2 backdrop-blur-md">
            {penMode && (
              <DrawingToolbar
                tool={tool}
                color={inkColor}
                size={tool === "highlighter" ? HIGHLIGHTER_SIZE : penSize}
                canUndo={past.length > 0}
                canRedo={future.length > 0}
                penOnly={penOnly}
                recorderState={recorder.state}
                recordingElapsedMs={recorder.elapsedMs}
                onToolChange={setTool}
                onColorChange={setInkColor}
                onSizeChange={setPenSize}
                onUndo={undoInk}
                onRedo={redoInk}
                onClear={() => setClearInkOpen(true)}
                onPenOnlyChange={setPenOnly}
                onStartRecording={() => void startRecording()}
                onPauseRecording={recorder.pause}
                onResumeRecording={recorder.resume}
                onStopRecording={() => void stopRecording()}
              />
            )}
            {(audioPath !== null || pendingUpload) && (
              <div className="flex justify-center">
                <NoteAudioPlayer
                  isPlaying={isPlaying}
                  positionMs={positionMs}
                  durationMs={audioDurationMs}
                  pendingUpload={pendingUpload}
                  onTogglePlay={togglePlay}
                  onSeek={seek}
                  onRetryUpload={() => {
                    const recording = pendingRecordingRef.current;
                    if (recording) void uploadRecording(recording);
                  }}
                  onDelete={() => void removeAudio()}
                />
              </div>
            )}
          </div>
        )}

        {/* The ink layer spans this whole column, not just the text's reading
            width — handwriting shouldn't stop at a margin the typing happens
            to use. */}
        <div ref={inkWrapRef} className="relative flex flex-1 flex-col" style={{ minHeight: inkMinHeight || undefined }}>
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-16 sm:px-6">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título da nota"
              aria-label="Título da nota"
              autoFocus={!noteId}
              className="w-full bg-transparent font-heading text-3xl leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50"
            />

            <SyncStatusIndicator status={current?.syncStatus ?? "local"} />

            <RichTextEditor
              ref={editorRef}
              content={body}
              onChange={setBody}
              autoFocus={!noteId}
              className="flex flex-1 flex-col"
              publications={publications}
              notes={noteMentionOptions}
              onReferenceClick={setOpenReference}
            />
          </div>

          <DrawingCanvas
            strokes={strokes}
            tool={tool}
            color={inkColor}
            size={tool === "highlighter" ? HIGHLIGHTER_SIZE : penSize}
            active={penMode && !isPlaying}
            penOnly={penOnly}
            // A stylus showing up is proof this device has one, so palm
            // rejection turns itself on the first time the pen touches the
            // screen — the toolbar's own toggle then overrides it either way.
            onPenDetected={() => setPenOnly(true)}
            revealUntilMs={revealUntilMs}
            recordingElapsed={recorder.elapsedNow}
            onCommitStroke={commitStroke}
            onEraseStrokes={eraseStrokes}
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
        open={clearInkOpen}
        onOpenChange={setClearInkOpen}
        title="Apagar o que foi escrito à mão?"
        description="Todos os traços desta nota serão removidos. O texto digitado e a gravação, se houver, são mantidos."
        confirmLabel="Apagar"
        onConfirm={() => {
          pushInkHistory(strokes);
          setStrokes([]);
        }}
      />

      <NoteReferenceSurface
        reference={openReference}
        onClose={() => setOpenReference(null)}
        onOpenNote={(id) => router.push(`/notes/${id}`)}
      />
    </div>
  );
}
