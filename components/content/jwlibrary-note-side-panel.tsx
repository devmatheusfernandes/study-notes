"use client";

import { useState } from "react";
import DOMPurify from "dompurify";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { deleteJwlibraryNote, type JwlibraryNoteView, type JwlibraryTagView } from "@/app/(app)/jwlibrary-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";
import { JwlibraryTagChip } from "./jwlibrary-tag-chip";

interface JwlibraryNoteSidePanelProps {
  open: boolean;
  note: JwlibraryNoteView | null;
  tags: JwlibraryTagView[];
  /** Whether the note resolves to a real publication chapter or Bible chapter — gates the "Ir até o conteúdo" button. */
  openable: boolean;
  onClose: () => void;
  onEdit: () => void;
  onGoToContent: () => void;
  onDeleted: () => void;
}

/**
 * Opened by clicking a note card on /jwlibrary — shows its tags/content
 * read-only plus edit/delete/go-to-content actions, instead of jumping
 * straight into the publication/Bible chapter (or the edit vault) on a
 * plain click. Same JwpubSidePanel shell as everywhere else in this app.
 */
export function JwlibraryNoteSidePanel({
  open,
  note,
  tags,
  openable,
  onClose,
  onEdit,
  onGoToContent,
  onDeleted,
}: JwlibraryNoteSidePanelProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const noteTags = note ? tags.filter((t) => note.tagIds.includes(t.id)) : [];

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

            {noteTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {noteTags.map((tag) => (
                  <JwlibraryTagChip key={tag.id} tag={tag} active />
                ))}
              </div>
            )}

            {note.bibleText && (
              <p className="italic leading-relaxed text-muted-foreground text-[13.5px]">“{note.bibleText}”</p>
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

            {openable && (
              <Button variant="outline" fullWidth rightIcon={<ArrowRight />} onClick={onGoToContent}>
                Ir até o conteúdo
              </Button>
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
        description="Essa ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
