"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  listIncomingInvites,
  listMyOutgoingShares,
  listSharedWithMe,
  type IncomingInvite,
  type SharedFolder,
  type SharedNote,
} from "@/app/(app)/shares-actions";
import { clearCollabDocument } from "@/lib/collab/device-copy";

/**
 * What's shared WITH this user (and which of their own things they share).
 * Deliberately separate from notes-store: those are the user's own rows with
 * an offline outbox; these belong to someone else, are edited through the
 * collaborative path (lib/collab/), and can disappear at any moment.
 *
 * Persisted only as a read cache so the "Compartilhado comigo" list and the
 * device copies of shared notes still open offline. Every successful refresh
 * PURGES what the server no longer returns — local list entry and the note's
 * IndexedDB document — so a revoked, left or locked share is really gone from
 * this device, not just from the server.
 */

type CollabRole = "owner" | "editor" | "viewer";

interface SharedState {
  notes: SharedNote[];
  folders: SharedFolder[];
  invites: IncomingInvite[];
  outgoingNoteIds: string[];
  outgoingFolderIds: string[];
  /** Notes this device has opened collaboratively, with the role last seen — lets them open offline. */
  collabRoles: Record<string, CollabRole>;
  loaded: boolean;
  /** The persisted copy has been read back (not persisted itself). */
  hydrated: boolean;
  refresh: () => Promise<void>;
  markCollabNote: (id: string, role: CollabRole) => void;
  unmarkCollabNote: (id: string) => void;
  removeShareLocally: (shareId: string) => void;
}

let inflight: Promise<void> | null = null;

export const useSharedStore = create<SharedState>()(
  persist(
    (set, get) => ({
      notes: [],
      folders: [],
      invites: [],
      outgoingNoteIds: [],
      outgoingFolderIds: [],
      collabRoles: {},
      loaded: false,
      hydrated: false,

      refresh: () => {
        inflight ??= (async () => {
          try {
            const [shared, invites, outgoing] = await Promise.all([
              listSharedWithMe(),
              listIncomingInvites(),
              listMyOutgoingShares(),
            ]);
            if (!shared.ok) return;

            // Purge device copies of shared notes this user no longer has.
            const stillShared = new Set(shared.notes.map((n) => n.id));
            const roles = { ...get().collabRoles };
            for (const [id, role] of Object.entries(roles)) {
              if (role !== "owner" && !stillShared.has(id)) {
                delete roles[id];
                void clearCollabDocument(id);
              }
            }
            for (const n of shared.notes) roles[n.id] = n.role;

            set({
              notes: shared.notes,
              folders: shared.folders,
              invites: invites.error ? get().invites : invites.invites,
              outgoingNoteIds: outgoing.noteIds,
              outgoingFolderIds: outgoing.folderIds,
              collabRoles: roles,
              loaded: true,
            });
          } catch {
            // offline: keep the cached lists
            set({ loaded: true });
          } finally {
            inflight = null;
          }
        })();
        return inflight;
      },

      markCollabNote: (id, role) => {
        if (get().collabRoles[id] === role) return;
        set({ collabRoles: { ...get().collabRoles, [id]: role } });
      },
      unmarkCollabNote: (id) => {
        if (!(id in get().collabRoles)) return;
        const next = { ...get().collabRoles };
        delete next[id];
        set({ collabRoles: next });
      },
      removeShareLocally: (shareId) => {
        const gone = get().notes.filter((n) => n.shareId === shareId).map((n) => n.id);
        for (const id of gone) void clearCollabDocument(id);
        const roles = { ...get().collabRoles };
        for (const id of gone) delete roles[id];
        set({
          notes: get().notes.filter((n) => n.shareId !== shareId),
          folders: get().folders.filter((f) => f.shareId !== shareId),
          invites: get().invites.filter((i) => i.id !== shareId),
          collabRoles: roles,
        });
      },
    }),
    {
      name: "study-notes:shared",
      skipHydration: true,
      onRehydrateStorage: () => () => useSharedStore.setState({ hydrated: true }),
      partialize: (s) => ({
        notes: s.notes,
        folders: s.folders,
        outgoingNoteIds: s.outgoingNoteIds,
        outgoingFolderIds: s.outgoingFolderIds,
        collabRoles: s.collabRoles,
      }),
    }
  )
);
