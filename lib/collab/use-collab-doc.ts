"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { createClient } from "@/lib/supabase/client";
import { saveCollabState, type CollabRole } from "@/app/(app)/collab-actions";
import { fetchCollabAccess, fetchCollabOpen, postCollabSeed } from "./collab-api";
import { SupabaseYjsProvider, type PresenceUser } from "./supabase-provider";
import { fromBase64, toBase64 } from "./base64";
import { collaboratorColor } from "./colors";
import { clearCollabDocument, collabDbName as idbName } from "./device-copy";
import { useSharedStore } from "@/lib/store/shared-store";

/**
 * Opens a shared note as a collaborative Yjs document.
 *
 * Order of sources: the device copy (y-indexeddb, so a shared note opens and
 * edits offline once it has been opened online), then the server state, then
 * — for a note nobody has opened collaboratively yet — a seed built from its
 * HTML by the editor (see `needsSeed`). Live sync rides SupabaseYjsProvider;
 * persistence is a debounced, MERGING Server Action. Access is re-checked
 * while the note is open, and losing it (owner locked/revoked, invitee left)
 * wipes the device copy — "removed" has to mean removed on this device too.
 */

export type CollabStatus = "checking" | "plain" | "loading" | "ready" | "revoked" | "unavailable";

const SAVE_DEBOUNCE_MS = 2000;
const ACCESS_POLL_MS = 30_000;
const RETRY_MS = 5000;

export const COLLAB_TITLE_FIELD = "title";
export const COLLAB_BODY_FIELD = "default";


export interface CollabSession {
  status: CollabStatus;
  role: CollabRole | null;
  doc: Y.Doc | null;
  provider: SupabaseYjsProvider | null;
  self: PresenceUser | null;
  /** Others in the note right now. */
  peers: PresenceUser[];
  /** HTML to build the very first Yjs state from (only while `needsSeed`). */
  seedHtml: string | null;
  needsSeed: boolean;
  /** The editor hands back the seeded state; whoever stored first wins and everyone continues from that. */
  applySeed: (seedB64: string) => Promise<void>;
  /** The editor registers how to render its current HTML (for the notes.body snapshot). */
  setHtmlSource: (fn: () => string) => void;
  /** "saved" / "saving" / "offline" — for the sync indicator. */
  saveState: "saved" | "saving" | "offline";
  /** A viewer opening a note no editor has opened collaboratively yet: show this snapshot read-only. */
  viewerFallback: { title: string; body: string } | null;
  /** Re-runs the open sequence (after sharing a note that was being edited normally). */
  recheck: () => void;
}

export function useCollabDoc(noteId: string | undefined, opts: { knownShared: boolean }): CollabSession {
  const [status, setStatus] = useState<CollabStatus>(noteId ? "checking" : "plain");
  const [role, setRole] = useState<CollabRole | null>(null);
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [provider, setProvider] = useState<SupabaseYjsProvider | null>(null);
  const [self, setSelf] = useState<PresenceUser | null>(null);
  const [peers, setPeers] = useState<PresenceUser[]>([]);
  const [seedHtml, setSeedHtml] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const [viewerFallback, setViewerFallback] = useState<{ title: string; body: string } | null>(null);
  const htmlSource = useRef<(() => string) | null>(null);
  const markCollab = useSharedStore((s) => s.markCollabNote);
  const unmarkCollab = useSharedStore((s) => s.unmarkCollabNote);
  const knownSharedRef = useRef(opts.knownShared);
  useEffect(() => {
    knownSharedRef.current = opts.knownShared;
  });
  // Bumped to re-run the open sequence, e.g. right after the owner shares the note.
  const [epoch, setEpoch] = useState(0);
  const recheck = useCallback(() => setEpoch((n) => n + 1), []);

  const setHtmlSource = useCallback((fn: () => string) => {
    htmlSource.current = fn;
  }, []);

  // Session lifetime — everything below is torn down when the note changes.
  const sessionRef = useRef<{
    doc: Y.Doc;
    idb: IndexeddbPersistence;
    provider: SupabaseYjsProvider | null;
    dispose: () => void;
  } | null>(null);

  const seedTitle = useRef("");
  const applySeed = useCallback(
    async (seedB64: string) => {
      if (!noteId || !sessionRef.current) return;
      // The title goes INTO the seed, not into the live doc beforehand: two
      // clients seeding at once would otherwise each insert it and the merge
      // would show it twice. Only the stored seed ever reaches anyone.
      const seedDoc = new Y.Doc();
      Y.applyUpdate(seedDoc, fromBase64(seedB64));
      if (seedTitle.current) seedDoc.getText(COLLAB_TITLE_FIELD).insert(0, seedTitle.current);
      const seed = toBase64(Y.encodeStateAsUpdate(seedDoc));
      seedDoc.destroy();
      // The note stays behind the skeleton until this lands — keep trying
      // through a flaky connection rather than leaving it stuck.
      let res: { state?: string } = {};
      for (let attempt = 0; attempt < 6 && !res.state && sessionRef.current; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
        res = await postCollabSeed(noteId, seed).catch(() => ({}));
      }
      if (res.state && sessionRef.current) {
        Y.applyUpdate(sessionRef.current.doc, fromBase64(res.state), "server");
        setSeedHtml(null);
      }
    },
    [noteId]
  );

  useEffect(() => {
    if (!noteId) return; // reported as "plain" below
    let cancelled = false;
    const supabase = createClient();

    async function revoke() {
      if (!noteId) return;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      await clearCollabDocument(noteId);
      unmarkCollab(noteId);
      if (!cancelled) {
        setDoc(null);
        setProvider(null);
        setStatus("revoked");
      }
    }

    async function start() {
      if (!noteId) return;
      let opened: Awaited<ReturnType<typeof fetchCollabOpen>> | null = null;
      try {
        opened = await fetchCollabOpen(noteId);
      } catch {
        opened = null; // offline
      }
      if (cancelled) return;

      if (opened && !opened.collaborative) {
        if (opened.role === null) {
          // A shared note we no longer have access to.
          if (knownSharedRef.current) await revoke();
          else setStatus("plain");
          return;
        }
        unmarkCollab(noteId);
        setStatus("plain");
        return;
      }
      if (!opened && !knownSharedRef.current) {
        // Offline and never seen as shared on this device: the ordinary editor.
        setStatus("plain");
        return;
      }

      setStatus("loading");
      const ydoc = new Y.Doc();
      const idb = new IndexeddbPersistence(idbName(noteId), ydoc);
      await idb.whenSynced;
      if (cancelled) {
        void idb.destroy();
        ydoc.destroy();
        return;
      }

      const currentRole: CollabRole =
        opened?.role ?? (useSharedStore.getState().collabRoles[noteId] as CollabRole | undefined) ?? "viewer";
      markCollab(noteId, currentRole);
      setRole(currentRole);
      const canWrite = currentRole === "owner" || currentRole === "editor";

      let serverVector: Uint8Array | null = null;
      if (opened?.state) {
        Y.applyUpdate(ydoc, fromBase64(opened.state), "server");
        serverVector = Y.encodeStateVector(ydoc);
      }
      const isEmpty = ydoc.getXmlFragment(COLLAB_BODY_FIELD).length === 0;
      if (isEmpty && !opened?.state) {
        if (!opened) {
          // Offline, nothing on the device and nothing to seed from.
          void idb.destroy();
          ydoc.destroy();
          setStatus("unavailable");
          return;
        }
        if (canWrite) {
          seedTitle.current = opened.title ?? "";
          setSeedHtml(opened.body ?? "");
        } else {
          // A viewer can't seed; until an editor opens it, show the snapshot read-only.
          setViewerFallback({ title: opened.title ?? "", body: opened.body ?? "" });
        }
      }

      const { data } = await supabase.auth.getSession();
      const email = data.session?.user.email ?? "";
      const userId = data.session?.user.id ?? String(ydoc.clientID);
      const me: PresenceUser = {
        name: email.split("@")[0] || "Você",
        color: collaboratorColor(userId),
        role: currentRole,
      };
      setSelf(me);

      const yProvider = new SupabaseYjsProvider(supabase, noteId, ydoc, { canWrite, user: me });
      const offPresence = yProvider.onPresence(setPeers);
      const offRefresh = yProvider.onRefresh(async () => {
        try {
          const fresh = await fetchCollabOpen(noteId);
          if (fresh.state) Y.applyUpdate(ydoc, fromBase64(fresh.state), "server");
        } catch {
          // offline — the next sync exchange covers it
        }
      });

      // ── Saving (debounced, merging, retried while offline) ──
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      let dirty = false;
      let saving = false;
      const save = async () => {
        saveTimer = null;
        if (!canWrite || saving || !dirty) return;
        saving = true;
        dirty = false;
        setSaveState("saving");
        try {
          const html = htmlSource.current?.() ?? "";
          const title = ydoc.getText(COLLAB_TITLE_FIELD).toString();
          const res = await saveCollabState(noteId, toBase64(Y.encodeStateAsUpdate(ydoc)), html, title);
          if (res.error) {
            dirty = true;
            if (!res.transient) {
              const access = await fetchCollabAccess(noteId).catch(() => null);
              if (access && access.role === null) return void revoke();
            }
            setSaveState("offline");
            saveTimer = setTimeout(save, RETRY_MS);
          } else {
            setSaveState(dirty ? "saving" : "saved");
            yProvider.announceRefreshIfNeeded();
            if (dirty) saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
          }
        } catch {
          dirty = true; // offline: the device copy already has it; retry later
          setSaveState("offline");
          saveTimer = setTimeout(save, RETRY_MS);
        } finally {
          saving = false;
        }
      };
      const scheduleSave = () => {
        dirty = true;
        setSaveState("saving");
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
      };
      const onUpdate = (_u: Uint8Array, origin: unknown) => {
        if (origin === "server") return;
        if (origin === yProvider) {
          // Someone else's edit — persisting it is their job; nothing to do.
          return;
        }
        scheduleSave();
      };
      ydoc.on("update", onUpdate);

      // Edits made on this device while offline (already in IndexedDB) that
      // the server copy doesn't have yet: push them now.
      if (canWrite && serverVector) {
        const missing = Y.encodeStateAsUpdate(ydoc, serverVector);
        if (missing.length > 2) scheduleSave();
      }

      const onOnline = () => {
        if (dirty) void save();
      };
      window.addEventListener("online", onOnline);

      // Access can end while the note is open (owner locks it, revokes, …).
      const poll = setInterval(async () => {
        try {
          const { role: now } = await fetchCollabAccess(noteId);
          if (now === null) void revoke();
        } catch {
          // offline — try again next tick
        }
      }, ACCESS_POLL_MS);

      const flushOnHide = () => {
        if (document.visibilityState === "hidden" && dirty) void save();
      };
      document.addEventListener("visibilitychange", flushOnHide);

      sessionRef.current = {
        doc: ydoc,
        idb,
        provider: yProvider,
        dispose: () => {
          clearInterval(poll);
          window.removeEventListener("online", onOnline);
          document.removeEventListener("visibilitychange", flushOnHide);
          if (saveTimer) clearTimeout(saveTimer);
          if (dirty) void save();
          ydoc.off("update", onUpdate);
          offPresence();
          offRefresh();
          yProvider.destroy();
          void idb.destroy();
        },
      };
      setDoc(ydoc);
      setProvider(yProvider);
      setStatus("ready");
    }

    void start();
    return () => {
      cancelled = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [noteId, epoch, markCollab, unmarkCollab]);

  return {
    status: noteId ? status : "plain",
    role,
    doc,
    provider,
    self,
    peers,
    seedHtml,
    needsSeed: seedHtml !== null,
    applySeed,
    setHtmlSource,
    saveState,
    viewerFallback,
    recheck,
  };
}
