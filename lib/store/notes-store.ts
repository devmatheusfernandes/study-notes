import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SyncStatus } from "@/components/content/sync-status";
import { deleteStorageFile } from "@/app/(app)/files-actions";

export type NoteType = "nota" | "pdf" | "docx" | "xlsx" | "jwpub" | "arquivo";
export type NoteStatus = "active" | "archived" | "trashed";

/** Maps an uploaded file's extension onto one of our card types. */
export function typeFromFileName(name: string): NoteType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "doc" || ext === "docx") return "docx";
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return "xlsx";
  if (ext === "jwpub") return "jwpub";
  return "arquivo";
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

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
  /** Supabase Storage object path (`${userId}/...`) — only set for real uploaded files, never for notes or seed/demo data. */
  storagePath?: string;
}

export interface Folder {
  id: string;
  name: string;
  /** Parent folder, for folders nested inside other folders. Root folders omit this. */
  parentId?: string;
}

const SEED_FOLDERS: Folder[] = [
  { id: "f1", name: "Estudo Semanal" },
  { id: "f2", name: "Discursos" },
  { id: "f3", name: "Arquivos antigos" },
];

// Seeded with varied body lengths so the masonry layout has real height
// variation to work with (the Keep-style look depends on it).
const SEED: Note[] = [
  {
    id: "n1",
    folderId: "f1",
    type: "nota",
    title: "Resumo do capítulo 4",
    body: "O ponto central do capítulo é a diferença entre preparo e improviso. Três trechos merecem atenção na revisão desta semana. A ordem das semanas 40 e 41 foi trocada no cronograma, e isso muda o material que precisa estar pronto antes.",
    meta: "Editado há 2 h",
    pinned: true,
    status: "active",
    syncStatus: "local",
    updatedAt: Date.now() - 2 * 60 * 60 * 1000,
  },
  {
    id: "n2",
    type: "nota",
    title: "Perguntas para revisar",
    body: "Lista curta para o próximo encontro.",
    meta: "27 ago",
    pinned: true,
    status: "active",
    syncStatus: "synced",
    updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
  },
  {
    id: "n3",
    folderId: "f2",
    type: "nota",
    title: "Como elaborar um esboço",
    body: "O objetivo central é tocar o coração. O nosso propósito não é apenas transmitir informações, mas fazer o coração dos irmãos arder. A lição de Lucas 24:32: os discípulos sentiram o coração arder porque Jesus abriu plenamente as Escrituras. Não é o orador ou seu cargo que impacta a assistência, mas as Escrituras. Não use o esboço para explicar a Bíblia — use a Bíblia para ensinar o que está no esboço.",
    meta: "Hoje",
    pinned: false,
    status: "active",
    syncStatus: "local",
    updatedAt: Date.now() - 30 * 60 * 1000,
  },
  {
    id: "n4",
    folderId: "f1",
    type: "pdf",
    title: "Apostila-2026.pdf",
    body: "4,2 MB · indexado para busca",
    meta: "28 ago",
    pinned: false,
    status: "active",
    syncStatus: "synced",
    updatedAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
  },
  {
    id: "n5",
    folderId: "f1",
    type: "nota",
    title: "Como fazer pesquisas",
    body: "Normalmente, basta fazer uma procura simples. Muitas vezes, basta saber localizar uma única palavra ou um texto bíblico nas publicações. No entanto, às vezes pode ser necessária uma procura mais detalhada a fim de encontrar um texto específico.",
    meta: "25 ago",
    pinned: false,
    status: "active",
    syncStatus: "synced",
    updatedAt: Date.now() - 6 * 24 * 60 * 60 * 1000,
  },
  {
    id: "n6",
    folderId: "f3",
    type: "jwpub",
    title: "biblioteca-2026.jwpub",
    body: "Importado e disponível offline",
    meta: "21 ago",
    pinned: false,
    status: "active",
    syncStatus: "synced",
    updatedAt: Date.now() - 9 * 24 * 60 * 60 * 1000,
  },
  {
    id: "n7",
    type: "nota",
    title: "Indicação não depende de fluência no idioma local",
    body: "O corpo de anciãos não deve segurar a recomendação de um irmão como servo ministerial ou ancião só porque ele ainda não é fluente no idioma da congregação. O que os anciãos devem analisar é se o irmão se encaixa nas qualificações bíblicas.",
    meta: "20 ago",
    pinned: false,
    status: "active",
    syncStatus: "synced",
    updatedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
  },
  {
    id: "n8",
    folderId: "f3",
    type: "xlsx",
    title: "Cronograma.xlsx",
    body: "Semanas 34–52",
    meta: "19 ago",
    pinned: false,
    status: "active",
    syncStatus: "synced",
    updatedAt: Date.now() - 11 * 24 * 60 * 60 * 1000,
  },
  {
    id: "n9",
    type: "docx",
    title: "Rascunho-ensaio.docx",
    body: "Aguardando sincronização",
    meta: "Hoje",
    pinned: false,
    status: "active",
    syncStatus: "local",
    updatedAt: Date.now() - 60 * 60 * 1000,
  },
  {
    id: "n10",
    type: "nota",
    title: "Paz e Segurança",
    body: "(1Ts 5:1, 2) O dia de Jeová começa com a destruição da religião falsa e vai até o Armagedom.",
    meta: "18 ago",
    pinned: false,
    status: "archived",
    syncStatus: "synced",
    updatedAt: Date.now() - 12 * 24 * 60 * 60 * 1000,
  },
  {
    id: "n11",
    type: "nota",
    title: "Anotações antigas",
    body: "Rascunho que não uso mais.",
    meta: "10 ago",
    pinned: false,
    status: "trashed",
    syncStatus: "synced",
    updatedAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
  },
];

interface NotesStore {
  notes: Note[];
  folders: Folder[];
  createFolder: (name: string, parentId?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  addFiles: (files: { name: string; size: number; storagePath: string }[], folderId?: string) => void;
  togglePin: (id: string) => void;
  archive: (id: string) => void;
  trash: (id: string) => void;
  restore: (id: string) => void;
  /** Removes a note for good — only meaningful for items already in the trash. */
  deletePermanently: (id: string) => void;
  rename: (id: string, title: string) => void;
  bulkArchive: (ids: string[]) => void;
  bulkRestore: (ids: string[]) => void;
  bulkTrash: (ids: string[]) => void;
  bulkDeletePermanently: (ids: string[]) => void;
  addNote: (note: Pick<Note, "title" | "body"> & { folderId?: string }) => string;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "body">>) => void;
  getNote: (id: string) => Note | undefined;
}

export const useNotesStore = create<NotesStore>()(
  persist(
    (set, get) => ({
      notes: SEED,
      folders: SEED_FOLDERS,

      createFolder: (name, parentId) => {
        const id = `f${Date.now().toString(36)}`;
        set((s) => ({ folders: [...s.folders, { id, name, parentId }] }));
        return id;
      },

      renameFolder: (id, name) =>
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) })),

      // Files are already uploaded to Supabase Storage by the time this runs
      // (see app/(app)/files-actions.ts) — this just indexes them locally.
      addFiles: (files, folderId) =>
        set((s) => ({
          notes: [
            ...files.map((file, index) => ({
              id: `n${Date.now().toString(36)}${index}`,
              type: typeFromFileName(file.name),
              title: file.name,
              body: formatFileSize(file.size),
              meta: "Agora",
              pinned: false,
              status: "active" as const,
              syncStatus: "synced" as const,
              updatedAt: Date.now(),
              folderId,
              storagePath: file.storagePath,
            })),
            ...s.notes,
          ],
        })),

      // Removing a folder keeps its contents — notes and any nested subfolders
      // just move up to wherever the deleted folder itself lived.
      deleteFolder: (id) =>
        set((s) => {
          const parentId = s.folders.find((f) => f.id === id)?.parentId;
          return {
            folders: s.folders
              .filter((f) => f.id !== id)
              .map((f) => (f.parentId === id ? { ...f, parentId } : f)),
            notes: s.notes.map((n) => (n.folderId === id ? { ...n, folderId: parentId } : n)),
          };
        }),

      togglePin: (id) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)),
        })),

      archive: (id) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, status: "archived" as const, pinned: false } : n
          ),
        })),

      trash: (id) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, status: "trashed" as const, pinned: false } : n
          ),
        })),

      restore: (id) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, status: "active" as const } : n)),
        })),

      deletePermanently: (id) => {
        const note = get().notes.find((n) => n.id === id);
        if (note?.storagePath) void deleteStorageFile(note.storagePath);
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
      },

      rename: (id, title) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, title, updatedAt: Date.now() } : n)),
        })),

      bulkArchive: (ids) => {
        const set_ = new Set(ids);
        set((s) => ({
          notes: s.notes.map((n) =>
            set_.has(n.id) ? { ...n, status: "archived" as const, pinned: false } : n
          ),
        }));
      },

      bulkRestore: (ids) => {
        const set_ = new Set(ids);
        set((s) => ({
          notes: s.notes.map((n) => (set_.has(n.id) ? { ...n, status: "active" as const } : n)),
        }));
      },

      bulkTrash: (ids) => {
        const set_ = new Set(ids);
        set((s) => ({
          notes: s.notes.map((n) =>
            set_.has(n.id) ? { ...n, status: "trashed" as const, pinned: false } : n
          ),
        }));
      },

      bulkDeletePermanently: (ids) => {
        const set_ = new Set(ids);
        get()
          .notes.filter((n) => set_.has(n.id) && n.storagePath)
          .forEach((n) => void deleteStorageFile(n.storagePath!));
        set((s) => ({ notes: s.notes.filter((n) => !set_.has(n.id)) }));
      },

      addNote: ({ title, body, folderId }) => {
        const id = `n${Date.now().toString(36)}`;
        set((s) => ({
          notes: [
            {
              id,
              type: "nota" as const,
              title,
              body,
              meta: "Agora",
              pinned: false,
              status: "active" as const,
              syncStatus: "local" as const,
              updatedAt: Date.now(),
              folderId,
            },
            ...s.notes,
          ],
        }));
        return id;
      },

      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, ...patch, updatedAt: Date.now(), syncStatus: "local" as const } : n
          ),
        })),

      getNote: (id) => get().notes.find((n) => n.id === id),
    }),
    { name: "study-notes:notes", skipHydration: true }
  )
);

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
