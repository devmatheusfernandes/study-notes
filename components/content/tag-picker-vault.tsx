"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Vault, VaultBody, VaultContent, VaultHeader, VaultTitle, VaultDescription } from "@/components/ui/vault";
import { useNotesStore } from "@/lib/store/notes-store";
import { TagDot } from "./tag-pill";

interface TagPickerVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One id: toggles apply immediately (mirrors togglePin). More than one: staged behind an "Aplicar" button, additive-only. */
  noteIds: string[];
}

/**
 * Lists every existing tag as a toggleable row — deliberately no create-tag
 * option here, since tags can only be created from Settings or the header
 * search panel.
 */
export function TagPickerVault({ open, onOpenChange, noteIds }: TagPickerVaultProps) {
  const tags = useNotesStore((s) => s.tags);
  const notes = useNotesStore((s) => s.notes);
  const addTagToNote = useNotesStore((s) => s.addTagToNote);
  const removeTagFromNote = useNotesStore((s) => s.removeTagFromNote);
  const bulkAssignTags = useNotesStore((s) => s.bulkAssignTags);

  const isBulk = noteIds.length > 1;
  const [staged, setStaged] = useState<string[]>([]);

  // Reset the staged selection each time the vault (re-)opens for a bulk pick —
  // done during render (React's documented pattern for resetting state on a
  // prop change) rather than an effect, so it can't tear across a re-render.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && isBulk) setStaged([]);
  }

  const singleNote = !isBulk ? notes.find((n) => n.id === noteIds[0]) : undefined;

  function isChecked(tagId: string) {
    return isBulk ? staged.includes(tagId) : (singleNote?.tagIds.includes(tagId) ?? false);
  }

  function toggle(tagId: string) {
    if (isBulk) {
      setStaged((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));
      return;
    }
    const noteId = noteIds[0];
    if (!noteId) return;
    if (singleNote?.tagIds.includes(tagId)) removeTagFromNote(noteId, tagId);
    else addTagToNote(noteId, tagId);
  }

  function apply() {
    if (staged.length > 0) bulkAssignTags(noteIds, staged);
    onOpenChange(false);
  }

  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label="Gerenciar tags">
        <VaultHeader showCloseButton={false}>
          <VaultTitle>{isBulk ? `Aplicar tags a ${noteIds.length} itens` : "Gerenciar tags"}</VaultTitle>
          <VaultDescription>
            {isBulk
              ? "As tags escolhidas são adicionadas a todos os itens selecionados — nenhuma tag existente é removida."
              : "Toque em uma tag para adicionar ou remover."}
          </VaultDescription>
        </VaultHeader>
        <VaultBody>
          {tags.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              Nenhuma tag criada ainda. Crie uma pelo campo de busca ou em Configurações.
            </p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto no-scrollbar">
              {tags.map((tag) => (
                <li key={tag.id}>
                  <button
                    type="button"
                    onClick={() => toggle(tag.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-secondary"
                  >
                    <Checkbox checked={isChecked(tag.id)} className="pointer-events-none" tabIndex={-1} readOnly />
                    <TagDot color={tag.color} />
                    <span className="truncate text-[13.5px] text-foreground">{tag.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {isBulk && (
            <div className="flex gap-2 pt-1">
              <div className="flex-1">
                <Button variant="outline" fullWidth onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
              </div>
              <div className="flex-1">
                <Button fullWidth disabled={staged.length === 0} onClick={apply}>
                  Aplicar
                </Button>
              </div>
            </div>
          )}
        </VaultBody>
      </VaultContent>
    </Vault>
  );
}
