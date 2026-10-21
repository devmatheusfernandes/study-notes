"use client";

import { useTheme } from "next-themes";
import type { InkAppearance } from "@/lib/drawing/strokes";

/** Which palette handwriting is painted over — see `displayInkColor` in lib/drawing/strokes.ts. */
export function useInkAppearance(): InkAppearance {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? "light" : "dark";
}
