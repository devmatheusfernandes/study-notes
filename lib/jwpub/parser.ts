"use client";

import { deriveJwpubKeys, decodeJwpubContent } from "./crypto";
import type {
  JwpubChapter,
  JwpubFootnote,
  JwpubBibleCitation,
  ParsedJwpub,
  JwpubPublicationMeta,
} from "./types";

/** `SQLite format 3\0` — how the inner database is identified, rather than trusting a filename. */
const SQLITE_MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg"]);

export interface ParseProgress {
  (stage: string, current?: number, total?: number): void;
}

function looksLikeSqlite(bytes: Uint8Array) {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  return SQLITE_MAGIC.every((byte, i) => bytes[i] === byte);
}

/** `jwpub-media://foo.jpg` → `foo.jpg`, in `src`/`href` attributes alike. */
export function collectMediaRefs(html: string): string[] {
  const refs = new Set<string>();
  const pattern = /jwpub-media:\/\/([^\s"'<>)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const name = decodeURIComponent(match[1]).split("/").pop();
    if (name) refs.add(name);
  }
  return [...refs];
}

/**
 * Reads a `.jwpub` archive end to end, in the browser.
 *
 * Takes a `Blob` rather than a `File` so the same code serves both the upload
 * path and the "reprocess from Storage" recovery path.
 */
export async function parseJwpub(file: Blob, onProgress?: ParseProgress): Promise<ParsedJwpub> {
  onProgress?.("Abrindo arquivo");

  // The heavy trio is only ever pulled in here — see lib/jwpub/ingest.ts.
  const [{ default: JSZip }, initSqlJs, { inflate }] = await Promise.all([
    import("jszip"),
    import("sql.js").then((m) => m.default),
    import("pako"),
  ]);

  const entries = new Map<string, import("jszip").JSZipObject>();
  let dbBytes: Uint8Array | null = null;

  async function harvest(zip: import("jszip")) {
    const candidates: import("jszip").JSZipObject[] = [];
    zip.forEach((relativePath, entry) => {
      if (entry.dir) return;
      const fileName = relativePath.split("/").pop()!;
      entries.set(fileName, entry);
      candidates.push(entry);
    });

    for (const entry of candidates) {
      if (dbBytes) break;
      const name = entry.name.split("/").pop()!.toLowerCase();
      // Skip the catalog/manifest sidecars — they're SQLite too, but not the content.
      if (name.includes("manifest") || name.includes("catalog")) continue;
      if (!name.endsWith(".db") && !name.includes("contents")) continue;

      const bytes = await entry.async("uint8array");
      if (looksLikeSqlite(bytes)) {
        dbBytes = bytes;
        break;
      }
      // A `contents` entry is often another zip wrapping the real payload.
      try {
        const inner = await JSZip.loadAsync(bytes);
        await harvest(inner);
      } catch {
        // Not a zip — nothing else to try for this entry.
      }
    }
  }

  const zip = await JSZip.loadAsync(file);
  await harvest(zip);

  if (!dbBytes) {
    throw new Error("Banco SQLite não encontrado dentro do .jwpub.");
  }

  onProgress?.("Lendo publicação");
  const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  const db = new SQL.Database(dbBytes);

  try {
    const meta = readPublicationMeta(db);
    const keys = await deriveJwpubKeys(meta);

    const chapters = await readChapters(db, keys, inflate, onProgress);
    const footnotes = await readFootnotes(db, keys, inflate);
    const bibleCitations = readBibleCitations(db);

    onProgress?.("Extraindo imagens");
    const media = await extractMedia(entries, chapters);

    return { ...meta, chapters, footnotes, media, bibleCitations };
  } finally {
    db.close();
  }
}

function readPublicationMeta(db: import("sql.js").Database): JwpubPublicationMeta {
  const res = db.exec(
    "SELECT Symbol, Title, MepsLanguageIndex, Year, IssueTagNumber FROM Publication LIMIT 1"
  );
  if (res.length === 0 || res[0].values.length === 0) {
    throw new Error("Tabela Publication vazia — arquivo .jwpub inválido.");
  }
  const [symbol, title, meps, year, issue] = res[0].values[0];
  return {
    symbol: symbol === null ? "" : String(symbol),
    title: title === null ? "" : String(title),
    mepsLanguageIndex: meps === null ? null : Number(meps),
    year: year === null ? null : Number(year),
    issueTagNumber: issue === null ? null : Number(issue),
  };
}

async function readChapters(
  db: import("sql.js").Database,
  keys: Awaited<ReturnType<typeof deriveJwpubKeys>>,
  inflate: (input: Uint8Array) => Uint8Array,
  onProgress?: ParseProgress
): Promise<JwpubChapter[]> {
  const res = db.exec("SELECT DocumentId, Title, Content FROM Document ORDER BY DocumentId");
  if (res.length === 0) return [];

  const rows = res[0].values;
  const chapters: JwpubChapter[] = [];

  for (let i = 0; i < rows.length; i++) {
    const [documentId, title, content] = rows[i];
    onProgress?.("Decodificando capítulos", i + 1, rows.length);

    const html =
      content instanceof Uint8Array
        ? await decodeJwpubContent(content, keys, inflate)
        : content === null
          ? ""
          : String(content);

    chapters.push({
      documentId: Number(documentId),
      position: i,
      title: title === null ? `Capítulo ${documentId}` : String(title),
      html,
      mediaRefs: collectMediaRefs(html),
    });
  }

  return chapters;
}

async function readFootnotes(
  db: import("sql.js").Database,
  keys: Awaited<ReturnType<typeof deriveJwpubKeys>>,
  inflate: (input: Uint8Array) => Uint8Array
): Promise<JwpubFootnote[]> {
  let res;
  try {
    res = db.exec("SELECT FootnoteId, Content FROM Footnote");
  } catch {
    return []; // Footnote table is optional.
  }
  if (res.length === 0) return [];

  const footnotes: JwpubFootnote[] = [];
  for (const [footnoteId, content] of res[0].values) {
    const html =
      content instanceof Uint8Array
        ? await decodeJwpubContent(content, keys, inflate)
        : content === null
          ? ""
          : String(content);
    footnotes.push({ footnoteId: Number(footnoteId), html });
  }
  return footnotes;
}

/**
 * Optional in the archive — only publications that actually cite scripture
 * carry a `BibleCitation` table. Verified against a real `.jwpub` (not
 * guessed): `Document.Content` anchors look like
 * `<a href="jwpub://b/NWTR/19:40:8-19:40:8" data-bid="1-1">` — the href
 * itself is just the human-readable book:chapter:verse range, informational
 * only. The actual join key back to `BibleCitation` is `data-bid="<BlockNumber>-<ElementNumber>"`
 * scoped to the *current* `DocumentId`, since block/element numbers repeat
 * across documents.
 *
 * `First`/`LastBibleVerseId` are the `BibleVerseId` scheme documented in
 * data/NWT_structure.md — they map onto `public.bible_verses.id` with zero
 * conversion. Keyed as `"<documentId>:<blockNumber>:<elementNumber>"`.
 */
function readBibleCitations(db: import("sql.js").Database): Map<string, JwpubBibleCitation> {
  const citations = new Map<string, JwpubBibleCitation>();

  let res;
  try {
    res = db.exec(
      "SELECT DocumentId, BlockNumber, ElementNumber, FirstBibleVerseId, LastBibleVerseId FROM BibleCitation"
    );
  } catch {
    return citations; // Table doesn't exist in this archive.
  }
  if (res.length === 0) return citations;

  for (const [documentId, blockNumber, elementNumber, first, last] of res[0].values) {
    if (documentId === null || blockNumber === null || elementNumber === null) continue;
    if (first === null || last === null) continue;
    citations.set(`${documentId}:${blockNumber}:${elementNumber}`, {
      firstVerseId: Number(first),
      lastVerseId: Number(last),
    });
  }

  return citations;
}

/** Only pulls out images the chapters actually reference — an archive carries plenty that nothing links to. */
async function extractMedia(
  entries: Map<string, import("jszip").JSZipObject>,
  chapters: JwpubChapter[]
): Promise<Map<string, Blob>> {
  const wanted = new Set(chapters.flatMap((c) => c.mediaRefs));
  const media = new Map<string, Blob>();

  for (const name of wanted) {
    const entry = entries.get(name);
    if (!entry) continue;
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    media.set(name, await entry.async("blob"));
  }

  return media;
}
