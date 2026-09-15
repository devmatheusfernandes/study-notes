"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PAGE_WIDTH,
  drawStroke,
  renderStrokes,
  strokesHitBy,
  type DrawPoint,
  type DrawTool,
  type Stroke,
} from "@/lib/drawing/strokes";

interface DrawingCanvasProps {
  strokes: Stroke[];
  tool: DrawTool;
  color: string;
  size: number;
  /** False when the note is in typing mode (or replaying): the layer shows ink but lets every event through to the text underneath. */
  active: boolean;
  /** Only a stylus draws; touch scrolls the note instead. A mouse still draws either way — this is about a resting palm, not about pointing devices. */
  penOnly: boolean;
  /** Fired the first time a real stylus is seen, so the host can switch `penOnly` on by itself. */
  onPenDetected: () => void;
  /** Renders only the ink drawn up to this position on the recording timeline. */
  revealUntilMs?: number;
  /** Current position on the recording timeline, or undefined when not recording — stamped onto each stroke so playback can replay it. */
  recordingElapsed?: () => number | undefined;
  onCommitStroke: (stroke: Stroke) => void;
  /** `startsGesture` marks the first erase of a drag, so one sweep of the eraser is one undo step rather than one per frame. */
  onEraseStrokes: (ids: string[], startsGesture: boolean) => void;
  className?: string;
}

/**
 * Ceiling on each layer's backing store, in device pixels (~12 MP ≈ 48 MB).
 * The ink layer is as tall as the note, so without a cap a long one asks the
 * browser for a buffer it won't give.
 */
const MAX_CANVAS_PIXELS = 12_000_000;

/** The element that actually scrolls behind the ink layer, or null when that's the page itself. */
function scrollableAncestor(from: HTMLElement): HTMLElement | null {
  let node = from.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * A transparent ink layer sized to whatever it covers — in this app, the note
 * being written. It is absolutely positioned over the text rather than being
 * a page of its own, which is what lets one note hold both typing and
 * handwriting instead of forcing the user to pick a note "type" up front.
 */
export function DrawingCanvas({
  strokes,
  tool,
  color,
  size,
  active,
  penOnly,
  onPenDetected,
  revealUntilMs,
  recordingElapsed,
  onCommitStroke,
  onEraseStrokes,
  className,
}: DrawingCanvasProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [box, setBox] = useState({ width: 0, height: 0 });

  const pointsRef = useRef<DrawPoint[]>([]);
  const strokeStartRef = useRef<{ perf: number; t?: number } | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const erasingRef = useRef(false);
  const erasedThisGestureRef = useRef(false);
  const penReportedRef = useRef(false);
  const touchScrollRef = useRef<{ pointerId: number; lastY: number; target: HTMLElement | null } | null>(null);
  const liveDirtyRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = wrap.getBoundingClientRect();
      setBox({ width, height });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /** Page height in the same logical units as the stored points. */
  const logicalHeight = box.width > 0 ? (box.height * PAGE_WIDTH) / box.width : 0;

  /**
   * Sizes a canvas and puts it into logical units. Does NOT clear — callers
   * clear only what they're about to repaint, which for the live layer is a
   * small box rather than the whole note.
   */
  const configure = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || box.width === 0 || box.height === 0) return null;

      // A note grows as it's written on, and a full-height canvas at native
      // device resolution gets enormous — a few screens of writing on a 3x
      // tablet is hundreds of MB per layer, past what the browser will even
      // allocate (it hands back a blank canvas) and enough to take the tab
      // down. Resolution is capped by total area instead, which only starts
      // costing sharpness on notes far longer than a screen.
      const area = box.width * box.height;
      const maxScale = area > 0 ? Math.sqrt(MAX_CANVAS_PIXELS / area) : 1;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, maxScale));

      const pixelWidth = Math.round(box.width * dpr);
      const pixelHeight = Math.round(box.height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const unit = pixelWidth / PAGE_WIDTH;
      ctx.scale(unit, unit);
      return ctx;
    },
    [box]
  );

  const clearLive = useCallback(() => {
    const ctx = configure(liveRef.current);
    const dirty = liveDirtyRef.current;
    if (ctx && dirty) {
      ctx.clearRect(dirty.minX, dirty.minY, dirty.maxX - dirty.minX, dirty.maxY - dirty.minY);
    }
    return ctx;
  }, [configure]);

  useEffect(() => {
    const ctx = configure(baseRef.current);
    if (!ctx) return;
    ctx.clearRect(0, 0, PAGE_WIDTH, logicalHeight);
    renderStrokes(ctx, strokes, revealUntilMs);
  }, [strokes, revealUntilMs, configure, logicalHeight]);

  const toPagePoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = liveRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      return {
        x: ((clientX - rect.left) / rect.width) * PAGE_WIDTH,
        // Same unit on both axes — the layer isn't a fixed-aspect page, so y
        // is simply "how far down", in the width's own units.
        y: (clientY - rect.top) / (rect.width / PAGE_WIDTH),
      };
    },
    []
  );

  const drawLive = useCallback(() => {
    const ctx = clearLive();
    const points = pointsRef.current;
    if (!ctx || points.length === 0) return;

    drawStroke(ctx, {
      id: "live",
      color,
      size,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      points,
    });

    // Remember what was painted so the next frame clears only that, instead of
    // wiping a canvas that may be several screens tall on every pointermove.
    const pad = size * 2 + 8;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (point[0] < minX) minX = point[0];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[1] > maxY) maxY = point[1];
    }
    liveDirtyRef.current = {
      minX: minX - pad,
      minY: minY - pad,
      maxX: maxX + pad,
      maxY: maxY + pad,
    };
  }, [clearLive, color, size, tool]);

  function pushPoint(event: React.PointerEvent, clientX: number, clientY: number, pressure: number) {
    const point = toPagePoint(clientX, clientY);
    if (!point) return;
    const start = strokeStartRef.current;
    if (!start) return;
    pointsRef.current.push([
      Math.round(point.x * 10) / 10,
      Math.round(point.y * 10) / 10,
      // A mouse reports a constant 0.5 and some touchscreens report 0 — both
      // mean "no real pressure", which perfect-freehand then simulates from
      // velocity instead (see `simulatePressure` in lib/drawing/strokes.ts).
      event.pointerType === "pen" ? pressure : 0,
      Math.round(performance.now() - start.perf),
    ]);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    if (event.pointerType === "pen" && !penReportedRef.current) {
      penReportedRef.current = true;
      onPenDetected();
    }
    // Palm rejection: with pen-only on, a hand resting on a tablet scrolls the
    // note rather than painting over the writing. The scrolling is done by
    // hand here because the layer has to keep `touch-action: none` — see the
    // note on the canvas element below.
    if (penOnly && event.pointerType === "touch") {
      event.currentTarget.setPointerCapture(event.pointerId);
      touchScrollRef.current = {
        pointerId: event.pointerId,
        lastY: event.clientY,
        target: scrollableAncestor(event.currentTarget),
      };
      return;
    }
    if (activePointerRef.current !== null) return;

    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "eraser") {
      erasingRef.current = true;
      erasedThisGestureRef.current = false;
      const point = toPagePoint(event.clientX, event.clientY);
      if (point) {
        const hit = strokesHitBy(strokes, point.x, point.y);
        if (hit.length > 0) {
          onEraseStrokes(hit, true);
          erasedThisGestureRef.current = true;
        }
      }
      return;
    }

    strokeStartRef.current = { perf: performance.now(), t: recordingElapsed?.() };
    pointsRef.current = [];
    pushPoint(event, event.clientX, event.clientY, event.pressure);
    drawLive();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const scrolling = touchScrollRef.current;
    if (scrolling?.pointerId === event.pointerId) {
      const delta = scrolling.lastY - event.clientY;
      scrolling.lastY = event.clientY;
      if (scrolling.target) scrolling.target.scrollBy(0, delta);
      else window.scrollBy(0, delta);
      return;
    }

    if (!active || activePointerRef.current !== event.pointerId) return;

    if (erasingRef.current) {
      const point = toPagePoint(event.clientX, event.clientY);
      if (point) {
        const hit = strokesHitBy(strokes, point.x, point.y);
        if (hit.length > 0) {
          onEraseStrokes(hit, !erasedThisGestureRef.current);
          erasedThisGestureRef.current = true;
        }
      }
      return;
    }

    // A stylus reports far faster than the browser fires pointermove; the
    // coalesced queue is what keeps fast handwriting from turning into
    // straight segments between sampled points.
    const native = event.nativeEvent;
    const batch =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    if (batch.length > 0) {
      for (const sample of batch) pushPoint(event, sample.clientX, sample.clientY, sample.pressure);
    } else {
      pushPoint(event, event.clientX, event.clientY, event.pressure);
    }
    drawLive();
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (touchScrollRef.current?.pointerId === event.pointerId) {
      touchScrollRef.current = null;
      return;
    }
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;

    if (erasingRef.current) {
      erasingRef.current = false;
      return;
    }

    const start = strokeStartRef.current;
    const points = pointsRef.current;
    pointsRef.current = [];
    strokeStartRef.current = null;

    // The stroke is about to be handed to the base layer, so the live one has
    // to give it up in the same frame or it shows through twice.
    clearLive();
    liveDirtyRef.current = null;

    if (!start || points.length === 0) return;
    onCommitStroke({
      id: crypto.randomUUID(),
      color,
      size,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      points,
      t: start.t,
    });
  }

  return (
    // The wrapper must stay `pointer-events-none`: it spans the whole note, so
    // with the default it swallows every tap meant for the text underneath —
    // the ink layer would silently make the note impossible to type in. Only
    // the live canvas opts back in, and only while drawing is active.
    <div ref={wrapRef} className={cn("pointer-events-none absolute inset-0", className)} aria-hidden={!active}>
      <canvas ref={baseRef} className="absolute inset-0 size-full" />
      <canvas
        ref={liveRef}
        className={cn(
          "absolute inset-0 size-full",
          active
            ? cn("pointer-events-auto", tool === "eraser" ? "cursor-cell" : "cursor-crosshair")
            : null
        )}
        style={{
          // Never `pan-y`, not even in pen-only mode: `touch-action` can't be
          // narrowed to one pointer type, so allowing the browser to pan meant
          // it treated a *pen* drag as a scroll and cancelled the stroke a few
          // pixels in — handwriting came out as dots. The layer swallows the
          // gesture and pen-only mode scrolls by hand instead (see
          // handlePointerDown).
          touchAction: active ? "none" : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
    </div>
  );
}
