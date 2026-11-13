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

export type WolQuery =
  | { kind: "lookup"; q: string; label: string }
  | { kind: "insight"; title: string };

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

/** "pág.", "págs.", "pp.", "p." before a number — WOL's own cards write it, its search box rejects it. */
const PAGE_WORD = /\b(?:p[áa]gs?|pp?)\.?\s*(?=\d)/gi;

const fold = (raw: string) => raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const P_DAY = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})\s+(\d{1,2}\/\d{1,2})\s+${PAGES}$`);
const P_MONTH_NUM = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})\.(\d{1,2})\s+${PAGES}$`);
const P_MONTH_NAME = new RegExp(String.raw`^(${PERIODICAL})\s?(\d{2})[\s.]+([a-z]{3,9})\.?\s+${PAGES}$`);
/** Magazines numbered per year: "g20 n. 1 pág. 4", "wp18 nº 2 3". */
const P_ISSUE_NUMBER = new RegExp(String.raw`^(g|wp)\s?(\d{2})\s+(?:n\.?|no\.?|n[º°]|numero)\s?(\d)\s+${PAGES}$`);

function parsePeriodical(text: string): { q: string; label: string } | null {
  const t = fold(text.replace(PAGE_WORD, ""));
  const compact = (pages: string) => pages.replace(/\s/g, "");

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

/** "[cap.|lição|p.] 3 [par. 2]" → what to append after the symbol, or null. */
function parseTail(tail: string): { wol: string; label: string } | null {
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

const MAX_CANDIDATES = 3;

export function parseWolQueries(raw: string): WolQuery[] {
  const original = raw.trim().replace(/\s+/g, " ");
  if (original.length < 3 || original.length > 80) return [];
  const text = original.replace(PAGE_WORD, "");
  const results: WolQuery[] = [];

  const periodical = parsePeriodical(original);
  if (periodical) return [{ kind: "lookup", q: periodical.q, label: periodical.label }];

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
