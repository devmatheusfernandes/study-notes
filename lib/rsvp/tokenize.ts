/**
 * Turns note / publication HTML into the stream of words an RSVP reader shows
 * one at a time. Pure and DOM-based (DOMParser), so it only runs in the browser
 * — same constraint as lib/note-preview.ts.
 *
 * What is deliberately NOT read aloud-in-the-eye:
 *   - anything in (parentheses) or [brackets] — scripture citations, asides;
 *   - footnote / cross-reference markers and links to Bible citations;
 *   - verse and paragraph numbers.
 * The numbers still matter as *boundaries*: each verse / paragraph / heading /
 * list item starts a new block, and blocks are where the reader breathes (or,
 * in study mode, stops).
 */

export interface RsvpToken {
  /** The word as displayed (punctuation kept — it is part of the rhythm). */
  text: string;
  /** Index of the Optimal Recognition Point letter inside `text`. */
  orp: number;
  /** Multiplier over the base per-word time (long words, punctuation). */
  weight: number;
  /** True for the last word of a block (paragraph, verse, heading, item). */
  blockEnd: boolean;
  /** Which block this word belongs to. */
  block: number;
}

export interface RsvpBlock {
  /** Clean text of the whole block, for the study-mode recap. */
  text: string;
  /** Index of the block's first token in the token array. */
  start: number;
  /** True for headings — they get a longer breath and are never "studied". */
  heading: boolean;
}

export interface RsvpDocument {
  tokens: RsvpToken[];
  blocks: RsvpBlock[];
}

/** Elements that are chrome or numbering, never reading text. */
const DROP_SELECTOR = [
  "script",
  "style",
  "sup",
  "img",
  "figure",
  "svg",
  "table",
  "[data-jwpub-footnote]",
  "[data-jwpub-bible-first]",
  "[data-jwpub-ref]",
  ".parNum",
  ".vl",
  ".vp",
  ".cl",
  ".fn",
  ".verse-affordance",
  ".gen-field",
  "[data-ref-type]",
].join(",");

/** Elements that open a new block of reading. */
const BLOCK_TAGS = new Set([
  "p",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "div",
  "tr",
  "dd",
  "dt",
]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * Removes (…) and […] groups, innermost first, including the space that
 * preceded them so "texto (Sal. 37:11) segue" becomes "texto segue".
 * Unbalanced openers swallow to the end of the block — better a clipped line
 * than a stray citation.
 */
export function stripBracketed(input: string): string {
  let out = input;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/\s*\([^()[\]]*\)/g, "").replace(/\s*\[[^()[\]]*\]/g, "");
  } while (out !== prev);
  // An opener with no closer (the citation was cut across blocks): drop the tail.
  out = out.replace(/\s*[([][^)\]]*$/, "");
  // A stray closer left behind by a cut.
  out = out.replace(/[)\]]/g, "");
  return out;
}

/** Collects the visible text of a node, in order, with block starts marked. */
function walk(node: Node, blocks: { text: string; heading: boolean }[], state: { current: number }) {
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.textContent ?? "";
    if (!raw) return;
    if (state.current === -1) {
      blocks.push({ text: "", heading: false });
      state.current = blocks.length - 1;
    }
    blocks[state.current].text += raw;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  if (el.matches(DROP_SELECTOR)) return;

  const tag = el.tagName.toLowerCase();
  // A new verse inside one paragraph also starts a block: Bible books mark
  // each verse with `.v` (its number is dropped, the break stays).
  const startsBlock = BLOCK_TAGS.has(tag) || el.classList.contains("v") || tag === "br";
  if (startsBlock) state.current = -1;
  // A verse marker that holds nothing but its number: the break stays, the number goes.
  if (el.classList.contains("v") && /^[\s ]*\d+[\s ]*$/.test(el.textContent ?? "")) return;

  const heading = HEADING_TAGS.has(tag);
  for (const child of Array.from(el.childNodes)) {
    walk(child, blocks, state);
    if (heading && state.current !== -1) blocks[state.current].heading = true;
  }

  if (BLOCK_TAGS.has(tag)) state.current = -1;
}

/**
 * Index of the letter the eye should land on (the ORP), a touch left of the
 * middle — the heuristic Spritz-style readers use, by word length.
 */
export function orpIndex(word: string): number {
  // Look at letters only, so leading quotes/brackets don't shift the anchor.
  const lead = word.match(/^[^\p{L}\p{N}]*/u)?.[0].length ?? 0;
  const core = word.slice(lead).replace(/[^\p{L}\p{N}]+$/u, "");
  const n = core.length;
  let i: number;
  if (n <= 1) i = 0;
  else if (n <= 5) i = 1;
  else if (n <= 9) i = 2;
  else if (n <= 13) i = 3;
  else i = 4;
  return Math.min(lead + i, Math.max(0, word.length - 1));
}

/**
 * How long a word stays on screen relative to the base time. Longer words
 * and closing punctuation get more; a ~2-letter word gets a touch less.
 */
export function wordWeight(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  let w = 1;
  if (letters >= 13) w = 1.9;
  else if (letters >= 10) w = 1.6;
  else if (letters >= 7) w = 1.3;
  else if (letters <= 2) w = 0.85;

  if (/[.!?…]["”’')]*$/.test(word)) w += 1.1;
  else if (/[;:]["”’')]*$/.test(word)) w += 0.7;
  else if (/[,—–]["”’')]*$/.test(word)) w += 0.5;
  return w;
}

/** Builds the token stream + block table from a note / chapter body. */
export function htmlToRsvp(html: string): RsvpDocument {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const raw: { text: string; heading: boolean }[] = [];
  walk(doc.body, raw, { current: -1 });

  const tokens: RsvpToken[] = [];
  const blocks: RsvpBlock[] = [];

  for (const r of raw) {
    const clean = stripBracketed(r.text.replace(/ /g, " "))
      .replace(/\s+/g, " ")
      .trim();
    const words = clean.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (words.length === 0) continue;

    const blockIndex = blocks.length;
    blocks.push({ text: words.join(" "), start: tokens.length, heading: r.heading });
    words.forEach((text, i) => {
      tokens.push({
        text,
        orp: orpIndex(text),
        weight: wordWeight(text),
        blockEnd: i === words.length - 1,
        block: blockIndex,
      });
    });
  }

  return { tokens, blocks };
}

/** Milliseconds a token stays visible at `wpm`. */
export function tokenDuration(token: RsvpToken, wpm: number): number {
  return (60000 / wpm) * token.weight;
}

/** Breath after the last word of a block, in ms, at `wpm` (headings breathe longer). */
export function blockPause(block: RsvpBlock | undefined, wpm: number): number {
  const base = 60000 / wpm;
  return base * (block?.heading ? 4 : 2.4);
}
