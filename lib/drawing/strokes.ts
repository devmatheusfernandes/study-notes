// Pure stroke model + rendering. Imported by the canvas, the replay player and
// the card preview, so it stays free of React and of any "use client"/"use
// server" boundary.

import { getStroke } from "perfect-freehand";

/**
 * `[x, y, pressure, dt]` — a tuple rather than an object because a single
 * handwritten page runs to tens of thousands of points, and the key names
 * would triple the stored (and encrypted) JSON for no gain.
 * `dt` is milliseconds since this stroke's own start, which is what makes
 * audio-synced replay possible without a second timeline.
 */
export type DrawPoint = [x: number, y: number, pressure: number, dt: number];

export type DrawTool = "pen" | "highlighter" | "eraser";

export interface Stroke {
  id: string;
  color: string;
  /** Width in page units, before pressure thinning. */
  size: number;
  tool: "pen" | "highlighter";
  points: DrawPoint[];
  /**
   * Milliseconds into the note's audio recording at which this stroke began.
   * Absent when it was drawn with no recording running — such a stroke is
   * always visible during replay instead of appearing at some arbitrary moment.
   */
  t?: number;
}

export interface DrawingDoc {
  version: 1;
  strokes: Stroke[];
}

/**
 * The page is a fixed logical size and every point is stored in these units,
 * so a note drawn on a phone replays identically on a tablet (and survives a
 * device rotation) instead of stretching with whatever viewport it was made
 * on. 1000×1414 is the A4 portrait ratio — the same "a page of paper" shape
 * every handwriting app shows.
 */
export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414;

/**
 * Ink colors are persisted user data, not theme chrome — a stroke drawn red
 * must stay that exact red even if the app's palette is retuned later, so
 * these are deliberately literal values rather than CSS variables (the
 * globals.css tokens are for UI surfaces; see CLAUDE.md).
 */
export const INK_COLORS = [
  "#F5F0E8",
  "#111111",
  "#E8763A",
  "#4EA3F0",
  "#5BC77E",
  "#E25563",
] as const;

export const HIGHLIGHT_COLORS = ["#F2C744", "#7BE08A", "#6FC5F0", "#F08AC0"] as const;

export const PEN_SIZES = [3, 6, 12] as const;
export const HIGHLIGHTER_SIZE = 28;

/** Radius, in page units, within which the eraser considers a stroke "touched". */
const ERASER_RADIUS = 14;

const PEN_OPTIONS = {
  smoothing: 0.5,
  streamline: 0.5,
  thinning: 0.6,
};

export function emptyDoc(): DrawingDoc {
  return { version: 1, strokes: [] };
}

/** Tolerant on purpose: a corrupt or legacy payload yields an empty page instead of breaking the editor. */
export function parseDoc(raw: string | null | undefined): DrawingDoc {
  if (!raw) return emptyDoc();
  try {
    const parsed = JSON.parse(raw) as DrawingDoc;
    if (!parsed || !Array.isArray(parsed.strokes)) return emptyDoc();
    return { version: 1, strokes: parsed.strokes };
  } catch {
    return emptyDoc();
  }
}

export function serializeDoc(doc: DrawingDoc): string {
  return JSON.stringify(doc);
}

/** Absolute timeline position of a stroke's last point, for "how long is this replay" maths. */
export function strokeEndTime(stroke: Stroke): number | undefined {
  if (stroke.t === undefined) return undefined;
  const last = stroke.points[stroke.points.length - 1];
  return last ? stroke.t + last[3] : stroke.t;
}

function outlineFor(stroke: Stroke, points: DrawPoint[]) {
  const isHighlighter = stroke.tool === "highlighter";
  return getStroke(
    points.map((p) => [p[0], p[1], p[2]]),
    {
      size: stroke.size,
      ...PEN_OPTIONS,
      // A highlighter is a flat chisel — pressure thinning would make it look
      // like a fat pen instead.
      thinning: isHighlighter ? 0 : PEN_OPTIONS.thinning,
      simulatePressure: stroke.points.some((p) => p[2] > 0) ? false : true,
    }
  );
}

function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  if (outline.length === 0) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    path.lineTo(outline[i][0], outline[i][1]);
  }
  path.closePath();
  return path;
}

/**
 * Draws one stroke, optionally only the part of it drawn up to `revealUntilMs`
 * on the recording's timeline — that partial reveal is what makes the replay
 * look like the pen is moving again rather than strokes popping in whole.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, revealUntilMs?: number) {
  let points = stroke.points;

  if (revealUntilMs !== undefined && stroke.t !== undefined) {
    if (stroke.t > revealUntilMs) return;
    const elapsed = revealUntilMs - stroke.t;
    points = points.filter((p) => p[3] <= elapsed);
    if (points.length === 0) return;
  }

  const outline = outlineFor(stroke, points);
  if (outline.length === 0) return;

  ctx.save();
  ctx.fillStyle = stroke.color;
  if (stroke.tool === "highlighter") {
    ctx.globalAlpha = 0.32;
    // Keeps overlapping highlighter passes from compounding into a solid
    // block — the same way a real marker doesn't get darker on a second pass.
    ctx.globalCompositeOperation = "lighter";
  }
  ctx.fill(outlineToPath(outline));
  ctx.restore();
}

export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  revealUntilMs?: number
) {
  // Highlighter under ink, always — otherwise a marker pass drawn after the
  // writing veils it.
  for (const stroke of strokes) {
    if (stroke.tool === "highlighter") drawStroke(ctx, stroke, revealUntilMs);
  }
  for (const stroke of strokes) {
    if (stroke.tool !== "highlighter") drawStroke(ctx, stroke, revealUntilMs);
  }
}

/** Stroke-level eraser: returns the ids of strokes passing within ERASER_RADIUS of the point. */
export function strokesHitBy(strokes: Stroke[], x: number, y: number): string[] {
  const hit: string[] = [];
  for (const stroke of strokes) {
    const radius = ERASER_RADIUS + stroke.size / 2;
    for (const point of stroke.points) {
      const dx = point[0] - x;
      const dy = point[1] - y;
      if (dx * dx + dy * dy <= radius * radius) {
        hit.push(stroke.id);
        break;
      }
    }
  }
  return hit;
}
