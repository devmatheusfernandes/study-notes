"use client";

import { useState } from "react";
import { Folder, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmVault } from "@/components/ui/confirm-vault";

export interface FolderCardProps {
  name: string;
  itemCount: number;
  onOpen?: () => void;
  onRename?: (name: string) => void;
  onDelete?: () => void;
}

export function FolderCard({ name, itemCount, onOpen, onRename, onDelete }: FolderCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function commit() {
    const next = draft.trim();
    if (next && next !== name) onRename?.(next);
    else setDraft(name);
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-3 rounded-3xl bg-card p-4 text-left transition-colors hover:bg-secondary">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-accent">
        <Folder className="size-[18px]" />
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
            {itemCount} {itemCount === 1 ? "item" : "itens"}
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
