"use client";

import { useEffect, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Vault, VaultContent, VaultTitle } from "@/components/ui/vault";
import { sectionEnd, topLevelChildren } from "@/lib/tiptap/collapsible-headings";
import { cn } from "@/lib/utils";

/** Where a heading counts as "being read" and where a jump lands — just under the sticky note header. */
const HEADER_OFFSET = 96;

export interface NoteOutlineOptions {
  open: boolean;
  /** No room beside the text: shown as a bottom sheet instead of a column. */
  sheet: boolean;
  onClose: () => void;
}

interface OutlineItem {
  pos: number;
  level: number;
  text: string;
  /** Has something under it, so it can be collapsed. */
  collapsible: boolean;
  collapsed: boolean;
}

function readOutline(editor: Editor): OutlineItem[] {
  const children = topLevelChildren(editor.state.doc);
  return children.flatMap((child, index) => {
    if (child.node.type.name !== "heading") return [];
    return [
      {
        pos: child.pos,
        level: child.node.attrs.level as number,
        text: child.node.textContent.trim(),
        collapsible: sectionEnd(children, index) > index + 1,
        collapsed: Boolean(child.node.attrs.collapsed),
      },
    ];
  });
}

function headingElement(editor: Editor, pos: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
}

function scrollParent(from: HTMLElement): HTMLElement | null {
  for (let node = from.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Opens whatever collapsed section hides the heading, then scrolls it under the header. */
function goToHeading(editor: Editor, pos: number) {
  const children = topLevelChildren(editor.state.doc);
  const target = children.findIndex((c) => c.pos === pos);
  if (target === -1) return;

  const tr = editor.state.tr;
  for (let i = 0; i < target; i++) {
    const { node, pos: at } = children[i];
    if (node.type.name === "heading" && node.attrs.collapsed && sectionEnd(children, i) > target) {
      tr.setNodeMarkup(at, undefined, { ...node.attrs, collapsed: false });
    }
  }
  if (tr.docChanged) editor.view.dispatch(tr);

  requestAnimationFrame(() => {
    const el = headingElement(editor, pos);
    if (!el) return;
    const top = el.getBoundingClientRect().top - HEADER_OFFSET;
    (scrollParent(el) ?? window).scrollBy({ top, behavior: "smooth" });
  });
}

function setAllCollapsed(editor: Editor, collapsed: boolean) {
  const children = topLevelChildren(editor.state.doc);
  const { from } = editor.state.selection;
  const tr = editor.state.tr;
  let hidingCaret: number | null = null;

  children.forEach((child, index) => {
    if (child.node.type.name !== "heading") return;
    const end = sectionEnd(children, index);
    if (end === index + 1) return;
    if (Boolean(child.node.attrs.collapsed) !== collapsed) {
      tr.setNodeMarkup(child.pos, undefined, { ...child.node.attrs, collapsed });
    }
    const last = children[end - 1];
    if (hidingCaret === null && from >= child.pos + child.node.nodeSize && from < last.pos + last.node.nodeSize) {
      hidingCaret = child.pos;
    }
  });

  // A caret left inside what just got hidden would type into nothing — park it on the heading.
  if (collapsed && hidingCaret !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(hidingCaret + 1)));
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** The heading the reader is in: the last visible one that has reached the top of the screen. */
function useActiveHeading(editor: Editor, items: OutlineItem[], enabled: boolean) {
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    function measure() {
      frame = 0;
      let current: number | null = null;
      for (const item of items) {
        const el = headingElement(editor, item.pos);
        if (!el || el.offsetParent === null) continue; // inside a collapsed section
        if (current === null) current = item.pos;
        if (el.getBoundingClientRect().top <= HEADER_OFFSET + 8) current = item.pos;
        else break;
      }
      setActive(current);
    }
    const schedule = () => {
      frame ||= requestAnimationFrame(measure);
    };
    schedule();
    // Capture: the note may be scrolled by the page or by a container (fullscreen).
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      cancelAnimationFrame(frame);
    };
  }, [editor, items, enabled]);

  return active;
}

/**
 * The note's headings as a clickable list — Google Docs' document outline.
 * Built from the text itself, so there is nothing to save. A column in the empty
 * margin beside the text when there is room, a bottom sheet when there isn't.
 */
export function NoteOutline({
  editor,
  open,
  sheet,
  onClose,
  canCollapse,
}: NoteOutlineOptions & { editor: Editor; canCollapse: boolean }) {
  const items = useEditorState({ editor, selector: ({ editor }) => readOutline(editor) });
  const active = useActiveHeading(editor, items, open && !sheet);

  const listed = items.filter((item) => item.text);
  const topLevel = Math.min(...listed.map((item) => item.level));
  const anyOpen = items.some((item) => item.collapsible && !item.collapsed);
  const showCollapse = canCollapse && editor.isEditable && items.some((item) => item.collapsible);

  function select(pos: number) {
    if (!sheet) return goToHeading(editor, pos);
    onClose();
    // The sheet locks the page's scroll until it has slid away.
    setTimeout(() => goToHeading(editor, pos), 350);
  }

  const content = (
    <nav aria-label="Títulos da nota" className="flex flex-col gap-0.5">
      {showCollapse && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={anyOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
          onClick={() => setAllCollapsed(editor, anyOpen)}
          className="mb-1 self-start text-[12px] text-muted-foreground"
        >
          {anyOpen ? "Recolher tudo" : "Expandir tudo"}
        </Button>
      )}
      {listed.length === 0 ? (
        <p className="px-2 text-[12.5px] leading-relaxed text-muted-foreground">
          Os títulos da nota aparecem aqui.
        </p>
      ) : (
        listed.map((item) => (
          <Button
            key={item.pos}
            variant="ghost"
            size="sm"
            onClick={() => select(item.pos)}
            aria-current={item.pos === active ? "location" : undefined}
            title={item.text}
            className={cn(
              "h-auto w-full justify-start whitespace-normal rounded-xl py-1.5 pr-2 text-left text-[12.5px] leading-snug",
              item.pos === active ? "bg-primary/15 text-accent" : "text-muted-foreground"
            )}
            style={{ paddingLeft: `${8 + (item.level - topLevel) * 12}px` }}
          >
            <span className="line-clamp-2">{item.text}</span>
          </Button>
        ))
      )}
    </nav>
  );

  if (sheet) {
    return (
      <Vault open={open} onOpenChange={(next) => !next && onClose()}>
        <VaultContent aria-label="Títulos da nota">
          <VaultTitle className="pb-3 font-heading text-base">Títulos</VaultTitle>
          {content}
        </VaultContent>
      </Vault>
    );
  }

  if (!open) return null;
  return (
    <aside className="absolute bottom-0 right-full top-0 mr-8 w-52">
      <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain pb-4 scrollbar-none">
        {content}
      </div>
    </aside>
  );
}
