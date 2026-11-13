import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { sectionEnd, topLevelChildren } from "./collapsible-headings";

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  matches: FindMatch[];
  /** Which match is the "current" one (the one Enter lands on). */
  index: number;
}

const FIND_KEY = new PluginKey<FindState>("findInNote");

const EMPTY: FindState = { query: "", matches: [], index: 0 };

/** Case- and accent-insensitive, one character in → one character out so document positions stay aligned. */
function fold(character: string): string {
  const folded = character.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return folded.length === 1 ? folded : character.toLowerCase().slice(0, 1) || character;
}

/**
 * Every occurrence of `query` in the document. Searched per text block, with
 * the block's inline content flattened, so a match is found even when it
 * straddles a bold/italic/reference boundary (the old scrollToText only
 * matched inside a single text node).
 */
function findMatches(doc: PMNode, query: string): FindMatch[] {
  const needle = query.split("").map(fold).join("");
  if (!needle) return [];

  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    const chars: string[] = [];
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          chars.push(fold(child.text[i]));
          positions.push(start + i);
        }
      } else {
        // A hard break, an image… — something no query should match across.
        chars.push("\n");
        positions.push(start);
      }
    });

    const haystack = chars.join("");
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      matches.push({ from: positions[from], to: positions[from + needle.length - 1] + 1 });
      from = haystack.indexOf(needle, from + needle.length);
    }
    return false; // never descend into a text block's inline content
  });
  return matches;
}

/**
 * Find-in-note: highlights every match of a query across the whole note and
 * tracks a "current" one. The match list is plugin state, recomputed whenever
 * the query or the document changes, so it stays right while the person
 * keeps editing with the bar open.
 *
 * Driven through the helpers below (not Tiptap commands) because the UI that
 * owns the query lives outside the editor.
 */
export const FindInNote = Extension.create({
  name: "findInNote",

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: FIND_KEY,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const meta = tr.getMeta(FIND_KEY) as Partial<FindState> | undefined;
            if (meta?.query !== undefined) {
              const matches = findMatches(tr.doc, meta.query);
              return { query: meta.query, matches, index: 0 };
            }
            if (meta?.index !== undefined) return { ...value, index: meta.index };
            if (tr.docChanged && value.query) {
              const matches = findMatches(tr.doc, value.query);
              return { ...value, matches, index: Math.min(value.index, Math.max(0, matches.length - 1)) };
            }
            return value;
          },
        },
        props: {
          decorations(state) {
            const find = FIND_KEY.getState(state);
            if (!find || find.matches.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              find.matches.map((match, i) =>
                Decoration.inline(match.from, match.to, {
                  class: i === find.index ? "find-match find-match-active" : "find-match",
                })
              )
            );
          },
        },
      }),
    ];
  },
});

export function getFindState(editor: Editor): FindState {
  return FIND_KEY.getState(editor.state) ?? EMPTY;
}

/**
 * A match inside a collapsed section is invisible — open the sections that
 * hide it (several, if they are nested) before scrolling to it.
 */
function expandSectionsHiding(editor: Editor, pos: number) {
  const children = topLevelChildren(editor.state.doc);
  const at = children.findIndex((child) => pos >= child.pos && pos < child.pos + child.node.nodeSize);
  if (at === -1) return;

  const tr = editor.state.tr;
  let changed = false;
  children.forEach((child, i) => {
    if (i >= at || child.node.type.name !== "heading" || !child.node.attrs.collapsed) return;
    if (sectionEnd(children, i) > at) {
      tr.setNodeMarkup(child.pos, undefined, { ...child.node.attrs, collapsed: false });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr);
}

function reveal(editor: Editor) {
  const { matches, index } = getFindState(editor);
  const match = matches[index];
  if (!match) return;
  expandSectionsHiding(editor, match.from);
  requestAnimationFrame(() => {
    // The note may have been closed between the keystroke and this frame.
    if (editor.isDestroyed) return;
    editor.view.dom.querySelector(".find-match-active")?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

export function setFindQuery(editor: Editor, query: string) {
  editor.view.dispatch(editor.state.tr.setMeta(FIND_KEY, { query }));
  reveal(editor);
}

export function stepFind(editor: Editor, delta: 1 | -1) {
  const { matches, index } = getFindState(editor);
  if (matches.length === 0) return;
  const next = (index + delta + matches.length) % matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(FIND_KEY, { index: next }));
  reveal(editor);
}

export function clearFind(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(FIND_KEY, { query: "" }));
}
