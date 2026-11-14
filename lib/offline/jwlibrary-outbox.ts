import { create } from "zustand";
import { persist } from "zustand/middleware";
import { notify } from "@/components/ui/toaster";
import {
  createJwlibraryHighlight,
  createJwlibraryNote,
  deleteJwlibraryHighlight,
  deleteJwlibraryNote,
  updateJwlibraryHighlightColor,
  updateJwlibraryNote,
  type CreateJwlibraryHighlightInput,
  type CreateJwlibraryNoteInput,
} from "@/app/(app)/jwlibrary-actions";
import { saveAnswer } from "@/app/(app)/jwpub-actions";
import { refreshOfflineUserData } from "./jwpub-offline";

/**
 * The offline outbox for highlights, notes and "Sua resposta" fields — the same
 * idea as the pending-ops outbox in lib/store/notes-store.ts, for the
 * `jwlibrary_*` tables the publication reader writes to.
 *
 * Every mutation goes through here, online or not: it is queued (persisted in
 * localStorage, so it survives a closed tab) and then replayed in order. Rows are
 * created with ids the client chose, so a later op can refer to a row the server
 * hasn't seen yet and a replay after a lost response is a no-op server-side.
 */

export const JW_MARKS_CHANGED_EVENT = "jwlibrary:marks-changed";

export type JwOp = { opId: string; lastError?: string; attempts?: number } & (
  | { kind: "createHighlight"; entityId: string; input: CreateJwlibraryHighlightInput }
  | { kind: "setHighlightColor"; entityId: string; colorIndex: number }
  | { kind: "deleteHighlight"; entityId: string }
  | { kind: "createNote"; entityId: string; input: CreateJwlibraryNoteInput }
  | { kind: "updateNote"; entityId: string; patch: { title?: string; content?: string } }
  | { kind: "deleteNote"; entityId: string }
  | { kind: "saveAnswer"; entityId: string; publicationId: string; documentId: number; pid: string; answer: string }
);

/** An op without its queue id — what callers describe. */
export type NewJwOp = JwOp extends infer O ? (O extends JwOp ? Omit<O, "opId"> : never) : never;

interface JwOutboxState {
  ops: JwOp[];
  submit: (op: NewJwOp) => void;
  /** Replays the queue in order; stops at the first op that can't reach the server. With `force`, an op that keeps failing no longer holds the rest back (see runPass). */
  sync: (options?: { force?: boolean }) => Promise<void>;
  /** Drops a queued op for good. */
  discard: (opId: string) => void;
}

/** The op currently being sent. A coalescing edit must not rewrite it — its result would be removed from the queue along with the edit. */
let inflightOpId: string | null = null;
let syncing = false;

function applyToQueue(ops: JwOp[], op: JwOp): JwOp[] {
  const queued = (match: (o: JwOp) => boolean) => ops.findIndex((o) => o.opId !== inflightOpId && match(o));
  const replaceAt = (index: number, next: JwOp) => ops.map((o, i) => (i === index ? next : o));

  switch (op.kind) {
    case "createHighlight":
    case "createNote":
      return [...ops, op];

    case "updateNote": {
      const create = queued((o) => o.kind === "createNote" && o.entityId === op.entityId);
      if (create >= 0) {
        const existing = ops[create] as Extract<JwOp, { kind: "createNote" }>;
        return replaceAt(create, { ...existing, input: { ...existing.input, ...op.patch } });
      }
      const update = queued((o) => o.kind === "updateNote" && o.entityId === op.entityId);
      if (update >= 0) {
        const existing = ops[update] as Extract<JwOp, { kind: "updateNote" }>;
        return replaceAt(update, { ...existing, patch: { ...existing.patch, ...op.patch } });
      }
      return [...ops, op];
    }

    case "setHighlightColor": {
      const createHighlight = queued((o) => o.kind === "createHighlight" && o.entityId === op.entityId);
      if (createHighlight >= 0) {
        const existing = ops[createHighlight] as Extract<JwOp, { kind: "createHighlight" }>;
        return replaceAt(createHighlight, { ...existing, input: { ...existing.input, colorIndex: op.colorIndex } });
      }
      const createNote = queued((o) => o.kind === "createNote" && o.input.userMarkId === op.entityId && !!o.input.highlight);
      if (createNote >= 0) {
        const existing = ops[createNote] as Extract<JwOp, { kind: "createNote" }>;
        return replaceAt(createNote, {
          ...existing,
          input: { ...existing.input, highlight: { ...existing.input.highlight!, colorIndex: op.colorIndex } },
        });
      }
      const recolor = queued((o) => o.kind === "setHighlightColor" && o.entityId === op.entityId);
      if (recolor >= 0) return replaceAt(recolor, { ...(ops[recolor] as JwOp), colorIndex: op.colorIndex } as JwOp);
      return [...ops, op];
    }

    case "deleteHighlight": {
      let cancelled = false;
      const next = ops
        .filter((o) => {
          if (o.opId === inflightOpId) return true;
          if (o.kind === "setHighlightColor" && o.entityId === op.entityId) return false;
          if (o.kind === "createHighlight" && o.entityId === op.entityId) {
            cancelled = true;
            return false;
          }
          return true;
        })
        .map((o): JwOp => {
          if (o.opId === inflightOpId || o.kind !== "createNote") return o;
          // A note queued against this highlight survives it, just without the mark.
          if (o.input.attachToUserMarkId === op.entityId) {
            return { ...o, input: { ...o.input, attachToUserMarkId: undefined } };
          }
          if (o.input.userMarkId === op.entityId && o.input.highlight) {
            cancelled = true;
            return { ...o, input: { ...o.input, highlight: null, userMarkId: undefined } };
          }
          return o;
        });
      return cancelled ? next : [...next, op];
    }

    case "deleteNote": {
      const create = queued((o) => o.kind === "createNote" && o.entityId === op.entityId);
      const rest = ops.filter((o) => o.opId === inflightOpId || !(o.entityId === op.entityId && (o.kind === "updateNote" || o.kind === "createNote")));
      return create >= 0 ? rest : [...rest, op];
    }

    case "saveAnswer": {
      const same = queued((o) => o.kind === "saveAnswer" && o.entityId === op.entityId);
      return same >= 0 ? replaceAt(same, op) : [...ops, op];
    }
  }
}

function runOp(op: JwOp): Promise<{ error?: string }> {
  switch (op.kind) {
    case "createHighlight":
      return createJwlibraryHighlight(op.input);
    case "setHighlightColor":
      return updateJwlibraryHighlightColor(op.entityId, op.colorIndex);
    case "deleteHighlight":
      return deleteJwlibraryHighlight(op.entityId);
    case "createNote":
      return createJwlibraryNote(op.input);
    case "updateNote":
      return updateJwlibraryNote(op.entityId, op.patch);
    case "deleteNote":
      return deleteJwlibraryNote(op.entityId);
    case "saveAnswer":
      return saveAnswer(op.publicationId, op.documentId, op.pid, op.answer);
  }
}

function announceMarksChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JW_MARKS_CHANGED_EVENT));
}

let activePass: Promise<void> | null = null;

type StoreGet = () => JwOutboxState;
type StoreSet = (update: (state: JwOutboxState) => Partial<JwOutboxState>) => void;

/** Sends queued ops in order until the queue is empty or one can't reach the server. */
async function runPass(get: StoreGet, set: StoreSet, force = false): Promise<void> {
  let sentAny = false;
  let rejectedAny = false;
  // Forced pass only: ops already tried, and notes/highlights with a failing op whose later ops must wait.
  const tried = new Set<string>();
  const blocked = new Set<string>();

  try {
    for (;;) {
      const op = force ? get().ops.find((o) => !tried.has(o.opId) && !blocked.has(o.entityId)) : get().ops[0];
      if (!op) break;
      tried.add(op.opId);

      let result: { error?: string };
      inflightOpId = op.opId;
      try {
        result = await runOp(op);
      } catch (error) {
        // The request threw — offline, or something failing every time. Say which, so the sync panel can.
        const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200);
        set((s) => ({
          ops: s.ops.map((o) => (o.opId === op.opId ? { ...o, lastError: message, attempts: (o.attempts ?? 0) + 1 } : o)),
        }));
        // Normal pass: keep everything in order and try again later. Forced: skip this one, but a failing
        // create still stops the pass — later ops may refer to the row it was meant to make.
        if (!force || op.kind === "createHighlight" || op.kind === "createNote") break;
        blocked.add(op.entityId);
        continue;
      } finally {
        inflightOpId = null;
      }

      // An expired session isn't a rejection of this edit: keep it queued rather than lose what was written offline.
      if (result.error === "Sessão expirada.") break;

      set((s) => ({ ops: s.ops.filter((o) => o.opId !== op.opId) }));
      sentAny = true;
      if (result.error) {
        rejectedAny = true;
        notify.error("Não foi possível sincronizar uma alteração", result.error);
      }
    }
  } finally {
    syncing = false;
    activePass = null;
  }

  if (sentAny && get().ops.length === 0) {
    // Chapter text never changes, but the user's marks and answers on the downloaded copies might.
    try {
      await refreshOfflineUserData();
    } catch {
      // Still offline or failing — the local copy stays as the user left it.
    }
    announceMarksChanged();
  } else if (rejectedAny) {
    announceMarksChanged();
  }
}

export const useJwOutbox = create<JwOutboxState>()(
  persist(
    (set, get) => ({
      ops: [],

      submit: (op) => {
        const full = { ...op, opId: crypto.randomUUID() } as JwOp;
        set((s) => ({ ops: applyToQueue(s.ops, full) }));
        void get().sync();
      },

      // A call made while a pass is running joins it, so `await sync()` also means "everything queued so far has been tried".
      sync: (options) => {
        if (syncing) return activePass ?? Promise.resolve();
        syncing = true;
        activePass = runPass(get, set, options?.force === true);
        return activePass;
      },

      discard: (opId) => set((s) => ({ ops: s.ops.filter((o) => o.opId !== opId) })),
    }),
    {
      name: "study-notes:jw-outbox",
      partialize: (state) => ({ ops: state.ops }),
      // Rehydrated explicitly by StoreHydration, same as the notes store.
      skipHydration: true,
    }
  )
);

export function useJwOutboxCount() {
  return useJwOutbox((s) => s.ops.length);
}

