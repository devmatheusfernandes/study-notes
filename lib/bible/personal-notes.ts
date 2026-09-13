import type { BibleVerseHighlight } from "@/app/(app)/jwlibrary-actions";
import type { BiblePersonalNote } from "@/components/content/bible-study-panel";

/**
 * Reshapes the chapter's highlights (see getBibleChapterHighlights) into the
 * study panel's "Pessoal" tab shape — the subset that has a note attached,
 * scoped to `selectedVerse` when one is set. Shared by bible-reader.tsx and
 * jwpub-bible-surface.tsx, which both already have a BibleVerseHighlight[] in
 * hand from the same action.
 */
export function toPersonalNotes(
  highlights: BibleVerseHighlight[],
  selectedVerse: number | null
): (BiblePersonalNote & { verse: number | null })[] {
  const withNotes = highlights
    .filter((h): h is typeof h & { note: NonNullable<(typeof h)["note"]> } => h.note !== null)
    .map((h) => ({
      id: h.note.id,
      title: h.note.title,
      content: h.note.content,
      userMarkId: h.colorIndex !== null ? h.id : null,
      colorIndex: h.colorIndex,
      verse: h.verse,
    }));
  return selectedVerse === null ? withNotes : withNotes.filter((n) => n.verse === selectedVerse);
}
