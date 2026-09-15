"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PAGE_HEIGHT,
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
  /** Playback mode: the page is a viewer, not an input surface. */
  readOnly?: boolean;
  /** Renders only the ink drawn up to this position on the recording timeline. */
  revealUntilMs?: number;
  /** Current position on the recording timeline, or undefined when not recording — stamped onto each stroke so playback can replay it. */
  recordingElapsed?: () => number | undefined;
  onCommitStroke: (stroke: Stroke) => void;
  /** `startsGesture` marks the first erase of a drag, so one sweep of the eraser is one undo step rather than one per frame. */
  onEraseStrokes: (ids: string[], startsGesture: boolean) => void;
  className?: string;
}

export function DrawingCanvas({
  strokes,
  tool,
  color,
  size,
  readOnly = false,
  revealUntilMs,
  recordingElapsed,
  onCommitStroke,
  onEraseStrokes,
  className,
}: DrawingCanvasProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  const pointsRef = useRef<DrawPoint[]>([]);
  const strokeStartRef = useRef<{ perf: number; t?: number } | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const erasingRef = useRef(false);
  const erasedThisGestureRef = useRef(false);
  /**
   * Palm rejection: once a real stylus has touched this page, finger contact
   * stops drawing. Without it the hand resting on a tablet paints over the
   * writing — and there's no way to tell a palm from a deliberate finger
   * stroke except by trusting the pen when one is present.
   */
  const [penSeen, setPenSeen] = useState(false);

  // ── Fit the A4 page into whatever space the layout gives us ───────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const observer = new ResizeObserver(() => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const scale = Math.min(width / PAGE_WIDTH, height / PAGE_HEIGHT);
      setPageSize({ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale });
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /** Puts a canvas into page coordinates at device resolution, so ink stays crisp on a retina tablet. */
  const prepare = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || pageSize.width === 0) return null;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(pageSize.width * dpr);
      if (canvas.width !== pixelWidth) {
        canvas.width = pixelWidth;
        canvas.height = Math.round(pageSize.height * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = (pageSize.width * dpr) / PAGE_WIDTH;
      ctx.scale(scale, scale);
      return ctx;
    },
    [pageSize]
  );

  useEffect(() => {
    const ctx = prepare(baseRef.current);
    if (ctx) renderStrokes(ctx, strokes, revealUntilMs);
  }, [strokes, revealUntilMs, prepare]);

  const toPagePoint = useCallback((clientX: number, clientY: number) => {
    const rect = liveRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * PAGE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * PAGE_HEIGHT,
    };
  }, []);

  const drawLive = useCallback(() => {
    const ctx = prepare(liveRef.current);
    if (!ctx || pointsRef.current.length === 0) return;
    drawStroke(ctx, {
      id: "live",
      color,
      size,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      points: pointsRef.current,
    });
  }, [prepare, color, size, tool]);

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
    if (readOnly) return;
    if (event.pointerType === "pen") setPenSeen(true);
    else if (penSeen && event.pointerType === "touch") return;
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
    if (readOnly || activePointerRef.current !== event.pointerId) return;

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

    // `prepare` clears as it re-establishes the transform — the live layer is
    // wiped here because the stroke is about to be handed to the base layer.
    prepare(liveRef.current);

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
    <div ref={wrapRef} className={cn("flex min-h-0 flex-1 items-center justify-center", className)}>
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}
      >
        <canvas ref={baseRef} className="absolute inset-0 size-full" />
        <canvas
          ref={liveRef}
          className={cn(
            "absolute inset-0 size-full",
            readOnly ? "cursor-default" : tool === "eraser" ? "cursor-cell" : "cursor-crosshair"
          )}
          // The page must never scroll or zoom out from under the pen mid-stroke.
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
      </div>
    </div>
  );
}
