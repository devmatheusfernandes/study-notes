"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Vault, VaultBody, VaultContent, VaultHeader, VaultTitle, VaultDescription } from "@/components/ui/vault";
import {
  listOwnJwlibraryTags,
  getJwlibraryNoteTagIds,
  addTagToJwlibraryNote,
  removeTagFromJwlibraryNote,
  createJwlibraryTag,
  type JwlibraryTagView,
} from "@/app/(app)/jwlibrary-actions";
import { JwlibraryTagChip } from "./jwlibrary-tag-chip";

interface JwlibraryTagPickerVaultProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One id: toggles apply immediately. More than one: staged behind an "Aplicar" button, additive-only — mirrors tag-picker-vault.tsx's contract for regular notes. */
  noteIds: string[];
}

/**
 * Attach/detach jwlibrary tags on one or more notes — used from /jwlibrary's
 * bulk bar and per-note tag button, and reused as-is from the reader's note
 * editor vault. Tags scroll horizontally next to a search box (rather than a
 * vertical checkbox list) since a real account can carry dozens of tags —
 * typing narrows the row, and creating a brand-new tag is just one more tap
 * away when nothing matches.
 */
export function JwlibraryTagPickerVault({ open, onOpenChange, noteIds }: JwlibraryTagPickerVaultProps) {
  const isBulk = noteIds.length > 1;
  const [tags, setTags] = useState<JwlibraryTagView[]>([]);
  const [noteTagIds, setNoteTagIds] = useState<string[]>([]);
  const [staged, setStaged] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  async function refreshTags() {
    const result = await listOwnJwlibraryTags();
    setTags(result.tags ?? []);
  }

  // Reset on each (re-)open, same render-time wasOpen guard pattern as tag-picker-vault.tsx.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      void refreshTags();
      setStaged([]);
      setQuery("");
      if (!isBulk && noteIds[0]) {
        void getJwlibraryNoteTagIds(noteIds[0]).then((result) => setNoteTagIds(result.tagIds ?? []));
      } else {
        setNoteTagIds([]);
      }
    }
  }

  const filteredTags = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tags;
    return tags.filter((t) => (t.name ?? "").toLowerCase().includes(q));
  }, [tags, query]);

  function isChecked(tagId: string) {
    return isBulk ? staged.includes(tagId) : noteTagIds.includes(tagId);
  }

  async function toggle(tagId: string) {
    if (isBulk) {
      setStaged((prev) => (prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]));
      return;
    }
    const noteId = noteIds[0];
    if (!noteId) return;
    if (noteTagIds.includes(tagId)) {
      setNoteTagIds((prev) => prev.filter((t) => t !== tagId));
      await removeTagFromJwlibraryNote(noteId, tagId);
    } else {
      setNoteTagIds((prev) => [...prev, tagId]);
      await addTagToJwlibraryNote(noteId, tagId);
    }
  }

  async function handleCreateAndAssign() {
    const name = query.trim();
    if (!name) return;
    const result = await createJwlibraryTag(name);
    if (!result.id) return;
    const tagId = result.id;
    setQuery("");
    await refreshTags();
    if (isBulk) {
      setStaged((prev) => [...prev, tagId]);
    } else {
      const noteId = noteIds[0];
      if (noteId) {
        setNoteTagIds((prev) => [...prev, tagId]);
        await addTagToJwlibraryNote(noteId, tagId);
      }
    }
  }

  async function apply() {
    if (staged.length > 0) {
      await Promise.all(
        noteIds.flatMap((noteId) => staged.map((tagId) => addTagToJwlibraryNote(noteId, tagId)))
      );
    }
    onOpenChange(false);
  }

  return (
    <Vault open={open} onOpenChange={onOpenChange}>
      <VaultContent aria-label="Tags">
        <VaultHeader showCloseButton={false}>
          <VaultTitle>{isBulk ? `Aplicar tags a ${noteIds.length} notas` : "Tags"}</VaultTitle>
          <VaultDescription>
            {isBulk
              ? "As tags escolhidas são adicionadas a todas as notas selecionadas — nenhuma tag existente é removida."
              : "Toque em uma tag para adicionar ou remover."}
          </VaultDescription>
        </VaultHeader>
        <VaultBody>
          <div className="flex items-center gap-2">
            <div className="relative w-28 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar"
                className="h-8 pl-8 pr-2 text-[12px]"
              />
            </div>
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {filteredTags.map((tag) => (
                <span key={tag.id} className="shrink-0">
                  <JwlibraryTagChip tag={tag} active={isChecked(tag.id)} onClick={() => void toggle(tag.id)} />
                </span>
              ))}
              {query.trim() !== "" && filteredTags.length === 0 && (
                <button
                  type="button"
                  onClick={() => void handleCreateAndAssign()}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-accent/50 px-2.5 text-[12px] text-accent transition-colors hover:bg-accent/10"
                >
                  <Plus className="size-3" />
                  Criar &quot;{query.trim()}&quot;
                </button>
              )}
            </div>
          </div>

          {isBulk && (
            <div className="flex gap-2 pt-3">
              <div className="flex-1">
                <Button variant="outline" fullWidth onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
              </div>
              <div className="flex-1">
                <Button fullWidth disabled={staged.length === 0} onClick={() => void apply()}>
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
