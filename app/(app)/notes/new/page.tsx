import type { Metadata } from "next";
import { NoteEditor } from "@/components/content/note-editor";

export const metadata: Metadata = {
  title: "Nova nota — Study Notes",
};

// No async params/searchParams read here on purpose: NoteEditor reads them
// client-side via useSearchParams(). That keeps this page free of any
// dynamic server API, so Next can prerender it statically — the same static
// shell then serves every "new note" navigation, offline included, instead
// of needing a fresh RSC fetch keyed to that request's query string.
export default function NewNotePage() {
  return <NoteEditor />;
}
