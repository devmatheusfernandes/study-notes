/**
 * The eight sections JW Library groups the Bible into, keyed by the same 1-66
 * `book_order` used throughout public.bible_verses.
 *
 * Expressed as ranges rather than a 66-entry map because the divisions are
 * contiguous by definition — the canon is ordered by section.
 */

export type BibleDivision =
  | "pentateuch"
  | "historical"
  | "poetic"
  | "prophetic"
  | "gospels"
  | "acts"
  | "letters"
  | "revelation";

const DIVISION_RANGES: { until: number; division: BibleDivision }[] = [
  { until: 5, division: "pentateuch" }, // Gênesis – Deuteronômio
  { until: 17, division: "historical" }, // Josué – Ester
  { until: 22, division: "poetic" }, // Jó – Cântico de Salomão
  { until: 39, division: "prophetic" }, // Isaías – Malaquias
  { until: 43, division: "gospels" }, // Mateus – João
  { until: 44, division: "acts" }, // Atos
  { until: 65, division: "letters" }, // Romanos – Judas
  { until: 66, division: "revelation" }, // Apocalipse
];

export function divisionForBook(bookOrder: number): BibleDivision {
  for (const range of DIVISION_RANGES) {
    if (bookOrder <= range.until) return range.division;
  }
  return "revelation";
}

/** Portuguese section names, for tooltips/labels. */
export const BIBLE_DIVISION_LABELS: Record<BibleDivision, string> = {
  pentateuch: "Pentateuco",
  historical: "Livros históricos",
  poetic: "Livros poéticos",
  prophetic: "Livros proféticos",
  gospels: "Evangelhos",
  acts: "Atos",
  letters: "Cartas",
  revelation: "Apocalipse",
};

/**
 * Written out in full rather than composed as `bg-bible-${division}` —
 * Tailwind scans source text for complete class names, so an interpolated one
 * would never be generated.
 */
export const BIBLE_DIVISION_BG: Record<BibleDivision, string> = {
  pentateuch: "bg-bible-pentateuch",
  historical: "bg-bible-historical",
  poetic: "bg-bible-poetic",
  prophetic: "bg-bible-prophetic",
  gospels: "bg-bible-gospels",
  acts: "bg-bible-acts",
  letters: "bg-bible-letters",
  revelation: "bg-bible-revelation",
};
