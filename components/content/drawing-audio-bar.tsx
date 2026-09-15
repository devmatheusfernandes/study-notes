"use client";

import { useCallback, useRef } from "react";
import { Mic, Pause, Play, Square, Trash2, UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RecorderState } from "@/hooks/use-audio-recorder";

interface DrawingAudioBarProps {
  recorderState: RecorderState;
  recordingElapsedMs: number;
  hasAudio: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  /** A recording whose upload failed — kept in memory so it can be retried instead of lost. */
  pendingUpload: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onTogglePlay: () => void;
  onSeek: (ms: number) => void;
  onRetryUpload: () => void;
  onDeleteAudio: () => void;
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function DrawingAudioBar({
  recorderState,
  recordingElapsedMs,
  hasAudio,
  isPlaying,
  positionMs,
  durationMs,
  pendingUpload,
  onStartRecording,
  onStopRecording,
  onTogglePlay,
  onSeek,
  onRetryUpload,
  onDeleteAudio,
}: DrawingAudioBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  // Built from a plain element rather than a UI primitive because the app has
  // no slider yet and a seek bar is the only thing that would use one — see
  // the "extend, don't fork" rule in CLAUDE.md if a second consumer appears.
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || durationMs === 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(ratio * durationMs);
    },
    [durationMs, onSeek]
  );

  const isRecording = recorderState === "recording";
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <div className="flex items-center gap-3 rounded-full border border-border bg-card/80 px-3 py-2 backdrop-blur-md">
      {isRecording ? (
        <>
          <Button
            variant="destructive"
            size="sm"
            leftIcon={<Square className="size-3.5 fill-current" />}
            onClick={onStopRecording}
          >
            Parar
          </Button>
          <span className="flex items-center gap-2 font-mono text-[12px] text-destructive">
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
            {formatTime(recordingElapsedMs)}
          </span>
          <span className="hidden text-[12px] text-muted-foreground sm:inline">
            Escreva enquanto fala — o traço fica sincronizado com o áudio.
          </span>
        </>
      ) : pendingUpload ? (
        <>
          <Button variant="outline" size="sm" leftIcon={<UploadCloud />} onClick={onRetryUpload}>
            Reenviar gravação
          </Button>
          <span className="text-[12px] text-muted-foreground">O envio do áudio falhou.</span>
        </>
      ) : hasAudio ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            aria-label={isPlaying ? "Pausar" : "Reproduzir"}
            onClick={onTogglePlay}
            className="px-2.5"
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>

          <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
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
            className="relative h-6 min-w-24 flex-1 cursor-pointer touch-none"
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

          <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
            {formatTime(durationMs)}
          </span>

          <Button
            variant="ghost"
            size="sm"
            aria-label="Excluir gravação"
            onClick={onDeleteAudio}
            className={cn("px-2.5 text-muted-foreground hover:text-destructive")}
          >
            <Trash2 className="size-4" />
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Mic />}
            disabled={recorderState === "saving"}
            onClick={onStartRecording}
          >
            {recorderState === "saving" ? "Salvando…" : "Gravar áudio"}
          </Button>
          <span className="hidden text-[12px] text-muted-foreground sm:inline">
            A gravação acompanha o que você escrever a partir daqui.
          </span>
        </>
      )}
    </div>
  );
}
