"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { Pencil, Trash2 } from "lucide-react";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import {
  deleteJwlibraryNote,
  listOwnJwlibraryTags,
  getJwlibraryNoteTagIds,
  type JwlibraryTagView,
} from "@/app/(app)/jwlibrary-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { JwlibraryTagChip } from "./jwlibrary-tag-chip";
import type { EditableJwlibraryNote } from "./jwlibrary-note-editor-vault";

interface JwlibraryHighlightNotePanelProps {
  open: boolean;
  note: EditableJwlibraryNote | null;
  onClose: () => void;
  /** Promotes to the full editor vault (see jwpub-reader.tsx's highlightEditMode). */
  onEdit: () => void;
  /** Called after the note is actually deleted, so the caller can drop its highlight/marker and refresh. */
  onDeleted: () => void;
}

/**
 * Read-only preview opened by clicking a highlight's margin marker in the
 * reader (see the `data-jwlibrary-note-id` wiring in jwpub-chapter-view.tsx)
 * — same side-panel/Vault shell as footnotes and Bible references. Edit
 * hands off to the full JwlibraryNoteEditorVault; delete confirms inline
 * through its own ConfirmVault, per the app's no-modal-dialogs rule.
 */
export function JwlibraryHighlightNotePanel({ open, note, onClose, onEdit, onDeleted }: JwlibraryHighlightNotePanelProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [tags, setTags] = useState<JwlibraryTagView[]>([]);

  // Same fetch-on-open shape as jwlibrary-note-editor-vault.tsx's own Tags
  // section — this panel is read-only, so it just needs the note's current
  // tags to display, not the full picker/editor machinery.
  useEffect(() => {
    if (!open || !note) {
      queueMicrotask(() => setTags([]));
      return;
    }
    let cancelled = false;
    void Promise.all([listOwnJwlibraryTags(), getJwlibraryNoteTagIds(note.id)]).then(([allTags, noteTags]) => {
      if (cancelled) return;
      const tagIds = new Set(noteTags.tagIds ?? []);
      setTags((allTags.tags ?? []).filter((t) => tagIds.has(t.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, note]);

  async function handleDelete() {
    if (!note) return;
    await deleteJwlibraryNote(note.id);
    setConfirmDeleteOpen(false);
    onDeleted();
  }

  return (
    <>
      <JwpubSidePanel open={open} title="Nota" onClose={onClose}>
        {note ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-1.5 self-end">
              <button
                type="button"
                onClick={onEdit}
                aria-label="Editar nota"
                className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="size-3.5" />
                Editar
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                aria-label="Excluir nota"
                className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12px] text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
                Excluir
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <JwlibraryTagChip key={tag.id} tag={tag} active />
                ))}
              </div>
            )}
            {note.title && <span className="font-heading text-[15px]">{note.title}</span>}
            {note.content && (
              <div
                className="text-[13.5px] leading-relaxed text-foreground/90 [&_p]:my-2"
                // note.content is either plain text (imported) or Tiptap HTML
                // (created here) — sanitized the same way any other untrusted
                // HTML in this app is before rendering.
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(note.content, { USE_PROFILES: { html: true } }),
                }}
              />
            )}
          </div>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">Nota não encontrada.</p>
        )}
      </JwpubSidePanel>

      <ConfirmVault
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Excluir nota?"
        description="O destaque associado deixa de mostrar essa nota. Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
