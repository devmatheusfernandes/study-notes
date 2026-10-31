"use client";

import { Check, Folder, FolderOpen } from "lucide-react";
import { Vault, VaultBody, VaultContent, VaultHeader, VaultTitle, VaultDescription } from "@/components/ui/vault";
import { useNotesStore, type Folder as FolderType } from "@/lib/store/notes-store";
import { descendantIds } from "@/lib/folders";
import { cn } from "@/lib/utils";

interface FolderPickerVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Notes/files to move. Ignored when `folderId` is set. */
  noteIds?: string[];
  /** The note's own folder, so it can be shown as the current pick — only meaningful for a single note. */
  currentFolderId?: string;
  /** Moves this folder (under the picked one) instead of moving notes. Its own subtree is not offered as a destination. */
  folderId?: string;
}

/**
 * Flat list of every folder (nested ones shown with their parent path, e.g.
 * "Estudos / Bíblia") plus a "Sem pasta" root option — deliberately no
 * folder-creation here, same reasoning as TagPickerVault.
 */
export function FolderPickerVault({ open, onOpenChange, noteIds = [], currentFolderId, folderId }: FolderPickerVaultProps) {
  const folders = useNotesStore((s) => s.folders);
  const moveNote = useNotesStore((s) => s.moveNote);
  const bulkMoveNotes = useNotesStore((s) => s.bulkMoveNotes);
  const moveFolder = useNotesStore((s) => s.moveFolder);

  const movingFolder = folderId !== undefined;
  const isBulk = !movingFolder && noteIds.length > 1;
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const currentId = movingFolder ? folderById.get(folderId)?.parentId : currentFolderId;
  const blocked = movingFolder ? new Set([folderId, ...descendantIds(folders, folderId)]) : new Set<string>();
  const checkCurrent = movingFolder || !isBulk;

  function pathFor(folder: FolderType): string {
    const parent = folder.parentId ? folderById.get(folder.parentId) : undefined;
    return parent ? `${pathFor(parent)} / ${folder.name}` : folder.name;
  }

  function pick(destinationId?: string) {
    if (movingFolder) moveFolder(folderId, destinationId);
    else if (isBulk) bulkMoveNotes(noteIds, destinationId);
    else if (noteIds[0]) moveNote(noteIds[0], destinationId);
    onOpenChange(false);
  }

  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label={movingFolder ? "Mover pasta" : "Mover para pasta"}>
        <VaultHeader showCloseButton={false}>
          <VaultTitle>
            {movingFolder ? `Mover "${folderById.get(folderId)?.name ?? "pasta"}"` : isBulk ? `Mover ${noteIds.length} itens` : "Mover para pasta"}
          </VaultTitle>
          <VaultDescription>Escolha a pasta de destino.</VaultDescription>
        </VaultHeader>
        <VaultBody>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto no-scrollbar">
            <li>
              <button
                type="button"
                onClick={() => pick(undefined)}
                disabled={movingFolder && !currentId}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary",
                  movingFolder && !currentId && "opacity-50"
                )}
              >
                <FolderOpen className="size-4 text-muted-foreground" />
                <span className="truncate text-[13.5px] text-foreground">Sem pasta (raiz)</span>
                {checkCurrent && !currentId && <Check className="ml-auto size-4 shrink-0 text-accent" />}
              </button>
            </li>
            {folders
              .filter((folder) => !blocked.has(folder.id))
              .map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => pick(folder.id)}
                    disabled={checkCurrent && folder.id === currentId}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary",
                      checkCurrent && folder.id === currentId && "opacity-50"
                    )}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-[13.5px] text-foreground">{pathFor(folder)}</span>
                    {checkCurrent && folder.id === currentId && <Check className="ml-auto size-4 shrink-0 text-accent" />}
                  </button>
                </li>
              ))}
          </ul>
        </VaultBody>
      </VaultContent>
    </Vault>
  );
}
