import { findBibleReferenceOccurrences } from "@/lib/bible/parse-reference";

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, div, blockquote, pre, td";

export interface CitationTarget {
  bookOrder: number;
  chapter: number;
  verse: number | null;
  endVerse: number | null;
}

/**
 * The DOM Range covering the first place a rendered note cites `target`, or
 * `null` when it can't be found.
 *
 * The citation index stores only coordinates and an excerpt (the note text is
 * encrypted at rest), so the position is recovered here by re-running the same
 * scan over the rendered note's own text. Text nodes are joined with a newline
 * only where the block changes — the same boundary the server uses — so
 * "Mt <b>5:3</b>" still reads as one citation while two adjacent paragraphs
 * never fuse into one.
 */
export function findCitationRange(root: HTMLElement, target: CitationTarget): Range | null {
  const nodes: { node: Text; start: number }[] = [];
  let full = "";
  let lastBlock: Element | null = null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    if (nodes.length > 0 && block !== lastBlock) full += "\n";
    lastBlock = block;
    nodes.push({ node, start: full.length });
    full += node.data;
  }

  const hit = findBibleReferenceOccurrences(full).find(
    (o) =>
      o.bookOrder === target.bookOrder &&
      o.chapter === target.chapter &&
      o.startVerse === target.verse &&
      o.endVerse === target.endVerse
  );
  if (!hit) return null;

  const locate = (offset: number, preferEnd: boolean) => {
    for (const entry of nodes) {
      const end = entry.start + entry.node.data.length;
      if (offset >= entry.start && (preferEnd ? offset <= end : offset < end)) {
        return { node: entry.node, offset: offset - entry.start };
      }
    }
    return null;
  };

  const from = locate(hit.charStart, false);
  const to = locate(hit.charEnd, true);
  if (!from || !to) return null;

  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}
