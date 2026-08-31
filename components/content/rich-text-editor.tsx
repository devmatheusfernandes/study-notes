"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
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
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  { content, onChange, placeholder, autoFocus, className },
  ref
) {
  const seeded = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    openImagePicker: () => fileInputRef.current?.click(),
  }));

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
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "min-h-[50vh] w-full flex-1 outline-none text-base leading-relaxed text-foreground/90 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul[data-type=taskList]]:my-2 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:flex [&_ul[data-type=taskList]]:flex-col [&_ul[data-type=taskList]]:gap-0.5 [&_ul[data-type=taskList]]:pl-0 [&_img]:my-2",
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
    </div>
  );
});
