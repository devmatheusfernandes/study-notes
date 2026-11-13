"use server";

/**
 * Backs the "@" menu's "publicação não baixada" rows: resolves "w05 1/6 16" or
 * "bh cap. 3" through WOL's own search-box endpoint (`/wol/l/r5/lp-t?q=…`),
 * which answers with the article's card (`docId-…` is the MepsDocumentId the
 * `pubref` reference already carries), and Perspicaz titles through the
 * per-letter index pages.
 *
 * Never takes a URL from the client: the query is re-validated here and only
 * ever interpolated into the one WOL path, URL-encoded.
 */

import { createClient } from "@/lib/supabase/server";

export interface WolHit {
  mepsDocumentId: number;
  title: string;
  /** What the note shows: "Salvos, não só por obras… — A Sentinela 2005". */
  label: string;
  /** First paragraph of the cited range, when WOL names one. */
  pid?: string;
  /** The cited paragraphs themselves (sanitized on render), kept in the note so it opens offline without downloading the publication. */
  snapshot?: string;
}

/** Cap on what a note carries per citation — a page is a few KB; anything bigger is a whole article. */
const MAX_SNAPSHOT_CHARS = 24_000;

const WOL = "https://wol.jw.org/pt/wol";
const TIMEOUT_MS = 8000;
const SAFE_QUERY = /^[\p{L}\p{N}\s./\-]{2,80}$/u;

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

async function fetchWol(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; study-notes)" },
      next: { revalidate: 3600 },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function requireUser(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user);
}

/** One search-box query ("w05 1/6 16") → the article WOL opens for it. */
export async function lookupWolReference(q: string, label: string): Promise<{ hit?: WolHit; error?: string }> {
  if (!(await requireUser())) return { error: "Sessão expirada." };
  const query = q.trim();
  if (!SAFE_QUERY.test(query)) return { error: "Consulta inválida." };

  const html = await fetchWol(`${WOL}/l/r5/lp-t?q=${encodeURIComponent(query)}`);
  if (!html) return { error: "Sem resposta do WOL." };

  // The result is a card — `<li class="linkCard">` for a periodical page,
  // `<li class="row navCard">` for a book chapter — whose anchor carries the
  // MepsDocumentId, plus (for a page) a `#h=<firstParagraph>:…` range.
  const anchor = /<a href="\/pt\/wol\/d\/r5\/lp-t\/(\d+)([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
  if (!anchor) return { error: "Não encontrei essa página no WOL." };
  const docId = anchor[1];
  const card = anchor[3];

  const title = decode(/<div class="\s*cardLine1\s[^"]*">([\s\S]*?)<\/div>/.exec(card)?.[1] ?? "");
  const source = decode(/<div class="\s*cardLine2\s[^"]*">([\s\S]*?)<\/div>/.exec(card)?.[1] ?? "");
  const range = /#h(?:=|&#x3D;)(\d+):\d+-(\d+):/.exec(anchor[2]);
  const pid = range?.[1];
  const snapshot = range ? await fetchSnapshot(Number(docId), Number(range[1]), Number(range[2])) : undefined;

  return {
    hit: {
      mepsDocumentId: Number(docId),
      title: title || label,
      label: title && source ? `${title} — ${source}` : label,
      pid,
      snapshot,
    },
  };
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Perspicaz article by (part of) its title, from the A–Z index page of its first letter. */
export async function lookupPerspicazTitle(title: string): Promise<{ hits?: WolHit[]; error?: string }> {
  if (!(await requireUser())) return { error: "Sessão expirada." };
  const needle = normalize(title);
  const letter = needle[0];
  if (needle.length < 2 || !letter || !/[a-z]/.test(letter)) return { hits: [] };

  const html = await fetchWol(
    `${WOL}/library/r5/lp-t/todas-as-publica%C3%A7%C3%B5es/estudo-perspicaz/${letter}`
  );
  if (!html) return { error: "Sem resposta do WOL." };

  const hits: WolHit[] = [];
  for (const m of html.matchAll(/<a href="\/pt\/wol\/d\/r5\/lp-t\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const text = decode(m[2]);
    if (!text || !normalize(text).startsWith(needle)) continue;
    hits.push({ mepsDocumentId: Number(m[1]), title: text, label: `${text} — Perspicaz` });
    if (hits.length >= 5) break;
  }
  return { hits };
}

const MAX_ARTICLE_CHARS = 600_000;

/**
 * The text of one WOL document, for a `pubref` whose publication isn't in the
 * library — so the panel can show the cited article right away instead of
 * requiring a download first. Links are flattened to plain text (they are
 * relative to wol.jw.org and would 404 inside this app); the caller still runs
 * `sanitizeChapterHtml` before rendering.
 */
export async function getWolArticle(mepsDocumentId: number): Promise<{ title?: string; html?: string; error?: string }> {
  if (!(await requireUser())) return { error: "Sessão expirada." };
  if (!Number.isInteger(mepsDocumentId) || mepsDocumentId < 1) return { error: "Documento inválido." };

  const page = await fetchWol(`${WOL}/d/r5/lp-t/${mepsDocumentId}`);
  if (!page) return { error: "Não foi possível carregar do WOL." };

  const start = page.indexOf('<article id="article"');
  const end = page.indexOf("</article>", start);
  if (start === -1 || end === -1) return { error: "Conteúdo não encontrado no WOL." };

  let html = page.slice(start, end + "</article>".length);
  if (html.length > MAX_ARTICLE_CHARS) html = html.slice(0, MAX_ARTICLE_CHARS);
  html = html
    .replace(/<a\b[^>]*>/gi, "<span>")
    .replace(/<\/a>/gi, "</span>")
    .replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, "");

  const title = decode(/<(?:p|h1)\b[^>]*class="(?:st|title)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|h1)>/.exec(html)?.[1] ?? "");
  return { title: title || undefined, html };
}

/** Flattens links (they'd point at wol.jw.org paths) and drops anything that isn't text. */
function flattenArticleHtml(html: string): string {
  return html
    .replace(/<a\b[^>]*>/gi, "<span>")
    .replace(/<\/a>/gi, "</span>")
    .replace(/<(script|style|iframe)\b[\s\S]*?<\/\1>/gi, "");
}

/** The paragraphs `first`…`last` (by data-pid) of one WOL document, in document order. */
async function fetchSnapshot(docId: number, first: number, last: number): Promise<string | undefined> {
  if (!Number.isInteger(docId) || last < first || last - first > 60) return undefined;
  const page = await fetchWol(`${WOL}/d/r5/lp-t/${docId}`);
  if (!page) return undefined;
  const start = page.indexOf('<article id="article"');
  const end = page.indexOf("</article>", start);
  if (start === -1 || end === -1) return undefined;

  const parts: string[] = [];
  for (const m of page.slice(start, end).matchAll(/<(p|h[1-6]|li)\b[^>]*\bdata-pid="(\d+)"[^>]*>[\s\S]*?<\/\1>/g)) {
    const pid = Number(m[2]);
    if (pid >= first && pid <= last) parts.push(m[0]);
  }
  if (parts.length === 0) return undefined;
  const html = flattenArticleHtml(parts.join("\n"));
  return html.length > MAX_SNAPSHOT_CHARS ? undefined : html;
}
