import { parseBibleReference } from "@/lib/bible/parse-reference";

/**
 * Pure HTML → data helpers for wol.jw.org (Biblioteca On-line). Regex-based on
 * purpose, not a DOM parser: this runs in a Server Action, where `DOMParser`
 * doesn't exist and jsdom is a devDependency — the same reason lib/note-images.ts
 * parses with regexes. WOL's markup is machine-generated and very regular, and
 * everything here is verified against real responses (search page for "mansos",
 * article 1200002959, Bible book 1001061123).
 *
 * The output is still untrusted third-party HTML: the client runs it through
 * `sanitizeChapterHtml` before it reaches the DOM, exactly like Perspicaz.
 */

export const WOL_ORIGIN = "https://wol.jw.org";
/** `r5/lp-t` is WOL's own code for Portuguese (Brazil). */
export const WOL_LIBRARY_PATH = "/pt/wol";
export const WOL_LANG_PATH = "r5/lp-t";

/** Match markers, swapped for `<mark>` only after escaping — same scheme as bible-search-actions.ts. */
const MARK_START = "\u0001";
const MARK_END = "\u0002";

export interface WolSearchHit {
  docId: number;
  title: string;
  /** "13 ocorrências", as WOL words it. */
  count: string | null;
  /** Already-escaped HTML with `<mark>` around the matched words. */
  headline: string;
  /** Where the document comes from — "w19 fevereiro págs. 8-13 - A Sentinela (Estudo) — 2019". */
  source: string | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
  hellip: "…",
  ndash: "–",
  mdash: "—",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toPlainText(html: string): string {
  return collapse(decodeEntities(html.replace(/<[^>]*>/g, " ")));
}

/** A result snippet's `<span class="mk">` wrappers become markers, everything else is flattened to text. */
function snippetToHighlightedHtml(snippetHtml: string): string {
  const marked = snippetHtml
    // WOL separates the excerpts of one document with a bold "..." — an ellipsis
    // in its own right, which the punctuation clean-up below must not glue on.
    .replace(/<strong>\s*\.\.\.\s*<\/strong>/g, " … ")
    .replace(
    /<span\b[^>]*\bclass="mk"[^>]*>([\s\S]*?)<\/span>/g,
    (_match, inner: string) => `${MARK_START}${inner.replace(/<[^>]*>/g, "")}${MARK_END}`
  );
  const text = collapse(decodeEntities(marked.replace(/<[^>]*>/g, " ")))
    // Stripping tags leaves a space either side of each marker's edge.
    .replace(new RegExp(`${MARK_START} `, "g"), MARK_START)
    .replace(new RegExp(` ${MARK_END}`, "g"), MARK_END)
    // Same for punctuation that tag-stripping pulled away from its neighbour: "( Sal. 37:11 )", "Mansos ’".
    .replace(/ (?=[,.;:!?)\]’”]|\u0002[’”)])/g, "")
    .replace(/(?<=[(\[‘“]) /g, "");
  return escapeHtml(text).split(MARK_START).join("<mark>").split(MARK_END).join("</mark>");
}

/**
 * One page of `wol.jw.org/pt/wol/s/r5/lp-t?q=…&pg=N`. `hasMore` is whether the
 * page's own pager links to `pg=N+1`.
 */
export function parseWolSearchPage(html: string, page: number): { hits: WolSearchHit[]; hasMore: boolean } {
  const hits: WolSearchHit[] = [];
  const chunks = html.split('<li class="caption">').slice(1);

  for (const chunk of chunks) {
    const docId = /\bdocId-(\d+)\b/.exec(chunk)?.[1] ?? /\/wol\/d\/[^/]+\/[^/]+\/(\d+)/.exec(chunk)?.[1];
    // The same document can be listed twice in one page (one caption per
    // matching section) — one card each is enough, and React needs unique keys.
    if (!docId || hits.some((hit) => hit.docId === Number(docId))) continue;

    const title = toPlainText(/<a\b[^>]*class="lnk"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)?.[1] ?? "");
    const count = toPlainText(/<span\b[^>]*class="count"[^>]*>([\s\S]*?)<\/span>/.exec(chunk)?.[1] ?? "") || null;

    const snippets = [...chunk.matchAll(/<div class="document">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    const headline = snippetToHighlightedHtml(snippets.slice(0, 2).join(" … "));

    const source = toPlainText(/<li class="ref">([\s\S]*?)<\/li>/.exec(chunk)?.[1] ?? "") || null;

    hits.push({ docId: Number(docId), title: title || source || `Documento ${docId}`, count, headline, source });
  }

  // The pager's hrefs are HTML-escaped, so the separator is `&amp;`, not `&`.
  const hasMore = new RegExp(`[?&;]pg=${page + 1}\\b`).test(html);
  return { hits, hasMore };
}

/** Bytes of article HTML sent to the client. A whole Bible book is 1.4 MB; nobody reads that inside a search result. */
const MAX_ARTICLE_HTML_LENGTH = 400_000;

export interface WolArticle {
  title: string;
  /** Rewritten but NOT sanitized — see the file comment. */
  html: string;
  /** True when the document was cut at `MAX_ARTICLE_HTML_LENGTH`. */
  truncated: boolean;
  /** The article's own page on wol.jw.org, for "Abrir no WOL". */
  url: string;
}

/**
 * A WOL page is addressed by its path under `/pt/wol/` — "d/r5/lp-t/2019282" (a
 * document), "pc/…" and "tc/…" (a publication / topic cross-reference, which WOL
 * answers with a redirect to a document), "b/…" (a Bible chapter). Nothing else
 * is ever fetched: this is the allowlist for what a link inside an article, or a
 * Server Action argument, may point at.
 */
const WOL_PATH_PATTERN = /^(?:d|pc|tc|b)\/r5\/lp-t\/[0-9A-Za-z_\-/]+$/;

export function isWolPath(path: string): boolean {
  return WOL_PATH_PATTERN.test(path) && !path.includes("..");
}

export function wolDocPath(docId: number): string {
  return `d/${WOL_LANG_PATH}/${docId}`;
}

export function wolUrl(path: string): string {
  return `${WOL_ORIGIN}${WOL_LIBRARY_PATH}/${path}`;
}

/** The `/pt/wol/…` path a link's href names, if it is one the reader can open. */
function wolPathFromHref(href: string): string | null {
  const match = /^\/pt\/wol\/([^?#]+)/.exec(href);
  return match && isWolPath(match[1]) ? match[1] : null;
}

/**
 * Links are rewritten so nothing inside an article can navigate away from the
 * app (a relative `/pt/wol/…` href would resolve against OUR origin):
 *   - a page the reader can open (another document, a publication or topic
 *     cross-reference, a Bible chapter) → data-wol-path="<path>", see `isWolPath`
 *   - a Bible reference ("Sal. 37:11", `class="b"`) → data-wol-verse="<book>:<chapter>:<verse>",
 *     resolved from the link text with the app's own reference parser rather
 *     than WOL's `data-bid`, which is a block id, not a verse
 *   - anything else               → href dropped, text kept
 * Relative image sources become absolute so they load from WOL directly.
 */
function rewriteArticleLinks(html: string): string {
  const withLinks = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (_match, attrs: string, inner: string) => {
    const href = /\bhref="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const isBibleRef = /\bclass="[^"]*\bb\b[^"]*"/.test(attrs);

    if (isBibleRef) {
      const parsed = parseBibleReference(toPlainText(inner));
      if (parsed) {
        return `<a data-wol-verse="${parsed.bookOrder}:${parsed.chapter}:${parsed.startVerse ?? 0}">${inner}</a>`;
      }
    }

    const path = wolPathFromHref(href);
    if (path) return `<a data-wol-path="${path}">${inner}</a>`;

    return `<a>${inner}</a>`;
  });

  return withLinks.replace(/(<img\b[^>]*?\bsrc=")(\/[^"]*)"/g, `$1${WOL_ORIGIN}$2"`);
}

/** The `<article id="article">` of a WOL page; `url` is the page it came from, kept for "Abrir no WOL". */
export function parseWolArticle(html: string, url: string): WolArticle | null {
  const start = html.indexOf('<article id="article"');
  if (start < 0) return null;
  const openEnd = html.indexOf(">", start);
  const end = html.indexOf("</article>", openEnd);
  if (openEnd < 0 || end < 0) return null;

  let inner = html.slice(openEnd + 1, end);
  const title =
    toPlainText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(inner)?.[1] ?? "") ||
    toPlainText(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? "").replace(/\s*—.*$/, "") ||
    "Documento";

  let truncated = false;
  if (inner.length > MAX_ARTICLE_HTML_LENGTH) {
    // Cut at a paragraph boundary so the tail isn't a half-open tag.
    const cut = inner.lastIndexOf("</p>", MAX_ARTICLE_HTML_LENGTH);
    inner = inner.slice(0, cut > 0 ? cut + 4 : MAX_ARTICLE_HTML_LENGTH);
    truncated = true;
  }

  return { title, html: rewriteArticleLinks(inner), truncated, url };
}
