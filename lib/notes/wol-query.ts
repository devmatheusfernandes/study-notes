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

/** Periodical symbols WOL dates itself: "w05 1/6 16", "g88 8/12 10", "w24.11 9". */
const PERIODICAL = "w|wp|g|mwb|km|kmw|yb";

const PERIODICAL_WITH_DAY = new RegExp(
  `^(${PERIODICAL})\\s?(\\d{2})\\s+(\\d{1,2}\\/\\d{1,2})\\s+(?:p(?:ág)?\\.?\\s*)?(\\d{1,3}(?:\\s*-\\s*\\d{1,3})?)$`,
  "i"
);
const PERIODICAL_WITH_MONTH = new RegExp(
  `^(${PERIODICAL})\\s?(\\d{2})\\.(\\d{1,2})\\s+(?:p(?:ág)?\\.?\\s*)?(\\d{1,3}(?:\\s*-\\s*\\d{1,3})?)$`,
  "i"
);

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
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < 3 || text.length > 80) return [];
  const results: WolQuery[] = [];

  const day = PERIODICAL_WITH_DAY.exec(text);
  if (day) {
    const page = day[4].replace(/\s/g, "");
    return [
      {
        kind: "lookup",
        q: `${day[1].toLowerCase()}${day[2]} ${day[3]} ${page}`,
        label: `${day[1].toLowerCase()}${day[2]} ${day[3]} p. ${page}`,
      },
    ];
  }
  const month = PERIODICAL_WITH_MONTH.exec(text);
  if (month) {
    const page = month[4].replace(/\s/g, "");
    return [
      {
        kind: "lookup",
        q: `${month[1].toLowerCase()}${month[2]}.${month[3]} ${page}`,
        label: `${month[1].toLowerCase()}${month[2]}.${month[3]} p. ${page}`,
      },
    ];
  }

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
