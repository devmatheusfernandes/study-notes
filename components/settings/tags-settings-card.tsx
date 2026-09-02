"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { TagDot } from "@/components/content/tag-pill";
import { TagSwatchPicker } from "@/components/content/tag-swatch-picker";
import { DEFAULT_TAG_COLOR } from "@/lib/tag-colors";
import { useNotesStore } from "@/lib/store/notes-store";

/**
 * The one place (besides the header search panel) tags can be created, and
 * the only place they can be renamed/recolored/deleted — per CLAUDE.md's
 * no-modal-dialogs rule, deletion confirms through `ConfirmVault`.
 */
export function TagsSettingsCard() {
  const tags = useNotesStore((s) => s.tags);
  const createTag = useNotesStore((s) => s.createTag);
  const updateTag = useNotesStore((s) => s.updateTag);
  const deleteTag = useNotesStore((s) => s.deleteTag);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_TAG_COLOR);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_TAG_COLOR);

  function startEdit(tag: { id: string; name: string; color: string }) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  }

  function saveEdit() {
    const trimmed = editName.trim();
    if (!trimmed || !editingId) return;
    updateTag(editingId, { name: trimmed, color: editColor });
    setEditingId(null);
  }

  function submitCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createTag(trimmed, newColor);
    setNewName("");
    setNewColor(DEFAULT_TAG_COLOR);
    setCreating(false);
  }

  const deletingTag = tags.find((t) => t.id === confirmDeleteId);

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <TagIcon className="size-5" />
        </span>
        <div className="flex flex-col">
          <h3 className="font-heading text-base text-foreground">Tags</h3>
          <p className="text-xs text-muted-foreground">Organize notas e arquivos com etiquetas coloridas</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {tags.length === 0 && !creating && (
          <p className="py-2 text-[13px] text-muted-foreground">Nenhuma tag criada ainda.</p>
        )}

        {tags.map((tag) =>
          editingId === tag.id ? (
            <div key={tag.id} className="flex flex-col gap-2.5 rounded-2xl border border-border/50 bg-secondary/50 p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveEdit();
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-9 flex-1"
                  autoFocus
                />
                <Button variant="ghost" size="icon" aria-label="Salvar" onClick={saveEdit} disabled={!editName.trim()}>
                  <Check className="size-4 text-success" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Cancelar" onClick={() => setEditingId(null)}>
                  <X className="size-4" />
                </Button>
              </div>
              <TagSwatchPicker value={editColor} onChange={setEditColor} />
            </div>
          ) : (
            <div
              key={tag.id}
              className="group flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-secondary/50"
            >
              <TagDot color={tag.color} className="size-2.5" />
              <span className="flex-1 truncate text-[13.5px] text-foreground">{tag.name}</span>
              <Button variant="ghost" size="icon" aria-label={`Editar ${tag.name}`} onClick={() => startEdit(tag)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Excluir ${tag.name}`}
                onClick={() => setConfirmDeleteId(tag.id)}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          )
        )}

        {creating ? (
          <div className="flex flex-col gap-2.5 rounded-2xl border border-border/50 bg-secondary/50 p-3">
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCreate();
                  }
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Nome da tag"
                className="h-9 flex-1"
                autoFocus
              />
              <Button variant="ghost" size="icon" aria-label="Criar tag" onClick={submitCreate} disabled={!newName.trim()}>
                <Check className="size-4 text-success" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Cancelar"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
            <TagSwatchPicker value={newColor} onChange={setNewColor} />
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Plus className="size-3.5" />}
            onClick={() => setCreating(true)}
            className="mt-1 w-fit rounded-full text-[12.5px]"
          >
            Nova tag
          </Button>
        )}
      </div>

      <ConfirmVault
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        title="Excluir tag?"
        description={
          deletingTag
            ? `"${deletingTag.name}" será removida de todas as notas e arquivos que a usam. Essa ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Excluir"
        onConfirm={() => {
          if (confirmDeleteId) deleteTag(confirmDeleteId);
        }}
      />
    </section>
  );
}
