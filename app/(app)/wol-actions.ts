"use server";

import { createClient } from "@/lib/supabase/server";
import { BIBLE_SEARCH_MIN_LENGTH } from "@/lib/bible/search-config";
import {
  WOL_ORIGIN,
  WOL_LANG_PATH,
  WOL_LIBRARY_PATH,
  isWolPath,
  parseWolArticle,
  parseWolSearchPage,
  wolUrl,
  type WolArticle,
  type WolSearchHit,
} from "@/lib/wol/parse";

export type { WolArticle, WolSearchHit };

/** WOL is somebody else's server — never let a slow answer hold a Server Action open indefinitely. */
const WOL_TIMEOUT_MS = 12_000;
const MAX_QUERY_LENGTH = 120;
const MAX_PAGE = 50;

async function requireSession(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user !== null;
}

/**
 * The "Biblioteca" results tab: a live search of wol.jw.org (Biblioteca
 * On-line), fetched server-side because the site sends `X-Frame-Options:
 * SAMEORIGIN` — it can't be embedded, and a browser `fetch()` is blocked by
 * CORS. The page is scraped into plain hits (see lib/wol/parse.ts) and the app
 * renders them itself.
 *
 * The host is fixed and the query is only ever a URL-encoded parameter, so
 * nothing the user types can steer this request to another server.
 */
export async function searchWol(
  query: string,
  page = 1
): Promise<{ hits?: WolSearchHit[]; hasMore?: boolean; error?: string }> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed.length < BIBLE_SEARCH_MIN_LENGTH) return { hits: [], hasMore: false };
  const pageNumber = Number.isInteger(page) ? Math.min(Math.max(page, 1), MAX_PAGE) : 1;

  if (!(await requireSession())) return { error: "Sessão expirada." };

  const params = new URLSearchParams({ q: trimmed, p: "par", r: "occ" });
  if (pageNumber > 1) {
    params.set("st", "g");
    params.set("pg", String(pageNumber));
  }

  try {
    const res = await fetch(`${WOL_ORIGIN}${WOL_LIBRARY_PATH}/s/${WOL_LANG_PATH}?${params}`, {
      signal: AbortSignal.timeout(WOL_TIMEOUT_MS),
    });
    if (!res.ok) return { error: "A Biblioteca On-line não respondeu." };
    const { hits, hasMore } = parseWolSearchPage(await res.text(), pageNumber);
    return { hits, hasMore };
  } catch {
    return { error: "Não foi possível buscar na Biblioteca On-line." };
  }
}

/** A "publication" or "topic" cross-reference has no content of its own: WOL answers with a page that meta-refreshes to the real document. */
const MAX_REDIRECTS = 3;

/**
 * One WOL page, rewritten for in-app reading — see `parseWolArticle`. `path` is
 * relative to `/pt/wol/` and must pass `isWolPath` (an allowlist), so this can
 * only ever fetch a document, a cross-reference or a Bible chapter of the
 * library — including every hop of a redirect, which is re-validated.
 */
export async function getWolArticle(path: string): Promise<{ article?: WolArticle; error?: string }> {
  if (typeof path !== "string" || !isWolPath(path)) return { error: "Documento inválido." };
  if (!(await requireSession())) return { error: "Sessão expirada." };

  try {
    let current = path;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(wolUrl(current), { signal: AbortSignal.timeout(WOL_TIMEOUT_MS) });
      if (!res.ok) return { error: "A Biblioteca On-line não respondeu." };
      const html = await res.text();

      const target = /http-equiv="refresh"[^>]*url='?(\/pt\/wol\/[^'"\s>]+)/i.exec(html)?.[1];
      if (target) {
        const next = target.slice("/pt/wol/".length);
        if (!isWolPath(next)) return { error: "Documento inválido." };
        current = next;
        continue;
      }

      const article = parseWolArticle(html, wolUrl(current));
      if (!article) return { error: "Não foi possível ler este documento." };
      return { article };
    }
    return { error: "Não foi possível ler este documento." };
  } catch {
    return { error: "Não foi possível abrir o documento na Biblioteca On-line." };
  }
}
