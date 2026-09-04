"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
// Deliberately from @tiptap/extension-list (not the standalone
// @tiptap/extension-task-list / -task-item packages): StarterKit already
// wires up that package's ListKeymap for Enter/Tab/Backspace, and it isn't
// aware of the standalone packages' node types — with those, Enter inside a
// task item didn't split into a new one at all (silently a no-op).
import { TaskList, TaskItem } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItemNodeView } from "@/components/content/task-item-node-view";
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/components/ui/toaster";
import { uploadNoteImage } from "@/app/(app)/note-images-actions";
import { NoteReferenceMark, NOTE_REFERENCE_MARK } from "@/lib/tiptap/note-reference-mark";
import {
  ReferenceSuggestion,
  type ReferenceSuggestionState,
} from "@/lib/tiptap/reference-suggestion";
import {
  buildReferenceSuggestions,
  type PublicationOption,
  type ReferenceSuggestionItem,
} from "@/lib/notes/reference-suggestions";
import {
  referenceFromElement,
  referenceToMarkAttributes,
  type NoteReference,
} from "@/lib/notes/note-reference";
import { ReferenceSuggestionMenu } from "@/components/content/reference-suggestion-menu";

async function insertImageFile(editor: Editor, file: File) {
  if (!file.type.startsWith("image/")) return;

  const formData = new FormData();
  formData.set("file", file);
  const { url, error } = await uploadNoteImage(formData);

  if (error || !url) {
    notify.error("Não foi possível enviar a imagem", error);
    return;
  }
  // Collapse to the end of whatever was selected first — inserting an image
  // over an active selection replaces it (standard ProseMirror behavior),
  // which would silently delete the user's selected text/content instead of
  // just adding the image where the cursor was.
  const end = editor.state.selection.to;
  editor.chain().focus().setTextSelection(end).setImage({ src: url }).run();
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Selection collapses on mousedown-then-blur — run before that happens.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-7 items-center justify-center rounded-full transition-colors",
        active ? "bg-primary/[0.18] text-accent" : "text-foreground/80 hover:bg-secondary"
      )}
    >
      {children}
    </button>
  );
}

export interface RichTextEditorHandle {
  /** Opens the native file picker to insert an image — for a trigger button that lives outside this component (see note-editor.tsx's header). */
  openImagePicker: () => void;
}

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  /** The user's ingested .jwpub publications — what makes "(th 2)" recognisable as a reference at all. */
  publications?: PublicationOption[];
  /** Called when a reference in the text is clicked, so the host can open its side panel. */
  onReferenceClick?: (reference: NoteReference) => void;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { content, onChange, placeholder, autoFocus, className, publications, onReferenceClick },
  ref
) {
  const seeded = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    openImagePicker: () => fileInputRef.current?.click(),
  }));

  /* --------------------------------------------------------------- *
   * References — "(mt 7:12)" input rule + the "/" menu
   *
   * Everything the extensions need to read at runtime goes through a ref:
   * `useEditor` builds its extension list exactly once, so anything captured
   * directly would freeze at its first-render value (an empty publication
   * list, a stale item array).
   * --------------------------------------------------------------- */
  const [suggestion, setSuggestion] = useState<ReferenceSuggestionState | null>(null);
  // The highlighted row is stored together with the query it belongs to, so a
  // new query resets it by derivation instead of by an effect that would
  // render once with a stale highlight before correcting itself.
  const [highlight, setHighlight] = useState<{ query: string; index: number }>({
    query: "",
    index: 0,
  });
  // Set when Escape dismisses the menu, cleared once the caret leaves that
  // trigger — otherwise the plugin would immediately reopen it, since the
  // "/" is still sitting in the document.
  const dismissedAt = useRef<number | null>(null);
  const suggestionRef = useRef(suggestion);

  const knownSymbols = useMemo(
    () => new Set((publications ?? []).map((p) => p.symbol)),
    [publications]
  );
  const symbolsRef = useRef(knownSymbols);

  const items = useMemo(
    () => (suggestion ? buildReferenceSuggestions(suggestion.query, publications ?? []) : []),
    [suggestion, publications]
  );
  const activeIndex = highlight.query === (suggestion?.query ?? "") ? highlight.index : 0;
  const setActiveIndex = useCallback(
    (next: number | ((current: number) => number)) =>
      setHighlight((current) => {
        const base = current.query === (suggestionRef.current?.query ?? "") ? current.index : 0;
        return {
          query: suggestionRef.current?.query ?? "",
          index: typeof next === "function" ? next(base) : next,
        };
      }),
    []
  );

  const itemsRef = useRef(items);
  const activeIndexRef = useRef(activeIndex);

  const editorRef = useRef<Editor | null>(null);

  const applyItem = useCallback((item: ReferenceSuggestionItem) => {
    const editor = editorRef.current;
    const active = suggestionRef.current;
    if (!editor || !active) return;

    // Inserted as an explicit text node, never as a string: `insertContentAt`
    // parses a string as HTML, which collapses the trailing space these rows
    // depend on ("/Mateus " would land as "/Mateus", so the chapter the user
    // types next would run into the name).
    if (item.type === "prefix") {
      editor
        .chain()
        .focus()
        .insertContentAt({ from: active.from, to: active.to }, { type: "text", text: `/${item.text}` })
        .run();
      return;
    }

    const end = active.from + item.text.length;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: active.from, to: active.to }, { type: "text", text: item.text })
      .setTextSelection({ from: active.from, to: end })
      .setMark(NOTE_REFERENCE_MARK, referenceToMarkAttributes(item.reference))
      .setTextSelection(end)
      .unsetMark(NOTE_REFERENCE_MARK)
      // Trailing space so typing continues outside the reference.
      .insertContent({ type: "text", text: " " })
      .run();
  }, []);

  const handleSuggestionKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const current = itemsRef.current;
      const active = suggestionRef.current;
      if (active && dismissedAt.current === active.from) return false;

      if (event.key === "Escape") {
        dismissedAt.current = active?.from ?? null;
        setSuggestion(null);
        return true;
      }
      if (current.length === 0) return false;

      if (event.key === "ArrowDown") {
        setActiveIndex((index) => (index + 1) % current.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setActiveIndex((index) => (index - 1 + current.length) % current.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        applyItem(current[activeIndexRef.current] ?? current[0]);
        return true;
      }
      return false;
    },
    // Both are stable useCallbacks, so this handler's identity never changes
    // — which is what lets the extension hold on to it for the editor's life.
    [applyItem, setActiveIndex]
  );

  const handleSuggestionUpdate = useCallback((next: ReferenceSuggestionState | null) => {
    if (!next) {
      dismissedAt.current = null;
      setSuggestion(null);
      return;
    }
    if (dismissedAt.current !== null && dismissedAt.current !== next.from) {
      dismissedAt.current = null;
    }
    if (dismissedAt.current === next.from) {
      setSuggestion(null);
      return;
    }
    // Keep the previous object when nothing meaningful changed, so React can
    // bail out of the re-render.
    //
    // This is load-bearing, not an optimisation: `useEditor` re-runs
    // `editor.setOptions()` after every render (its `compareOptions` checks
    // extension identity, and this component builds a fresh extensions array
    // and `editorProps` each time), setOptions calls `view.updateState()`,
    // and that fires this plugin's `update()` again. Handing back a new
    // object every time made that cycle self-sustaining — render → setOptions
    // → updateState → setSuggestion → render — until React gave up with
    // "Maximum update depth exceeded". `rect` is derived from `from`/`to`, so
    // comparing the positions and the query covers it.
    setSuggestion((current) =>
      current && current.from === next.from && current.to === next.to && current.query === next.query
        ? current
        : next
    );
  }, []);

  // onReferenceClick is a prop, so it needs the ref treatment; the two
  // suggestion callbacks above are already stable useCallbacks and can be
  // handed to the extension directly.
  const referenceClickRef = useRef(onReferenceClick);
  const getKnownSymbols = useCallback(() => symbolsRef.current, []);

  // Own React node view instead of Tiptap's default (a bare native
  // checkbox) — reuses the app's animated Checkbox primitive. Memoized so
  // the extension identity is stable across renders (useEditor recreates
  // the editor if its extensions array changes).
  const CustomTaskItem = useMemo(
    () =>
      TaskItem.extend({
        addNodeView() {
          return ReactNodeViewRenderer(TaskItemNodeView);
        },
      }),
    []
  );

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ HTMLAttributes: { class: "rounded-2xl max-w-full" } }),
      TaskList,
      CustomTaskItem,
      Placeholder.configure({ placeholder: placeholder ?? "Comece a escrever…" }),
      /* These three callbacks read refs, but only ever from a ProseMirror
         plugin event (a keystroke, a click) — never while rendering, which is
         what the rule is guarding against. */
      /* eslint-disable react-hooks/refs */
      NoteReferenceMark.configure({ getKnownSymbols }),
      ReferenceSuggestion.configure({
        char: "/",
        onUpdate: handleSuggestionUpdate,
        onKeyDown: handleSuggestionKeyDown,
      }),
      /* eslint-enable react-hooks/refs */
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "min-h-[50vh] w-full flex-1 outline-none text-base leading-relaxed text-foreground/90 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul[data-type=taskList]]:my-2 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:flex [&_ul[data-type=taskList]]:flex-col [&_ul[data-type=taskList]]:gap-0.5 [&_ul[data-type=taskList]]:pl-0 [&_img]:my-2",
      },
      // Clicking a reference opens it. Handled here rather than with a DOM
      // listener so the caret still lands where the user clicked — the text
      // stays fully editable, the panel is purely additive.
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const element = target?.closest("[data-note-ref]");
        if (!element) return false;
        const reference = referenceFromElement(element);
        if (!reference) return false;
        referenceClickRef.current?.(reference);
        return false;
      },
      handleDrop: (_view, event) => {
        const file = event.dataTransfer?.files?.[0];
        if (!file || !editor) return false;
        event.preventDefault();
        void insertImageFile(editor, file);
        return true;
      },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!file || !editor) return false;
        event.preventDefault();
        void insertImageFile(editor, file);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    // Themed to match the app's dark "Organic" tokens instead of Tiptap's defaults.
    editable: true,
  });

  // All of the above refs are refreshed here rather than during render:
  // every reader of them (an input rule, a keydown, a click) runs after
  // effects have flushed, so this is always the value they see.
  useEffect(() => {
    editorRef.current = editor;
    symbolsRef.current = knownSymbols;
    itemsRef.current = items;
    activeIndexRef.current = activeIndex;
    suggestionRef.current = suggestion;
    referenceClickRef.current = onReferenceClick;
  });

  // Adopt persisted content once (e.g. once localStorage rehydrates) without
  // fighting the user's own typing on every keystroke.
  useEffect(() => {
    if (!editor || seeded.current) return;
    if (content) {
      seeded.current = true;
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className={cn("relative", className)}>
      <BubbleMenu
        editor={editor}
        shouldShow={({ state }: { state: { selection: { empty: boolean } } }) => !state.selection.empty}
        className="flex items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-lg"
      >
        <ToolbarButton
          label="Negrito"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Itálico"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Lista de tarefas"
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks className="size-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <ToolbarButton
          label="Alinhar à esquerda"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Centralizar"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Alinhar à direita"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          label="Justificar"
          active={editor.isActive({ textAlign: "justify" })}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        >
          <AlignJustify className="size-3.5" />
        </ToolbarButton>
      </BubbleMenu>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void insertImageFile(editor, file);
        }}
      />

      <EditorContent editor={editor} />

      {suggestion && (
        <ReferenceSuggestionMenu
          items={items}
          activeIndex={activeIndex}
          rect={suggestion.rect}
          onSelect={applyItem}
          onHover={setActiveIndex}
        />
      )}
    </div>
  );
});
