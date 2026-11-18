import { useEffect, useMemo, useState } from "react";
import {
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
import { loadBibleChapterVerses } from "@/lib/offline/bible-offline";
import { loadStudyData, peekStudyCache, prefetchStudyData, studyCacheKey, type StudyResult } from "@/lib/cache/study-cache";

/** A range this wide is no longer "a passage" — cross references are then read chapter-wide and filtered instead of one request per verse. */
const MAX_PER_VERSE_REQUESTS = 30;

/**
 * These hooks are the data BibleStudyPanel's tabs need, extracted out of
 * bible-reader.tsx (its original inline effects) so jwpub-bible-surface.tsx
 * can fetch the identical shape for whatever verse range it's showing.
 * Kept as separate hooks rather than one, because bible-reader.tsx
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

interface StudyContent {
  footnotes: BibleFootnote[];
  studyNotes: BibleStudyNote[];
}

interface ResearchGuideData {
  entries: { verse: number | null; contentHtml: string }[];
  extracts: Record<number, ResearchGuideExtract>;
}

// Module-level (not inline) so their identity is stable across renders and the
// hooks below can list them as effect dependencies.
async function fetchStudyContent(bookOrder: number, chapter: number): Promise<StudyResult<StudyContent>> {
  const result = await getChapterStudyContent(bookOrder, chapter);
  if (result.error) return { error: result.error };
  return { data: { footnotes: result.footnotes ?? [], studyNotes: result.studyNotes ?? [] } };
}

/** `[verse id, verse number]` pairs — local-first (IndexedDB when the Bible is downloaded), and tiny, so cached on its own. */
async function fetchVerseNumbers(bookOrder: number, chapter: number): Promise<StudyResult<[number, number | null][]>> {
  const result = await loadBibleChapterVerses(bookOrder, chapter);
  if (result.error || !result.verses) return { error: result.error ?? "Capítulo indisponível." };
  return { data: result.verses.map((v) => [v.id, v.verse] as [number, number | null]) };
}

async function fetchChapterVideos(bookOrder: number, chapter: number): Promise<StudyResult<ChapterVideo[]>> {
  const result = await getChapterVideos(bookOrder, chapter);
  if (result.error) return { error: result.error };
  return { data: result.videos ?? [] };
}

async function fetchResearchGuide(bookOrder: number, chapter: number): Promise<StudyResult<ResearchGuideData>> {
  const result = await getChapterResearchGuide(bookOrder, chapter);
  if (result.error) return { error: result.error };
  return { data: { entries: result.entries ?? [], extracts: result.extracts ?? {} } };
}

/** How long a chapter has to stay settled before the next one is warmed — keeps speculative requests out of the way of a user's own. */
const PREFETCH_DELAY_MS = 1500;

interface ChapterDataParams<T> {
  kind: string;
  bookOrder: number | null;
  chapter: number | null;
  enabled: boolean;
  fetcher: (bookOrder: number, chapter: number) => Promise<StudyResult<T>>;
}

/**
 * One chapter-scoped dataset, served through lib/cache/study-cache.ts: painted
 * at once from memory or IndexedDB when this chapter was seen before, then
 * quietly re-checked against the server. Only a chapter nothing has cached
 * shows `loading`.
 *
 * `data` keeps the previous chapter's value until the new one settles (same as
 * the effect-driven hooks this replaced) — callers gate on `loading`.
 */
function useChapterData<T>({ kind, bookOrder, chapter, enabled, fetcher }: ChapterDataParams<T>) {
  const key = enabled && bookOrder !== null && chapter !== null ? studyCacheKey(kind, bookOrder, chapter) : null;
  const [state, setState] = useState<{ key: string; data: T | undefined } | null>(null);

  // Read during render so a chapter that is already in memory paints on the
  // first frame instead of flashing a skeleton for the effect's round trip.
  const remembered = key !== null ? peekStudyCache<T>(key) : undefined;
  const settled = key !== null && state !== null && state.key === key;
  const data = settled ? state.data : (remembered ?? state?.data);
  const loading = key !== null && !settled && remembered === undefined;

  useEffect(() => {
    if (key === null || bookOrder === null || chapter === null) return;
    let cancelled = false;
    loadStudyData<T>(
      key,
      () => fetcher(bookOrder, chapter),
      (next) => {
        if (!cancelled) setState({ key, data: next });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key, bookOrder, chapter, fetcher]);

  // Reading forward is the common case: warm the next chapter once this one is on screen.
  useEffect(() => {
    if (!settled || bookOrder === null || chapter === null) return;
    const timer = setTimeout(() => {
      prefetchStudyData<T>(studyCacheKey(kind, bookOrder, chapter + 1), () => fetcher(bookOrder, chapter + 1));
    }, PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [settled, kind, bookOrder, chapter, fetcher]);

  return { data, loading };
}

/** A chapter's footnotes and study notes alone — what the reading pane needs for its in-text markers. */
export function useChapterStudyContent({ bookOrder, chapter, enabled }: Pick<CommonParams, "bookOrder" | "chapter" | "enabled">) {
  const { data, loading } = useChapterData({ kind: "study", bookOrder, chapter, enabled, fetcher: fetchStudyContent });
  return { footnotes: data?.footnotes ?? EMPTY_FOOTNOTES, studyNotes: data?.studyNotes ?? EMPTY_STUDY_NOTES, loading };
}

const EMPTY_FOOTNOTES: BibleFootnote[] = [];
const EMPTY_STUDY_NOTES: BibleStudyNote[] = [];
const EMPTY_VIDEOS: ChapterVideo[] = [];
const EMPTY_GUIDE_ENTRIES: ResearchGuideData["entries"] = [];
const EMPTY_GUIDE_EXTRACTS: ResearchGuideData["extracts"] = {};

/**
 * Footnotes + study notes, gated by `enabled` — for a caller (jwpub-bible-surface.tsx)
 * that has no always-on need for these, unlike bible-reader.tsx's own use of
 * useChapterStudyContent, which fetches unconditionally to feed the reading
 * pane's markers.
 */
export function useBibleFootnotesAndStudyNotes({ bookOrder, chapter, selectedVerse, verseRange = null, enabled }: CommonParams) {
  const rangeFrom = verseRange?.from ?? null;
  const rangeTo = verseRange?.to ?? null;
  const study = useChapterData({ kind: "study", bookOrder, chapter, enabled, fetcher: fetchStudyContent });
  const verseNumbers = useChapterData({ kind: "verse-numbers", bookOrder, chapter, enabled, fetcher: fetchVerseNumbers });

  const footnotes = study.data?.footnotes ?? EMPTY_FOOTNOTES;
  const studyNotes = study.data?.studyNotes ?? EMPTY_STUDY_NOTES;
  const chapterVerseNumberById = useMemo(() => new Map(verseNumbers.data ?? []), [verseNumbers.data]);

  const panelFootnotes = useMemo(() => {
    const withVerse = footnotes.map((f) => ({ ...f, verse: chapterVerseNumberById.get(f.verseId) ?? null }));
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    return withVerse.filter((f) => inVerseScope(f.verse, selectedVerse, range));
  }, [footnotes, chapterVerseNumberById, selectedVerse, rangeFrom, rangeTo]);

  const panelStudyNotes = useMemo(() => {
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    return studyNotes.filter((n) => inVerseScope(n.verse, selectedVerse, range));
  }, [studyNotes, selectedVerse, rangeFrom, rangeTo]);

  return { footnotes: panelFootnotes, studyNotes: panelStudyNotes, studyLoading: study.loading || verseNumbers.loading };
}

export function useBibleChapterVideos({ bookOrder, chapter, selectedVerse, verseRange = null, enabled }: CommonParams) {
  const rangeFrom = verseRange?.from ?? null;
  const rangeTo = verseRange?.to ?? null;
  const { data, loading } = useChapterData({ kind: "videos", bookOrder, chapter, enabled, fetcher: fetchChapterVideos });
  const chapterVideos = data ?? EMPTY_VIDEOS;

  const panelVideos = useMemo(() => {
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    if (selectedVerse === null && !range) return chapterVideos;
    return chapterVideos.filter(
      (video) => video.verses.length === 0 || video.verses.some((verse) => inVerseScope(verse, selectedVerse, range))
    );
  }, [chapterVideos, selectedVerse, rangeFrom, rangeTo]);

  return { videos: panelVideos, videosLoading: loading };
}

export function useBibleResearchGuide({ bookOrder, chapter, selectedVerse, verseRange = null, enabled }: CommonParams) {
  const rangeFrom = verseRange?.from ?? null;
  const rangeTo = verseRange?.to ?? null;
  const { data, loading } = useChapterData({ kind: "guide", bookOrder, chapter, enabled, fetcher: fetchResearchGuide });
  const researchGuideEntries = data?.entries ?? EMPTY_GUIDE_ENTRIES;

  const panelResearchGuide = useMemo(() => {
    const range = rangeFrom !== null && rangeTo !== null ? { from: rangeFrom, to: rangeTo } : null;
    return researchGuideEntries.filter((entry) => inVerseScope(entry.verse, selectedVerse, range));
  }, [researchGuideEntries, selectedVerse, rangeFrom, rangeTo]);

  return {
    researchGuideEntries: panelResearchGuide,
    researchGuideExtracts: data?.extracts ?? EMPTY_GUIDE_EXTRACTS,
    researchGuideLoading: loading,
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
