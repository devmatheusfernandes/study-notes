import { useEffect, useMemo, useState } from "react";
import {
  getBibleChapterVerses,
  getChapterCrossReferences,
  getVerseCrossReferences,
  getChapterStudyContent,
  type BibleFootnote,
  type BibleStudyNote,
  type CrossReference,
  type CrossReferenceSource,
} from "@/app/(app)/bible-actions";
import { getChapterVideos, type ChapterVideo } from "@/app/(app)/bible-search-actions";
import { getChapterResearchGuide, type ResearchGuideExtract } from "@/app/(app)/research-guide-actions";

/**
 * These four hooks are the data BibleStudyPanel's tabs need, extracted out of
 * bible-reader.tsx (its original inline effects) so jwpub-bible-surface.tsx
 * can fetch the identical shape for whatever verse range it's showing.
 * Kept as four separate hooks rather than one, because bible-reader.tsx
 * fetches footnotes/study notes UNCONDITIONALLY (it needs them for the
 * reading pane's in-text footnote/study-note markers regardless of whether
 * the study panel is even open) while everything else here is only fetched
 * while the panel is open — folding all four into one `enabled`-gated hook
 * would either lose that always-on behavior or double-fetch footnotes.
 */

interface CommonParams {
  bookOrder: number | null;
  chapter: number | null;
  /** `null` means "show the whole chapter" — every dataset below comes back unfiltered. */
  selectedVerse: number | null;
  /** Nothing is fetched while this is false. */
  enabled: boolean;
}

export function useBibleCrossReferences({ bookOrder, chapter, selectedVerse, enabled }: CommonParams) {
  const [refs, setRefs] = useState<(CrossReference & { verse: number | null })[]>([]);
  const [isLoadingRefs, setIsLoadingRefs] = useState(false);
  const [refsTruncated, setRefsTruncated] = useState(false);
  const [refsSource, setRefsSource] = useState<CrossReferenceSource>("nwt");

  useEffect(() => {
    if (!enabled || bookOrder === null || chapter === null) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoadingRefs(true);
    });

    const request =
      selectedVerse === null
        ? getChapterCrossReferences(bookOrder, chapter, refsSource)
        : getVerseCrossReferences(bookOrder, chapter, selectedVerse, refsSource).then((result) => ({
            refs: result.refs?.map((ref) => ({ ...ref, verse: selectedVerse })),
            truncated: false,
          }));

    void request.then((result) => {
      if (cancelled) return;
      setRefs(result.refs ?? []);
      setRefsTruncated(result.truncated ?? false);
      setIsLoadingRefs(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, selectedVerse, refsSource, bookOrder, chapter]);

  return { refs, refsLoading: isLoadingRefs, refsTruncated, refsSource, setRefsSource };
}

/**
 * Footnotes + study notes, gated by `enabled` — for a caller (jwpub-bible-surface.tsx)
 * that has no always-on need for these, unlike bible-reader.tsx's own inline
 * version which fetches unconditionally to feed the reading pane's markers.
 */
export function useBibleFootnotesAndStudyNotes({ bookOrder, chapter, selectedVerse, enabled }: CommonParams) {
  const [chapterVerseNumberById, setChapterVerseNumberById] = useState<Map<number, number | null>>(new Map());
  const [footnotes, setFootnotes] = useState<BibleFootnote[]>([]);
  const [studyNotes, setStudyNotes] = useState<BibleStudyNote[]>([]);
  const [isLoadingStudy, setIsLoadingStudy] = useState(false);

  useEffect(() => {
    if (!enabled || bookOrder === null || chapter === null) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoadingStudy(true);
    });
    void Promise.all([getChapterStudyContent(bookOrder, chapter), getBibleChapterVerses(bookOrder, chapter)]).then(
      ([studyResult, versesResult]) => {
        if (cancelled) return;
        setFootnotes(studyResult.footnotes ?? []);
        setStudyNotes(studyResult.studyNotes ?? []);
        setChapterVerseNumberById(new Map((versesResult.verses ?? []).map((v) => [v.id, v.verse])));
        setIsLoadingStudy(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, bookOrder, chapter]);

  const panelFootnotes = useMemo(() => {
    const withVerse = footnotes.map((f) => ({ ...f, verse: chapterVerseNumberById.get(f.verseId) ?? null }));
    return selectedVerse === null ? withVerse : withVerse.filter((f) => f.verse === selectedVerse);
  }, [footnotes, chapterVerseNumberById, selectedVerse]);

  const panelStudyNotes = useMemo(
    () => (selectedVerse === null ? studyNotes : studyNotes.filter((n) => n.verse === selectedVerse)),
    [studyNotes, selectedVerse]
  );

  return { footnotes: panelFootnotes, studyNotes: panelStudyNotes, studyLoading: isLoadingStudy };
}

export function useBibleChapterVideos({ bookOrder, chapter, selectedVerse, enabled }: CommonParams) {
  const [chapterVideos, setChapterVideos] = useState<ChapterVideo[]>([]);
  const [isLoadingChapterVideos, setIsLoadingChapterVideos] = useState(false);

  useEffect(() => {
    if (!enabled || bookOrder === null || chapter === null) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoadingChapterVideos(true);
    });
    void getChapterVideos(bookOrder, chapter).then((result) => {
      if (cancelled) return;
      setChapterVideos(result.videos ?? []);
      setIsLoadingChapterVideos(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, bookOrder, chapter]);

  const panelVideos = useMemo(() => {
    if (selectedVerse === null) return chapterVideos;
    return chapterVideos.filter((video) => video.verses.length === 0 || video.verses.includes(selectedVerse));
  }, [chapterVideos, selectedVerse]);

  return { videos: panelVideos, videosLoading: isLoadingChapterVideos };
}

export function useBibleResearchGuide({ bookOrder, chapter, selectedVerse, enabled }: CommonParams) {
  const [researchGuideEntries, setResearchGuideEntries] = useState<{ verse: number | null; contentHtml: string }[]>(
    []
  );
  const [researchGuideExtracts, setResearchGuideExtracts] = useState<Record<number, ResearchGuideExtract>>({});
  const [isLoadingResearchGuide, setIsLoadingResearchGuide] = useState(false);

  useEffect(() => {
    if (!enabled || bookOrder === null || chapter === null) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsLoadingResearchGuide(true);
    });
    void getChapterResearchGuide(bookOrder, chapter).then((result) => {
      if (cancelled) return;
      setResearchGuideEntries(result.entries ?? []);
      setResearchGuideExtracts(result.extracts ?? {});
      setIsLoadingResearchGuide(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, bookOrder, chapter]);

  const panelResearchGuide = useMemo(() => {
    if (selectedVerse === null) return researchGuideEntries;
    return researchGuideEntries.filter((entry) => entry.verse === selectedVerse);
  }, [researchGuideEntries, selectedVerse]);

  return {
    researchGuideEntries: panelResearchGuide,
    researchGuideExtracts,
    researchGuideLoading: isLoadingResearchGuide,
  };
}

/** Convenience composition of all four — for a caller like jwpub-bible-surface.tsx that needs everything. */
export function useBibleStudyData(params: CommonParams) {
  const crossRefs = useBibleCrossReferences(params);
  const footnotesAndStudyNotes = useBibleFootnotesAndStudyNotes(params);
  const videos = useBibleChapterVideos(params);
  const researchGuide = useBibleResearchGuide(params);
  return { ...crossRefs, ...footnotesAndStudyNotes, ...videos, ...researchGuide };
}
