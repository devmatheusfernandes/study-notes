import { useCallback, useEffect, useState } from "react";
import { resolveJwpubReferences, getChapter, type ResolvedJwpubReference } from "@/app/(app)/jwpub-actions";
import type { JwpubReferenceTarget } from "@/components/content/jwpub-reference-surface";

/**
 * State + handlers for the Guia tab's `data-jwpub-pubref`/`data-jwpub-extract`
 * links — extracted out of bible-study-panel.tsx so both `BibleStudyPanel`
 * and `JwpubBibleSurface` can render `JwpubReferenceSurface` and the extract
 * panel as their OWN top-level siblings (next to their "Estudo"/"Referência
 * bíblica" panel), rather than nested inside `BibleStudyTabs`'s content.
 *
 * That nesting is not cosmetic: `JwpubSidePanel` only behaves as a real
 * sidebar (a `position: sticky` flex item next to the reading pane on
 * desktop) when it's a direct flex sibling of the surrounding row — nested
 * one level deeper inside another `JwpubSidePanel`'s own scrollable content,
 * it just renders inline, stacked underneath whatever else is in that panel
 * instead of opening beside it. See the two host components for where these
 * are actually rendered.
 */
export function useResearchGuideReference(researchGuideEntries: { contentHtml: string }[]) {
  const [resolvedPubRefs, setResolvedPubRefs] = useState<Map<number, ResolvedJwpubReference>>(new Map());
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [referenceTarget, setReferenceTarget] = useState<JwpubReferenceTarget | null>(null);
  const [referenceHtml, setReferenceHtml] = useState<string | null>(null);
  const [isLoadingReference, setIsLoadingReference] = useState(false);
  const [unresolvedPubRef, setUnresolvedPubRef] = useState<number | null>(null);
  // A citation link names a LIST of excerpt ids (see rewriteJwpubLinks) — `null` means the panel is closed.
  const [openExtractIds, setOpenExtractIds] = useState<number[] | null>(null);

  // Resolves every citation currently on screen against this user's own
  // library in one batched call, the moment the Guia tab's content arrives —
  // matching jwpub-reader.tsx's own pattern, so the link doesn't have to be
  // clicked once just to find out whether it even works.
  useEffect(() => {
    const ids = [
      ...new Set(
        researchGuideEntries
          .flatMap((entry) => [...entry.contentHtml.matchAll(/data-jwpub-pubref="(\d+)"/g)])
          .map((m) => Number(m[1]))
      ),
    ];
    if (ids.length === 0) {
      queueMicrotask(() => setResolvedPubRefs(new Map()));
      return;
    }
    let cancelled = false;
    void resolveJwpubReferences(ids).then((result) => {
      if (cancelled) return;
      setResolvedPubRefs(new Map(result.resolved.map((r) => [r.mepsDocumentId, r])));
    });
    return () => {
      cancelled = true;
    };
  }, [researchGuideEntries]);

  const openPublicationRef = useCallback(
    (mepsDocumentId: number) => {
      // The two reference surfaces (this one and the extract panel) are
      // independent state, so without this a citation with an embedded
      // extract left its panel open when the next citation clicked was a bare
      // pointer instead — two "Referência"-ish sidebars open side by side.
      setOpenExtractIds(null);
      const resolved = resolvedPubRefs.get(mepsDocumentId);
      if (!resolved) {
        setReferenceOpen(true);
        setReferenceTarget(null);
        setReferenceHtml(null);
        setIsLoadingReference(false);
        setUnresolvedPubRef(mepsDocumentId);
        return;
      }
      setReferenceOpen(true);
      setReferenceHtml(null);
      setIsLoadingReference(true);
      setUnresolvedPubRef(null);
      setReferenceTarget({
        noteId: resolved.noteId,
        publicationTitle: resolved.publicationTitle,
        chapterTitle: resolved.chapterTitle,
        documentId: resolved.documentId,
      });
      if (resolved.isGlobal) {
        setReferenceHtml(resolved.contentHtml ?? null);
        setIsLoadingReference(false);
        return;
      }
      void getChapter(resolved.publicationId, resolved.documentId).then((result) => {
        setReferenceHtml(result.html ?? null);
        setIsLoadingReference(false);
      });
    },
    [resolvedPubRefs]
  );

  const openExtract = useCallback((extractIds: number[]) => {
    setReferenceOpen(false);
    setOpenExtractIds(extractIds);
  }, []);

  const handlePublicationRefResolved = useCallback((mepsDocumentId: number) => {
    void resolveJwpubReferences([mepsDocumentId]).then((result) => {
      const resolved = result.resolved[0];
      if (!resolved) return;
      setResolvedPubRefs((prev) => new Map(prev).set(mepsDocumentId, resolved));
      setUnresolvedPubRef(null);
      setIsLoadingReference(true);
      setReferenceTarget({
        noteId: resolved.noteId,
        publicationTitle: resolved.publicationTitle,
        chapterTitle: resolved.chapterTitle,
        documentId: resolved.documentId,
      });
      void getChapter(resolved.publicationId, resolved.documentId).then((chapterResult) => {
        setReferenceHtml(chapterResult.html ?? null);
        setIsLoadingReference(false);
      });
    });
  }, []);

  return {
    referenceOpen,
    referenceTarget,
    referenceHtml,
    isLoadingReference,
    unresolvedPubRef,
    closeReference: () => setReferenceOpen(false),
    openPublicationRef,
    handlePublicationRefResolved,
    openExtractIds,
    openExtract,
    closeExtract: () => setOpenExtractIds(null),
  };
}
