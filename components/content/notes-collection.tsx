"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { NoteCard } from "./note-card";
import { FolderCard } from "./folder-card";
import { useNotesStore, selectByStatus, type Note, type NoteStatus } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { useFolderViewStore } from "@/lib/store/folder-view-store";
import { useSelectionStore } from "@/lib/store/selection-store";
import { useHydrated } from "@/components/providers/store-hydration";
import { FileDropZone } from "./file-drop-zone";

interface NotesCollectionProps {
  status: NoteStatus;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  /** Folders only make sense on the main content screen. */
  showFolders?: boolean;
}

export function NotesCollection({
  status,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  showFolders = false,
}: NotesCollectionProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const activeFolder = useFolderViewStore((s) => s.activeFolderId);
  const setActiveFolder = useFolderViewStore((s) => s.setActiveFolder);

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const isSelected = useSelectionStore((s) => s.isSelected);
  const toggleSelect = useSelectionStore((s) => s.toggle);
  const clearSelection = useSelectionStore((s) => s.clear);
  const setVisibleIds = useSelectionStore((s) => s.setVisibleIds);
  const selectionMode = selectedIds.length > 0;

  // Folder scoping only applies to the main content screen; leaving it (or
  // landing on archived/trash) drops back to the root.
  useEffect(() => {
    if (!showFolders) setActiveFolder(null);
    return () => setActiveFolder(null);
  }, [showFolders, setActiveFolder]);

  // A selection shouldn't survive switching screens or drilling into a folder —
  // it'd otherwise silently apply to a completely different list of items.
  useEffect(() => {
    clearSelection();
    return () => clearSelection();
  }, [status, activeFolder, clearSelection]);

  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const deleteFolder = useNotesStore((s) => s.deleteFolder);
  const togglePin = useNotesStore((s) => s.togglePin);
  const archive = useNotesStore((s) => s.archive);
  const trash = useNotesStore((s) => s.trash);
  const restore = useNotesStore((s) => s.restore);
  const deletePermanently = useNotesStore((s) => s.deletePermanently);
  const viewMode = usePreferencesStore((s) => s.viewMode);

  const isTrashed = status === "trashed";
  const { pinned, others } = selectByStatus(
    notes,
    status,
    showFolders ? { folderId: activeFolder } : undefined
  );
  const isEmpty = pinned.length === 0 && others.length === 0;

  // Keeps the selection store's notion of "all" matched to what's actually on
  // screen, so "Selecionar todas" is correct after filtering/folder changes.
  useEffect(() => {
    setVisibleIds([...pinned, ...others].map((n) => n.id));
  }, [pinned, others, setVisibleIds]);

  const openFolder = folders.find((f) => f.id === activeFolder);
  // Subfolders of whatever level we're currently browsing (root, or the open folder).
  const childFolders = showFolders
    ? folders.filter((f) => (f.parentId ?? null) === (activeFolder ?? null))
    : [];
  const foldersVisible = childFolders.length > 0;

  const renderCard = (note: Note) => (
    <NoteCard
      key={note.id}
      id={note.id}
      type={note.type}
      title={note.title}
      body={note.body}
      meta={note.meta}
      syncStatus={note.syncStatus}
      pinned={note.pinned}
      variant={viewMode}
      permanentDelete={isTrashed}
      selectionMode={selectionMode}
      selected={isSelected(note.id)}
      onToggleSelect={toggleSelect}
      onOpen={() => router.push(`/notes/${note.id}`)}
      onTogglePin={status === "active" ? () => togglePin(note.id) : undefined}
      onArchive={status === "active" ? () => archive(note.id) : undefined}
      onRestore={status !== "active" ? () => restore(note.id) : undefined}
      onDelete={isTrashed ? () => deletePermanently(note.id) : () => trash(note.id)}
    />
  );

  const itemsSection = (label: string, items: Note[]) => {
    if (items.length === 0) return null;
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
        {viewMode === "grid" ? (
          // CSS multi-column masonry — cards keep their natural height and
          // `break-inside-avoid` stops them being split across columns.
          <div className="columns-2 gap-3 md:columns-3 xl:columns-4 [&>*]:mb-3 [&>*]:break-inside-avoid">
            {items.map((note) => (
              <motion.div
                key={note.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                {renderCard(note)}
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((note) => (
              <motion.div
                key={note.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                {renderCard(note)}
              </motion.div>
            ))}
          </div>
        )}
      </section>
    );
  };

  if (!hydrated) {
    // Placeholder that matches the server render, avoiding a flash of seed data
    // being reordered once localStorage rehydrates.
    return <div className="flex-1 px-4 py-6 sm:px-6" aria-hidden />;
  }

  return (
    <FileDropZone>
      <div className="flex flex-1 flex-col gap-7 px-4 py-6 sm:px-6">
        {openFolder && (
          <button
            type="button"
            onClick={() => setActiveFolder(openFolder.parentId ?? null)}
            className="flex w-fit items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-surface"
          >
            <ChevronLeft className="size-4" />
            {openFolder.name}
          </button>
        )}

        {foldersVisible && (
          <section className="flex flex-col gap-3">
            <span className="font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">
              PASTAS
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {childFolders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  name={folder.name}
                  itemCount={
                    notes.filter((n) => n.folderId === folder.id && n.status === "active").length
                  }
                  onOpen={() => setActiveFolder(folder.id)}
                  onRename={(name) => renameFolder(folder.id, name)}
                  onDelete={() => deleteFolder(folder.id)}
                />
              ))}
            </div>
          </section>
        )}

        {isEmpty ? (
          <div className="flex flex-1 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">{emptyIcon}</EmptyMedia>
                <EmptyTitle>{openFolder ? "Pasta vazia" : emptyTitle}</EmptyTitle>
                <EmptyDescription>
                  {openFolder
                    ? "Nada aqui ainda. Arraste arquivos ou crie uma nota dentro dela."
                    : emptyDescription}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <>
            {itemsSection("FIXADAS", pinned)}
            {itemsSection(pinned.length > 0 ? "OUTRAS" : "NOTAS E ARQUIVOS", others)}
          </>
        )}
      </div>
    </FileDropZone>
  );
}
