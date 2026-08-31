"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ImagePlus, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SyncStatusIndicator } from "@/components/content/sync-status";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/content/rich-text-editor";
import { useNotesStore } from "@/lib/store/notes-store";
import { useHydrated } from "@/components/providers/store-hydration";

interface NoteEditorProps {
  /** Existing note id, or undefined for a brand-new note. */
  noteId?: string;
}

export function NoteEditor({ noteId }: NoteEditorProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  // Read client-side (not as server searchParams) so /notes/new stays a
  // static shell — see the comment on that page.
  const searchParams = useSearchParams();
  const initialBody = noteId ? "" : searchParams.get("q") ?? "";
  const folderId = noteId ? undefined : searchParams.get("folder") ?? undefined;

  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const togglePin = useNotesStore((s) => s.togglePin);

  const existing = noteId ? notes.find((n) => n.id === noteId) : undefined;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? initialBody);
  // Once a new note is persisted we keep writing to that same id.
  const createdId = useRef<string | null>(noteId ?? null);
  const seeded = useRef(false);
  const editorRef = useRef<RichTextEditorHandle>(null);

  // Adopt the persisted note once localStorage rehydrates.
  useEffect(() => {
    if (!hydrated || seeded.current || !existing) return;
    seeded.current = true;
    setTitle(existing.title);
    setBody(existing.body);
  }, [hydrated, existing]);

  // Debounced autosave.
  useEffect(() => {
    if (!hydrated) return;
    if (!title.trim() && !body.trim()) return;

    const timer = setTimeout(() => {
      if (createdId.current) {
        updateNote(createdId.current, { title: title.trim() || "Nova nota", body });
      } else {
        createdId.current = addNote({ title: title.trim() || "Nova nota", body, folderId });
        // Not router.replace(): that navigates from the /notes/new route tree
        // to /notes/[id], which remounts this whole component (replaying the
        // entrance animation and dropping focus — the "flicker"). A plain
        // history update keeps this same instance alive and just relabels
        // the URL bar, since nothing here actually depends on route params.
        window.history.replaceState(null, "", `/notes/${createdId.current}`);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [title, body, hydrated, addNote, updateNote, folderId]);

  const current = createdId.current ? notes.find((n) => n.id === createdId.current) : undefined;
  const pinned = current?.pinned ?? false;

  return (
    <motion.main
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex flex-1 flex-col"
    >
      <header className="flex items-center gap-2 px-4 py-3 sm:px-6">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<ArrowLeft />}
          onClick={() => router.push("/notes")}
        >
          Voltar
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => editorRef.current?.openImagePicker()}
            aria-label="Inserir imagem"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ImagePlus className="size-4" />
          </button>
          {current && (
            <button
              type="button"
              onClick={() => togglePin(current.id)}
              aria-label={pinned ? "Desafixar nota" : "Fixar nota"}
              aria-pressed={pinned}
              className={cn(
                "rounded-full p-2 transition-colors",
                pinned
                  ? "bg-primary/[0.18] text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Pin className={cn("size-4", pinned && "fill-current")} />
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pb-16 sm:px-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título da nota"
          aria-label="Título da nota"
          autoFocus={!noteId}
          className="w-full bg-transparent font-heading text-3xl leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50"
        />

        <SyncStatusIndicator status={current?.syncStatus ?? "local"} />

        <RichTextEditor
          ref={editorRef}
          content={body}
          onChange={setBody}
          autoFocus={!noteId}
          className="flex flex-1 flex-col"
        />
      </div>
    </motion.main>
  );
}
