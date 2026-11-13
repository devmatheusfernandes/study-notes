import { Mark, mergeAttributes } from "@tiptap/core";

export const NOTE_HIGHLIGHT_MARK = "highlight";

/** Yellow — what the shortcut uses until a colour has been picked from the bubble menu. */
const DEFAULT_HIGHLIGHT_COLOR = "#e8c547";

/** Pastel highlight colours carry fixed dark text so they read on both themes (see the Handwriting/highlight notes in CLAUDE.md). */
export const NOTE_HIGHLIGHT_TEXT_COLOR = "#1c1917";

/** Only a plain hex colour is ever stored/rendered — the value ends up in a `style` attribute. */
export function isHighlightColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value);
}

/**
 * A coloured highlight over selected text, with the same six colours the
 * .jwpub reader offers (lib/jwlibrary/constants.ts). A mark, like
 * `noteReference`: the text stays ordinary text, so search, card previews and
 * vectorization see it unchanged. Stored as `<mark data-color="#e8c547" style=…>`.
 */
export const NoteHighlight = Mark.create({
  name: NOTE_HIGHLIGHT_MARK,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const color = element.getAttribute("data-color") || element.style.backgroundColor;
          return isHighlightColor(color) ? color : null;
        },
        renderHTML: (attributes) =>
          isHighlightColor(attributes.color)
            ? {
                "data-color": attributes.color,
                style: `background-color: ${attributes.color}; color: ${NOTE_HIGHLIGHT_TEXT_COLOR}`,
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes({ class: "note-highlight" }, HTMLAttributes), 0];
  },

  // The colour the shortcut applies: the last one chosen, so repeated
  // highlighting in one colour is a single keystroke.
  addStorage() {
    return { lastColor: null as string | null };
  },

  addKeyboardShortcuts() {
    return {
      // Like Ctrl+B: highlights the selection, or removes the highlight if it already has one.
      "Mod-Shift-h": ({ editor }) => {
        if (editor.isActive(this.name)) return editor.commands.unsetNoteHighlight();
        return editor.commands.setNoteHighlight(this.storage.lastColor ?? DEFAULT_HIGHLIGHT_COLOR);
      },
    };
  },

  addCommands() {
    return {
      // One mark type: setting a colour over an existing highlight replaces it.
      setNoteHighlight:
        (color: string) =>
        ({ commands }) => {
          this.storage.lastColor = color;
          return commands.setMark(this.name, { color });
        },
      unsetNoteHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [NOTE_HIGHLIGHT_MARK]: {
      setNoteHighlight: (color: string) => ReturnType;
      unsetNoteHighlight: () => ReturnType;
    };
  }
}
