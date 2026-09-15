"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Eraser, Hand, Highlighter, Mic, Pause, Pen, Play, Redo2, Square, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  HIGHLIGHT_COLORS,
  INK_COLORS,
  PEN_SIZES,
  type DrawTool,
} from "@/lib/drawing/strokes";
import type { RecorderState } from "@/hooks/use-audio-recorder";

interface DrawingToolbarProps {
  tool: DrawTool;
  color: string;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  penOnly: boolean;
  recorderState: RecorderState;
  recordingElapsedMs: number;
  onToolChange: (tool: DrawTool) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onPenOnlyChange: (penOnly: boolean) => void;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onStopRecording: () => void;
  /** Feedback for the stop → upload round trip, so ending a recording visibly succeeds instead of the timer just vanishing. */
  audioSaveState: "idle" | "saving" | "saved";
  /** The note's player, rendered inline here so a recording doesn't cost the note a second row. */
  audioSlot?: ReactNode;
  className?: string;
}

const TOOLS: { id: DrawTool; label: string; icon: typeof Pen }[] = [
  { id: "pen", label: "Caneta", icon: Pen },
  { id: "highlighter", label: "Marca-texto", icon: Highlighter },
  { id: "eraser", label: "Borracha", icon: Eraser },
];

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

export function DrawingToolbar({
  tool,
  color,
  size,
  canUndo,
  canRedo,
  penOnly,
  recorderState,
  recordingElapsedMs,
  onToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  onRedo,
  onClear,
  onPenOnlyChange,
  onStartRecording,
  onPauseRecording,
  onResumeRecording,
  onStopRecording,
  audioSaveState,
  audioSlot,
  className,
}: DrawingToolbarProps) {
  const palette = tool === "highlighter" ? HIGHLIGHT_COLORS : INK_COLORS;
  const isRecording = recorderState === "recording";
  const isPaused = recorderState === "paused";

  return (
    // Scrolls sideways rather than wrapping or squeezing: on a phone the full
    // set of tools can't fit a single line, and wrapping pushed the note's own
    // content down by a whole row every time pen mode was on.
    <div
      className={cn(
        "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      <div className="mx-auto flex w-max items-center gap-2 rounded-full border border-border bg-card/90 px-2 py-1.5 backdrop-blur-md">
        <div className="flex shrink-0 items-center gap-1">
          {TOOLS.map((item) => (
            <Button
              key={item.id}
              variant={tool === item.id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={tool === item.id}
              aria-label={item.label}
              onClick={() => onToolChange(item.id)}
              className={cn("px-2.5", tool === item.id && "text-accent")}
            >
              <item.icon className="size-4" />
            </Button>
          ))}
        </div>

        <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

        {tool !== "eraser" && (
          <>
            <div className="flex shrink-0 items-center gap-1.5">
              {palette.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Cor ${swatch}`}
                  aria-pressed={color === swatch}
                  onClick={() => onColorChange(swatch)}
                  style={{ backgroundColor: swatch }}
                  className={cn(
                    "size-6 shrink-0 rounded-full border transition-transform",
                    color === swatch
                      ? "scale-110 border-accent ring-2 ring-accent/40"
                      : "border-border hover:scale-105"
                  )}
                />
              ))}
            </div>

            {tool === "pen" && (
              <>
                <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
                <div className="flex shrink-0 items-center gap-1">
                  {PEN_SIZES.map((penSize) => (
                    <button
                      key={penSize}
                      type="button"
                      aria-label={`Espessura ${penSize}`}
                      aria-pressed={size === penSize}
                      onClick={() => onSizeChange(penSize)}
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                        size === penSize ? "bg-secondary" : "hover:bg-secondary/60"
                      )}
                    >
                      <span
                        className={cn("rounded-full bg-foreground", size === penSize && "bg-accent")}
                        style={{ width: penSize + 2, height: penSize + 2 }}
                      />
                    </button>
                  ))}
                </div>
              </>
            )}

            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
          </>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Desfazer" disabled={!canUndo} onClick={onUndo} className="px-2.5">
            <Undo2 className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Refazer" disabled={!canRedo} onClick={onRedo} className="px-2.5">
            <Redo2 className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Apagar traços" onClick={onClear} className="px-2.5 text-destructive">
            <Trash2 className="size-4" />
          </Button>
        </div>

        <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

        <Button
          variant={penOnly ? "secondary" : "ghost"}
          size="sm"
          aria-label="Escrever só com a caneta"
          aria-pressed={penOnly}
          onClick={() => onPenOnlyChange(!penOnly)}
          className={cn("px-2.5", penOnly && "text-accent")}
        >
          <Hand className="size-4" />
        </Button>

        <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

        {isRecording || isPaused ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant={isPaused ? "secondary" : "ghost"}
              size="sm"
              aria-label={isPaused ? "Retomar gravação" : "Pausar gravação"}
              onClick={isPaused ? onResumeRecording : onPauseRecording}
              className="px-2.5"
            >
              {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </Button>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 font-mono text-[12px] tabular-nums",
                isPaused ? "text-muted-foreground" : "text-destructive"
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  isPaused ? "bg-muted-foreground" : "animate-pulse bg-destructive"
                )}
              />
              {formatTime(recordingElapsedMs)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Encerrar gravação"
              onClick={onStopRecording}
              className="px-2.5 text-destructive"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          </div>
        ) : audioSaveState !== "idle" ? (
          <AnimatePresence mode="wait">
            <motion.span
              key={audioSaveState}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "flex shrink-0 items-center gap-2 px-1 text-[12px]",
                audioSaveState === "saved" ? "text-success" : "text-muted-foreground"
              )}
            >
              {audioSaveState === "saving" ? (
                <>
                  {/* Three bars rising and falling — a recording being written, not a generic spinner. */}
                  <span className="flex items-end gap-0.5" aria-hidden>
                    {[0, 0.15, 0.3].map((delay) => (
                      <motion.span
                        key={delay}
                        className="w-0.5 rounded-full bg-accent"
                        animate={{ height: [4, 12, 4] }}
                        transition={{ duration: 0.7, repeat: Infinity, delay, ease: "easeInOut" }}
                      />
                    ))}
                  </span>
                  Salvando áudio…
                </>
              ) : (
                <>
                  <Check className="size-3.5" />
                  Gravação salva
                </>
              )}
            </motion.span>
          </AnimatePresence>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Gravar áudio"
            onClick={onStartRecording}
            className="px-2.5"
          >
            <Mic className="size-4" />
          </Button>
        )}

        {audioSlot && (
          <>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
            <div className="shrink-0">{audioSlot}</div>
          </>
        )}
      </div>
    </div>
  );
}
