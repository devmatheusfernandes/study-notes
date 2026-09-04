import { Mark, InputRule, mergeAttributes } from "@tiptap/core";
import {
  REFERENCE_ATTRIBUTE,
  parseNoteReference,
  referenceToMarkAttributes,
} from "@/lib/notes/note-reference";

export const NOTE_REFERENCE_MARK = "noteReference";

export interface NoteReferenceOptions {
  /**
   * The .jwpub symbols currently in the user's library, read fresh on every
   * keystroke rather than captured once — the editor fetches them
   * asynchronously after mount, and re-creating the extension (and therefore
   * the whole editor) just to hand it a new Set would drop focus mid-typing.
   */
  getKnownSymbols: () => ReadonlySet<string>;
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Text the user typed as "(mt 7:12)" or "(th 2)", marked up so it can be
 * clicked open in the reference side panel.
 *
 * A **mark**, not an atomic node, on purpose: the literal text the user typed
 * stays in the document, so the reference is still editable character by
 * character, still searchable, and still reads as plain "(mt 7:12)" to
 * everything that consumes the body as text — card previews
 * (lib/note-preview.ts), vectorization, the assistant. Only the click
 * behaviour and the styling are added on top.
 */
export const NoteReferenceMark = Mark.create<NoteReferenceOptions>({
  name: NOTE_REFERENCE_MARK,

  // Typing straight after a reference must produce ordinary text, not more
  // reference — the mark ends where the closing parenthesis does.
  inclusive: false,

  // Nothing else should merge into it, and it carries no formatting meaning.
  excludes: "",

  addOptions() {
    return {
      getKnownSymbols: () => new Set<string>(),
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      kind: {
        default: null,
        parseHTML: (element) => element.getAttribute(REFERENCE_ATTRIBUTE),
        renderHTML: (attributes) =>
          attributes.kind ? { [REFERENCE_ATTRIBUTE]: attributes.kind } : {},
      },
      bookOrder: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-ref-book"),
        renderHTML: (attributes) =>
          attributes.bookOrder !== null ? { "data-ref-book": String(attributes.bookOrder) } : {},
      },
      bookName: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-ref-book-name"),
        renderHTML: (attributes) =>
          attributes.bookName ? { "data-ref-book-name": String(attributes.bookName) } : {},
      },
      chapter: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-ref-chapter"),
        renderHTML: (attributes) =>
          attributes.chapter !== null ? { "data-ref-chapter": String(attributes.chapter) } : {},
      },
      startVerse: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-ref-verse"),
        renderHTML: (attributes) =>
          attributes.startVerse !== null ? { "data-ref-verse": String(attributes.startVerse) } : {},
      },
      endVerse: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-ref-verse-end"),
        renderHTML: (attributes) =>
          attributes.endVerse !== null ? { "data-ref-verse-end": String(attributes.endVerse) } : {},
      },
      symbol: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-ref-symbol"),
        renderHTML: (attributes) =>
          attributes.symbol ? { "data-ref-symbol": String(attributes.symbol) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${REFERENCE_ATTRIBUTE}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        // Styled from globals.css rather than utility classes so the same look
        // applies wherever a note body is rendered, not just inside the editor.
        //
        // Deliberately no role/tabindex: this is editable text the caret moves
        // through, not a widget, and a tabindex on an inline span inside a
        // contenteditable hijacks Tab.
        class: "note-reference",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      // Used by the slash menu, which already knows exactly what it inserted.
      setNoteReference:
        (attributes: Record<string, unknown>) =>
        ({ commands }) =>
          commands.setMark(this.name, attributes),
      unsetNoteReference:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        // Fires on the closing parenthesis. `textBefore` here is the block's
        // text up to the cursor plus the character being typed, and that
        // final ")" is NOT yet in the document — the handler inserts it (see
        // run() in @tiptap/core: a matched rule swallows the keystroke).
        find: /\(([^()\n]{1,80})\)$/,
        handler: ({ state, range, match, chain }) => {
          const reference = parseNoteReference(match[1], this.options.getKnownSymbols());
          // Not a reference — return null so the rule is skipped entirely and
          // ProseMirror inserts the ")" itself, leaving the prose untouched.
          if (!reference) return null;

          const attributes = referenceToMarkAttributes(reference);
          const markType = state.schema.marks[this.name];
          if (!markType) return null;

          chain()
            .command(({ tr }) => {
              // Put the swallowed ")" back, then mark "(…)" as a whole so the
              // parentheses read as part of the chip instead of stray text.
              tr.insertText(")", range.to);
              tr.addMark(range.from, range.to + 1, markType.create(attributes));
              tr.removeStoredMark(markType);
              return true;
            })
            .run();
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    [NOTE_REFERENCE_MARK]: {
      setNoteReference: (attributes: Record<string, unknown>) => ReturnType;
      unsetNoteReference: () => ReturnType;
    };
  }
}
