"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/content/rich-text-editor";
import { queueCreateNote, queueUpdateNote } from "@/lib/offline/jwlibrary-mutations";
import type { CreateJwlibraryNoteInput } from "@/app/(app)/jwlibrary-actions";

const SAVE_DEBOUNCE_MS = 600;

export type NewNoteInput = Omit<CreateJwlibraryNoteInput, "title" | "content" | "id" | "userMarkId">;

interface InlineHighlightNoteProps {
  /** The note being edited, or null to create one on the first keystroke. */
  note: { id: string; title: string; content: string } | null;
  /** Where a new note goes — read at the moment it is created, so a colour picked meanwhile counts. */
  createInput?: () => NewNoteInput;
  /** After every save (already applied to the outbox), with the highlight it created alongside, if any. */
  onSaved: (note: { id: string; title: string; content: string }, created?: { userMarkId?: string }) => void;
}

/**
 * The title + text of a highlight note, edited right where it is — for side
 * panels, where opening the editor Vault would stack a second surface on top of
 * the one being read. Autosaves like JwlibraryNoteEditorVault and flushes
 * whatever is pending when it goes away.
 */
export function InlineHighlightNote({ note, createInput, onSaved }: InlineHighlightNoteProps) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");

  const idRef = useRef(note?.id ?? null);
  const savedRef = useRef({ title: note?.title ?? "", content: note?.content ?? "" });
  const latestRef = useRef({ title, content });
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    latestRef.current = { title, content };
    saveRef.current = () => {
      const next = latestRef.current;
      if (next.title === savedRef.current.title && next.content === savedRef.current.content) return;
      if (idRef.current) {
        queueUpdateNote(idRef.current, next);
        savedRef.current = next;
        onSaved({ id: idRef.current, ...next });
        return;
      }
      if (!createInput || (!next.title.trim() && !next.content.replace(/<[^>]*>/g, "").trim())) return;
      const { noteId, userMarkId } = queueCreateNote({ ...createInput(), ...next });
      idRef.current = noteId;
      savedRef.current = next;
      onSaved({ id: noteId, ...next }, { userMarkId });
    };
  });

  useEffect(() => {
    const timer = setTimeout(() => saveRef.current(), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [title, content]);

  // Going back (or closing the panel) inside the debounce window must not drop the text.
  useEffect(() => () => saveRef.current(), []);

  return (
    <div className="flex flex-col gap-2">
      <Input
        variant="underline"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título"
        aria-label="Título da nota"
        className="font-heading text-[15px]"
      />
      <RichTextEditor
        content={content}
        onChange={setContent}
        placeholder="Escreva sua nota…"
        className="text-[13.5px] [&_.ProseMirror]:min-h-40 [&_.ProseMirror]:text-[13.5px]"
      />
    </div>
  );
}
