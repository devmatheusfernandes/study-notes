import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveJwpubReferences, type ResolvedJwpubReference } from "@/app/(app)/jwpub-actions";
import type { GlobalPublicationSymbol } from "@/components/content/global-publication-reader";
import { globalPublicationHref, isGlobalPublicationSymbol } from "@/lib/jwpub/global-publication-link";

interface Options {
  /**
   * Opens a global publication's article in place instead of navigating to
   * /bible — for hosts that already ARE that page (bible-reader.tsx).
   */
  onOpenGlobal?: (symbol: GlobalPublicationSymbol, documentId: number) => void;
}

/**
 * "Abrir publicação" on an embedded excerpt: takes the reader to the cited
 * publication's own page — the user's reader at /notes/[id] or, for a shared
 * global one like Perspicaz, its page on /bible — rather than opening yet
 * another reference panel beside the excerpt.
 *
 * Only when nothing resolves does it open a panel, with the "Baixar" prompt;
 * once that download finishes it navigates the same way. Render
 * `<JwpubReferenceSurface {...surfaceProps} />` for that panel.
 */
export function useOpenPublicationSource({ onOpenGlobal }: Options = {}) {
  const router = useRouter();
  // `resolving` shows the panel's skeleton while the lookup runs; once it
  // settles with no hit, the same panel turns into the "Baixar" prompt.
  const [pending, setPending] = useState<{ mepsDocumentId: number; resolving: boolean } | null>(null);

  const navigate = useCallback(
    (hit: ResolvedJwpubReference): boolean => {
      if (hit.isGlobal) {
        if (!isGlobalPublicationSymbol(hit.symbol)) return false;
        if (onOpenGlobal) onOpenGlobal(hit.symbol, hit.documentId);
        else router.push(globalPublicationHref(hit.symbol, hit.documentId));
        return true;
      }
      if (!hit.noteId) return false;
      router.push(`/notes/${hit.noteId}?doc=${hit.documentId}`);
      return true;
    },
    [onOpenGlobal, router]
  );

  const openSource = useCallback(
    (mepsDocumentId: number) => {
      setPending({ mepsDocumentId, resolving: true });
      void resolveJwpubReferences([mepsDocumentId]).then(({ resolved }) => {
        const hit = resolved[0];
        if (hit && navigate(hit)) {
          setPending(null);
          return;
        }
        setPending({ mepsDocumentId, resolving: false });
      });
    },
    [navigate]
  );

  const handleDownloaded = useCallback(
    (mepsDocumentId: number, noteId: string) => {
      setPending({ mepsDocumentId, resolving: true });
      void resolveJwpubReferences([mepsDocumentId]).then(({ resolved }) => {
        setPending(null);
        const hit = resolved[0];
        if (hit && navigate(hit)) return;
        router.push(`/notes/${noteId}`);
      });
    },
    [navigate, router]
  );

  return {
    openSource,
    surfaceProps: {
      open: pending !== null,
      target: null,
      html: null,
      isLoading: pending?.resolving ?? false,
      unresolvedMepsDocumentId: pending && !pending.resolving ? pending.mepsDocumentId : null,
      onResolved: handleDownloaded,
      onClose: () => setPending(null),
    },
  };
}
