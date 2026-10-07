"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DOMPurify from "dompurify";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotesStore } from "@/lib/store/notes-store";
import type { NoteScriptureMention } from "@/app/(app)/note-scripture-actions";
import { JwpubSidePanel } from "./jwpub-side-panel";

interface NoteMentionPanelProps {
  mention: NoteScriptureMention | null;
  onClose: () => void;
}

/**
 * One of the user's own notes, opened beside the Bible text it cites — a
 * sibling of the "Estudo" panel (so, like the footnote and excerpt panels, it
 * stacks in the shared desktop slot with a back button and is a Vault on
 * mobile, never a modal). Read-only on purpose: the reader is for reading,
 * and "Abrir nota" hands over to the real editor when the user wants to
 * change something.
 *
 * The body comes from the notes store, which is already hydrated with every
 * note, so there is nothing to fetch.
 */
export function NoteMentionPanel({ mention, onClose }: NoteMentionPanelProps) {
  const router = useRouter();
  const notes = useNotesStore((s) => s.notes);

  // Keeps the last note rendered while the panel animates closed — `mention`
  // is already null by then, which would blank the content mid-exit.
  const [shown, setShown] = useState(mention);
  if (mention && mention !== shown) setShown(mention);

  const note = useMemo(() => notes.find((n) => n.id === shown?.noteId), [notes, shown?.noteId]);
  const body = note?.body;
  const html = useMemo(() => (body ? DOMPurify.sanitize(body, { USE_PROFILES: { html: true } }) : ""), [body]);

  return (
    <JwpubSidePanel open={mention !== null} title="Nota" onClose={onClose} width={420}>
      {note ? (
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-lg leading-snug">{note.title || "Sem título"}</h2>
          {html ? (
            <div
              className="text-[14px] leading-relaxed text-foreground/90 [&_img]:max-w-full [&_img]:rounded-xl [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <p className="text-[13px] text-muted-foreground">Esta nota está vazia.</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            leftIcon={<ExternalLink />}
            onClick={() => router.push(`/notes/${note.id}`)}
          >
            Abrir nota
          </Button>
        </div>
      ) : (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          Esta nota não está mais disponível.
        </p>
      )}
    </JwpubSidePanel>
  );
}
