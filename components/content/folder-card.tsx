"use client";

import { useRef, useState } from "react";
import { Folder, MoreHorizontal, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { extractDiscoveredItems, type DiscoveredFile } from "@/lib/import-notes";
import { hasDraggedNoteIds, readDraggedNoteIds } from "@/lib/note-drag";

export interface FolderCardProps {
  name: string;
  itemCount: number;
  onOpen?: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
  onDropItems?: (items: DiscoveredFile[]) => void;
  /** Called with the dragged note/file ids when they're dropped here to move them into this folder. */
  onDropNoteIds?: (ids: string[]) => void;
}

export function FolderCard({
  name,
  itemCount,
  onOpen,
  onRename,
  onDelete,
  onDropItems,
  onDropNoteIds,
}: FolderCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepth = useRef(0);

  function commit() {
    const next = draft.trim();
    if (next && next !== name) onRename?.(next);
    else setDraft(name);
    setEditing(false);
  }

  function hasFiles(event: React.DragEvent) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function isDraggable(event: React.DragEvent) {
    return hasFiles(event) || hasDraggedNoteIds(event);
  }

  return (
    <div
      className={`relative cursor-pointer flex items-center gap-3 rounded-3xl p-4 text-left transition-all duration-200 ${
        isDragOver
          ? "bg-accent/20 ring-2 ring-accent scale-[1.02] shadow-lg"
          : "bg-card hover:bg-secondary"
      }`}
      onDragEnter={(e) => {
        if (!isDraggable(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current += 1;
        setIsDragOver(true);
      }}
      onDragOver={(e) => {
        if (!isDraggable(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasDraggedNoteIds(e) ? "move" : "copy";
      }}
      onDragLeave={(e) => {
        if (!isDraggable(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        if (!isDraggable(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth.current = 0;
        setIsDragOver(false);

        if (hasDraggedNoteIds(e)) {
          const ids = readDraggedNoteIds(e.dataTransfer);
          if (ids.length > 0) onDropNoteIds?.(ids);
          return;
        }

        void extractDiscoveredItems(e.dataTransfer).then((discovered) => {
          if (discovered.length > 0) {
            onDropItems?.(discovered);
          }
        });
      }}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
          isDragOver ? "bg-accent text-background" : "bg-primary/20 text-accent"
        }`}
      >
        {isDragOver ? <Upload className="size-[18px] animate-bounce" /> : <Folder className="size-[18px]" />}
      </span>

      {editing ? (
        <input
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          aria-label={`Renomear pasta ${name}`}
          className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1 font-heading text-[15px] outline-none ring-1 ring-ring"
        />
      ) : (
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate font-heading text-[15px]">{name}</span>
          <span className="text-[11.5px] text-muted-foreground">
            {isDragOver ? "Soltar aqui" : `${itemCount} ${itemCount === 1 ? "item" : "itens"}`}
          </span>
        </button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Mais opções para ${name}`}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onRename && (
            <DropdownMenuItem
              onSelect={() => {
                setDraft(name);
                setEditing(true);
              }}
            >
              Renomear
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
              Excluir pasta
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {onDelete && (
        <ConfirmVault
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Excluir pasta?"
          description={`"${name}" será excluída. Notas, arquivos e subpastas dentro dela sobem de nível em vez de serem apagados.`}
          confirmLabel="Excluir pasta"
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}
