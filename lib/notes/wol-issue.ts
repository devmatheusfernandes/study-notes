/**
 * Pure helpers for listing the articles of one issue (or of a book) from WOL.
 *
 * A WOL search with no page ("w13 1/3", "g 8/08", "od") answers with one card
 * per document — the whole issue — but a card carries only the title and the
 * publication's name: no date and no page. The start page comes from the
 * article itself, where WOL prints a marker at every page break:
 * `<span id="page4" class="pageNum" data-no="4">`. The smallest `data-no`
 * inside `<article>` is the page the article starts on (checked on Sentinela
 * 2005/2013/2020, Despertai! 2008/2020, the Meeting Workbook and Perspicaz).
 */

export interface WolIssueCard {
  docId: number;
  title: string;
  /** The publication line under the title — "A Sentinela Anunciando o Reino de Jeová — 2013". */
  source: string;
}

function decode(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Titles that are navigation, not articles to cite. */
const NON_ARTICLE_TITLE = /^(sum[áa]rio|[íi]ndice|conte[úu]do)$/i;

/** The cards of a WOL search-results page, in WOL's own order, without repeats and without the table of contents. */
export function parseIssueCards(html: string): WolIssueCard[] {
  const cards: WolIssueCard[] = [];
  const seen = new Set<number>();
  for (const anchor of html.matchAll(/<a href="\/pt\/wol\/d\/r5\/lp-t\/(\d+)([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const docId = Number(anchor[1]);
    if (seen.has(docId)) continue;
    const body = anchor[3];
    const title = decode(/<div class="\s*cardLine1\s[^"]*">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? "");
    if (!title || NON_ARTICLE_TITLE.test(title)) continue;
    seen.add(docId);
    cards.push({
      docId,
      title,
      source: decode(/<div class="\s*cardLine2\s[^"]*">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? ""),
    });
  }
  return cards;
}

/** The page a WOL document starts on, or `undefined` when it prints no page markers (some books). */
export function startPageOf(documentHtml: string): number | undefined {
  const start = documentHtml.indexOf('<article id="article"');
  const end = documentHtml.indexOf("</article>", start);
  if (start === -1 || end === -1) return undefined;
  let first: number | undefined;
  for (const marker of documentHtml.slice(start, end).matchAll(/class="pageNum"[^>]*\bdata-no="(\d+)"/g)) {
    const page = Number(marker[1]);
    if (first === undefined || page < first) first = page;
  }
  return first;
}
