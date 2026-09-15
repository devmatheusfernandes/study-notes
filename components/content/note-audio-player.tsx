"use client";

import { useCallback, useRef } from "react";
import { Pause, Play, Trash2, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NoteAudioPlayerProps {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  /** A recording whose upload failed — kept in memory so it can be retried instead of lost. */
  pendingUpload: boolean;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
  onRetryUpload: () => void;
  onDelete: () => void;
  /** Drops the pill styling for when this sits inside the drawing toolbar, which already is one. */
  embedded?: boolean;
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * The note's recording, and the handle that scrubs its synced handwriting:
 * dragging here rewinds the ink along with the audio (see `revealUntilMs` in
 * note-editor.tsx).
 */
export function NoteAudioPlayer({
  isPlaying,
  positionMs,
  durationMs,
  pendingUpload,
  onTogglePlay,
  onSeek,
  onRetryUpload,
  onDelete,
  embedded = false,
}: NoteAudioPlayerProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const shell = embedded
    ? "flex items-center gap-2"
    : "flex items-center gap-2 rounded-full border border-border bg-card/80 px-2.5 py-1.5";

  // Built from a plain element rather than a UI primitive because the app has
  // no slider yet and this is the only thing that would use one — see the
  // "extend, don't fork" rule in CLAUDE.md if a second consumer appears.
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || durationMs === 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(ratio * durationMs);
    },
    [durationMs, onSeek]
  );

  if (pendingUpload) {
    return (
      <div className={shell}>
        <Button variant="outline" size="xs" leftIcon={<UploadCloud />} onClick={onRetryUpload}>
          Reenviar gravação
        </Button>
        <span className="text-[12px] text-muted-foreground">O envio do áudio falhou.</span>
      </div>
    );
  }

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <div className={shell}>
      <Button
        variant="secondary"
        size="sm"
        aria-label={isPlaying ? "Pausar" : "Reproduzir"}
        onClick={onTogglePlay}
        className="px-2.5"
      >
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>

      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatTime(positionMs)}
      </span>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Posição da gravação"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs)}
        aria-valuenow={Math.round(positionMs)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) seekFromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, positionMs - 5000));
          if (e.key === "ArrowRight") onSeek(Math.min(durationMs, positionMs + 5000));
        }}
        className={cn(
          "relative h-6 cursor-pointer touch-none",
          // Inside the toolbar the row is `w-max`, so `flex-1` would collapse
          // the track to nothing — it needs a width of its own there.
          embedded ? "w-24 shrink-0" : "min-w-20 flex-1"
        )}
      >
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <span
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${progress * 100}%` }}
        />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${progress * 100}%` }}
        />
      </div>

      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatTime(durationMs)}
      </span>

      <Button
        variant="ghost"
        size="sm"
        aria-label="Excluir gravação"
        onClick={onDelete}
        className="px-2.5 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
