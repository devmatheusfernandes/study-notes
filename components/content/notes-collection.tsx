"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { notify } from "@/components/ui/toaster";
import { NoteCard } from "./note-card";
import { FolderCard } from "./folder-card";
import { useNotesStore, selectByStatus, type Note, type NoteStatus } from "@/lib/store/notes-store";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { useFolderViewStore } from "@/lib/store/folder-view-store";
import { useSelectionStore } from "@/lib/store/selection-store";
import { useSearchStore } from "@/lib/store/search-store";
import { matchesSearch } from "@/lib/search";
import { useHydrated } from "@/components/providers/store-hydration";
import { FileDropZone } from "./file-drop-zone";
import { TagPickerVault } from "./tag-picker-vault";
import { useFileUpload } from "@/hooks/use-file-upload";
import { getFileUrl } from "@/app/(app)/files-actions";

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
  const searchParams = useSearchParams();

  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const isSelected = useSelectionStore((s) => s.isSelected);
  const toggleSelect = useSelectionStore((s) => s.toggle);
  const clearSelection = useSelectionStore((s) => s.clear);
  const setVisibleIds = useSelectionStore((s) => s.setVisibleIds);
  const selectionMode = selectedIds.length > 0;

  // Folder scoping only applies to the main content screen — landing on
  // archived/trash drops back to the root. (Deliberately no unmount cleanup
  // here anymore: the folder now lives in the URL, so leaving /notes and
  // coming back to the same `?folder=` should reopen it, not reset it — and
  // an unconditional reset-on-unmount also fired spuriously under React
  // Strict Mode's dev-only mount→cleanup→remount cycle, wiping out a
  // just-adopted deep link before it ever rendered.)
  useEffect(() => {
    if (!showFolders) setActiveFolder(null);
  }, [showFolders, setActiveFolder]);

  // Mirrors the open folder into `?folder=<id>` so it's deep-linkable and the
  // browser's back/forward buttons step through folder navigation — using
  // plain History APIs (not next/navigation's router) so drilling into a
  // folder never triggers a real Next.js navigation/remount of this screen.
  const suppressNextUrlPush = useRef(false);
  const didAdoptFromUrl = useRef(false);

  useEffect(() => {
    if (!showFolders || didAdoptFromUrl.current) return;
    didAdoptFromUrl.current = true;
    const folderParam = searchParams.get("folder");
    if (folderParam) {
      suppressNextUrlPush.current = true;
      setActiveFolder(folderParam);
    }
  }, [showFolders, searchParams, setActiveFolder]);

  useEffect(() => {
    if (!showFolders) return;
    if (suppressNextUrlPush.current) {
      suppressNextUrlPush.current = false;
      return;
    }
    const url = new URL(window.location.href);
    if (activeFolder) url.searchParams.set("folder", activeFolder);
    else url.searchParams.delete("folder");
    if (url.href === window.location.href) return;
    window.history.pushState(null, "", url);
  }, [activeFolder, showFolders]);

  useEffect(() => {
    if (!showFolders) return;
    function onPopState() {
      suppressNextUrlPush.current = true;
      setActiveFolder(new URLSearchParams(window.location.search).get("folder"));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [showFolders, setActiveFolder]);

  // A selection shouldn't survive switching screens or drilling into a folder —
  // it'd otherwise silently apply to a completely different list of items.
  useEffect(() => {
    clearSelection();
    return () => clearSelection();
  }, [status, activeFolder, clearSelection]);

  const notes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const tags = useNotesStore((s) => s.tags);
  const [manageTagsNoteId, setManageTagsNoteId] = useState<string | null>(null);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const deleteFolder = useNotesStore((s) => s.deleteFolder);
  const togglePin = useNotesStore((s) => s.togglePin);
  const archive = useNotesStore((s) => s.archive);
  const trash = useNotesStore((s) => s.trash);
  const restore = useNotesStore((s) => s.restore);
  const deletePermanently = useNotesStore((s) => s.deletePermanently);
  const toggleChecklistItem = useNotesStore((s) => s.toggleChecklistItem);
  const viewMode = usePreferencesStore((s) => s.viewMode);
  const { processDiscoveredItems } = useFileUpload();

  const isTrashed = status === "trashed";
  const query = useSearchStore((s) => s.query);
  const selectedTagIds = useSearchStore((s) => s.selectedTagIds);
  const isSearching = query.trim().length > 0;
  const { pinned: allPinned, others: allOthers } = selectByStatus(
    notes,
    status,
    showFolders ? { folderId: activeFolder } : undefined
  );
  const matchesNote = (note: Note) =>
    matchesSearch(query, note.title, note.body) &&
    (selectedTagIds.length === 0 || selectedTagIds.some((id) => note.tagIds.includes(id)));
  const pinned = allPinned.filter(matchesNote);
  const others = allOthers.filter(matchesNote);
  const isEmpty = pinned.length === 0 && others.length === 0;

  // Keeps the selection store's notion of "all" matched to what's actually on
  // screen, so "Selecionar todas" is correct after filtering/folder changes.
  useEffect(() => {
    setVisibleIds([...pinned, ...others].map((n) => n.id));
  }, [pinned, others, setVisibleIds]);

  const openFolder = folders.find((f) => f.id === activeFolder);
  // Subfolders of whatever level we're currently browsing (root, or the open folder).
  const childFolders = (
    showFolders ? folders.filter((f) => (f.parentId ?? null) === (activeFolder ?? null)) : []
  ).filter((f) => matchesSearch(query, f.name));
  const foldersVisible = childFolders.length > 0;

  async function openNote(note: Note) {
    if (note.processing) return; // still uploading/ingesting — NoteCard already blocks the click, this is belt-and-suspenders.
    if (!note.storagePath) {
      // Text notes (and legacy seed/demo file cards with no real upload) use the editor.
      router.push(`/notes/${note.id}`);
      return;
    }

    // Publications and PDFs are read in-app rather than downloaded — the route itself
    // decides between the respective reader and the editor.
    if (note.type === "jwpub" || note.type === "pdf") {
      router.push(`/notes/${note.id}`);
      return;
    }

    // Open the tab synchronously, on the click itself, so browsers don't treat
    // the later redirect as an unrequested popup once the signed URL resolves.
    const tab = window.open("", "_blank");
    const { url, error } = await getFileUrl(note.storagePath);
    if (error || !url) {
      tab?.close();
      notify.error("Não foi possível abrir o arquivo", error);
      return;
    }
    if (tab) tab.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  const renderCard = (note: Note) => {
    // A temp id (no server row yet) can't be pinned/archived/tagged/deleted —
    // see addOptimisticFile in the store. Once resolved to a real id the row
    // exists even if still `processing` (e.g. a .jwpub still being ingested),
    // so only the open-to-read action stays gated at that point.
    const isOptimistic = note.id.startsWith("optimistic:");

    return (
      <NoteCard
        key={note.clientKey ?? note.id}
        id={note.id}
        type={note.type}
        title={note.title}
        body={note.body}
        meta={note.meta}
        syncStatus={note.syncStatus}
        vectorStatus={note.vectorStatus}
        processing={note.processing}
        pinned={note.pinned}
        variant={viewMode}
        permanentDelete={isTrashed}
        selectionMode={selectionMode}
        selected={isSelected(note.id)}
        tags={note.tagIds.length > 0 ? tags.filter((t) => note.tagIds.includes(t.id)) : undefined}
        onToggleSelect={isOptimistic ? undefined : toggleSelect}
        onOpen={() => void openNote(note)}
        onTogglePin={!isOptimistic && status === "active" ? () => togglePin(note.id) : undefined}
        onArchive={!isOptimistic && status === "active" ? () => archive(note.id) : undefined}
        onRestore={!isOptimistic && status !== "active" ? () => restore(note.id) : undefined}
        onDelete={isOptimistic ? undefined : isTrashed ? () => deletePermanently(note.id) : () => trash(note.id)}
        onManageTags={isOptimistic ? undefined : () => setManageTagsNoteId(note.id)}
        onToggleChecklistItem={(index) => toggleChecklistItem(note.id, index)}
      />
    );
  };

  const itemsSection = (label: string, items: Note[]) => {
    if (items.length === 0) return null;

    if (viewMode === "list") {
      return (
        <section className="flex flex-col gap-3">
          <span className="font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">
            {label}
          </span>
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
        </section>
      );
    }

    // Single item in grid mode: expand to full width (100%) so single pinned/other notes fill the space nicely
    if (items.length === 1) {
      return (
        <section className="flex flex-col gap-3">
          <span className="font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">
            {label}
          </span>
          <div className="w-full">
            <motion.div
              key={items[0].id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              {renderCard(items[0])}
            </motion.div>
          </div>
        </section>
      );
    }

    // Multi-item balanced grid: alternate items into 2 columns for mobile/tablet to balance height perfectly
    const col1 = items.filter((_, i) => i % 2 === 0);
    const col2 = items.filter((_, i) => i % 2 === 1);

    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground">
          {label}
        </span>
        <div className="grid grid-cols-2 gap-3 md:hidden">
          <div className="flex flex-col gap-3">
            {col1.map((note) => (
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
          <div className="flex flex-col gap-3">
            {col2.map((note) => (
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
        </div>

        {/* Desktop grid (3 columns on md, 4 on xl) */}
        <div className="hidden md:columns-3 xl:columns-4 [&>*]:mb-3 [&>*]:break-inside-avoid md:block">
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
      </section>
    );
  };

  if (!hydrated) {
    // Placeholder that matches the server render, avoiding a flash of seed data
    // being reordered once localStorage rehydrates.
    return <div className="flex-1 px-4 py-6 sm:px-6" aria-hidden />;
  }

  return (
    <>
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
                  onDropItems={(items) => void processDiscoveredItems(items, folder.id)}
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
                <EmptyTitle>
                  {isSearching ? "Nenhum resultado" : openFolder ? "Pasta vazia" : emptyTitle}
                </EmptyTitle>
                <EmptyDescription>
                  {isSearching
                    ? `Nada encontrado para "${query.trim()}".`
                    : openFolder
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
    <TagPickerVault
      open={manageTagsNoteId !== null}
      onOpenChange={(open) => {
        if (!open) setManageTagsNoteId(null);
      }}
      noteIds={manageTagsNoteId ? [manageTagsNoteId] : []}
    />
    </>
  );
}
