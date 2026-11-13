import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface CollapsibleHeadingsOptions {
  /** Read on every render of the decorations, so it can follow a breakpoint without recreating the editor. */
  isEnabled: () => boolean;
}

const COLLAPSIBLE_HEADINGS_KEY = new PluginKey("collapsibleHeadings");

/** A chevron pointing right; CSS turns it to point down while the section is open. */
const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

interface TopLevelChild {
  node: PMNode;
  pos: number;
}

function topLevelChildren(doc: PMNode): TopLevelChild[] {
  const children: TopLevelChild[] = [];
  doc.forEach((node, offset) => children.push({ node, pos: offset }));
  return children;
}

/**
 * Index (exclusive) where the section opened by `children[index]` ends: the
 * next heading of the same or a higher level (`h2` ends at the next `h2` or
 * `h1`), or the end of the document. Everything in between is its body.
 */
function sectionEnd(children: TopLevelChild[], index: number): number {
  const level = children[index].node.attrs.level as number;
  let end = index + 1;
  while (end < children.length) {
    const next = children[end].node;
    if (next.type.name === "heading" && (next.attrs.level as number) <= level) break;
    end++;
  }
  return end;
}

/**
 * Apple-Notes-style collapsible sections: every heading gets a small chevron
 * on its left that hides/shows the blocks beneath it, up to the next heading
 * of the same or higher level.
 *
 * The collapsed state is an attribute on the heading (`data-collapsed`), so it
 * is saved with the note and survives a reload. Hiding is purely visual — a
 * decoration adds a class, the text stays in the document — so search, card
 * previews, vectorization and copy all still see the whole note.
 *
 * A chevron only appears on a heading that has something under it.
 */
export const CollapsibleHeadings = Extension.create<CollapsibleHeadingsOptions>({
  name: "collapsibleHeadings",

  addOptions() {
    return { isEnabled: () => true };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          collapsed: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
            renderHTML: (attributes) => (attributes.collapsed ? { "data-collapsed": "true" } : {}),
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      // A new paragraph started at the end of a collapsed heading would land
      // inside the hidden section and vanish as it is typed — open it first.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name === "heading" && $from.parent.attrs.collapsed) {
          editor.commands.updateAttributes("heading", { collapsed: false });
        }
        return false; // let the normal Enter run
      },
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: COLLAPSIBLE_HEADINGS_KEY,
        props: {
          decorations(state) {
            if (!options.isEnabled()) return null;

            const children = topLevelChildren(state.doc);
            const decorations: Decoration[] = [];

            children.forEach((child, index) => {
              if (child.node.type.name !== "heading") return;
              const end = sectionEnd(children, index);
              if (end === index + 1) return; // nothing underneath

              const collapsed = !!child.node.attrs.collapsed;
              decorations.push(
                Decoration.node(child.pos, child.pos + child.node.nodeSize, { class: "has-collapse" })
              );

              decorations.push(
                Decoration.widget(
                  child.pos + 1,
                  (view, getPos) => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "heading-collapse-toggle";
                    button.contentEditable = "false";
                    button.setAttribute("aria-label", collapsed ? "Expandir seção" : "Recolher seção");
                    button.setAttribute("aria-expanded", String(!collapsed));
                    button.innerHTML = CHEVRON_SVG;
                    // Don't steal the caret/selection from the text.
                    button.addEventListener("mousedown", (event) => event.preventDefault());
                    button.addEventListener("click", () => {
                      const widgetPos = getPos();
                      if (widgetPos === undefined) return;
                      const headingPos = widgetPos - 1;
                      const { state: current } = view;
                      const heading = current.doc.nodeAt(headingPos);
                      if (!heading || heading.type.name !== "heading") return;

                      const nowCollapsed = !heading.attrs.collapsed;
                      const tr = current.tr.setNodeMarkup(headingPos, undefined, {
                        ...heading.attrs,
                        collapsed: nowCollapsed,
                      });

                      // A caret left inside what just got hidden would type into nothing — park it on the heading.
                      if (nowCollapsed) {
                        const all = topLevelChildren(current.doc);
                        const at = all.findIndex((c) => c.pos === headingPos);
                        if (at !== -1) {
                          const last = all[sectionEnd(all, at) - 1];
                          const hiddenFrom = headingPos + heading.nodeSize;
                          const hiddenTo = last.pos + last.node.nodeSize;
                          const { from } = current.selection;
                          if (from >= hiddenFrom && from < hiddenTo) {
                            tr.setSelection(TextSelection.near(tr.doc.resolve(hiddenFrom - 1), -1));
                          }
                        }
                      }
                      view.dispatch(tr);
                    });
                    return button;
                  },
                  // The key carries the state so the chevron is rebuilt (and re-aimed) when it flips.
                  { side: -1, key: `collapse-${child.pos}-${collapsed}`, ignoreSelection: true }
                )
              );

              if (collapsed) {
                for (let i = index + 1; i < end; i++) {
                  const hidden = children[i];
                  decorations.push(
                    Decoration.node(hidden.pos, hidden.pos + hidden.node.nodeSize, { class: "note-collapsed" })
                  );
                }
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
