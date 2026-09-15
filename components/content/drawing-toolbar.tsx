"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Eraser,
  Hand,
  Highlighter,
  MoreHorizontal,
  Pause,
  Pen,
  Play,
  Redo2,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/**
 * Sits inline in the note's header, so it has to stay small: only the choices
 * made constantly (which tool, undo, record) are buttons. Ink colour and
 * thickness live behind the swatch that already shows the current one, and
 * one-off settings behind the overflow menu — laying all eighteen controls out
 * in a row turned the header into an unusable strip.
 */
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
  const [inkOpen, setInkOpen] = useState(false);
  const palette = tool === "highlighter" ? HIGHLIGHT_COLORS : INK_COLORS;
  const isRecording = recorderState === "recording";
  const isPaused = recorderState === "paused";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {/* Tools — one segmented control, so it reads as a single choice. */}
      <div className="flex shrink-0 items-center rounded-full border border-border bg-card/90 p-0.5">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tool === item.id}
            aria-label={item.label}
            onClick={() => onToolChange(item.id)}
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              tool === item.id
                ? "bg-secondary text-accent"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <item.icon className="size-4" />
          </button>
        ))}
      </div>

      {/* Ink — the swatch is both the current state and the way to change it. */}
      {tool !== "eraser" && (
        <DropdownMenu open={inkOpen} onOpenChange={setInkOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Cor e espessura"
              className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-border bg-card/90 pl-1.5 pr-2 transition-colors hover:bg-secondary"
            >
              <span
                className="size-5 rounded-full border border-border"
                style={{ backgroundColor: color }}
              />
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-auto p-3">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-6 gap-2">
                {palette.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Cor ${swatch}`}
                    aria-pressed={color === swatch}
                    onClick={() => {
                      onColorChange(swatch);
                      setInkOpen(false);
                    }}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      "size-8 rounded-full border transition-transform",
                      color === swatch
                        ? "scale-110 border-accent ring-2 ring-accent/40"
                        : "border-border hover:scale-105"
                    )}
                  />
                ))}
              </div>

              {tool === "pen" && (
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  {PEN_SIZES.map((penSize) => (
                    <button
                      key={penSize}
                      type="button"
                      aria-label={`Espessura ${penSize}`}
                      aria-pressed={size === penSize}
                      onClick={() => {
                        onSizeChange(penSize);
                        setInkOpen(false);
                      }}
                      className={cn(
                        "flex h-9 flex-1 items-center justify-center rounded-lg transition-colors",
                        size === penSize ? "bg-secondary" : "hover:bg-secondary/60"
                      )}
                    >
                      <span
                        className={cn("rounded-full bg-foreground", size === penSize && "bg-accent")}
                        style={{ width: penSize + 3, height: penSize + 3 }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="flex shrink-0 items-center">
        <Button variant="ghost" size="sm" aria-label="Desfazer" disabled={!canUndo} onClick={onUndo} className="px-2">
          <Undo2 className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Refazer" disabled={!canRedo} onClick={onRedo} className="px-2">
          <Redo2 className="size-4" />
        </Button>
      </div>

      {/* Recording — the one control that changes shape with its state. */}
      {isRecording || isPaused ? (
        <div className="flex shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 pl-1 pr-1.5">
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
      ) : audioSaveState !== "idle" ? (
        <AnimatePresence mode="wait">
          <motion.span
            key={audioSaveState}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18 }}
            className={cn(
              "flex shrink-0 items-center gap-2 whitespace-nowrap px-2 text-[12px]",
              audioSaveState === "saved" ? "text-success" : "text-muted-foreground"
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
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Gravar áudio"
          onClick={onStartRecording}
          className="shrink-0 gap-1.5 px-2.5"
        >
          <span className="size-2.5 rounded-full bg-destructive" aria-hidden />
          <span className="max-lg:sr-only">Gravar</span>
        </Button>
      )}

      {audioSlot && <div className="shrink-0">{audioSlot}</div>}

      {/* Everything set once and forgotten. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Mais opções" className="shrink-0 px-2">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onPenOnlyChange(!penOnly)}>
            <Hand className="size-4" />
            Só caneta
            {penOnly && <Check className="ml-auto size-4 text-accent" />}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onClear}>
            <Trash2 className="size-4" />
            Apagar traços
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
