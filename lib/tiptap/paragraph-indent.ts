import { Extension } from "@tiptap/core";

const INDENT_EM_PER_LEVEL = 2;
const MAX_INDENT_LEVEL = 8;
const INDENTABLE_TYPES = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphIndent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/**
 * Google Docs-style Tab/Shift-Tab: indents/outdents the current paragraph(s)
 * with a left margin, for text that isn't inside a list. List items already
 * get Tab/Shift-Tab for free from @tiptap/extension-list's ListKeymap (nests
 * one level deeper / lifts out), so this extension explicitly steps aside
 * whenever the selection is inside a listItem/taskItem — it must be added
 * to the editor's extensions array AFTER TaskList/TaskItem/StarterKit for
 * that fallthrough to work: ProseMirror tries each extension's keymap in
 * registration order and stops at the first one that returns true, so the
 * list behaviour always gets first refusal.
 */
export const ParagraphIndent = Extension.create({
  name: "paragraphIndent",

  addGlobalAttributes() {
    return [
      {
        types: INDENTABLE_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const margin = parseFloat(element.style.marginLeft || "0");
              if (Number.isNaN(margin) || margin <= 0) return 0;
              return Math.min(MAX_INDENT_LEVEL, Math.round(margin / INDENT_EM_PER_LEVEL));
            },
            renderHTML: (attributes) => {
              const level = attributes.indent as number;
              if (!level) return {};
              return { style: `margin-left: ${level * INDENT_EM_PER_LEVEL}em` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const step = (delta: 1 | -1) => () => ({ tr, state, dispatch }: { tr: any; state: any; dispatch?: (tr: any) => void }) => {
      const { from, to } = state.selection;
      let changed = false;

      state.doc.nodesBetween(from, to, (node: any, pos: number) => {
        if (!INDENTABLE_TYPES.includes(node.type.name)) return;
        const current = (node.attrs.indent as number) ?? 0;
        const next = Math.min(MAX_INDENT_LEVEL, Math.max(0, current + delta));
        if (next === current) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        changed = true;
      });

      if (changed && dispatch) dispatch(tr);
      return changed;
    };

    return {
      indent: step(1),
      outdent: step(-1),
    };
  },

  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive("listItem") || this.editor.isActive("taskItem");

    return {
      // Always swallow Tab/Shift-Tab outside a list — even once a paragraph
      // is already at the min/max indent level — so the key never falls
      // through to the browser's default "move focus to the next element"
      // behaviour while the editor has focus.
      Tab: () => {
        if (inList()) return false;
        this.editor.commands.indent();
        return true;
      },
      "Shift-Tab": () => {
        if (inList()) return false;
        this.editor.commands.outdent();
        return true;
      },
    };
  },
});
