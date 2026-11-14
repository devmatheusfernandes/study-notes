"use client";

import { signOut } from "@/app/login/actions";
import { useNotesStore } from "@/lib/store/notes-store";
import { useLockStore } from "@/lib/store/lock-store";
import { useJwOutbox } from "@/lib/offline/jwlibrary-outbox";
import { deleteOfflineDatabase } from "@/lib/offline/idb";
import { forgetThisDevice } from "@/lib/offline/device-inventory";

const SYNC_GRACE_MS = 4000;

/**
 * Signing out has to take the notes with it: the offline-first store keeps every
 * note (title + body in plain text) in localStorage, and the service worker keeps
 * rendered pages and images in Cache Storage — all of which would still be
 * sitting on the device for whoever uses it next. Unsynced edits get a short
 * window to reach the server first, so signing out doesn't silently discard them.
 */
export async function signOutAndWipeLocalData() {
  try {
    const { pendingOps, syncPendingOps } = useNotesStore.getState();
    const { sync: syncPublicationEdits, ops: publicationEdits } = useJwOutbox.getState();
    if (Object.keys(pendingOps ?? {}).length > 0 || publicationEdits.length > 0) {
      await Promise.race([
        Promise.all([syncPendingOps(), syncPublicationEdits()]),
        new Promise((r) => setTimeout(r, SYNC_GRACE_MS)),
      ]);
    }
  } catch {
    // Offline or failing — sign out anyway; the wipe below is the point.
  }

  // Still signed in here, which the call needs; the downloads below are about to be wiped.
  await Promise.race([forgetThisDevice(), new Promise((r) => setTimeout(r, 2000))]);

  // The in-memory store survives a client-side redirect (no reload), and the next
  // account to sign in would merge with it — empty it before wiping storage.
  useNotesStore.setState({ notes: [], folders: [], pendingOps: {} });
  useJwOutbox.setState({ ops: [] });
  useLockStore.getState().lock();

  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("study-notes:")) localStorage.removeItem(key);
    }
    sessionStorage.clear();
  } catch {
    // Storage blocked — nothing to wipe.
  }

  // Downloaded publications (and the highlights and notes kept with them) belong to this account.
  await deleteOfflineDatabase();

  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    // Best effort.
  }

  await signOut();
}
