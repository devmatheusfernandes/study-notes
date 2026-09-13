"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseNotePreview } from "@/lib/note-preview";
import type { Note } from "@/lib/store/notes-store";
import { JwpubSidePanel } from "./jwpub-side-panel";

interface NoteLinkSurfaceProps {
  open: boolean;
  /** `null` when the note was deleted (or hasn't synced to this device) after the reference was made. */
  note: Note | null;
  /** The title baked into the chip itself — shown as the panel title even before/instead of `note` resolving, since a note reference never re-fetches a fresh title from a server. */
  fallbackTitle: string;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Same side-panel-on-desktop/Vault-on-mobile shell as the other "@" reference
 * surfaces — opened by clicking a note-to-note reference chip. Reuses
 * parseNotePreview (the same excerpt logic note cards on /notes already use)
 * rather than rendering the full body, since the point is a quick peek before
 * deciding to jump over.
 */
export function NoteLinkSurface({ open, note, fallbackTitle, onOpen, onClose }: NoteLinkSurfaceProps) {
  const preview = note ? parseNotePreview(note.body) : null;

  return (
    <JwpubSidePanel open={open} title={note?.title || fallbackTitle || "Nota"} onClose={onClose}>
      {!note ? (
        <p className="text-[13.5px] text-muted-foreground">
          Essa nota não foi encontrada — pode ter sido excluída.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Button variant="outline" size="sm" leftIcon={<ExternalLink />} onClick={onOpen}>
            Abrir nota
          </Button>
          {preview?.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a preview thumbnail, same treatment note-card.tsx already gives it
            <img src={preview.imageUrl} alt="" className="max-w-full rounded-xl" />
          )}
          {preview?.checklist ? (
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              {preview.checklist.map((item, index) => (
                <li
                  key={index}
                  className={item.checked ? "text-muted-foreground line-through" : "text-foreground/90"}
                >
                  {item.text}
                </li>
              ))}
              {preview.checklistRemaining ? (
                <li className="text-muted-foreground">+{preview.checklistRemaining} mais</li>
              ) : null}
            </ul>
          ) : preview?.html ? (
            <div
              className="text-[13.5px] leading-relaxed text-foreground/90"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          ) : (
            <p className="text-[13.5px] text-muted-foreground">Nota vazia.</p>
          )}
        </div>
      )}
    </JwpubSidePanel>
  );
}
