/**
 * What part of a chapter the study tabs (notes, videos, research guide, highlights)
 * are about: one verse, a range of verses, or — with neither — the whole chapter.
 * A single selected verse wins over a range, so tapping a verse heading narrows a
 * passage further and "ver passagem" can return to it.
 */
export interface VerseRange {
  from: number;
  to: number;
}

/** Whether something attached to `verse` belongs in the current scope. */
export function inVerseScope(
  verse: number | null,
  selectedVerse: number | null,
  verseRange: VerseRange | null | undefined
): boolean {
  if (selectedVerse !== null) return verse === selectedVerse;
  if (verseRange) return verse !== null && verse >= verseRange.from && verse <= verseRange.to;
  return true;
}

/** The inclusive range a multi-verse passage covers, or null for a single verse, a lone superscription, or a passage that crosses chapters. */
export function verseRangeOf(
  verses: readonly { chapter: number; verse: number | null; isSuperscription?: boolean }[] | null
): VerseRange | null {
  if (!verses) return null;
  const real = verses.filter((v) => !v.isSuperscription && v.verse !== null);
  if (real.length < 2) return null;
  if (real.some((v) => v.chapter !== real[0].chapter)) return null;
  const numbers = real.map((v) => v.verse as number);
  return { from: Math.min(...numbers), to: Math.max(...numbers) };
}
