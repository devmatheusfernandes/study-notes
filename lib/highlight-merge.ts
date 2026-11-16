interface MergeableHighlight {
  id: string;
  startToken: number | null;
  endToken: number | null;
  note: unknown;
}

/**
 * A new highlight that overlaps existing ones is merged into them instead of
 * being stacked on top: the result spans the union, and the overlapped marks are
 * absorbed (to be deleted by the caller). A mark carrying a note is left alone —
 * deleting it would orphan the note — as is one still being created
 * (`optimistic:` id, which the server can't act on yet).
 *
 * `candidates` must already be limited to the same paragraph/verse.
 */
export function mergeHighlightRange(
  candidates: MergeableHighlight[],
  startToken: number,
  endToken: number
): { startToken: number; endToken: number; absorbedIds: string[] } {
  let start = startToken;
  let end = endToken;
  const absorbed = new Set<string>();

  // Absorbing one can widen the range enough to reach another, so repeat until stable.
  let changed = true;
  while (changed) {
    changed = false;
    for (const h of candidates) {
      if (absorbed.has(h.id) || h.note || h.startToken === null || h.endToken === null) continue;
      if (h.id.startsWith("optimistic:")) continue;
      if (h.startToken <= end && h.endToken >= start) {
        absorbed.add(h.id);
        start = Math.min(start, h.startToken);
        end = Math.max(end, h.endToken);
        changed = true;
      }
    }
  }
  return { startToken: start, endToken: end, absorbedIds: [...absorbed] };
}
