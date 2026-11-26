/**
 * Recognises references the "@" menu can resolve against WOL (wol.jw.org) for
 * publications the user hasn't downloaded: "w05 1/6 16", "bh cap. 3",
 * "Achegue-se a Jeová 10", "Perspicaz Criação".
 *
 * Pure and synchronous — it only decides whether the text LOOKS like one of
 * those shapes and builds the query string WOL's own search box understands
 * (`/wol/l/r5/lp-t?q=…`). The network call is `lookupWolReference`
 * (app/(app)/wol-lookup-actions.ts). Verified against the live endpoint:
 * WOL understands symbols, never titles, hence the catalog.
 */

import { WOL_CATALOG } from "./wol-catalog";

/**
 * A specific paragraph inside the cited page. `§N` counts on the page (and falls
 * back to the article's own numbering when the page has fewer); `par. N` is
 * always the article's numbering.
 */
export interface WolParagraph {
  n: number;
  scope: "page" | "article";
}

export type WolQuery =
  | { kind: "lookup"; q: string; label: string; para?: WolParagraph }
  | { kind: "insight"; title: string }
  /** A whole issue (or book) with no page: WOL answers with its articles, and the start page of each is read from the article itself. */
  | { kind: "issue"; q: string; label: string };

/** "… pág. 6 §1" / "… pág. 6 par. 17" → the text without it, plus what it asked for. Periodicals only. */
function splitParagraph(text: string): { text: string; para?: WolParagraph } {
  const m = /\s*(§|\bpar(?:[áa]grafos?)?\.?|\bpars\.)\s*(\d{1,3})$/i.exec(text);
  if (!m) return { text };
  return { text: text.slice(0, m.index), para: { n: Number(m[2]), scope: m[1] === "§" ? "page" : "article" } };
}

/** Periodical symbols WOL dates itself. */
const PERIODICAL = "w|wp|g|mwb|km|kmw|yb";
const PAGES = String.raw`(\d{1,3}(?:\s*-\s*\d{1,3})?)`;

/**
 * Month names/abbreviations as people write them — study editions and the
 * Meeting Workbook are cited by month ("w20 julho págs. 6-7"), and WOL itself
 * only takes the number form (`w20.07`) or an unaccented name, so everything
 * is folded to the number.
 */
const MONTHS: Record<string, string> = {
  janeiro: "01", jan: "01", fevereiro: "02", fev: "02", marco: "03", mar: "03", abril: "04", abr: "04",
  maio: "05", mai: "05", junho: "06", jun: "06", julho: "07", jul: "07", agosto: "08", ago: "08",
  setembro: "09", set: "09", outubro: "10", out: "10", novembro: "11", nov: "11", dezembro: "12", dez: "12",
};

/** "pág.", "págs.", "página", "pp.", "p." before a number — WOL's own cards write it, its search box rejects it. */
const PAGE_WORD = /\b(?:p[áa]g(?:ina)?s?|pp?)\.?\s*(?=\d)/gi;

const fold = (raw: string) => raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const P_DAY = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})\s+(\d{1,2}\/\d{1,2})\s+${PAGES}$`);
const P_MONTH_NUM = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})\.(\d{1,2})\s+${PAGES}$`);
const P_MONTH_NAME = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})[\s.]+([a-z]{3,9})\.?\s+${PAGES}$`);
/** Magazines numbered per year: "g20 n. 1 pág. 4", "wp18 nº 2 3". */
const P_ISSUE_NUMBER = new RegExp(String.raw`^(g|wp)\s?(\d{2})\s+(?:n\.?|no\.?|n[º°]|numero)\s?(\d)\s+${PAGES}$`);

const MONTH_NAME = String.raw`([a-z]{3,9})\.?`;

/** What people call the magazines, mapped to the symbol WOL knows them by. */
const PUBLICATION_NAMES: [RegExp, string][] = [
  [/^despertai(?=\s|$)/, "g"],
  [/^(?:a\s+)?sentinela(?=\s|$)/, "w"],
  [/^anuario(?=\s|$)/, "yb"],
];

/**
 * Folds the ways of writing a periodical's name and date onto the glued
 * "<symbol><yy> <month> <pages>" shape the patterns below expect:
 *   "despertai de 2008 agosto 10" → "g08 agosto 10"
 *   "g agosto 2008 10"            → "g08 agosto 10"
 *   "despertai 2020 n. 1 4"       → "g20 n. 1 4"
 */
function normalizePeriodicalText(folded: string): string {
  let s = folded.replace(/!/g, "");
  for (const [name, symbol] of PUBLICATION_NAMES) s = s.replace(name, symbol);
  s = s.replace(/\bde\b/g, " ").replace(/\s+/g, " ").trim();

  let m = new RegExp(String.raw`^(${PERIODICAL})\s+${MONTH_NAME}\s+(\d{4})(?:\s+(\d.*))?$`).exec(s);
  if (m) return `${m[1]}${m[3].slice(-2)} ${m[2]}${m[4] ? ` ${m[4]}` : ""}`;

  m = new RegExp(String.raw`^(${PERIODICAL})\s+(\d{4})\s+(.+)$`).exec(s);
  if (m) return `${m[1]}${m[2].slice(-2)} ${m[3]}`;

  // "yb 2013" → "yb13"
  m = new RegExp(String.raw`^(${PERIODICAL})\s+(\d{4})$`).exec(s);
  if (m) return `${m[1]}${m[2].slice(-2)}`;

  return s;
}

/**
 * Despertai! was one issue a month from 2006 to 2015 — neither dated by day
 * ("g88 8/12 10") nor numbered per year ("g20.1 4"). WOL files those under the
 * bare symbol and a month/year, "g 8/08 10" (verified live: it answers
 * "g 8/08 10", "g 8/2008 10" and "g agosto 2008 10", and answers nothing for
 * "g08 8/8 10", "g08.08 10" or "g08 agosto 10").
 */
const MONTHLY_AWAKE_FIRST_YEAR = 2006;
const MONTHLY_AWAKE_LAST_YEAR = 2015;

function parseMonthlyAwake(t: string): { q: string; label: string } | null {
  const compact = (pages: string) => pages.replace(/\s/g, "");
  const emit = (month: number, year: number, pages: string) => {
    if (year < MONTHLY_AWAKE_FIRST_YEAR || year > MONTHLY_AWAKE_LAST_YEAR || month < 1 || month > 12) return null;
    const yy = String(year % 100).padStart(2, "0");
    return { q: `g ${month}/${yy} ${pages}`, label: `g ${month}/${yy} p. ${pages}` };
  };
  const fullYear = (y: string) => (y.length === 4 ? Number(y) : 2000 + Number(y));

  // "g 8/08 10", "g 8/2008 10"
  let m = new RegExp(String.raw`^g\s?(\d{1,2})\/(\d{4}|\d{2})\s+${PAGES}$`).exec(t);
  if (m) return emit(Number(m[1]), fullYear(m[2]), compact(m[3]));

  // "g08 agosto 10" (what normalizePeriodicalText leaves for "despertai de 2008 agosto pagina 10")
  m = new RegExp(String.raw`^g\s?(\d{4}|\d{2})\s+${MONTH_NAME}\s+${PAGES}$`).exec(t);
  if (m && MONTHS[m[2]]) return emit(Number(MONTHS[m[2]]), fullYear(m[1]), compact(m[3]));

  return null;
}

function parsePeriodical(text: string): { q: string; label: string } | null {
  const t = normalizePeriodicalText(fold(text.replace(PAGE_WORD, "")));
  const compact = (pages: string) => pages.replace(/\s/g, "");

  const monthly = parseMonthlyAwake(t);
  if (monthly) return monthly;

  let m = P_DAY.exec(t);
  if (m) return { q: `${m[1]}${m[2]} ${m[3]} ${compact(m[4])}`, label: `${m[1]}${m[2]} ${m[3]} p. ${compact(m[4])}` };

  m = P_MONTH_NUM.exec(t);
  if (m) return { q: `${m[1]}${m[2]}.${m[3]} ${compact(m[4])}`, label: `${m[1]}${m[2]}.${m[3]} p. ${compact(m[4])}` };

  m = P_MONTH_NAME.exec(t);
  if (m && MONTHS[m[3]]) {
    return {
      q: `${m[1]}${m[2]}.${MONTHS[m[3]]} ${compact(m[4])}`,
      label: `${m[1]}${m[2]} ${m[3]} p. ${compact(m[4])}`,
    };
  }

  m = P_ISSUE_NUMBER.exec(t);
  if (m) return { q: `${m[1]}${m[2]}.${m[3]} ${compact(m[4])}`, label: `${m[1]}${m[2]} n. ${m[3]} p. ${compact(m[4])}` };

  return null;
}

/** keyword → how WOL wants it written. Plain page needs none. */
const KEYWORDS: Record<string, { wol: string; label: string }> = {
  cap: { wol: "cap.", label: "cap." },
  capitulo: { wol: "cap.", label: "cap." },
  licao: { wol: "lição", label: "lição" },
  p: { wol: "", label: "p." },
  pag: { wol: "", label: "p." },
  pagina: { wol: "", label: "p." },
};

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const bySymbol = new Map(WOL_CATALOG.map(([symbol, title]) => [symbol, title]));
const catalogIndex = WOL_CATALOG.map(([symbol, title]) => ({ symbol, title, norm: normalize(title) }));

/**
 * "631-638", "cap. 5 631-638", "cap 5 631": the pages say where, so a chapter
 * written before them is dropped — WOL's search box takes "jv 631-638" and
 * answers nothing for "jv cap. 5 631-638".
 */
function parsePageTail(folded: string): { wol: string; label: string } | null {
  const m = /^(?:(?:cap|capitulo|licao)\.?\s*\d{1,3}\s*[,;]?\s+(?:(?:paginas?|pags?|pp?)\.?\s*)?(\d{1,4})(?:\s*[-–—]\s*(\d{1,4}))?|(?:(?:paginas?|pags?|pp?)\.?\s*)?(\d{1,4})\s*[-–—]\s*(\d{1,4}))$/.exec(
    folded
  );
  if (!m) return null;
  const first = m[1] ?? m[3];
  const last = m[2] ?? m[4];
  if (last && Number(last) < Number(first)) return null;
  const pages = last ? `${first}-${last}` : first;
  return { wol: pages, label: `p. ${pages}` };
}

/** "[cap.|lição|p.] 3 [par. 2]" or a page range → what to append after the symbol, or null. */
function parseTail(tail: string): { wol: string; label: string } | null {
  const pages = parsePageTail(fold(tail.trim()));
  if (pages) return pages;
  const m = /^(?:(cap|capitulo|licao|p|pag|pagina)\.?\s*)?(\d{1,4})(?:\s*par(?:agrafo)?\.?\s*(\d{1,3}))?$/.exec(
    tail.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  );
  if (!m) return null;
  const kw = m[1] ? KEYWORDS[m[1]] : { wol: "", label: "p." };
  const para = m[3] ? ` par. ${m[3]}` : "";
  return {
    wol: [kw.wol, m[2], m[3] ? `par. ${m[3]}` : ""].filter(Boolean).join(" "),
    label: `${kw.label} ${m[2]}${para}`,
  };
}

/**
 * An issue named without a page — WOL lists its articles for these. Verified
 * against the live search box (what each form answers, and what it doesn't):
 *   "w13 1/3", "w13 15/3"      semi-monthly Watchtower (to 2015): needs the day
 *   "w20.07", "mwb20.07"       study edition / Meeting Workbook by month
 *   "g20.1", "wp18.2"          numbered per year (2016 on); "wp16.1" works, "wp13 1/3" does not
 *   "g 8/08", "km 5/08"        monthly Despertai! (2006–2015) and Our Kingdom Ministry
 *   "yb13", "od"               the Yearbook of a year; a book's whole table of contents
 * A bare month on a semi-monthly period names TWO issues, so both are returned.
 */
const fullYear = (yy: string) => (Number(yy) > 26 ? 1900 + Number(yy) : 2000 + Number(yy));

function issuesForMonth(symbol: string, yy: string, month: number, monthPadded: string): string[] {
  const year = fullYear(yy);
  const m = String(month);
  switch (symbol) {
    case "w":
      return year >= 2016 ? [`w${yy}.${monthPadded}`] : [`w${yy} 1/${m}`, `w${yy} 15/${m}`];
    case "wp":
      // Before 2016 the public Watchtower is the 1st-of-the-month issue of "w".
      return year >= 2016 ? [] : [`w${yy} 1/${m}`];
    case "mwb":
      return [`mwb${yy}.${monthPadded}`];
    case "km":
      return [`km ${m}/${yy}`];
    case "g":
      if (year >= MONTHLY_AWAKE_FIRST_YEAR && year <= MONTHLY_AWAKE_LAST_YEAR) return [`g ${m}/${yy}`];
      if (year < MONTHLY_AWAKE_FIRST_YEAR) return [`g${yy} 8/${m}`, `g${yy} 22/${m}`]; // twice a month until 2005
      return [];
    default:
      return [];
  }
}

function parseIssues(t: string): string[] {
  let m = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})\s+(\d{1,2}\/\d{1,2})$`).exec(t);
  if (m) return [`${m[1]}${m[2]} ${m[3]}`];

  m = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})\.(\d{1,2})$`).exec(t);
  if (m) return [`${m[1]}${m[2]}.${m[3]}`];

  m = new RegExp(String.raw`^(g|wp)\s?(\d{2})\s+(?:n\.?|no\.?|n[º°]|numero)\s?(\d)$`).exec(t);
  if (m) return [`${m[1]}${m[2]}.${m[3]}`];

  m = /^(g|km)\s?(\d{1,2})\/(\d{4}|\d{2})$/.exec(t);
  if (m) {
    const month = Number(m[2]);
    const yy = m[3].slice(-2);
    return month >= 1 && month <= 12 ? [`${m[1]} ${month}/${yy}`] : [];
  }

  m = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})[\s.]+${MONTH_NAME}$`).exec(t);
  if (m && MONTHS[m[3]]) return issuesForMonth(m[1], m[2], Number(MONTHS[m[3]]), MONTHS[m[3]]);

  m = /^yb\s?(\d{4}|\d{2})$/.exec(t);
  if (m) return [`yb${m[1].slice(-2)}`];

  return [];
}

const MAX_CANDIDATES = 3;

/** "631 a 633", "8 até 11", "8–11" → "8-11": a range is written with words as often as with a dash. */
const RANGE_WORD = /(\d)\s*(?:\s(?:a|à|ao|at[ée])\s|[–—])\s*(?:(?:p[áa]g(?:ina)?s?|pp?)\.?\s*)?(?=\d)/gi;

export function parseWolQueries(raw: string): WolQuery[] {
  const original = raw.trim().replace(/\s+/g, " ").replace(RANGE_WORD, "$1-");
  // A book's whole table of contents — an explicit exception to the length floor.
  if (/^od$/i.test(original)) return [{ kind: "issue", q: "od", label: "od" }];
  if (original.length < 3 || original.length > 80) return [];
  const text = original.replace(PAGE_WORD, "");
  const results: WolQuery[] = [];

  const withoutPara = splitParagraph(original);
  const periodical = parsePeriodical(withoutPara.text);
  if (periodical) {
    const { para } = withoutPara;
    const suffix = para ? (para.scope === "page" ? ` §${para.n}` : ` par. ${para.n}`) : "";
    return [{ kind: "lookup", q: periodical.q, label: periodical.label + suffix, ...(para ? { para } : {}) }];
  }

  // An issue with no page: "w13 março", "g agosto 2008", "w20.07", "yb13".
  const issues = parseIssues(normalizePeriodicalText(fold(text)));
  if (issues.length > 0) return issues.map((q) => ({ kind: "issue" as const, q, label: q }));

  // Perspicaz by article title: "perspicaz criação", "it-1 criação".
  const insight = /^(?:perspicaz|it(?:-[12])?)\s+(\p{L}[\p{L}\s,()'‘’-]{1,60})$/iu.exec(text);
  if (insight && !/^\d/.test(insight[1])) {
    results.push({ kind: "insight", title: insight[1].trim() });
  }

  // "<symbol> <tail>" — the symbol must be in the catalog, so "de 5" never fires.
  const symbolMatch = /^([a-z][a-z0-9-]{0,8})\s+(.+)$/i.exec(text);
  if (symbolMatch && bySymbol.has(symbolMatch[1].toLowerCase())) {
    const tail = parseTail(symbolMatch[2]);
    if (tail) {
      const symbol = symbolMatch[1].toLowerCase();
      results.push({
        kind: "lookup",
        q: `${symbol} ${tail.wol}`.trim(),
        label: `${bySymbol.get(symbol)} ${tail.label}`,
      });
    }
  }

  // "<title or prefix of a title> <tail>": split at the first token that starts a tail.
  const tokens = text.split(" ");
  for (let i = 1; i < tokens.length && results.length < MAX_CANDIDATES; i += 1) {
    const namePart = normalize(tokens.slice(0, i).join(" "));
    const tail = parseTail(tokens.slice(i).join(" "));
    if (!tail || namePart.length < 3) continue;
    const hits = catalogIndex.filter((entry) => entry.norm.startsWith(namePart));
    for (const hit of hits.slice(0, MAX_CANDIDATES)) {
      if (results.some((r) => r.kind === "lookup" && r.q.startsWith(`${hit.symbol} `))) continue;
      results.push({ kind: "lookup", q: `${hit.symbol} ${tail.wol}`.trim(), label: `${hit.title} ${tail.label}` });
      if (results.length >= MAX_CANDIDATES) break;
    }
    if (hits.length > 0) break;
  }

  return results.slice(0, MAX_CANDIDATES);
}
