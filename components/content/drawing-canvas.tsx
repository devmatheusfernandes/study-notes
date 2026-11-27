"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PAGE_WIDTH,
  drawStroke,
  renderStrokes,
  strokesHitBy,
  type DrawPoint,
  type DrawTool,
  type InkAppearance,
  type Stroke,
} from "@/lib/drawing/strokes";
import { useInkAppearance } from "@/hooks/ui/use-ink-appearance";

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
  /** Overrides the theme-derived ink appearance — a PDF page is white paper in either theme. */
  appearance?: InkAppearance;
  className?: string;
}

/**
 * Ceiling on each layer's backing store, in device pixels (~12 MP ≈ 48 MB).
 * The ink layer is as tall as the note, so without a cap a long one asks the
 * browser for a buffer it won't give.
 */
const MAX_CANVAS_PIXELS = 12_000_000;

/** How long after the stylus last reported (hover or contact) a touch is still treated as the writing hand. */
const PEN_GRACE_MS = 1500;

/** A fingertip reports a contact of roughly 10-20 CSS px; a resting palm or knuckle is far wider. */
const PALM_CONTACT_PX = 32;

/** How far a finger must travel before it scrolls — a resting or rocking hand stays under it, so the page holds still. */
const TOUCH_SCROLL_SLOP_PX = 18;

/** How many of the browser's predicted positions are drawn ahead of the nib (never stored). */
const PREDICTED_SAMPLES = 2;

/**
 * The S Pen's side button (or an eraser end, on pens that have one) held while
 * the nib touches down: for that stroke the pen erases, and goes back to
 * whatever tool was chosen once the stroke ends. `buttons` bit 2 is the barrel
 * button and bit 32 the eraser, per the Pointer Events spec.
 */
function isPenEraserGesture(event: React.PointerEvent): boolean {
  // Deliberately not limited to `pointerType === "pen"`: some Android builds report a stylus as a
  // "mouse" while its side button is down. A real mouse's right button then erases too, which is harmless.
  // `button` covers a browser that announces the press as its own pointerdown rather than through `buttons`.
  return (
    (event.buttons & 2) !== 0 ||
    (event.buttons & 32) !== 0 ||
    (event.type === "pointerdown" && (event.button === 2 || event.button === 5))
  );
}

function isPalmContact(event: React.PointerEvent): boolean {
  return Math.max(event.width, event.height) >= PALM_CONTACT_PX;
}

/** The element that actually scrolls behind the ink layer, or null when that's the page itself. */
function scrollableAncestor(from: HTMLElement, axis: "x" | "y" = "y"): HTMLElement | null {
  let node = from.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const overflow = axis === "y" ? style.overflowY : style.overflowX;
    const scrollable = axis === "y" ? node.scrollHeight > node.clientHeight : node.scrollWidth > node.clientWidth;
    if ((overflow === "auto" || overflow === "scroll") && scrollable) return node;
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
  appearance: appearanceOverride,
  className,
}: DrawingCanvasProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const predictedRef = useRef<DrawPoint[]>([]);
  const touchesRef = useRef(new Set<number>());
  /** What the base layer currently shows, so an appended stroke can be painted alone. */
  const paintedRef = useRef<{ strokes: Stroke[]; key: unknown[] } | null>(null);
  const themeAppearance = useInkAppearance();
  const appearance = appearanceOverride ?? themeAppearance;

  const [box, setBox] = useState({ width: 0, height: 0 });

  const pointsRef = useRef<DrawPoint[]>([]);
  const strokeStartRef = useRef<{ perf: number; t?: number } | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const erasingRef = useRef(false);
  const erasedThisGestureRef = useRef(false);
  const penReportedRef = useRef(false);
  // The side button can be pressed while the pen is still in the air, before any pointerdown.
  const penButtonHeldRef = useRef(false);
  // `?penDebug=1` shows what the browser actually reports for the pen — for when the button does nothing.
  const [debugText, setDebugText] = useState<string | null>(null);
  const [debugEnabled] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("penDebug")
  );
  function debug(event: React.PointerEvent | React.MouseEvent, label: string) {
    if (!debugEnabled) return;
    const e = event as React.PointerEvent;
    setDebugText(`${label} · ${e.pointerType ?? "mouse"} · button ${e.button} · buttons ${e.buttons}`);
  }
  const lastPenAtRef = useRef(-Infinity);
  const touchScrollRef = useRef<{
    pointerId: number;
    /** Where the finger landed until it passes the slop, then its previous position. */
    lastX: number;
    lastY: number;
    moving: boolean;
    target: HTMLElement | null;
    targetX: HTMLElement | null;
  } | null>(null);
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

  /**
   * Places the live layer over just the part of the note that's on screen. It
   * is repainted on every pen movement, and a canvas as tall as the note makes
   * the browser push megapixels to the screen each time — which is felt as the
   * ink trailing behind the nib. Nothing scrolls during a stroke, so placing it
   * once at pointerdown is enough.
   */
  function prepareLive() {
    const canvas = liveRef.current;
    const wrap = wrapRef.current;
    liveCtxRef.current = null;
    liveDirtyRef.current = null;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const height = Math.min(rect.height, window.innerHeight);
    const top = Math.round(Math.max(0, Math.min(-rect.top, rect.height - height)));
    canvas.style.top = `${top}px`;
    canvas.style.height = `${height}px`;

    const maxScale = Math.sqrt(MAX_CANVAS_PIXELS / (rect.width * height));
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, maxScale));
    const pixelWidth = Math.round(rect.width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    const unit = pixelWidth / PAGE_WIDTH;
    // Shifted so stroke coordinates stay the note's own, not the window's.
    ctx.setTransform(unit, 0, 0, unit, 0, -top * dpr);
    liveCtxRef.current = ctx;
  }

  function clearLive() {
    const ctx = liveCtxRef.current;
    const dirty = liveDirtyRef.current;
    if (ctx && dirty) {
      ctx.clearRect(dirty.minX, dirty.minY, dirty.maxX - dirty.minX, dirty.maxY - dirty.minY);
    }
    return ctx;
  }

  // A layout effect so a finished stroke appears here in the same frame it leaves the live layer.
  useLayoutEffect(() => {
    const ctx = configure(baseRef.current);
    if (!ctx) return;
    const key = [configure, logicalHeight, appearance, revealUntilMs];
    const painted = paintedRef.current;
    paintedRef.current = { strokes, key };

    // Writing only appends: redrawing a whole page of handwriting after every
    // stroke stalls the start of the next one. A highlighter still redraws,
    // because it has to go underneath the ink already there.
    if (
      painted &&
      revealUntilMs === undefined &&
      painted.key.every((value, i) => value === key[i]) &&
      strokes.length >= painted.strokes.length &&
      painted.strokes.every((stroke, i) => stroke === strokes[i])
    ) {
      const added = strokes.slice(painted.strokes.length);
      if (added.every((stroke) => stroke.tool !== "highlighter")) {
        for (const stroke of added) drawStroke(ctx, stroke, undefined, appearance);
        return;
      }
    }

    ctx.clearRect(0, 0, PAGE_WIDTH, logicalHeight);
    renderStrokes(ctx, strokes, revealUntilMs, appearance);
  }, [strokes, revealUntilMs, configure, logicalHeight, appearance]);

  const toPagePoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
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

  function drawLive() {
    const ctx = clearLive();
    if (!ctx || pointsRef.current.length === 0) return;
    const points = [...pointsRef.current, ...predictedRef.current];

    drawStroke(ctx, {
      id: "live",
      color,
      size,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      points,
    }, undefined, appearance);

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
  }

  function makePoint(event: React.PointerEvent, clientX: number, clientY: number, pressure: number): DrawPoint | null {
    const point = toPagePoint(clientX, clientY);
    const start = strokeStartRef.current;
    if (!point || !start) return null;
    return [
      Math.round(point.x * 10) / 10,
      Math.round(point.y * 10) / 10,
      // A mouse reports a constant 0.5 and some touchscreens report 0 — both
      // mean "no real pressure", which perfect-freehand then simulates from
      // velocity instead (see `simulatePressure` in lib/drawing/strokes.ts).
      event.pointerType === "pen" ? pressure : 0,
      Math.round(performance.now() - start.perf),
    ];
  }

  function pushPoint(event: React.PointerEvent, clientX: number, clientY: number, pressure: number) {
    const point = makePoint(event, clientX, clientY, pressure);
    if (point) pointsRef.current.push(point);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!active) return;
    debug(event, "down");
    notePenActivity(event);
    // Palm rejection: with pen-only on, a hand resting on a tablet scrolls the
    // note rather than painting over the writing. The scrolling is done by
    // hand here because the layer has to keep `touch-action: none` — see the
    // note on the canvas element below.
    if (event.pointerType === "pen") touchScrollRef.current = null;
    if (penOnly && event.pointerType === "touch") {
      // A second contact means a hand, not a scrolling finger: stop, and ignore until all have lifted.
      const alone = touchesRef.current.size === 0;
      touchesRef.current.add(event.pointerId);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (!alone) {
        touchScrollRef.current = null;
        return;
      }
      // A palm resting beside the nib must do nothing at all — not draw, and
      // not scroll the page out from under the hand that's writing. Pen near
      // the screen, or a contact too big to be a fingertip, means palm.
      if (penIsNear() || isPalmContact(event)) return;
      touchScrollRef.current = {
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        moving: false,
        target: scrollableAncestor(event.currentTarget),
        // A zoomed-in PDF page is wider than the screen, so the hand scrolls sideways too.
        targetX: scrollableAncestor(event.currentTarget, "x"),
      };
      return;
    }
    if (activePointerRef.current !== null) return;

    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "eraser" || isPenEraserGesture(event) || (penButtonHeldRef.current && penIsNear())) {
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
    predictedRef.current = [];
    prepareLive();
    pushPoint(event, event.clientX, event.clientY, event.pressure);
    drawLive();
  }

  /**
   * Records that a stylus is around. Hover counts, not just contact: the palm
   * usually lands while the S Pen is still in the air, and waiting for the
   * first stroke to learn there's a pen is how the first palm touch drew.
   */
  function notePenActivity(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "pen") return;
    lastPenAtRef.current = performance.now();
    if (!penReportedRef.current) {
      penReportedRef.current = true;
      onPenDetected();
    }
  }

  /** Hovering or just lifted — the grace period covers the gap between strokes while the hand still rests on the glass. */
  function penIsNear() {
    return performance.now() - lastPenAtRef.current < PEN_GRACE_MS;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (active) notePenActivity(event);
    const scrolling = touchScrollRef.current;
    if (scrolling && event.pointerType === "pen") {
      // The pen arrived after a hand was already down: that hand is a palm.
      touchScrollRef.current = null;
    } else if (scrolling?.pointerId === event.pointerId) {
      // A palm often lands as a small contact and only then flattens out.
      if (penIsNear() || isPalmContact(event)) {
        touchScrollRef.current = null;
        return;
      }
      if (!scrolling.moving) {
        const travelled = Math.hypot(event.clientX - scrolling.lastX, event.clientY - scrolling.lastY);
        if (travelled < TOUCH_SCROLL_SLOP_PX) return;
        // Scrolling starts from here, so crossing the slop doesn't jump the page.
        scrolling.moving = true;
        scrolling.lastX = event.clientX;
        scrolling.lastY = event.clientY;
        return;
      }
      const delta = scrolling.lastY - event.clientY;
      const deltaX = scrolling.lastX - event.clientX;
      scrolling.lastY = event.clientY;
      scrolling.lastX = event.clientX;
      if (scrolling.target) scrolling.target.scrollBy(0, delta);
      else window.scrollBy(0, delta);
      if (scrolling.targetX) scrolling.targetX.scrollBy(deltaX, 0);
      return;
    }

    if (active) debug(event, "move");
    if (event.pointerType !== "touch") penButtonHeldRef.current = isPenEraserGesture(event);

    if (!active || activePointerRef.current !== event.pointerId) return;

    // The button went down after the nib was already writing: drop the half-drawn line and erase from here.
    if (!erasingRef.current && isPenEraserGesture(event)) {
      pointsRef.current = [];
      strokeStartRef.current = null;
      clearLive();
      liveDirtyRef.current = null;
      erasingRef.current = true;
      erasedThisGestureRef.current = false;
    }

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
    // Where the browser expects the nib to be by the time this frame is shown.
    const predicted =
      typeof native.getPredictedEvents === "function" ? native.getPredictedEvents() : [];
    predictedRef.current = predicted
      .slice(0, PREDICTED_SAMPLES)
      .map((sample) => makePoint(event, sample.clientX, sample.clientY, sample.pressure))
      .filter((point): point is DrawPoint => point !== null);
    drawLive();
  }

  function endStroke(event: React.PointerEvent<HTMLDivElement>) {
    debug(event, event.type === "pointercancel" ? "cancel" : "up");
    if (event.pointerType !== "touch") penButtonHeldRef.current = false;
    touchesRef.current.delete(event.pointerId);
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
    predictedRef.current = [];
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
    // the input surface opts back in, and only while drawing is active.
    <div ref={wrapRef} className={cn("pointer-events-none absolute inset-0", className)} aria-hidden={!active}>
      <canvas ref={baseRef} className="absolute inset-0 size-full" />
      {debugEnabled && debugText && (
        <div className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-lg bg-black/80 px-2.5 py-1.5 font-mono text-[11px] text-white">
          {debugText}
        </div>
      )}
      <canvas ref={liveRef} className="absolute left-0 top-0 h-0 w-full" />
      <div
        className={cn(
          "absolute inset-0 select-none",
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
        // The barrel button is a right click to the browser — without this it
        // would pop a menu over the stroke it is meant to erase.
        onContextMenu={(event) => {
          debug(event, "contextmenu");
          if (active) event.preventDefault();
        }}
      />
    </div>
  );
}
