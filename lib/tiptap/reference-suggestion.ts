import { Extension, posToDOMRect } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";

export interface ReferenceSuggestionState {
  /** Everything typed after the trigger character. */
  query: string;
  /** Document range covering the trigger plus the query — what gets replaced on accept. */
  from: number;
  to: number;
  /** Viewport rect of the trigger, for positioning the menu. */
  rect: DOMRect;
}

export interface ReferenceSuggestionOptions {
  char: string;
  onUpdate: (state: ReferenceSuggestionState | null) => void;
  /** Return true to swallow the key — the menu handles arrows/Enter/Escape while it is open. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const referenceSuggestionKey = new PluginKey("noteReferenceSuggestion");

/**
 * A reference can contain spaces ("/mt 7:12", "/th 2"), so the query can't
 * stop at the first one — it runs to the end of the block instead, bounded so
 * a stray "/" in ordinary prose gives up rather than keeping a menu open for
 * a whole paragraph. A second "/" also ends it.
 */
const MAX_QUERY_LENGTH = 40;

function findSuggestion(state: EditorState, char: string): { query: string; from: number; to: number } | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const $from = selection.$from;
  if (!$from.parent.isTextblock) return null;

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  // The trigger only counts at the start of a block or after whitespace, so
  // "and/or" or a URL never opens the menu.
  const escapedChar = char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\s)${escapedChar}([^${escapedChar}\\n]{0,${MAX_QUERY_LENGTH}})$`);
  const match = pattern.exec(textBefore);
  if (!match) return null;

  const query = match[1];
  return { query, from: selection.from - query.length - char.length, to: selection.from };
}

/**
 * Minimal inline-suggestion plumbing for the note editor's "/" reference
 * menu: it reports what is being typed after the trigger and hands keyboard
 * control to the menu while one is open.
 *
 * Hand-rolled rather than pulled from `@tiptap/suggestion` because that
 * package brings its own popup/renderer contract (and, in practice, a
 * positioning dependency) for what is here about forty lines — and because
 * the menu needs the query to keep spaces, which the stock suggestion
 * matcher stops at.
 */
export const ReferenceSuggestion = Extension.create<ReferenceSuggestionOptions>({
  name: "noteReferenceSuggestion",

  addOptions() {
    return {
      char: "/",
      onUpdate: () => undefined,
      onKeyDown: () => false,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    // Tracked here (not in React) so handleKeyDown can decide synchronously
    // whether the menu owns the keystroke, before React has re-rendered.
    let active = false;

    return [
      new Plugin({
        key: referenceSuggestionKey,

        view() {
          return {
            update(view) {
              const next = findSuggestion(view.state, options.char);
              active = next !== null;
              if (!next) {
                options.onUpdate(null);
                return;
              }
              options.onUpdate({
                ...next,
                rect: posToDOMRect(view, next.from, next.to),
              });
            },
            destroy() {
              active = false;
              options.onUpdate(null);
            },
          };
        },

        props: {
          handleKeyDown(_view, event) {
            if (!active) return false;
            return options.onKeyDown(event);
          },
        },
      }),
    ];
  },
});
