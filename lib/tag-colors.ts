/**
 * Fixed palette for tag colors — picked to stay legible as a small dot/pill on
 * this app's dark "Organic" surfaces. Deliberately not a free-form hex input:
 * every option here is pre-checked for contrast, so a tag can never end up
 * unreadable.
 */
export const TAG_COLORS = [
  "#f97316", // orange (app accent)
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
] as const;

export const DEFAULT_TAG_COLOR: string = TAG_COLORS[0];
