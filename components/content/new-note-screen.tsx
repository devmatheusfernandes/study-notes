"use client";

import { useSearchParams } from "next/navigation";
import { NoteEditor } from "@/components/content/note-editor";
import { DrawingNoteEditor } from "@/components/content/drawing-note-editor";

/**
 * Which editor a brand-new note opens in, decided client-side from `?type=`
 * so /notes/new stays a static shell (see that page's own comment) — one
 * prerendered route still serves every "new note" navigation, offline included.
 */
export function NewNoteScreen() {
  const type = useSearchParams().get("type");
  return type === "desenho" ? <DrawingNoteEditor /> : <NoteEditor />;
}
