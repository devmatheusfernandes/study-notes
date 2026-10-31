import { notify } from "@/components/ui/toaster";
import type { CreateJwlibraryHighlightInput, CreateJwlibraryNoteInput } from "@/app/(app)/jwlibrary-actions";
import {
  localAddHighlight,
  localDeleteHighlight,
  localDeleteNote,
  localSaveAnswer,
  localSetHighlightColor,
  localSetNote,
  localUpdateNote,
} from "./jwpub-offline";
import { useJwOutbox } from "./jwlibrary-outbox";

/**
 * The write path for highlights, notes and answers. Each call updates the
 * downloaded copy (if there is one) right away and queues the server write in
 * the outbox, which sends it now or when the connection returns.
 *
 * Nothing here awaits the server, so callers update their own state
 * optimistically; a write the server later rejects raises a toast and a
 * `JW_MARKS_CHANGED_EVENT` so the reader can reload what is really saved.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** False for the Bible reader's temporary `optimistic:` ids, which the server can't act on yet. */
function isQueueableId(id: string): boolean {
  if (UUID_RE.test(id)) return true;
  notify.error("Destaque ainda sendo criado", "Tente de novo em instantes.");
  return false;
}

/** Paragraph-level marks on a publication are the only ones mirrored locally (the Bible isn't downloadable). */
function publicationTarget(input: { blockType: number; blockIdentifier: number | null; location: CreateJwlibraryNoteInput["location"] }) {
  const { blockType, blockIdentifier, location } = input;
  if (blockType !== 1 || blockIdentifier === null || !location.keySymbol || location.mepsDocumentId === null) return null;
  return {
    symbol: location.keySymbol,
    mepsLanguage: location.mepsLanguage,
    issueTagNumber: location.issueTagNumber,
    mepsDocumentId: location.mepsDocumentId,
    pid: String(blockIdentifier),
  };
}

/** Returns the new highlight's id — known immediately, since the client chooses it. */
export function queueCreateHighlight(input: Omit<CreateJwlibraryHighlightInput, "id">): string {
  const id = crypto.randomUUID();
  const target = publicationTarget(input);
  if (target) {
    void localAddHighlight(target, {
      id,
      pid: target.pid,
      colorIndex: input.colorIndex,
      startToken: input.startToken,
      endToken: input.endToken,
      note: null,
      mepsDocumentId: target.mepsDocumentId,
    });
  }
  useJwOutbox.getState().submit({ kind: "createHighlight", entityId: id, input: { ...input, id } });
  return id;
}

export function queueSetHighlightColor(id: string, colorIndex: number) {
  if (!isQueueableId(id)) return;
  void localSetHighlightColor(id, colorIndex);
  useJwOutbox.getState().submit({ kind: "setHighlightColor", entityId: id, colorIndex });
}

export function queueDeleteHighlight(id: string) {
  if (!isQueueableId(id)) return;
  void localDeleteHighlight(id);
  useJwOutbox.getState().submit({ kind: "deleteHighlight", entityId: id });
}

/** Returns the note's id and, when it creates a highlight alongside, that highlight's id. */
export function queueCreateNote(input: Omit<CreateJwlibraryNoteInput, "id" | "userMarkId">): { noteId: string; userMarkId?: string } {
  const noteId = crypto.randomUUID();
  const userMarkId = !input.attachToUserMarkId && input.highlight ? crypto.randomUUID() : undefined;
  const note = { id: noteId, title: input.title, content: input.content };

  const target = publicationTarget(input);
  if (target) {
    if (input.attachToUserMarkId) {
      void localSetNote(input.attachToUserMarkId, note);
    } else {
      void localAddHighlight(target, {
        id: userMarkId ?? `note:${noteId}`,
        pid: target.pid,
        colorIndex: input.highlight?.colorIndex ?? null,
        startToken: input.highlight?.startToken ?? null,
        endToken: input.highlight?.endToken ?? null,
        note,
        mepsDocumentId: target.mepsDocumentId,
      });
    }
  }

  useJwOutbox.getState().submit({ kind: "createNote", entityId: noteId, input: { ...input, id: noteId, userMarkId } });
  return { noteId, userMarkId };
}

export function queueUpdateNote(id: string, patch: { title?: string; content?: string }) {
  void localUpdateNote(id, patch);
  useJwOutbox.getState().submit({ kind: "updateNote", entityId: id, patch });
}

export function queueDeleteNote(id: string) {
  void localDeleteNote(id);
  useJwOutbox.getState().submit({ kind: "deleteNote", entityId: id });
}

export function queueSaveAnswer(publicationId: string, documentId: number, pid: string, answer: string) {
  void localSaveAnswer(publicationId, documentId, pid, answer);
  useJwOutbox.getState().submit({
    kind: "saveAnswer",
    entityId: `${publicationId}:${documentId}:${pid}`,
    publicationId,
    documentId,
    pid,
    answer,
  });
}
