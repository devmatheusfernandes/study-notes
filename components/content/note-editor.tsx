"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, ImagePlus, Pin, Share } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/toaster";
import { SyncStatusIndicator } from "@/components/content/sync-status";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/content/rich-text-editor";
import { NoteReferenceSurface } from "@/components/content/note-reference-surface";
import { useNotesStore } from "@/lib/store/notes-store";
import { bodyToPlainText } from "@/lib/note-preview";
import { shareNote } from "@/lib/share";
import { useHydrated } from "@/components/providers/store-hydration";
import { listPublicationSymbols } from "@/app/(app)/jwpub-actions";
import type { PublicationOption } from "@/lib/notes/reference-suggestions";
import type { NoteReference } from "@/lib/notes/note-reference";

interface NoteEditorProps {
  /** Existing note id, or undefined for a brand-new note. */
  noteId?: string;
  initialNote?: {
    id: string;
    title: string;
    body: string;
  } | null;
  /**
   * Overrides the "Voltar" button's navigation. Used by OfflineNoteView (the
   * Service Worker's fallback body for a failed /notes/[id] navigation — see
   * app/sw.ts): that page's embedded route tree is /notes-offline's own, not
   * /notes/[id]'s, so a Next `router.push` from there would navigate against
   * a mismatched client router state. A real `window.location` assignment
   * (full reload) sidesteps that entirely.
   */
  onBack?: () => void;
}

export function NoteEditor({ noteId, initialNote, onBack }: NoteEditorProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  // Read client-side (not as server searchParams) so /notes/new stays a
  // static shell — see the comment on that page.
  const searchParams = useSearchParams();
  const initialBody = noteId ? "" : searchParams.get("q") ?? "";
  const folderId = noteId ? undefined : searchParams.get("folder") ?? undefined;
  // Same `?text=` convention chat-message.tsx already sends jwpub notes to
  // (see JwpubChapterView's own highlight effect) — reused here so a note
  // opened from a search result (see notes-collection.tsx) or a chat source
  // jumps straight to where the term appears instead of just opening at the top.
  const highlight = searchParams.get("text");

  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const updateNote = useNotesStore((s) => s.updateNote);
  const togglePin = useNotesStore((s) => s.togglePin);

  const existing = noteId ? (notes.find((n) => n.id === noteId) ?? initialNote) : undefined;

  const effectiveTitle =
    existing?.title && existing.title.trim().length > 0
      ? existing.title
      : initialNote?.title && initialNote.title.trim().length > 0
      ? initialNote.title
      : "";

  const effectiveBody =
    existing?.body && existing.body.trim().length > 0
      ? existing.body
      : initialNote?.body && initialNote.body.trim().length > 0
      ? initialNote.body
      : initialBody;

  const [title, setTitle] = useState(effectiveTitle);
  const [body, setBody] = useState(effectiveBody);
  // Once a new note is persisted we keep writing to that same id.
  const [createdId, setCreatedId] = useState<string | null>(noteId ?? null);
  const editorRef = useRef<RichTextEditorHandle>(null);

  // The user's .jwpub library, for in-note references: it decides whether a
  // typed "(th 2)" is a real reference and it populates the "/" menu. Fetched
  // once here rather than per keystroke — a note is edited far more often
  // than the library changes.
  const [publications, setPublications] = useState<PublicationOption[]>([]);
  const [openReference, setOpenReference] = useState<NoteReference | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listPublicationSymbols().then((result) => {
      if (!cancelled) setPublications(result.publications);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced autosave.
  useEffect(() => {
    if (!hydrated) return;
    if (!title.trim() && !body.trim()) return;

    const timer = setTimeout(() => {
      if (createdId) {
        updateNote(createdId, { title: title.trim() || "Nova nota", body });
      } else {
        const newId = addNote({ title: title.trim() || "Nova nota", body, folderId });
        setCreatedId(newId);
        // Not router.replace(): that navigates from the /notes/new route tree
        // to /notes/[id], which remounts this whole component (replaying the
        // entrance animation and dropping focus — the "flicker"). A plain
        // history update keeps this same instance alive and just relabels
        // the URL bar, since nothing here actually depends on route params.
        window.history.replaceState(null, "", `/notes/${newId}`);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [title, body, hydrated, addNote, updateNote, folderId, createdId]);

  // Jumps to (and selects, so it's visually highlighted) the first
  // occurrence of the search term once the editor has real content to search —
  // `body` only carries the note's actual text once the store has hydrated,
  // so this keeps retrying (cheaply — it's just a doc walk) until that lands
  // instead of firing once too early and silently finding nothing. Left in
  // the URL afterward rather than stripped, matching JwpubChapterView's own
  // `?text=` handling — reloading the same link re-highlights the same spot.
  const highlightApplied = useRef(false);
  useEffect(() => {
    if (!highlight || highlightApplied.current || !body) return;
    if (editorRef.current?.scrollToText(highlight)) highlightApplied.current = true;
  }, [highlight, body]);

  const current = createdId ? notes.find((n) => n.id === createdId) : undefined;
  const pinned = current?.pinned ?? false;

  return (
    // Row, not just the main column: the reference panel is a flex sibling
    // (same arrangement as JwpubReader), so opening it narrows the note
    // instead of floating over the text the user is writing.
    <div className="flex min-h-dvh w-full">
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header className="flex items-center gap-2 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft />}
            onClick={() => (onBack ? onBack() : router.push("/notes"))}
          >
            Voltar
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const result = await shareNote(title || "Nova nota", bodyToPlainText(body));
                if (result === "copied") notify.success("Copiado", "O conteúdo da nota foi copiado.");
              }}
              aria-label="Compartilhar nota"
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Share className="size-4" />
            </button>
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
            publications={publications}
            onReferenceClick={setOpenReference}
          />
        </div>
      </motion.main>

      <NoteReferenceSurface reference={openReference} onClose={() => setOpenReference(null)} />
    </div>
  );
}
