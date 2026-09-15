"use client";

import { Eraser, Highlighter, Mic, Pen, Redo2, Square, Trash2, Undo2 } from "lucide-react";
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
  recorderState: RecorderState;
  recordingElapsedMs: number;
  onToolChange: (tool: DrawTool) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
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
  recorderState,
  recordingElapsedMs,
  onToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  onRedo,
  onClear,
  onStartRecording,
  onStopRecording,
}: DrawingToolbarProps) {
  const palette = tool === "highlighter" ? HIGHLIGHT_COLORS : INK_COLORS;
  const isRecording = recorderState === "recording";

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 rounded-full border border-border bg-card/90 px-2 py-1.5 backdrop-blur-md">
      <div className="flex items-center gap-1">
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

      <span className="h-5 w-px bg-border" aria-hidden />

      {tool !== "eraser" && (
        <>
          <div className="flex items-center gap-1.5">
            {palette.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Cor ${swatch}`}
                aria-pressed={color === swatch}
                onClick={() => onColorChange(swatch)}
                style={{ backgroundColor: swatch }}
                className={cn(
                  "size-6 rounded-full border transition-transform",
                  color === swatch
                    ? "scale-110 border-accent ring-2 ring-accent/40"
                    : "border-border hover:scale-105"
                )}
              />
            ))}
          </div>

          {tool === "pen" && (
            <>
              <span className="h-5 w-px bg-border" aria-hidden />
              <div className="flex items-center gap-1">
                {PEN_SIZES.map((penSize) => (
                  <button
                    key={penSize}
                    type="button"
                    aria-label={`Espessura ${penSize}`}
                    aria-pressed={size === penSize}
                    onClick={() => onSizeChange(penSize)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full transition-colors",
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

          <span className="h-5 w-px bg-border" aria-hidden />
        </>
      )}

      <div className="flex items-center gap-1">
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

      <span className="h-5 w-px bg-border" aria-hidden />

      {isRecording ? (
        <Button
          variant="destructive"
          size="sm"
          leftIcon={<Square className="size-3 fill-current" />}
          onClick={onStopRecording}
          className="font-mono tabular-nums"
        >
          {formatTime(recordingElapsedMs)}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Gravar áudio"
          disabled={recorderState === "saving"}
          onClick={onStartRecording}
          className="px-2.5"
        >
          <Mic className="size-4" />
        </Button>
      )}
    </div>
  );
}
