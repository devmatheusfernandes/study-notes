import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { fromBase64, toBase64 } from "./base64";

/**
 * A Yjs provider over Supabase Realtime Broadcast — no extra server.
 *
 * Channel `note:<id>` is PRIVATE: the database's RLS on realtime.messages
 * (0055) decides who may join (anyone with access) and who may send edits
 * (owner/editor only). A viewer receives everything and sends nothing but
 * presence.
 *
 * Protocol (all base64 Yjs payloads):
 *  - `update`  — an incremental change, batched every BATCH_MS so a burst of
 *                keystrokes is one message (Realtime bills per message, and
 *                each one counts once more per receiver).
 *  - `sync1`   — "here is my state vector": peers answer with `sync2` (what I'm
 *                missing) and send their own vector back as `sync1r`, so a
 *                client returning from offline both gets and gives.
 *  - `sync1r`  — same as sync1 but never answered with another vector (no loop).
 *  - `sync2`   — a diff answering a vector.
 *  - `awareness` — cursors/selections (y-protocols awareness), editors only.
 *  - `refresh` — "my change was too big to broadcast, re-read the server copy";
 *                sent after the save that persisted it.
 * Presence (channel.track) carries who is in the note, viewers included.
 *
 * Persistence is NOT here — see use-collab-doc.ts (IndexedDB locally, a
 * merging Server Action remotely).
 */

const BATCH_MS = 80;
/** Broadcast payloads are capped (256 KB on the Free plan); stay well under. */
const MAX_BROADCAST_B64 = 180_000;

export interface PresenceUser {
  name: string;
  color: string;
  role: string;
}

type Status = "connecting" | "connected" | "disconnected";

export class SupabaseYjsProvider {
  readonly awareness: Awareness;
  status: Status = "connecting";
  private channel: RealtimeChannel | null = null;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private needsRefreshBroadcast = false;
  private presenceListeners = new Set<(users: PresenceUser[]) => void>();
  private refreshListeners = new Set<() => void>();
  private statusListeners = new Set<(status: Status) => void>();

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly noteId: string,
    readonly doc: Y.Doc,
    private readonly opts: { canWrite: boolean; user: PresenceUser }
  ) {
    this.awareness = new Awareness(doc);
    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    void this.connect();
  }

  onPresence(fn: (users: PresenceUser[]) => void) {
    this.presenceListeners.add(fn);
    return () => this.presenceListeners.delete(fn);
  }
  onRefresh(fn: () => void) {
    this.refreshListeners.add(fn);
    return () => this.refreshListeners.delete(fn);
  }
  onStatus(fn: (status: Status) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Called by the persistence layer after a save that included an over-sized change. */
  announceRefreshIfNeeded() {
    if (!this.needsRefreshBroadcast) return;
    this.needsRefreshBroadcast = false;
    this.send("refresh", {});
  }

  private setStatus(status: Status) {
    this.status = status;
    for (const fn of this.statusListeners) fn(status);
  }

  private async connect() {
    // Private channels authorize with the user's JWT.
    await this.supabase.realtime.setAuth();
    if (this.destroyed) return;

    const channel = this.supabase.channel(`note:${this.noteId}`, {
      config: { private: true, broadcast: { self: false }, presence: { key: String(this.doc.clientID) } },
    });
    this.channel = channel;

    channel
      .on("broadcast", { event: "update" }, ({ payload }) => this.apply(payload?.u))
      .on("broadcast", { event: "sync2" }, ({ payload }) => this.apply(payload?.u))
      .on("broadcast", { event: "sync1" }, ({ payload }) => this.answerVector(payload?.sv, true))
      .on("broadcast", { event: "sync1r" }, ({ payload }) => this.answerVector(payload?.sv, false))
      .on("broadcast", { event: "awareness" }, ({ payload }) => {
        if (typeof payload?.a !== "string") return;
        try {
          applyAwarenessUpdate(this.awareness, fromBase64(payload.a), this);
        } catch {
          // ignore malformed
        }
      })
      .on("broadcast", { event: "refresh" }, () => {
        for (const fn of this.refreshListeners) fn();
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceUser>();
        const users = Object.entries(state)
          .filter(([key]) => key !== String(this.doc.clientID))
          .map(([, metas]) => metas[0])
          .filter(Boolean)
          .map((m) => ({ name: m.name, color: m.color, role: m.role }));
        for (const fn of this.presenceListeners) fn(users);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.setStatus("connected");
          void channel.track(this.opts.user);
          if (this.opts.canWrite) {
            // Catch up both ways with whoever is here (e.g. after being offline).
            this.send("sync1", { sv: toBase64(Y.encodeStateVector(this.doc)) });
            this.sendAwareness([this.doc.clientID]);
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this.setStatus("disconnected");
        }
      });
  }

  private apply(b64: unknown) {
    if (typeof b64 !== "string") return;
    try {
      Y.applyUpdate(this.doc, fromBase64(b64), this);
    } catch {
      // A malformed update is dropped rather than corrupting the document.
    }
  }

  private answerVector(b64: unknown, replyWithOwn: boolean) {
    if (!this.opts.canWrite || typeof b64 !== "string") return;
    try {
      const diff = Y.encodeStateAsUpdate(this.doc, fromBase64(b64));
      // An empty diff is a couple of bytes; skip sending it.
      if (diff.length > 2) this.sendUpdate("sync2", diff);
      if (replyWithOwn) this.send("sync1r", { sv: toBase64(Y.encodeStateVector(this.doc)) });
      this.sendAwareness([this.doc.clientID]);
    } catch {
      // ignore malformed
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.opts.canWrite) return;
    this.pending.push(update);
    if (!this.flushTimer) this.flushTimer = setTimeout(this.flush, BATCH_MS);
  };

  private flush = () => {
    this.flushTimer = null;
    if (this.pending.length === 0) return;
    const merged = Y.mergeUpdates(this.pending);
    this.pending = [];
    // Offline: nothing to do — the next `sync1` exchange carries it.
    if (this.status !== "connected") return;
    this.sendUpdate("update", merged);
  };

  private sendUpdate(event: "update" | "sync2", update: Uint8Array) {
    const b64 = toBase64(update);
    if (b64.length > MAX_BROADCAST_B64) {
      // Too big for one broadcast (a long paste): peers re-read the server copy after our next save.
      this.needsRefreshBroadcast = true;
      return;
    }
    this.send(event, { u: b64 });
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };

  private sendAwareness(clients: number[]) {
    if (!this.opts.canWrite || this.status !== "connected") return;
    this.send("awareness", { a: toBase64(encodeAwarenessUpdate(this.awareness, clients)) });
  }

  private send(event: string, payload: Record<string, unknown>) {
    if (!this.channel || this.status !== "connected") return;
    void this.channel.send({ type: "broadcast", event, payload });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flush();
    removeAwarenessStates(this.awareness, [this.doc.clientID], "destroy");
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    if (this.channel) void this.supabase.removeChannel(this.channel);
    this.channel = null;
    this.setStatus("disconnected");
  }
}
