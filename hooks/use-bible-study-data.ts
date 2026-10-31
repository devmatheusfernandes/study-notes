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
import { inVerseScope, type VerseRange } from "@/lib/bible/verse-scope";

/** A range this wide is no longer "a passage" — cross references are then read chapter-wide and filtered instead of one request per verse. */
const MAX_PER_VERSE_REQUESTS = 30;

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
  /** A passage of several verses. Used when no single verse is selected; with neither, the whole chapter. */
  verseRange?: VerseRange | null;
  /** Nothing is fetched while this is false. */
  enabled: boolean;
}

export function useBibleCrossReferences({ bookOrder, chapter, selectedVerse, verseRange = null, enabled }: CommonParams) {
  const rangeFrom = verseRange?.from ?? null;
  const rangeTo = verseRange?.to ?? null;
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

    const perVerse = (verses: number[]) =>
      Promise.all(verses.map((verse) => getVerseCrossReferences(bookOrder, chapter, verse, refsSource))).then((results) => ({
        refs: results.flatMap((result, i) => (result.refs ?? []).map((ref) => ({ ...ref, verse: verses[i] }))),
        truncated: false,
      }));

    let request;
    if (selectedVerse !== null) {
      request = perVerse([selectedVerse]);
    } else if (rangeFrom !== null && rangeTo !== null && rangeTo - rangeFrom < MAX_PER_VERSE_REQUESTS) {
      request = perVerse(Array.from({ length: rangeTo - rangeFrom + 1 }, (_, i) => rangeFrom + i));
    } else {
      request = getChapterCrossReferences(bookOrder, chapter, refsSource).then((result) => ({
        ...result,
        refs: result.refs?.filter((ref) => inVerseScope(ref.verse ?? null, null, verseRange)),
      }));
    }

    void request.then((result) => {
      if (cancelled) return;
      setRefs(result.refs ?? []);
      setRefsTruncated(result.truncated ?? false);
      setIsLoadingRefs(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- verseRange is represented by rangeFrom/rangeTo
  }, [enabled, selectedVerse, rangeFrom, rangeTo, refsSource, bookOrder, chapter]);

  return { refs, refsLoading: isLoadingRefs, refsTruncated, refsSource, setRefsSource };
}

/**
 * Footnotes + study notes, gated by `enabled` — for a caller (jwpub-bible-surface.tsx)
 * that has no always-on need for these, unlike bible-reader.tsx's own inline
 * version which fetches unconditionally to feed the reading pane's markers.
 */
export function useBibleFootnotesAndStudyNotes({ bookOrder, chapter, selectedVerse, verseRange = null, enabled }: CommonParams) {
  const rangeFrom = verseRange?.from ?? null;
  const rangeTo = verseRange?.to ?? null;
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
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    return withVerse.filter((f) => inVerseScope(f.verse, selectedVerse, range));
  }, [footnotes, chapterVerseNumberById, selectedVerse, rangeFrom, rangeTo]);

  const panelStudyNotes = useMemo(() => {
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    return studyNotes.filter((n) => inVerseScope(n.verse, selectedVerse, range));
  }, [studyNotes, selectedVerse, rangeFrom, rangeTo]);

  return { footnotes: panelFootnotes, studyNotes: panelStudyNotes, studyLoading: isLoadingStudy };
}

export function useBibleChapterVideos({ bookOrder, chapter, selectedVerse, verseRange = null, enabled }: CommonParams) {
  const rangeFrom = verseRange?.from ?? null;
  const rangeTo = verseRange?.to ?? null;
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
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    if (selectedVerse === null && !range) return chapterVideos;
    return chapterVideos.filter(
      (video) => video.verses.length === 0 || video.verses.some((verse) => inVerseScope(verse, selectedVerse, range))
    );
  }, [chapterVideos, selectedVerse, rangeFrom, rangeTo]);

  return { videos: panelVideos, videosLoading: isLoadingChapterVideos };
}

export function useBibleResearchGuide({ bookOrder, chapter, selectedVerse, verseRange = null, enabled }: CommonParams) {
  const rangeFrom = verseRange?.from ?? null;
  const rangeTo = verseRange?.to ?? null;
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
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    return researchGuideEntries.filter((entry) => inVerseScope(entry.verse, selectedVerse, range));
  }, [researchGuideEntries, selectedVerse, rangeFrom, rangeTo]);

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
