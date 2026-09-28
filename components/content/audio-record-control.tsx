"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Pause, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { RecorderState } from "@/hooks/use-audio-recorder";

interface AudioRecordControlProps {
  recorderState: RecorderState;
  recordingElapsedMs: number;
  /** Feedback for the stop → upload round trip, so ending a recording visibly succeeds instead of the timer just vanishing. */
  audioSaveState: "idle" | "saving" | "saved";
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: () => void;
  className?: string;
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * The one recording control, shared between the pen-mode `DrawingToolbar`
 * and the normal typing header (`NoteEditor`) — recording a voice note
 * shouldn't require picking up the pen first, it just used to only be
 * reachable from there.
 */
export function AudioRecordControl({
  recorderState,
  recordingElapsedMs,
  audioSaveState,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  className,
}: AudioRecordControlProps) {
  const isRecording = recorderState === "recording";
  const isPaused = recorderState === "paused";

  if (isRecording || isPaused) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 pl-1 pr-1.5",
          className
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label={isPaused ? "Retomar gravação" : "Pausar gravação"}
          onClick={isPaused ? onResumeRecording : onPauseRecording}
          className="px-2"
        >
          {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </Button>
        <span
          className={cn(
            "font-mono text-[12px] tabular-nums",
            isPaused ? "text-muted-foreground" : "text-destructive"
          )}
        >
          {formatTime(recordingElapsedMs)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Encerrar gravação"
          onClick={onStopRecording}
          className="px-2 text-destructive"
        >
          <Square className="size-3.5 fill-current" />
        </Button>
      </div>
    );
  }

  if (audioSaveState !== "idle") {
    return (
      <AnimatePresence mode="wait">
        <motion.span
          key={audioSaveState}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "flex shrink-0 items-center gap-2 whitespace-nowrap px-2 text-[12px]",
            audioSaveState === "saved" ? "text-success" : "text-muted-foreground",
            className
          )}
        >
          {audioSaveState === "saving" ? (
            <>
              {/* Bars rising and falling — a recording being written, not a generic spinner. */}
              <span className="flex h-4 items-end gap-0.5" aria-hidden>
                {[0, 0.15, 0.3].map((delay) => (
                  <motion.span
                    key={delay}
                    className="w-0.5 rounded-full bg-accent"
                    animate={{ height: [4, 14, 4] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay, ease: "easeInOut" }}
                  />
                ))}
              </span>
              Salvando…
            </>
          ) : (
            <>
              <Check className="size-3.5" />
              Salva
            </>
          )}
        </motion.span>
      </AnimatePresence>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Gravar áudio"
      onClick={onStartRecording}
      className={cn("shrink-0 gap-1.5 px-2.5", className)}
    >
      <span className="size-2.5 rounded-full bg-destructive" aria-hidden />
      
    </Button>
  );
}
