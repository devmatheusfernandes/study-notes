"use client";

import { Suspense, useEffect, useState } from "react";
import { FileQuestion } from "lucide-react";
import { useNotesStore } from "@/lib/store/notes-store";
import { useHydrated } from "@/components/providers/store-hydration";
import { NoteEditor } from "./note-editor";
import { JwpubReader } from "./jwpub-reader";
import { getOfflinePublication, type OfflinePublication } from "@/lib/offline/jwpub-offline";
import { LockGate } from "@/components/lock/lock-gate";

/**
 * Rendered at /notes-offline — the Service Worker's fallback body for any
 * /notes/<id> navigation that fails offline (see the matcher in app/sw.ts).
 * The browser keeps showing the real requested URL (/notes/<id>) even though
 * this page's own React tree is what's mounted, so the note id has to be read
 * straight from `window.location`, not from Next's router (`useParams`/
 * `usePathname` would report this page's own route, /notes-offline, since
 * that's the tree actually embedded in the precached HTML).
 *
 * Renders straight from the offline-first notes store (already hydrated from
 * localStorage) instead of any server-fetched prop — the same data NoteEditor
 * already prefers over its `initialNote` prop, so a note created or edited
 * entirely offline opens correctly here with no network involved.
 */
export function OfflineNoteView() {
  const [noteId, setNoteId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/notes\/([^/]+)$/);
    setNoteId(match?.[1] ?? null);
  }, []);

  const hydrated = useHydrated();
  const notes = useNotesStore((s) => s.notes);
  const note = noteId ? notes.find((n) => n.id === noteId) : undefined;

  // A publication downloaded for offline reading is kept in IndexedDB, not in the notes store.
  // undefined: not looked up yet. null: nothing downloaded.
  const [downloaded, setDownloaded] = useState<OfflinePublication | null | undefined>(undefined);
  const isPublication = note?.type === "jwpub";
  useEffect(() => {
    if (!noteId || !isPublication) return;
    let cancelled = false;
    void getOfflinePublication(noteId).then((found) => {
      if (!cancelled) setDownloaded(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, isPublication]);

  // Undefined noteId: still waiting on the location.pathname effect (or the
  // store rehydrating). Keeps the server/first-client render empty, matching
  // what was actually baked into the precached HTML — anything else here
  // would be a hydration mismatch against that snapshot.
  if (noteId === undefined || !hydrated) {
    return <div className="flex flex-1" />;
  }

  // Only plain rich-text notes ("nota") can be reconstructed from the local
  // store alone — files/.jwpub/.pdf keep their content in Storage/separate
  // tables that never get mirrored to localStorage.
  if (note && note.type === "nota") {
    return (
      <LockGate noteId={note.id} initialLocked={false}>
        <NoteEditor noteId={note.id} onBack={() => { window.location.href = "/notes"; }} />
      </LockGate>
    );
  }

  if (isPublication && downloaded === undefined) {
    return <div className="flex flex-1" />;
  }

  if (note && downloaded) {
    const params = new URLSearchParams(window.location.search);
    return (
      <LockGate noteId={note.id} initialLocked={false}>
        <Suspense fallback={null}>
          <JwpubReader
            noteId={note.id}
            initialPublication={downloaded.publication}
            initialChapters={downloaded.chapters}
            initialChapterParam={params.get("chapter") ?? undefined}
            initialDocParam={params.get("doc") ?? undefined}
          />
        </Suspense>
      </LockGate>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <FileQuestion className="size-6" />
      </div>
      <h1 className="font-heading text-xl">Nota não disponível offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {note
          ? isPublication
            ? "Esta publicação não foi baixada. Abra-a com internet e use o botão de download para lê-la offline."
            : "Arquivos precisam de conexão para abrir."
          : "Essa nota ainda não foi salva neste dispositivo."}
      </p>
      <a href="/notes" className="text-sm font-medium text-accent underline underline-offset-4">
        Voltar para minhas notas
      </a>
    </div>
  );
}
