"use client";

import { Check, Folder, FolderOpen } from "lucide-react";
import { Vault, VaultBody, VaultContent, VaultHeader, VaultTitle, VaultDescription } from "@/components/ui/vault";
import { useNotesStore, type Folder as FolderType } from "@/lib/store/notes-store";
import { cn } from "@/lib/utils";

interface FolderPickerVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteIds: string[];
  /** The note's own folder, so it can be shown as the current pick — only meaningful for a single note. */
  currentFolderId?: string;
}

/**
 * Flat list of every folder (nested ones shown with their parent path, e.g.
 * "Estudos / Bíblia") plus a "Sem pasta" root option — deliberately no
 * folder-creation here, same reasoning as TagPickerVault.
 */
export function FolderPickerVault({ open, onOpenChange, noteIds, currentFolderId }: FolderPickerVaultProps) {
  const folders = useNotesStore((s) => s.folders);
  const moveNote = useNotesStore((s) => s.moveNote);
  const bulkMoveNotes = useNotesStore((s) => s.bulkMoveNotes);

  const isBulk = noteIds.length > 1;
  const folderById = new Map(folders.map((f) => [f.id, f]));

  function pathFor(folder: FolderType): string {
    const parent = folder.parentId ? folderById.get(folder.parentId) : undefined;
    return parent ? `${pathFor(parent)} / ${folder.name}` : folder.name;
  }

  function pick(folderId?: string) {
    if (isBulk) bulkMoveNotes(noteIds, folderId);
    else if (noteIds[0]) moveNote(noteIds[0], folderId);
    onOpenChange(false);
  }

  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label="Mover para pasta">
        <VaultHeader showCloseButton={false}>
          <VaultTitle>{isBulk ? `Mover ${noteIds.length} itens` : "Mover para pasta"}</VaultTitle>
          <VaultDescription>Escolha a pasta de destino.</VaultDescription>
        </VaultHeader>
        <VaultBody>
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto no-scrollbar">
            <li>
              <button
                type="button"
                onClick={() => pick(undefined)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary"
              >
                <FolderOpen className="size-4 text-muted-foreground" />
                <span className="truncate text-[13.5px] text-foreground">Sem pasta (raiz)</span>
                {!isBulk && !currentFolderId && <Check className="ml-auto size-4 shrink-0 text-accent" />}
              </button>
            </li>
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  onClick={() => pick(folder.id)}
                  disabled={!isBulk && folder.id === currentFolderId}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary",
                    !isBulk && folder.id === currentFolderId && "opacity-50"
                  )}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-[13.5px] text-foreground">{pathFor(folder)}</span>
                  {!isBulk && folder.id === currentFolderId && <Check className="ml-auto size-4 shrink-0 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </VaultBody>
      </VaultContent>
    </Vault>
  );
}
