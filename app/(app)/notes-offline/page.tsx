import type { Metadata } from "next";
import { OfflineNoteView } from "@/components/content/offline-note-view";

export const metadata: Metadata = {
  title: "Nota — Study Notes",
};

// No async params/searchParams read here, same reasoning as notes/new/page.tsx:
// this page must be precacheable as a static shell, since it's only ever
// reached as the Service Worker's fallback body for a failed /notes/[id]
// navigation (see app/sw.ts). OfflineNoteView reads the real note id straight
// from window.location client-side.
export default function NotesOfflinePage() {
  return <OfflineNoteView />;
}
