"use client";

import { useCallback, useEffect, useState } from "react";
import { getDocumentHighlights, type ParagraphHighlight } from "@/app/(app)/jwlibrary-actions";
import { JW_MARKS_CHANGED_EVENT, useJwOutbox } from "@/lib/offline/jwlibrary-outbox";

/**
 * The user's highlights and notes on one document, found by its
 * MepsDocumentId alone (see getDocumentHighlights) — for surfaces that know
 * which document they are showing but not which publication symbol it was
 * marked under: an appendix, a Perspicaz article, a reference opened in a side
 * panel.
 *
 * Offline it quietly returns nothing rather than failing: these documents
 * come from the server anyway, so there is no local copy to read marks from.
 */
export function useDocumentHighlights(mepsDocumentId: number | null, titleHint?: string | null) {
  const [highlights, setHighlights] = useState<ParagraphHighlight[]>([]);

  const refresh = useCallback(async () => {
    if (mepsDocumentId === null) return;
    try {
      // The server only knows what the outbox has already sent.
      await useJwOutbox.getState().sync();
      const result = await getDocumentHighlights(mepsDocumentId, titleHint);
      if (result.highlights) setHighlights(result.highlights);
    } catch {
      // No connection: keep whatever is on screen.
    }
  }, [mepsDocumentId, titleHint]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (mepsDocumentId === null) return;
      try {
        await useJwOutbox.getState().sync();
        const result = await getDocumentHighlights(mepsDocumentId, titleHint);
        if (!cancelled && result.highlights) setHighlights(result.highlights);
      } catch {
        // Offline — see above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mepsDocumentId, titleHint]);

  // The outbox finished replaying (or the server refused one of its writes):
  // what is really saved may differ from what this screen drew optimistically.
  useEffect(() => {
    const onChanged = () => void refresh();
    window.addEventListener(JW_MARKS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(JW_MARKS_CHANGED_EVENT, onChanged);
  }, [refresh]);

  return { highlights, setHighlights, refresh };
}
