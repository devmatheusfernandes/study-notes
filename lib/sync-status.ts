import type { Folder, Note, PendingOp, Tag } from "@/lib/store/notes-store";
import type { JwOp } from "@/lib/offline/jwlibrary-outbox";
import { formatBytes } from "@/lib/format-bytes";

export interface PendingItem {
  /** Stable key for the list and for discarding: the notes-store op key, or the outbox op id. */
  id: string;
  source: "notes" | "publications";
  label: string;
  /** What it is about — the note/folder/tag name, when it can still be found. */
  subject?: string;
  attempts: number;
  /** Raw reason the last attempt threw, if any. */
  error?: string;
}

function clip(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const STATUS_LABEL = { active: "Restaurar nota", archived: "Arquivar nota", trashed: "Mover nota para a lixeira" } as const;

/** A queued change to a note, folder or tag, in words a person can read. */
export function describeNotesOp(op: PendingOp, notes: Note[], folders: Folder[], tags: Tag[]): PendingItem {
  const noteTitle = (id: string) => {
    const title = notes.find((n) => n.id === id)?.title;
    return title ? clip(title) : undefined;
  };
  const folderName = (id: string) => folders.find((f) => f.id === id)?.name;
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name;

  let label: string;
  let subject: string | undefined;

  switch (op.kind) {
    case "createNote":
      label = "Criar nota";
      subject = clip(op.payload.title || "Nova nota");
      break;
    case "updateNote":
      label = "Salvar edição da nota";
      subject = noteTitle(op.entityId);
      break;
    case "saveDrawing":
      label = "Salvar escrita à mão";
      // Size and whether the note is still here: the two things that help tell why a save keeps failing.
      subject = `${noteTitle(op.entityId) ?? "nota que não está mais neste aparelho"} · ${formatBytes(op.payload.strokes.length)}`;
      break;
    case "setNotePinned":
      label = op.payload.pinned ? "Fixar nota" : "Desafixar nota";
      subject = noteTitle(op.entityId);
      break;
    case "setNoteLocked":
      label = op.payload.locked ? "Bloquear nota" : "Desbloquear nota";
      subject = noteTitle(op.entityId);
      break;
    case "setNoteStatus":
      label = STATUS_LABEL[op.payload.status] ?? "Mudar situação da nota";
      subject = noteTitle(op.entityId);
      break;
    case "setNoteFolder":
      label = "Mover nota de pasta";
      subject = noteTitle(op.entityId);
      break;
    case "deleteNote":
      label = "Excluir nota definitivamente";
      break;
    case "createFolder":
      label = "Criar pasta";
      subject = op.payload.name;
      break;
    case "renameFolder":
      label = "Renomear pasta";
      subject = op.payload.name;
      break;
    case "setFolderParent":
      label = "Mover pasta";
      subject = folderName(op.entityId);
      break;
    case "setFolderLocked":
      label = op.payload.locked ? "Bloquear pasta" : "Desbloquear pasta";
      subject = folderName(op.entityId);
      break;
    case "deleteFolder":
      label = "Excluir pasta";
      break;
    case "createTag":
      label = "Criar tag";
      subject = op.payload.name;
      break;
    case "updateTag":
      label = "Editar tag";
      subject = tagName(op.entityId);
      break;
    case "deleteTag":
      label = "Excluir tag";
      break;
    case "addTagToNote":
      label = "Aplicar tag à nota";
      subject = noteTitle(op.payload.noteId);
      break;
    case "removeTagFromNote":
      label = "Tirar tag da nota";
      subject = noteTitle(op.payload.noteId);
      break;
  }

  return { id: op.key, source: "notes", label, subject, attempts: op.attempts ?? 0, error: op.lastError };
}

/** A queued highlight, note or answer on a publication. */
export function describeJwOp(op: JwOp): PendingItem {
  let label: string;
  switch (op.kind) {
    case "createHighlight":
      label = "Criar destaque";
      break;
    case "setHighlightColor":
      label = "Trocar cor de destaque";
      break;
    case "deleteHighlight":
      label = "Excluir destaque";
      break;
    case "createNote":
      label = "Criar nota em publicação";
      break;
    case "updateNote":
      label = "Salvar nota em publicação";
      break;
    case "deleteNote":
      label = "Excluir nota em publicação";
      break;
    case "saveAnswer":
      label = "Salvar resposta em publicação";
      break;
  }
  const subject = op.kind === "createNote" ? clip(op.input.title || "") || undefined : undefined;
  return { id: op.opId, source: "publications", label, subject, attempts: op.attempts ?? 0, error: op.lastError };
}

/** Turns the raw exception into something that says whether the problem is the connection or something else. */
export function explainSyncError(error: string | undefined, online: boolean): string | undefined {
  if (!error) return online ? undefined : "Sem conexão.";
  if (/failed to fetch|networkerror|load failed|network request failed|err_internet|offline/i.test(error)) {
    return online ? "Não conseguiu falar com o servidor." : "Sem conexão.";
  }
  return error;
}
