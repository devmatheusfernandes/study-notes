"use client";

import { useEffect, useState } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

/** How long a collaborator's caret stays after they stop moving or typing. */
export const CARET_IDLE_MS = 4000;

/**
 * Hides other people's carets (name tag and selection too) once they have been
 * still for a few seconds, so presence doesn't sit on top of the text being
 * read; they come back the moment that person moves or types — and only then:
 * presence messages repeating the same position (a reconnect, a window getting
 * focus again) don't count.
 *
 * Returns a stylesheet rather than touching the elements: ProseMirror creates
 * and moves the caret widgets itself, and a rule keyed on `data-client` (see
 * RichTextEditor's caret render) survives that.
 */
export function useIdleCaretCss(awareness: Awareness | undefined, doc: Y.Doc | undefined): string {
  const [idle, setIdle] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    if (!awareness || !doc) return;
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    // Where each one was last seen. Kept when they blur or drop out, so coming back to the same spot stays quiet.
    const lastPosition = new Map<number, string>();

    function setIdleState(client: number, value: boolean) {
      setIdle((current) => {
        if (current.has(client) === value) return current;
        const next = new Set(current);
        if (value) next.add(client);
        else next.delete(client);
        return next;
      });
    }

    function active(client: number) {
      if (client === doc!.clientID) return;
      setIdleState(client, false);
      clearTimeout(timers.get(client));
      timers.set(
        client,
        setTimeout(() => setIdleState(client, true), CARET_IDLE_MS)
      );
    }

    function moved(client: number) {
      const cursor = awareness!.getStates().get(client)?.cursor;
      if (!cursor) return;
      const position = JSON.stringify([cursor.anchor, cursor.head]);
      if (lastPosition.get(client) === position) return;
      lastPosition.set(client, position);
      active(client);
    }

    const onAwareness = ({ added, updated }: { added: number[]; updated: number[] }) => {
      [...added, ...updated].forEach(moved);
    };
    // Typing in the middle of a line can leave the published cursor unchanged — the new text counts too.
    const onTransaction = (transaction: Y.Transaction) => {
      transaction.afterState.forEach((clock, client) => {
        if (transaction.beforeState.get(client) !== clock) active(client);
      });
    };

    awareness.on("change", onAwareness);
    doc.on("afterTransaction", onTransaction);
    // Whoever is already here starts visible and fades like everyone else.
    queueMicrotask(() => awareness.getStates().forEach((_state, client) => moved(client)));

    return () => {
      awareness.off("change", onAwareness);
      doc.off("afterTransaction", onTransaction);
      timers.forEach(clearTimeout);
    };
  }, [awareness, doc]);

  return [...idle]
    .map(
      (client) =>
        `.collaboration-carets__caret[data-client="${client}"]{opacity:0}` +
        `.ProseMirror-yjs-selection[data-client="${client}"]{background-color:transparent!important}`
    )
    .join("");
}
