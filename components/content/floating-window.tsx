"use client";

import { useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, useFloatingWindowsStore, type FloatingRect } from "@/lib/store/floating-windows-store";
import { EmbeddedPanelProvider } from "./embedded-panel-context";

/** Windows sit above the page but under Vault sheets (z-50), so a confirmation or the note editor always wins. */
const BASE_Z = 30;

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const HANDLES: { edge: Edge; className: string }[] = [
  { edge: "n", className: "inset-x-3 top-0 h-1.5 cursor-ns-resize" },
  { edge: "s", className: "inset-x-3 bottom-0 h-1.5 cursor-ns-resize" },
  { edge: "e", className: "inset-y-3 right-0 w-1.5 cursor-ew-resize" },
  { edge: "w", className: "inset-y-3 left-0 w-1.5 cursor-ew-resize" },
  { edge: "ne", className: "right-0 top-0 size-3 cursor-nesw-resize" },
  { edge: "nw", className: "left-0 top-0 size-3 cursor-nwse-resize" },
  { edge: "se", className: "bottom-0 right-0 size-3 cursor-nwse-resize" },
  { edge: "sw", className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
];

interface FloatingWindowProps {
  id: string;
  title: string;
  onClose: () => void;
  /** The scrolling body. */
  children: React.ReactNode;
  /** Panels that cover the body (see EmbeddedPanelProvider) — kept outside the scroller so they don't scroll with it. */
  overlays?: React.ReactNode;
}

/**
 * A movable, resizable window pinned to the viewport (`position: fixed`), so it
 * stays where it is while the page scrolls underneath. Not a modal: nothing
 * behind it is blocked, and several can be open at once. Desktop and tablet only.
 *
 * Pointer events with capture (not mouse events) so a stylus or finger drags it
 * too; the title bar and the handles opt out of touch scrolling for the same reason.
 */
export function FloatingWindow({ id, title, onClose, children, overlays }: FloatingWindowProps) {
  const win = useFloatingWindowsStore((s) => s.windows.find((w) => w.id === id));
  const focus = useFloatingWindowsStore((s) => s.focus);
  const setRect = useFloatingWindowsStore((s) => s.setRect);

  const gesture = useRef<{ kind: "move" | Edge; pointerId: number; startX: number; startY: number; origin: FloatingRect } | null>(null);

  const begin = useCallback(
    (kind: "move" | Edge) => (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !win) return;
      if (kind === "move" && (event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        kind,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: { x: win.x, y: win.y, w: win.w, h: win.h },
      };
      focus(id);
    },
    [win, focus, id]
  );

  const update = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.pointerId !== event.pointerId) return;
      const dx = event.clientX - g.startX;
      const dy = event.clientY - g.startY;
      const { x, y, w, h } = g.origin;

      if (g.kind === "move") {
        setRect(id, { x: x + dx, y: y + dy });
        return;
      }

      let next: FloatingRect = { x, y, w, h };
      if (g.kind.includes("e")) next.w = Math.max(MIN_WINDOW_WIDTH, w + dx);
      if (g.kind.includes("s")) next.h = Math.max(MIN_WINDOW_HEIGHT, h + dy);
      // West/north edges move the origin too, and stop at the minimum size instead of pushing the far edge.
      if (g.kind.includes("w")) {
        next.w = Math.max(MIN_WINDOW_WIDTH, w - dx);
        next.x = x + (w - next.w);
      }
      if (g.kind.includes("n")) {
        next.h = Math.max(MIN_WINDOW_HEIGHT, h - dy);
        next.y = y + (h - next.h);
      }
      next = { ...next };
      setRect(id, next);
    },
    [id, setRect]
  );

  const end = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
  }, []);

  if (!win || typeof document === "undefined") return null;

  return createPortal(
    <EmbeddedPanelProvider value={true}>
      <section
        role="dialog"
        aria-modal="false"
        aria-label={title}
        onPointerDownCapture={() => focus(id)}
        style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: BASE_Z + win.z }}
        className="fixed flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_12px_36px_var(--shadow-strong)]"
      >
        <header
          onPointerDown={begin("move")}
          onPointerMove={update}
          onPointerUp={end}
          onPointerCancel={end}
          className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-border bg-sidebar px-4 py-2.5 active:cursor-grabbing"
        >
          <span className="mr-auto truncate font-heading text-[15px]">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Fechar ${title}`}
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0 overflow-y-auto overscroll-contain p-4">{children}</div>
          {overlays}
        </div>

        {HANDLES.map(({ edge, className }) => (
          <div
            key={edge}
            aria-hidden
            onPointerDown={begin(edge)}
            onPointerMove={update}
            onPointerUp={end}
            onPointerCancel={end}
            className={cn("absolute z-20 touch-none", className)}
          />
        ))}
      </section>
    </EmbeddedPanelProvider>,
    document.body
  );
}
