"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import {
  createJwlibraryTag,
  renameJwlibraryTag,
  deleteJwlibraryTag,
  type JwlibraryTagView,
} from "@/app/(app)/jwlibrary-actions";

interface JwlibraryTagManagerListProps {
  tags: JwlibraryTagView[];
  /** Called after any create/rename/delete so the caller can re-fetch its tag list. */
  onRefresh: () => void;
}

/**
 * The actual create/rename/delete CRUD body — extracted out of
 * jwlibrary-tag-manager-vault.tsx so the same list can also render on a full
 * page (app/(app)/jwlibrary/tags/page.tsx) without a Vault wrapper. Purely
 * presentational: fetching/refreshing the tag list is the caller's job.
 *
 * The imported "Favorito" tag (tag_type = 0) is shown read-only —
 * renameJwlibraryTag/deleteJwlibraryTag both guard on tag_type = 1
 * server-side too.
 */
export function JwlibraryTagManagerList({ tags, onRefresh }: JwlibraryTagManagerListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function startEdit(tag: JwlibraryTagView) {
    setEditingId(tag.id);
    setEditName(tag.name ?? "");
  }

  async function saveEdit() {
    const trimmed = editName.trim();
    if (!trimmed || !editingId) return;
    await renameJwlibraryTag(editingId, trimmed);
    setEditingId(null);
    onRefresh();
  }

  async function submitCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await createJwlibraryTag(trimmed);
    setNewName("");
    setCreating(false);
    onRefresh();
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    await deleteJwlibraryTag(confirmDeleteId);
    setConfirmDeleteId(null);
    onRefresh();
  }

  const deletingTag = tags.find((t) => t.id === confirmDeleteId);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {tags.length === 0 && !creating && (
          <p className="py-2 text-[13px] text-muted-foreground">Nenhuma tag criada ainda.</p>
        )}

        {tags.map((tag) =>
          editingId === tag.id ? (
            <div key={tag.id} className="flex items-center gap-2 rounded-2xl border border-border/50 bg-secondary/50 p-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveEdit();
                  }
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="h-9 flex-1"
                autoFocus
              />
              <Button variant="ghost" size="icon" aria-label="Salvar" onClick={() => void saveEdit()} disabled={!editName.trim()}>
                <Check className="size-4 text-success" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Cancelar" onClick={() => setEditingId(null)}>
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <div key={tag.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-secondary/50">
              {tag.tagType === 0 && <Star className="size-3.5 shrink-0 fill-current text-accent" />}
              <span className="flex-1 truncate text-[13.5px] text-foreground">{tag.name || "Sem nome"}</span>
              {tag.tagType === 1 && (
                <>
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
                </>
              )}
            </div>
          )
        )}

        {creating ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-secondary/50 p-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitCreate();
                }
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="Nome da tag"
              className="h-9 flex-1"
              autoFocus
            />
            <Button variant="ghost" size="icon" aria-label="Criar tag" onClick={() => void submitCreate()} disabled={!newName.trim()}>
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
        onOpenChange={(next) => {
          if (!next) setConfirmDeleteId(null);
        }}
        title="Excluir tag?"
        description={
          deletingTag
            ? `"${deletingTag.name}" será removida de todas as notas que a usam. Essa ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Excluir"
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
