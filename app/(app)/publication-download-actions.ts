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
 *  2. That article page's own `<article … docId-{id} pub-{symbol} …>` names
 *     the exact publication to download, plus — for a periodical — the
 *     issue's library path, which is where the `issue=` value comes from
 *     (see resolvePublicationSymbol). Scraped, not a documented API, so this
 *     step is the one most likely to need a fix if WOL's markup ever
 *     changes; it fails closed (a normal "não encontrada" error) rather
 *     than throwing.
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

/** One `pub=`/`issue=` pair to try against GETPUBMEDIALINKS, in order. */
interface PubMediaCandidate {
  pub: string;
  issue: string | null;
}

interface ResolvedPublication {
  /** The publication's own symbol, exactly as WOL labels the document (`lc`, `it-1`, `g88`, `wp19`). */
  symbol: string;
  candidates: PubMediaCandidate[];
  title: string;
}

/** Portuguese month names as they appear in a WOL library slug. The whole app is `wtlocale=T` only (see WOL_LANGUAGE), so there's no other locale to handle. */
const SLUG_MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  "março": 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const PUBLIC_EDITION_SLUGS = ["edição-para-o-público", "edicao-para-o-publico"];
const STUDY_EDITION_SLUGS = ["edição-de-estudo", "edicao-de-estudo"];

/**
 * `g88` → `g`, `wp19` → `wp`, `it-1` → `it-1`.
 *
 * Only a trailing 2-digit year is stripped, and only from an otherwise
 * all-letter symbol — the same normalization stripYearSuffix in
 * lib/jwpub/ingest.ts does in the other direction, for the same reason:
 * GETPUBMEDIALINKS keys a periodical by its undated symbol plus a separate
 * `issue`, while WOL labels the document with the dated one.
 */
function undatedSymbol(symbol: string): string {
  const match = /^([a-z]+)(\d{2})$/.exec(symbol);
  return match ? match[1] : symbol;
}

/**
 * Turns the WOL library path of a periodical issue into the `issue=` value
 * GETPUBMEDIALINKS wants. Verified against the real slugs:
 *   .../despertai/despertai-1988/8-de-dezembro              → 19881208
 *   .../a-sentinela/a-sentinela-2015/edição.../1-de-junho   → 20150601
 *   .../despertai/despertai-2021/n-3                        → 202103
 *   .../despertai/despertai-2015/outubro                    → 201510
 */
function issueFromLibraryPath(path: string): string | null {
  const segments = path.split("/").map((s) => s.toLowerCase());
  const yearIndex = segments.findIndex((s) => /-(?:19|20)\d{2}$/.test(s));
  if (yearIndex === -1) return null;
  const year = segments[yearIndex].slice(-4);

  const rest = segments
    .slice(yearIndex + 1)
    .filter((s) => !PUBLIC_EDITION_SLUGS.includes(s) && !STUDY_EDITION_SLUGS.includes(s));
  const last = rest[rest.length - 1];
  if (!last) return null;

  const dayMonth = /^(\d{1,2})-de-(.+)$/.exec(last);
  if (dayMonth && SLUG_MONTHS[dayMonth[2]]) {
    return `${year}${String(SLUG_MONTHS[dayMonth[2]]).padStart(2, "0")}${dayMonth[1].padStart(2, "0")}`;
  }
  if (SLUG_MONTHS[last]) return `${year}${String(SLUG_MONTHS[last]).padStart(2, "0")}`;
  const numbered = /^n-(\d{1,2})$/.exec(last);
  if (numbered) return `${year}${numbered[1].padStart(2, "0")}`;
  // "novembro-dezembro" and friends — the issue is filed under the first month.
  const firstOfRange = /^([a-zà-ú]+)-[a-zà-ú]+$/.exec(last);
  if (firstOfRange && SLUG_MONTHS[firstOfRange[1]]) {
    return `${year}${String(SLUG_MONTHS[firstOfRange[1]]).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Turns a bare `MepsDocumentId` (the only thing a `jwpub://p/T:{id}/…`
 * citation carries) into one or more `pub=`/`issue=` pairs to try.
 *
 * The publication is read off WOL's own article element, which names it
 * unambiguously:
 *
 *   <article id="article" class="… docId-1102010234 pub-lc … ">
 *
 * This replaced scraping the page for a `/wol/publication/r5/lp-t/{symbol}/…`
 * link, which was the original approach and was **wrong most of the time**:
 * every WOL article page carries a "publicações relacionadas" rail whose
 * thumbnails use that exact URL shape, and the first match in the document
 * was almost always one of those, not the article's own publication.
 * Measured against 40 real citations from the Research Guide, that made the
 * download button fetch an unrelated publication (Gênesis-era Despertai! 1988
 * resolved to Despertai! 2021, "Toda a Escritura" to the plain Bible, and so
 * on) far more often than it fetched the right one. Reading `pub-` straight
 * off `docId-`'s own element resolved all 40 correctly.
 *
 * A periodical then needs an `issue=` on top of the symbol, which the page
 * does NOT carry numerically — it comes from the issue's own library path in
 * `#publicationNavigation` (see issueFromLibraryPath).
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

    const symbolMatch = /docId-\d+\s+pub-([A-Za-z0-9-]+)/.exec(html);
    if (!symbolMatch) return null;
    const symbol = symbolMatch[1].toLowerCase();

    const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s*—\s*BIBLIOTECA.*$/i, "").trim() : "";

    // The issue's own path, e.g.
    // "todas-as-publicações/a-sentinela/a-sentinela-2015/edição-para-o-público/1-de-junho".
    let issue: string | null = null;
    let isPublicEdition = false;
    let isStudyEdition = false;
    for (const match of html.matchAll(/\/wol\/library\/r\d+\/lp-[a-z]+\/([^"'\s]+)/g)) {
      const path = decodeURIComponent(match[1]);
      const parsed = issueFromLibraryPath(path);
      if (!parsed) continue;
      issue = parsed;
      const lower = path.toLowerCase();
      isPublicEdition = PUBLIC_EDITION_SLUGS.some((s) => lower.includes(s));
      isStudyEdition = STUDY_EDITION_SLUGS.some((s) => lower.includes(s));
      break;
    }

    const candidates: PubMediaCandidate[] = [{ pub: symbol, issue: null }];
    if (issue) {
      const base = undatedSymbol(symbol);
      // A Watchtower issue from before the 2016 symbol split is filed under
      // "w" for the study edition and "wp" for the public one, while WOL
      // labels BOTH "w{yy}" — verified: 1/10/2012 (public) is only reachable
      // as pub=wp, 15/10/2012 (study) only as pub=w.
      if (base === "w" && isPublicEdition) candidates.push({ pub: "wp", issue });
      if (base === "wp" && isStudyEdition) candidates.push({ pub: "w", issue });
      candidates.push({ pub: base, issue });
      if (base !== symbol) candidates.push({ pub: symbol, issue });
    }

    return { symbol, candidates, title };
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

  // Each candidate is one plausible `pub=`/`issue=` spelling of the same
  // publication (see resolvePublicationSymbol) — GETPUBMEDIALINKS answers a
  // wrong one with a 400/404, so the first that comes back with a file wins.
  let links: PubMediaLinksResponse | null = null;
  let file: NonNullable<NonNullable<PubMediaLinksResponse["files"]>[string]["JWPUB"]>[number] | undefined;
  for (const candidate of resolved.candidates) {
    links = await fetchPubMediaLinks(candidate.pub, candidate.issue);
    file = links?.files?.[WOL_LANGUAGE]?.JWPUB?.[0];
    if (file?.file?.url) break;
    file = undefined;
  }
  if (!file?.file?.url) return { error: `"${resolved.symbol}" não está disponível para download.` };

  if (file.filesize && file.filesize > MAX_DOWNLOAD_BYTES) {
    // Named, because the one publication that routinely trips this is
    // Perspicaz (~338 MB) and "grande demais" alone reads like a bug.
    return {
      error: `Essa publicação tem ${formatFileSize(file.filesize)} — grande demais para baixar automaticamente.`,
    };
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
