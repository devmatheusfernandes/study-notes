/**
 * The user's own names for the highlight colours (Settings → Destaques), keyed
 * by color index. A label is a short title, not a sentence.
 */
export type HighlightLabels = Record<string, string>;

export const HIGHLIGHT_LABEL_MAX_WORDS = 3;
export const HIGHLIGHT_LABEL_MAX_CHARS = 30;

/** Trims, collapses spaces and enforces the word/length limits. */
export function normalizeHighlightLabel(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, HIGHLIGHT_LABEL_MAX_WORDS)
    .join(" ")
    .slice(0, HIGHLIGHT_LABEL_MAX_CHARS)
    .trim();
}
