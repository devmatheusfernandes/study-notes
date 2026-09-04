"use client";

/**
 * Maps a paragraph's rendered text to JW Library's word-token indexing, so
 * an imported highlight's StartToken/EndToken (public.jwlibrary_blockranges)
 * can be drawn as a <mark> over the exact right span, and so a new text
 * selection can be turned into the same kind of token range when creating a
 * highlight (Fase 2.5).
 *
 * There's no official documentation of the exact tokenization algorithm.
 * The first pass (splitting on whitespace only) was off by ~14 tokens on a
 * real highlight — validated directly against a side-by-side screenshot of
 * the real JW Library app: `public.jwlibrary_blockranges` had start/end
 * tokens 76/93 for a highlight that visibly started at "Os" and ended at the
 * period after "congregação", but a plain whitespace split only reached
 * index 78 for the *entire* paragraph. Manually re-tokenizing the same
 * paragraph counting **every punctuation mark as its own token** (so
 * `Filipos:` is 2 tokens, `(Fil.` is 3, `ministeriais."` is 3) landed
 * exactly on 76 and 93 — that's the rule implemented below. The one
 * exception: a colon between two digits (`1:1`) stays a single token, since
 * splitting it would break Bible-verse-style references.
 */

interface CharLocation {
  node: Text;
  offset: number;
}

/**
 * A "word" is a run of letters/digits that may continue through an internal
 * hyphen/apostrophe/colon *only* when followed by another letter/digit
 * (keeps `1:1`, contractions and hyphenated words whole); anything else
 * that isn't whitespace — every quote, paren, comma, period — matches the
 * second alternative and becomes its own single-character token.
 */
const WORD_REGEX = /[\p{L}\p{N}](?:[\p{L}\p{N}]|[-'’:](?=[\p{L}\p{N}]))*|[^\s]/gu;

interface WordToken {
  /** Index into the paragraph's combined text string — inclusive. */
  startIndex: number;
  /** Exclusive, like a normal string slice end. */
  endIndex: number;
}

interface Tokenization {
  tokens: WordToken[];
  charLocations: CharLocation[];
}

function collectTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let ancestor: HTMLElement | null = node.parentElement;
      while (ancestor && ancestor !== root) {
        if (ancestor.classList.contains("parNum")) return NodeFilter.FILTER_REJECT;
        ancestor = ancestor.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function buildTokenization(root: HTMLElement): Tokenization {
  const textNodes = collectTextNodes(root);

  let combined = "";
  const charLocations: CharLocation[] = [];
  for (const node of textNodes) {
    const text = node.data;
    for (let i = 0; i < text.length; i++) {
      combined += text[i];
      charLocations.push({ node, offset: i });
    }
  }

  const tokens: WordToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = WORD_REGEX.exec(combined))) {
    tokens.push({ startIndex: match.index, endIndex: match.index + match[0].length });
  }

  return { tokens, charLocations };
}

/** A Range boundary can land on a text node (the common case) or an element node (e.g. selecting from just before a child). Falls back to the nearest contained text node's start for the latter. */
function pointToCharIndex(root: HTMLElement, node: Node, offset: number, charLocations: CharLocation[]): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const idx = charLocations.findIndex((loc) => loc.node === node && loc.offset === offset);
    if (idx !== -1) return idx;
    // offset === node.length (end of this text node) — one past its last mapped char.
    const nodeStart = charLocations.findIndex((loc) => loc.node === node);
    if (nodeStart !== -1) return nodeStart + offset;
  }

  // Element boundary: find the first (or, if offset is past the last child, last) descendant text node.
  const children = Array.from(node.childNodes);
  const target = children[Math.min(offset, children.length - 1)] ?? node;
  const walker = document.createTreeWalker(target.nodeType === Node.TEXT_NODE ? root : target, NodeFilter.SHOW_TEXT);
  const firstText = (target.nodeType === Node.TEXT_NODE ? target : walker.nextNode()) as Text | null;
  if (firstText) {
    const idx = charLocations.findIndex((loc) => loc.node === firstText);
    if (idx !== -1) return idx;
  }
  return 0;
}

/**
 * Wraps tokens `[startToken, endToken]` (inclusive) of `root`'s rendered
 * text in a `<mark>` colored `colorHex`. Uses extractContents/insertNode
 * rather than Range.surroundContents, since a highlighted span routinely
 * crosses into a nested element (a Bible citation link partway through the
 * range) — surroundContents throws in that case, extractContents doesn't.
 *
 * `noteId`, when given, is stamped as `data-jwlibrary-note-id` so a click on
 * the mark can look the associated note up (see jwpub-chapter-view.tsx).
 * Returns the created `<mark>` (or null on failure) so the caller can read
 * its position — e.g. to place a margin marker at the exact line the
 * highlight starts on, not just the top of the paragraph.
 */
export function wrapTokenRange(
  root: HTMLElement,
  startToken: number,
  endToken: number,
  colorHex: string,
  noteId?: string
): HTMLElement | null {
  const { tokens, charLocations } = buildTokenization(root);
  if (tokens.length === 0) return null;

  const start = tokens[Math.max(0, Math.min(startToken, tokens.length - 1))];
  const end = tokens[Math.max(0, Math.min(endToken, tokens.length - 1))];
  const startLoc = charLocations[start.startIndex];
  const endLoc = charLocations[end.endIndex - 1];
  if (!startLoc || !endLoc) return null;

  const range = document.createRange();
  try {
    range.setStart(startLoc.node, startLoc.offset);
    range.setEnd(endLoc.node, endLoc.offset + 1);
  } catch {
    return null;
  }
  if (range.collapsed) return null;

  const mark = document.createElement("mark");
  mark.className = "jwlibrary-highlight";
  mark.style.backgroundColor = colorHex;
  mark.style.color = "#1a1614"; // fixed dark text — these highlight colors are pastel, meant for a light background, not this app's own dark theme text color
  mark.style.borderRadius = "2px";
  mark.style.padding = "0 1px";
  if (noteId) {
    mark.dataset.jwlibraryNoteId = noteId;
    mark.style.cursor = "pointer";
  }

  try {
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
}

/**
 * Reverse direction: given the user's current text selection (a Range
 * already known to fall inside `root`), returns which word tokens it spans
 * — used when creating a new highlight from a selection instead of a whole
 * paragraph. Clamped to the paragraph's own token bounds.
 */
export function getTokenRangeForSelection(
  root: HTMLElement,
  range: Range
): { start: number; end: number } | null {
  const { tokens, charLocations } = buildTokenization(root);
  if (tokens.length === 0) return null;

  const startCharIdx = pointToCharIndex(root, range.startContainer, range.startOffset, charLocations);
  const endCharIdx = pointToCharIndex(root, range.endContainer, range.endOffset, charLocations) - 1;

  let startToken = tokens.findIndex((t) => t.endIndex > startCharIdx);
  if (startToken === -1) startToken = tokens.length - 1;

  let endToken = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].startIndex <= endCharIdx) {
      endToken = i;
      break;
    }
  }
  if (endToken === -1) endToken = startToken;
  if (endToken < startToken) endToken = startToken;

  return { start: startToken, end: endToken };
}
