"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmVault } from "@/components/ui/confirm-vault";
import { notify } from "@/components/ui/toaster";
import { JWLIBRARY_HIGHLIGHT_COLORS } from "@/lib/jwlibrary/constants";
import {
  deleteJwlibraryNote,
  deleteJwlibraryHighlight,
  updateJwlibraryHighlightColor,
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
  /** The backing UserMark's id — when `note` is null and this is set, the panel shows the note-less highlight controls (recolor / add note / delete) instead of "Nota não encontrada.". */
  highlightId?: string | null;
  /** The highlight's current color, for the note-less controls below. */
  colorIndex?: number | null;
  /** The highlighted span's own plain text — shown in place of a note when there isn't one, so the user can still see what they highlighted. */
  highlightText?: string;
  /** Opens the full editor vault to attach a new note to this highlight (see jwpub-reader.tsx/bible-reader.tsx's `existingUserMarkId` wiring). Only relevant when `note` is null. */
  onAddNote?: () => void;
  /** Called after the highlight's color was changed (with the new index), so the caller can refresh its highlight list and keep this panel's own color state in sync. */
  onColorChanged?: (colorIndex: number) => void;
}

/**
 * Opened by clicking a highlight's margin marker (note attached) or the
 * highlight itself (no note) in the reader — same side-panel/Vault shell as
 * footnotes and Bible references. With a note: read-only preview, edit hands
 * off to the full JwlibraryNoteEditorVault, delete confirms inline. Without
 * one: recolor / add a note / delete the bare highlight — all through this
 * app's no-modal-dialogs rule (ConfirmVault for the destructive step).
 */
export function JwlibraryHighlightNotePanel({
  open,
  note,
  onClose,
  onEdit,
  onDeleted,
  highlightId = null,
  colorIndex,
  highlightText,
  onAddNote,
  onColorChanged,
}: JwlibraryHighlightNotePanelProps) {
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
    setConfirmDeleteOpen(false);
    if (note) {
      await deleteJwlibraryNote(note.id);
    } else if (highlightId) {
      await deleteJwlibraryHighlight(highlightId);
    } else {
      return;
    }
    onDeleted();
  }

  // Optimistic: tells the caller right away (so it can recolor the live
  // highlighted text and this panel's own swatch border instantly) instead
  // of waiting on the round trip — the update itself still happens, just in
  // the background. A rare failure just leaves the DB one step behind the
  // screen until the next natural refetch; not worth a rollback for a
  // low-stakes cosmetic action.
  function handleColorChange(index: number) {
    if (!highlightId) return;
    onColorChanged?.(index);
    void updateJwlibraryHighlightColor(highlightId, index).then((result) => {
      if (result.error) notify.error("Não foi possível trocar a cor", result.error);
    });
  }

  return (
    <>
      <JwpubSidePanel open={open} title={note ? "Nota" : "Destaque"} onClose={onClose}>
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
        ) : highlightId ? (
          <div className="flex flex-col gap-4">
            {highlightText && (
              <blockquote className="rounded-xl border-l-2 border-accent/50 bg-secondary/50 px-3 py-2 text-[13px] italic leading-relaxed text-muted-foreground">
                “{highlightText}”
              </blockquote>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11.5px] text-muted-foreground">Cor do destaque</span>
              <div className="flex items-center gap-1.5">
                {Object.entries(JWLIBRARY_HIGHLIGHT_COLORS).map(([index, color]) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleColorChange(Number(index))}
                    aria-label={color.name}
                    title={color.name}
                    className="size-7 shrink-0 rounded-full border-2 transition-transform hover:scale-110 active:scale-95"
                    style={{
                      backgroundColor: color.hex,
                      borderColor: colorIndex === Number(index) ? "var(--foreground)" : "transparent",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={onAddNote}
                className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] text-accent transition-colors hover:bg-accent/10 self-start"
              >
                <Plus className="size-3.5" />
                Adicionar nota
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] text-destructive transition-colors hover:bg-destructive/10 self-start"
              >
                <Trash2 className="size-3.5" />
                Excluir destaque
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">Nota não encontrada.</p>
        )}
      </JwpubSidePanel>

      <ConfirmVault
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={note ? "Excluir nota?" : "Excluir destaque?"}
        description={
          note
            ? "O destaque associado deixa de mostrar essa nota. Essa ação não pode ser desfeita."
            : "Essa ação não pode ser desfeita."
        }
        confirmLabel="Excluir"
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
