import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SyncStatus } from "@/components/content/sync-status";
import { typeFromFileName, formatFileSize, type NoteType } from "@/lib/file-types";
import { formatRelativeMeta } from "@/lib/format-date";
import { notify } from "@/components/ui/toaster";
import type { UploadedFile } from "@/app/(app)/files-actions";
import {
  createNoteRow,
  updateNoteRow,
  setNotePinned,
  setNoteStatus,
  bulkSetNoteStatus,
  deleteNotePermanently as deleteNoteRowPermanently,
  bulkDeleteNotesPermanently as bulkDeleteNoteRowsPermanently,
  createFolderRow,
  renameFolderRow,
  deleteFolderRow,
  deleteAllFoldersRows,
  createTagRow,
  updateTagRow,
  deleteTagRow,
  deleteAllTagsRows,
  addTagToNote as addTagToNoteRow,
  removeTagFromNote as removeTagFromNoteRow,
  assignTagsToNotes,
  type NoteRow,
  type FolderRow,
  type TagRow,
} from "@/app/(app)/notes-actions";
import { toggleChecklistItemInHtml } from "@/lib/note-preview";
import { removedNoteImagePaths } from "@/lib/note-images";
import { deleteNoteImages } from "@/app/(app)/note-images-actions";

export type { NoteType };
export type NoteStatus = "active" | "archived" | "trashed";

export interface Note {
  id: string;
  type: NoteType;
  title: string;
  body: string;
  meta: string;
  pinned: boolean;
  status: NoteStatus;
  syncStatus: SyncStatus;
  updatedAt: number;
  /** Folder this item lives in, if any. Notes and files share the same folders. */
  folderId?: string;
  /** Supabase Storage object path (`${userId}/...`) — only set for real uploaded files, never for text notes. */
  storagePath?: string;
  /** Status of OpenAI vector embedding for RAG search. */
  vectorStatus?: "completed" | "pending" | "processing" | "failed" | "none";
  /** Tag ids assigned to this note — the `note_tags` join table, denormalized client-side. */
  tagIds: string[];
  /** True while a just-picked/dropped file is uploading or (for .jwpub) still being ingested — not clickable to open yet, see hooks/use-file-upload.ts. */
  processing?: boolean;
  /** Stable React key across the optimistic→real id swap in resolveOptimisticFile — falls back to `id` when absent. */
  clientKey?: string;
}

export interface Folder {
  id: string;
  name: string;
  /** Parent folder, for folders nested inside other folders. Root folders omit this. */
  parentId?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    meta: formatRelativeMeta(row.updatedAt),
    pinned: row.pinned,
    status: row.status,
    syncStatus: "synced",
    updatedAt: row.updatedAt,
    folderId: row.folderId,
    storagePath: row.storagePath,
    vectorStatus: row.vectorStatus,
    tagIds: row.tagIds,
  };
}

function toFolder(row: FolderRow): Folder {
  return { id: row.id, name: row.name, parentId: row.parentId };
}

function toTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color };
}

/**
 * The offline outbox. Every mutation that touches the server goes through
 * `runOrQueue`, which attempts the Server Action right away and — only if the
 * `fetch()` itself throws (no network reachable the origin, not a server
 * rejection) — records it here instead of losing it. `key` is what makes an
 * op "the same slot": a second `updateNote` for the same note replaces the
 * first instead of stacking, so a burst of offline keystrokes queues once.
 */
type PendingOp =
  | { key: string; entityId: string; kind: "createNote"; payload: { id: string; title: string; body: string; folderId?: string } }
  | { key: string; entityId: string; kind: "updateNote"; payload: { id: string; patch: { title?: string; body?: string } } }
  | { key: string; entityId: string; kind: "setNotePinned"; payload: { id: string; pinned: boolean } }
  | { key: string; entityId: string; kind: "setNoteStatus"; payload: { id: string; status: NoteStatus } }
  | { key: string; entityId: string; kind: "deleteNote"; payload: { id: string } }
  | { key: string; entityId: string; kind: "createFolder"; payload: { id: string; name: string; parentId?: string } }
  | { key: string; entityId: string; kind: "renameFolder"; payload: { id: string; name: string } }
  | { key: string; entityId: string; kind: "deleteFolder"; payload: { id: string } }
  | { key: string; entityId: string; kind: "createTag"; payload: { id: string; name: string; color: string } }
  | { key: string; entityId: string; kind: "updateTag"; payload: { id: string; patch: { name?: string; color?: string } } }
  | { key: string; entityId: string; kind: "deleteTag"; payload: { id: string } }
  | { key: string; entityId: string; kind: "addTagToNote"; payload: { noteId: string; tagId: string } }
  | { key: string; entityId: string; kind: "removeTagFromNote"; payload: { noteId: string; tagId: string } };

interface NotesStore {
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
  /** False until `hydrate` runs — gate rendering on this, not on "has some component mounted". */
  hydrated: boolean;
  /** Mutations that failed to reach the server (offline) and are waiting for reconnection, keyed so retries coalesce. */
  pendingOps: Record<string, PendingOp>;
  /** Seeds the store from the server-fetched rows — see components/providers/store-hydration.tsx. */
  hydrate: (notes: NoteRow[], folders: FolderRow[], tags: TagRow[]) => void;
  /** Replays every queued op in order; stops at the first one that still can't reach the server. */
  syncPendingOps: () => Promise<void>;

  createFolder: (name: string, parentId?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  /** Settings "danger zone" — removes every folder and moves their notes to the root. */
  deleteAllFolders: () => void;
  /** Optimistic placeholder shown the instant a file is picked/dropped, before the upload request even resolves. Returns the temp id used to resolve/fail it later. */
  addOptimisticFile: (file: { name: string; size: number }, folderId?: string) => string;
  /** Replaces a temp placeholder with its real server row once uploaded. `stillProcessing` keeps it non-clickable a bit longer for types (like .jwpub) that need further server-side processing before they're readable. */
  resolveOptimisticFile: (tempId: string, file: UploadedFile, stillProcessing: boolean) => void;
  /** Drops a placeholder whose upload failed outright. */
  failOptimisticFile: (tempId: string) => void;
  /** Flips a note's processing flag once its post-upload work (e.g. jwpub ingest) finishes. */
  setNoteProcessing: (id: string, processing: boolean) => void;
  /** Local-only title swap (no server round trip — the caller already wrote it server-side, e.g. jwpub ingest resolving the publication's real title). */
  setNoteTitle: (id: string, title: string) => void;

  createTag: (name: string, color: string) => string;
  updateTag: (id: string, patch: { name?: string; color?: string }) => void;
  /** Also strips the tag from every note that had it, client-side (the DB cascade won't be reflected until the next hydrate). */
  deleteTag: (id: string) => void;
  /** Settings "danger zone" — removes every tag and strips it from every note that had one. */
  deleteAllTags: () => void;
  addTagToNote: (noteId: string, tagId: string) => void;
  removeTagFromNote: (noteId: string, tagId: string) => void;
  /** Additive-only: unions the given tags into each note's existing tagIds, never removes any. */
  bulkAssignTags: (noteIds: string[], tagIds: string[]) => void;

  togglePin: (id: string) => void;
  archive: (id: string) => void;
  trash: (id: string) => void;
  restore: (id: string) => void;
  /** Removes a note for good — only meaningful for items already in the trash. */
  deletePermanently: (id: string) => void;
  bulkArchive: (ids: string[]) => void;
  bulkRestore: (ids: string[]) => void;
  bulkTrash: (ids: string[]) => void;
  bulkDeletePermanently: (ids: string[]) => void;
  addNote: (note: { title: string; body: string; folderId?: string }) => string;
  upsertNoteFromDb: (note: { id: string; title: string; body: string; type?: NoteType }) => void;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "body">>) => void;
  /** Flips one checklist item's checked state directly from a card preview, by its index among all task items in the note. */
  toggleChecklistItem: (id: string, itemIndex: number) => void;
}

/** Runs a Server Action; a thrown error means the request never reached the origin (offline), so it's queued instead of surfaced as a failure. Returns which of the two happened. */
async function runOrQueue(
  set: SetFn,
  get: GetFn,
  op: PendingOp,
  action: () => Promise<{ error?: string }>
): Promise<"synced" | "queued" | "rejected"> {
  try {
    const res = await action();
    set((s) => {
      const next = { ...s.pendingOps };
      delete next[op.key];
      return { pendingOps: next };
    });
    if (res.error) return "rejected";
    return "synced";
  } catch {
    enqueueOp(set, op);
    return "queued";
  }
}

/** Applies coalescing rules: same-slot ops replace in place, and a delete queued behind an unsynced create cancels both out instead of round-tripping a doomed create-then-delete. */
function enqueueOp(set: SetFn, op: PendingOp) {
  set((s) => {
    const next = { ...s.pendingOps };
    if (op.kind === "deleteNote" || op.kind === "deleteFolder" || op.kind === "deleteTag") {
      const createKind = op.kind === "deleteNote" ? "createNote" : op.kind === "deleteFolder" ? "createFolder" : "createTag";
      const hadUnsyncedCreate = Object.values(next).some((p) => p.kind === createKind && p.entityId === op.entityId);
      for (const key of Object.keys(next)) {
        if (next[key].entityId === op.entityId) delete next[key];
      }
      if (hadUnsyncedCreate) return { pendingOps: next };
    }
    next[op.key] = op;
    return { pendingOps: next };
  });
}

function opAction(op: PendingOp): () => Promise<{ error?: string }> {
  switch (op.kind) {
    case "createNote":
      return () => createNoteRow(op.payload);
    case "updateNote":
      return () => updateNoteRow(op.payload.id, op.payload.patch);
    case "setNotePinned":
      return () => setNotePinned(op.payload.id, op.payload.pinned);
    case "setNoteStatus":
      return () => setNoteStatus(op.payload.id, op.payload.status);
    case "deleteNote":
      return () => deleteNoteRowPermanently(op.payload.id);
    case "createFolder":
      return () => createFolderRow(op.payload);
    case "renameFolder":
      return () => renameFolderRow(op.payload.id, op.payload.name);
    case "deleteFolder":
      return () => deleteFolderRow(op.payload.id);
    case "createTag":
      return () => createTagRow(op.payload);
    case "updateTag":
      return () => updateTagRow(op.payload.id, op.payload.patch);
    case "deleteTag":
      return () => deleteTagRow(op.payload.id);
    case "addTagToNote":
      return () => addTagToNoteRow(op.payload.noteId, op.payload.tagId);
    case "removeTagFromNote":
      return () => removeTagFromNoteRow(op.payload.noteId, op.payload.tagId);
  }
}

export const useNotesStore = create<NotesStore>()(
  persist(
    (set, get) => ({
      notes: [],
      folders: [],
      tags: [],
      hydrated: false,
      pendingOps: {},

      hydrate: (rows, folderRows, tagRows) =>
        set((s) => {
          const pendingByEntity = new Map(Object.values(s.pendingOps).map((op) => [op.entityId, op.kind]));
          const isDeletedLocally = (id: string) => {
            const kind = pendingByEntity.get(id);
            return kind === "deleteNote" || kind === "deleteFolder" || kind === "deleteTag";
          };
          const localNotes = new Map(s.notes.map((n) => [n.id, n]));
          const localFolders = new Map(s.folders.map((f) => [f.id, f]));
          const localTags = new Map(s.tags.map((t) => [t.id, t]));

          const serverIds = new Set(rows.map((r) => r.id));
          const serverFolderIds = new Set(folderRows.map((f) => f.id));
          const serverTagIds = new Set(tagRows.map((t) => t.id));

          const mergedNotes = rows
            .filter((row) => !isDeletedLocally(row.id))
            .map((row) => (pendingByEntity.has(row.id) && localNotes.has(row.id) ? localNotes.get(row.id)! : toNote(row)));
          const localOnlyNotes = s.notes.filter((n) => pendingByEntity.has(n.id) && !serverIds.has(n.id) && !isDeletedLocally(n.id));

          const mergedFolders = folderRows
            .filter((row) => !isDeletedLocally(row.id))
            .map((row) => (pendingByEntity.has(row.id) && localFolders.has(row.id) ? localFolders.get(row.id)! : toFolder(row)));
          const localOnlyFolders = s.folders.filter((f) => pendingByEntity.has(f.id) && !serverFolderIds.has(f.id) && !isDeletedLocally(f.id));

          const mergedTags = tagRows
            .filter((row) => !isDeletedLocally(row.id))
            .map((row) => (pendingByEntity.has(row.id) && localTags.has(row.id) ? localTags.get(row.id)! : toTag(row)));
          const localOnlyTags = s.tags.filter((t) => pendingByEntity.has(t.id) && !serverTagIds.has(t.id) && !isDeletedLocally(t.id));

          return {
            notes: [...localOnlyNotes, ...mergedNotes],
            folders: [...localOnlyFolders, ...mergedFolders],
            tags: [...localOnlyTags, ...mergedTags],
            hydrated: true,
          };
        }),

      syncPendingOps: async () => {
        // Snapshot + FIFO by insertion order; stop at the first op that's still
        // unreachable so ordering is preserved (e.g. a create before its update).
        const ops = Object.values(get().pendingOps);
        for (const op of ops) {
          if (!get().pendingOps[op.key]) continue; // already resolved by a later coalesced op
          const outcome = await runOrQueue(set, get, op, opAction(op));
          if (outcome === "queued") break; // still offline — stop and retry the whole batch next time
          if (outcome === "rejected") {
            set((s) => {
              const next = { ...s.pendingOps };
              delete next[op.key];
              return { pendingOps: next };
            });
            notify.error("Não foi possível sincronizar uma alteração");
          }
          if (op.kind === "createNote" || op.kind === "updateNote") {
            set((s) => ({ notes: s.notes.map((n) => (n.id === op.entityId ? { ...n, syncStatus: outcome === "synced" ? "synced" : n.syncStatus } : n)) }));
          }
        }
      },

      createFolder: (name, parentId) => {
        const id = crypto.randomUUID();
        set((s) => ({ folders: [...s.folders, { id, name, parentId }] }));

        const op: PendingOp = { key: `folder:${id}`, entityId: id, kind: "createFolder", payload: { id, name, parentId } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set((s) => ({ folders: s.folders.filter((f) => f.id !== id) }));
            notify.error("Não foi possível criar a pasta");
          }
        });

        return id;
      },

      renameFolder: (id, name) => {
        const previous = get().folders.find((f) => f.id === id)?.name;
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) }));

        const op: PendingOp = { key: `folder:${id}`, entityId: id, kind: "renameFolder", payload: { id, name } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected" && previous !== undefined) {
            set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name: previous } : f)) }));
            notify.error("Não foi possível renomear a pasta");
          }
        });
      },

      // Removing a folder keeps its contents — notes and any nested subfolders
      // just move up to wherever the deleted folder itself lived.
      deleteFolder: (id) => {
        const prevFolders = get().folders;
        const prevNotes = get().notes;
        const parentId = prevFolders.find((f) => f.id === id)?.parentId;

        set((s) => ({
          folders: s.folders
            .filter((f) => f.id !== id)
            .map((f) => (f.parentId === id ? { ...f, parentId } : f)),
          notes: s.notes.map((n) => (n.folderId === id ? { ...n, folderId: parentId } : n)),
        }));

        const op: PendingOp = { key: `folder:${id}`, entityId: id, kind: "deleteFolder", payload: { id } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set({ folders: prevFolders, notes: prevNotes });
            notify.error("Não foi possível excluir a pasta");
          }
        });
      },

      // A rare, explicit "danger zone" action — not folded into the offline
      // outbox (unlike single-folder ops above): if the request never reaches
      // the server, the user just sees the error toast and can retry once
      // back online, rather than this pending silently in the background.
      deleteAllFolders: () => {
        const prevFolders = get().folders;
        const prevNotes = get().notes;

        set((s) => ({
          folders: [],
          notes: s.notes.map((n) => (n.folderId ? { ...n, folderId: undefined } : n)),
        }));

        void deleteAllFoldersRows()
          .then((res) => {
            if (res.error) {
              set({ folders: prevFolders, notes: prevNotes });
              notify.error("Não foi possível excluir as pastas", res.error);
            }
          })
          .catch(() => {
            set({ folders: prevFolders, notes: prevNotes });
            notify.error("Não foi possível excluir as pastas");
          });
      },

      createTag: (name, color) => {
        const id = crypto.randomUUID();
        set((s) => ({ tags: [...s.tags, { id, name, color }] }));

        const op: PendingOp = { key: `tag:${id}`, entityId: id, kind: "createTag", payload: { id, name, color } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }));
            notify.error("Não foi possível criar a tag");
          }
        });

        return id;
      },

      updateTag: (id, patch) => {
        const previous = get().tags.find((t) => t.id === id);
        set((s) => ({ tags: s.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

        const op: PendingOp = { key: `tag:${id}`, entityId: id, kind: "updateTag", payload: { id, patch } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected" && previous) {
            set((s) => ({ tags: s.tags.map((t) => (t.id === id ? previous : t)) }));
            notify.error("Não foi possível atualizar a tag");
          }
        });
      },

      deleteTag: (id) => {
        const prevTags = get().tags;
        const prevNotes = get().notes;

        set((s) => ({
          tags: s.tags.filter((t) => t.id !== id),
          notes: s.notes.map((n) => (n.tagIds.includes(id) ? { ...n, tagIds: n.tagIds.filter((t) => t !== id) } : n)),
        }));

        const op: PendingOp = { key: `tag:${id}`, entityId: id, kind: "deleteTag", payload: { id } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set({ tags: prevTags, notes: prevNotes });
            notify.error("Não foi possível excluir a tag");
          }
        });
      },

      // Same "danger zone" reasoning as deleteAllFolders above — not queued offline.
      deleteAllTags: () => {
        const prevTags = get().tags;
        const prevNotes = get().notes;

        set((s) => ({
          tags: [],
          notes: s.notes.map((n) => (n.tagIds.length > 0 ? { ...n, tagIds: [] } : n)),
        }));

        void deleteAllTagsRows()
          .then((res) => {
            if (res.error) {
              set({ tags: prevTags, notes: prevNotes });
              notify.error("Não foi possível excluir as tags", res.error);
            }
          })
          .catch(() => {
            set({ tags: prevTags, notes: prevNotes });
            notify.error("Não foi possível excluir as tags");
          });
      },

      addTagToNote: (noteId, tagId) => {
        set((s) => ({
          notes: s.notes.map((n) => (n.id === noteId && !n.tagIds.includes(tagId) ? { ...n, tagIds: [...n.tagIds, tagId] } : n)),
        }));

        const op: PendingOp = { key: `note:${noteId}:tag:${tagId}`, entityId: noteId, kind: "addTagToNote", payload: { noteId, tagId } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set((s) => ({
              notes: s.notes.map((n) => (n.id === noteId ? { ...n, tagIds: n.tagIds.filter((t) => t !== tagId) } : n)),
            }));
            notify.error("Não foi possível aplicar a tag");
          }
        });
      },

      removeTagFromNote: (noteId, tagId) => {
        set((s) => ({
          notes: s.notes.map((n) => (n.id === noteId ? { ...n, tagIds: n.tagIds.filter((t) => t !== tagId) } : n)),
        }));

        const op: PendingOp = { key: `note:${noteId}:tag:${tagId}`, entityId: noteId, kind: "removeTagFromNote", payload: { noteId, tagId } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set((s) => ({
              notes: s.notes.map((n) => (n.id === noteId && !n.tagIds.includes(tagId) ? { ...n, tagIds: [...n.tagIds, tagId] } : n)),
            }));
            notify.error("Não foi possível remover a tag");
          }
        });
      },

      bulkAssignTags: (noteIds, tagIds) => {
        const idSet = new Set(noteIds);
        const previous = get().notes;

        set((s) => ({
          notes: s.notes.map((n) =>
            idSet.has(n.id) ? { ...n, tagIds: Array.from(new Set([...n.tagIds, ...tagIds])) } : n
          ),
        }));

        void assignTagsToNotes(noteIds, tagIds)
          .then((res) => {
            if (res.error) {
              set({ notes: previous });
              notify.error("Não foi possível aplicar as tags", res.error);
            }
          })
          .catch(() => {
            // Offline: queue one op per note×tag pair that isn't already applied
            // locally, so the batch still syncs individually once reconnected.
            const previousById = new Map(previous.map((n) => [n.id, n]));
            for (const noteId of noteIds) {
              const hadTags = previousById.get(noteId)?.tagIds ?? [];
              for (const tagId of tagIds) {
                if (hadTags.includes(tagId)) continue;
                enqueueOp(set, { key: `note:${noteId}:tag:${tagId}`, entityId: noteId, kind: "addTagToNote", payload: { noteId, tagId } });
              }
            }
          });
      },

      addOptimisticFile: (file, folderId) => {
        const tempId = `optimistic:${crypto.randomUUID()}`;
        set((s) => ({
          notes: [
            {
              id: tempId,
              clientKey: tempId,
              type: typeFromFileName(file.name),
              title: file.name,
              body: formatFileSize(file.size),
              meta: "Enviando…",
              pinned: false,
              status: "active",
              syncStatus: "local",
              updatedAt: Date.now(),
              folderId,
              processing: true,
              tagIds: [],
            },
            ...s.notes,
          ],
        }));
        return tempId;
      },

      resolveOptimisticFile: (tempId, file, stillProcessing) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === tempId
              ? {
                  ...n,
                  id: file.id,
                  type: file.type,
                  title: file.title,
                  body: file.body,
                  meta: formatRelativeMeta(file.updatedAt),
                  syncStatus: "synced" as const,
                  updatedAt: file.updatedAt,
                  storagePath: file.storagePath,
                  vectorStatus: "pending" as const,
                  processing: stillProcessing,
                }
              : n
          ),
        })),

      failOptimisticFile: (tempId) =>
        set((s) => ({ notes: s.notes.filter((n) => n.id !== tempId) })),

      setNoteProcessing: (id, processing) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, processing } : n)) })),

      setNoteTitle: (id, title) =>
        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, title } : n)) })),

      togglePin: (id) => {
        const note = get().notes.find((n) => n.id === id);
        if (!note) return;
        const nextPinned = !note.pinned;

        set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, pinned: nextPinned } : n)) }));

        const op: PendingOp = { key: `note:${id}:pin`, entityId: id, kind: "setNotePinned", payload: { id, pinned: nextPinned } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, pinned: !nextPinned } : n)) }));
            notify.error("Não foi possível fixar a nota");
          }
        });
      },

      archive: (id) => applyStatus(set, get, id, "archived"),
      trash: (id) => applyStatus(set, get, id, "trashed"),
      restore: (id) => applyStatus(set, get, id, "active"),

      deletePermanently: (id) => {
        const previous = get().notes;
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));

        const op: PendingOp = { key: `note:${id}:delete`, entityId: id, kind: "deleteNote", payload: { id } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set({ notes: previous });
            notify.error("Não foi possível excluir");
          }
        });
      },

      bulkArchive: (ids) => applyBulkStatus(set, get, ids, "archived"),
      bulkRestore: (ids) => applyBulkStatus(set, get, ids, "active"),
      bulkTrash: (ids) => applyBulkStatus(set, get, ids, "trashed"),

      bulkDeletePermanently: (ids) => {
        const idSet = new Set(ids);
        const previous = get().notes;
        set((s) => ({ notes: s.notes.filter((n) => !idSet.has(n.id)) }));

        void bulkDeleteNoteRowsPermanently(ids)
          .then((res) => {
            if (res.error) {
              set({ notes: previous });
              notify.error("Não foi possível excluir", res.error);
            }
          })
          .catch(() => {
            // Offline: queue each id as its own delete op so the batch still
            // syncs individually once the connection returns.
            for (const id of ids) {
              enqueueOp(set, { key: `note:${id}:delete`, entityId: id, kind: "deleteNote", payload: { id } });
            }
          });
      },

      addNote: ({ title, body, folderId }) => {
        const id = crypto.randomUUID();
        const now = Date.now();

        set((s) => ({
          notes: [
            {
              id,
              type: "nota" as const,
              title,
              body,
              meta: formatRelativeMeta(now),
              pinned: false,
              status: "active" as const,
              syncStatus: "local" as const,
              updatedAt: now,
              folderId,
              vectorStatus: "pending",
              tagIds: [],
            },
            ...s.notes,
          ],
        }));

        const op: PendingOp = { key: `note:${id}`, entityId: id, kind: "createNote", payload: { id, title, body, folderId } };
        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          if (outcome === "rejected") {
            set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
            notify.error("Não foi possível salvar a nota");
          } else {
            set((s) => ({
              notes: s.notes.map((n) => (n.id === id ? { ...n, syncStatus: outcome === "synced" ? "synced" : "local" } : n)),
            }));
          }
        });

        return id;
      },

      upsertNoteFromDb: (rawNote) => {
        const now = Date.now();
        set((s) => {
          const exists = s.notes.some((n) => n.id === rawNote.id);
          if (exists) {
            return {
              notes: s.notes.map((n) =>
                n.id === rawNote.id
                  ? {
                      ...n,
                      title: rawNote.title,
                      body: rawNote.body,
                      updatedAt: now,
                      meta: formatRelativeMeta(now),
                    }
                  : n
              ),
            };
          }
          return {
            notes: [
              {
                id: rawNote.id,
                type: (rawNote.type as NoteType) || "nota",
                title: rawNote.title,
                body: rawNote.body,
                meta: formatRelativeMeta(now),
                pinned: false,
                status: "active",
                syncStatus: "synced",
                updatedAt: now,
                vectorStatus: "pending",
                tagIds: [],
              },
              ...s.notes,
            ],
          };
        });
      },

      updateNote: (id, patch) => {
        const now = Date.now();
        const previousBody = get().notes.find((n) => n.id === id)?.body;

        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id
              ? { ...n, ...patch, updatedAt: now, meta: formatRelativeMeta(now), syncStatus: "local" as const }
              : n
          ),
        }));

        // An image the user just deleted from the text shouldn't linger in
        // Storage forever — diffed client-side (both bodies are already in
        // memory here) rather than adding a round trip to every autosave on
        // the server. Best-effort: no outbox/retry, no error surfaced if it
        // fails — worst case is an orphaned object, not lost data.
        if (patch.body !== undefined && previousBody !== undefined) {
          const removed = removedNoteImagePaths(previousBody, patch.body);
          if (removed.length > 0) void deleteNoteImages(removed);
        }

        // A later edit to the same note replaces any still-queued earlier one —
        // only the latest text needs to reach the server, not every keystroke batch.
        const existingCreate = get().pendingOps[`note:${id}`];
        const key = existingCreate?.kind === "createNote" ? `note:${id}` : `note:${id}:update`;
        const op: PendingOp =
          existingCreate?.kind === "createNote"
            ? { ...existingCreate, payload: { ...existingCreate.payload, title: patch.title ?? existingCreate.payload.title, body: patch.body ?? existingCreate.payload.body } }
            : { key, entityId: id, kind: "updateNote", payload: { id, patch } };

        void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
          set((s) => ({
            notes: s.notes.map((n) =>
              n.id === id ? { ...n, syncStatus: outcome === "synced" ? "synced" : outcome === "queued" ? "local" : "offline" } : n
            ),
          }));
          // Not rolling back the text on a real rejection — that would erase what
          // the user just typed. The sync dot is the signal; the next edit retries.
          if (outcome === "rejected") notify.error("Não foi possível salvar");
        });
      },

      toggleChecklistItem: (id, itemIndex) => {
        const note = get().notes.find((n) => n.id === id);
        if (!note) return;
        get().updateNote(id, { body: toggleChecklistItemInHtml(note.body, itemIndex) });
      },
    }),
    {
      name: "study-notes:notes",
      skipHydration: true,
      partialize: (s) => ({ notes: s.notes, folders: s.folders, tags: s.tags, pendingOps: s.pendingOps }),
    }
  )
);

type SetFn = (partial: Partial<NotesStore> | ((s: NotesStore) => Partial<NotesStore>)) => void;
type GetFn = () => NotesStore;

function applyStatus(set: SetFn, get: GetFn, id: string, status: NoteStatus) {
  const previous = get().notes;
  set((s) => ({
    notes: s.notes.map((n) =>
      n.id === id ? { ...n, status, pinned: status === "active" ? n.pinned : false } : n
    ),
  }));

  const op: PendingOp = { key: `note:${id}:status`, entityId: id, kind: "setNoteStatus", payload: { id, status } };
  void runOrQueue(set, get, op, opAction(op)).then((outcome) => {
    if (outcome === "rejected") {
      set({ notes: previous });
      notify.error("Não foi possível atualizar");
    }
  });
}

function applyBulkStatus(set: SetFn, get: GetFn, ids: string[], status: NoteStatus) {
  const idSet = new Set(ids);
  const previous = get().notes;
  set((s) => ({
    notes: s.notes.map((n) =>
      idSet.has(n.id) ? { ...n, status, pinned: status === "active" ? n.pinned : false } : n
    ),
  }));

  void bulkSetNoteStatus(ids, status)
    .then((res) => {
      if (res.error) {
        set({ notes: previous });
        notify.error("Não foi possível atualizar", res.error);
      }
    })
    .catch(() => {
      for (const id of ids) {
        enqueueOp(set, { key: `note:${id}:status`, entityId: id, kind: "setNoteStatus", payload: { id, status } });
      }
    });
}

interface FolderScope {
  /** `null` means the folder root — notes filed into any folder are excluded. */
  folderId: string | null;
}

/**
 * `folderScope` is only passed on the main content screen, which is the one
 * screen with folder browsing. Without it (archived/trash) every item with
 * the matching status is returned flat, regardless of which folder it came
 * from — those screens don't support drilling into folders.
 */
export function selectByStatus(notes: Note[], status: NoteStatus, folderScope?: FolderScope) {
  const filtered = notes.filter((n) => {
    if (n.status !== status) return false;
    if (!folderScope) return true;
    return folderScope.folderId ? n.folderId === folderScope.folderId : !n.folderId;
  });
  return {
    pinned: filtered.filter((n) => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt),
    others: filtered.filter((n) => !n.pinned).sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

/** Count of mutations waiting for a connection — drives the sidebar's offline-status card. */
export function usePendingSyncCount() {
  return useNotesStore((s) => Object.keys(s.pendingOps).length);
}
