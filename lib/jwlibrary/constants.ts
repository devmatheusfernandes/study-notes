/**
 * Display-only fallback data for imported .jwlibrary content — used when a
 * note/highlight's KeySymbol doesn't resolve to an already-imported .jwpub
 * (see lib/jwlibrary/resolve.ts), so the UI can still show a readable
 * publication name instead of a bare symbol like "w" or "mwb".
 *
 * Adapted from a reference file the user supplied, trimmed to what this app
 * actually needs (no category/badge styling — this app has one theme).
 */

export const PUBLICATION_SYMBOLS: Record<string, { title: string; shortTitle: string }> = {
  w: { title: "The Watchtower", shortTitle: "Watchtower" },
  wp: { title: "The Watchtower (Public Edition)", shortTitle: "Watchtower (Public)" },
  ws: { title: "The Watchtower (Simplified)", shortTitle: "Watchtower (Simplified)" },
  g: { title: "Awake!", shortTitle: "Awake!" },
  mwb: { title: "Our Christian Life and Ministry Meeting Workbook", shortTitle: "Meeting Workbook" },
  km: { title: "Our Kingdom Ministry", shortTitle: "Kingdom Ministry" },
  nwt: { title: "New World Translation of the Holy Scriptures", shortTitle: "NWT Bible" },
  nwtsty: { title: "New World Translation of the Holy Scriptures (Study Edition)", shortTitle: "NWT Study Bible" },
  bi12: { title: "New World Translation of the Holy Scriptures (1984 Edition)", shortTitle: "NWT 1984" },
  rbi8: { title: "New World Translation of the Holy Scriptures (1984 Reference Bible)", shortTitle: "NWT 1984 Reference" },
  int: { title: "The Kingdom Interlinear Translation of the Greek Scriptures", shortTitle: "Kingdom Interlinear" },
  it: { title: "Insight on the Scriptures", shortTitle: "Insight on Scriptures" },
  cl: { title: "Draw Close to Jehovah", shortTitle: "Draw Close to Jehovah" },
  ia: { title: "Imitate Their Faith", shortTitle: "Imitate Their Faith" },
  jy: { title: "Jesus—The Way, the Truth, the Life", shortTitle: "Jesus—The Way" },
  bh: { title: "What Does the Bible Really Teach?", shortTitle: "Bible Teach" },
  od: { title: "Organized to Do Jehovah's Will", shortTitle: "Organized" },
  es: { title: "Examining the Scriptures Daily", shortTitle: "Daily Text" },
  yb: { title: "Yearbook of Jehovah's Witnesses", shortTitle: "Yearbook" },
};

export function getPublicationFallbackTitle(symbol: string | null | undefined): string {
  if (!symbol || !symbol.trim()) return "Nota geral";
  const clean = symbol.trim().toLowerCase();

  if (PUBLICATION_SYMBOLS[clean]) return PUBLICATION_SYMBOLS[clean].shortTitle;
  if (/^w\d+/i.test(clean)) return `A Sentinela (${symbol})`;
  if (/^g\d+/i.test(clean)) return `Despertai! (${symbol})`;
  if (/^mwb\d+/i.test(clean)) return `Apostila (${symbol})`;
  if (/^yb\d+/i.test(clean)) return `Anuário (${symbol})`;

  return symbol.toUpperCase();
}

/** JW Library's fixed 6-color highlight palette (UserMark.ColorIndex, 1-6). */
export const JWLIBRARY_HIGHLIGHT_COLORS: Record<number, { name: string; hex: string }> = {
  1: { name: "Amarelo", hex: "#e8c547" },
  2: { name: "Verde", hex: "#7cb87a" },
  3: { name: "Azul", hex: "#6fa8dc" },
  4: { name: "Rosa", hex: "#e08fa8" },
  5: { name: "Laranja", hex: "#e0975a" },
  6: { name: "Roxo", hex: "#a888c9" },
};
