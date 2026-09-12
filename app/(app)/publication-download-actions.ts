"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptText } from "@/lib/encryption";
import { formatFileSize } from "@/lib/file-types";
import { FILES_BUCKET } from "@/lib/storage-config";

/**
 * Fetches a publication straight from JW.org and drops it into the user's own
 * library, for a `data-jwpub-pubref` citation that points at something not
 * already imported — the reader offers "Baixar" instead of a dead link (see
 * components/content/publication-download-vault.tsx).
 *
 * Three JW.org services chained together, all verified against the real
 * endpoints during this feature's design:
 *
 *  1. wol.jw.org's own "finder" redirect resolves a bare MepsDocumentId (the
 *     only thing a jwpub:// citation carries — see lib/jwpub/sanitize.ts) to
 *     that document's real article page. Citations never carry which
 *     publication they belong to; this is the only way to find out.
 *  2. That article page's own "which publication" link
 *     (`/wol/publication/r{region}/lp-{lang}/{symbol}/...`) names the exact
 *     symbol to download — scraped, not an documented API, so this step is
 *     the one most likely to need a fix if WOL's markup ever changes; it
 *     fails closed (a normal "não encontrada" error) rather than throwing.
 *  3. `GETPUBMEDIALINKS` (the same endpoint jw.org's own download buttons
 *     use) turns a symbol into a direct, checksummed file URL — this one
 *     part of the chain sends `access-control-allow-origin: *`, but the file
 *     host itself (step 4) sends none, which is why this whole thing has to
 *     run server-side rather than as a client-side fetch chain.
 */

const WOL_LANGUAGE = "T"; // wtlocale for Portuguese (Brasil) — matches the language every publication in this app is fetched in (see lib/video/video-crawler.ts, scripts/seed-*.mjs).

/** A safety ceiling, not a real-world limit — the largest legitimate citation target measured so far (a whole Bible course book) stays well under this. Guards against a pathological/unexpected API response, not normal use. */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

interface PubMediaLinksResponse {
  pubName?: string;
  files?: Record<string, { JWPUB?: { file?: { url?: string; checksum?: string }; filesize?: number }[] }>;
}

/** A handful of named HTML entities that show up in WOL page `<title>` text — not a general decoder, just what's actually been seen there. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

interface ResolvedPublication {
  /** The bare `pub=` value GETPUBMEDIALINKS wants — a periodical's year suffix is stripped here (see the `[year, month]` handling below), same normalization `lib/jwpub/ingest.ts` already does in the other direction for a note's own KeySymbol. */
  symbol: string;
  /** `{year}{month:02d}`, e.g. "201706" — only periodicals (Despertai!/A Sentinela) carry one; a book-form publication's `pub=` call needs none. */
  issue: string | null;
  title: string;
}

/**
 * Turns a bare `MepsDocumentId` (the only thing a `jwpub://p/T:{id}/…`
 * citation carries) into a downloadable publication, by following the same
 * link WOL's own article page shows for "which publication is this from":
 * `/wol/publication/r{region}/lp-{lang}/{symbol}/{year}/{month}/…` for a
 * periodical (verified: `g17/2017/6` → Despertai! issue 3 of 2017 — GETPUBMEDIALINKS
 * wants `pub=g&issue=201706`, not the year-suffixed `pub=g17` this URL itself
 * shows), or just `/…/{symbol}/…` for anything else (a book, a brochure).
 *
 * **Known gap**: a citation into Perspicaz (Insight) or another multi-volume
 * reference work doesn't carry this link at all — WOL points at a
 * `/library/.../estudo-perspicaz/c`-style slug instead, which names a
 * *section*, not a downloadable file's symbol. Resolving that would need a
 * small hand-built slug→symbol table (there are only a few such works); not
 * done here, so these return `null` and the caller shows a plain "não
 * encontrada" rather than guessing wrong.
 */
async function resolvePublicationSymbol(mepsDocumentId: number): Promise<ResolvedPublication | null> {
  try {
    // `redirect: "manual"` — a 307 here is the actual payload (the Location
    // header), not something to follow blindly into whatever JS the landing
    // page runs.
    const finderRes = await fetch(
      `https://wol.jw.org/wol/finder?wtlocale=${WOL_LANGUAGE}&docid=${mepsDocumentId}&srctype=link`,
      { redirect: "manual" }
    );
    const location = finderRes.headers.get("location");
    if (!location) return null;

    const articleUrl = new URL(location, "https://wol.jw.org").toString();
    const articleRes = await fetch(articleUrl);
    if (!articleRes.ok) return null;
    const html = await articleRes.text();

    const pubMatch = html.match(/\/wol\/publication\/r\d+\/lp-\w+\/([a-z0-9]+)(?:\/(\d{4})\/(\d{1,2}))?\//i);
    if (!pubMatch) return null;

    const [, rawSymbol, year, month] = pubMatch;
    let symbol = rawSymbol;
    let issue: string | null = null;
    if (year && month) {
      // "g17" → "g": the URL's own symbol carries the 2-digit year (matches
      // Publication.Symbol inside that periodical's own .jwpub — see
      // stripYearSuffix in lib/jwpub/ingest.ts for the identical pattern),
      // but GETPUBMEDIALINKS wants the undated symbol plus a separate issue.
      const yearSuffix = year.slice(2);
      if (symbol.toLowerCase().endsWith(yearSuffix)) symbol = symbol.slice(0, -yearSuffix.length);
      issue = `${year}${month.padStart(2, "0")}`;
    }

    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s*—\s*BIBLIOTECA.*$/i, "").trim() : "";

    return { symbol, issue, title };
  } catch {
    return null;
  }
}

async function fetchPubMediaLinks(symbol: string, issue: string | null): Promise<PubMediaLinksResponse | null> {
  try {
    const params = new URLSearchParams({
      output: "json",
      pub: symbol,
      fileformat: "JWPUB",
      alllangs: "0",
      langwritten: WOL_LANGUAGE,
      txtCMSLang: WOL_LANGUAGE,
    });
    if (issue) params.set("issue", issue);
    const res = await fetch(`https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?${params}`);
    if (!res.ok) return null;
    const json = await res.json();
    // The API answers 200 with a single-element error array (not a 4xx)
    // when the pub/issue combination doesn't exist — that shape has no
    // `files`, so treating it as "not found" downstream (see caller) already
    // does the right thing without special-casing it here.
    return Array.isArray(json) ? null : json;
  } catch {
    return null;
  }
}

export interface DownloadedPublication {
  noteId: string;
  storagePath: string;
  title: string;
}

/**
 * Resolves, downloads and stages one publication into the caller's own
 * library — everything up through creating the `notes` row and landing the
 * raw bytes in Storage. The client finishes the job with the normal
 * `getFileUrl` + `ingestJwpub` it already uses for a manually-uploaded file
 * (see hooks/use-publication-download.ts), so parsing itself — which needs
 * `DOMParser`/`sql.js`, unavailable here — never has to happen server-side.
 */
export async function downloadAndStagePublication(
  mepsDocumentId: number
): Promise<{ publication?: DownloadedPublication; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  if (!Number.isFinite(mepsDocumentId) || mepsDocumentId <= 0) {
    return { error: "Referência inválida." };
  }

  const resolved = await resolvePublicationSymbol(mepsDocumentId);
  if (!resolved) return { error: "Não foi possível identificar essa publicação no jw.org." };

  const links = await fetchPubMediaLinks(resolved.symbol, resolved.issue);
  const file = links?.files?.[WOL_LANGUAGE]?.JWPUB?.[0];
  if (!file?.file?.url) return { error: `"${resolved.symbol}" não está disponível para download.` };

  if (file.filesize && file.filesize > MAX_DOWNLOAD_BYTES) {
    return { error: "Essa publicação é grande demais para baixar automaticamente." };
  }

  let bytes: ArrayBuffer;
  try {
    const fileRes = await fetch(file.file.url);
    if (!fileRes.ok) return { error: "Não foi possível baixar o arquivo do jw.org." };
    bytes = await fileRes.arrayBuffer();
  } catch {
    return { error: "Não foi possível baixar o arquivo do jw.org." };
  }

  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    return { error: "Essa publicação é grande demais para baixar automaticamente." };
  }

  const fileName = `${resolved.symbol}.jwpub`;
  const storagePath = `${user.id}/${randomUUID()}-${fileName}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(FILES_BUCKET)
    .upload(storagePath, Buffer.from(bytes), { contentType: "application/octet-stream" });
  if (uploadError) return { error: "Não foi possível guardar o arquivo baixado." };

  const title = resolved.title || links?.pubName || fileName;
  const { data: row, error: dbError } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      type: "jwpub",
      title: encryptText(title),
      body: encryptText(formatFileSize(bytes.byteLength)),
      storage_path: storagePath,
    })
    .select("id")
    .single();

  if (dbError || !row) {
    await admin.storage.from(FILES_BUCKET).remove([storagePath]);
    return { error: "Não foi possível registrar a publicação baixada." };
  }

  return { publication: { noteId: row.id, storagePath, title } };
}
