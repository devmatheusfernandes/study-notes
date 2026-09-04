/**
 * Reads a `.jwlibrary` backup — server-side (Node), not in the browser.
 *
 * Unlike `.jwpub`, `userData.db` isn't encrypted (confirmed in
 * data/jwlibrary_schema.md), so there's no reason to pay the "parse in the
 * browser" cost `lib/jwpub/parser.ts` pays for `crypto.subtle`. The file is
 * already sitting in Storage after the normal upload, so this runs in
 * app/(app)/jwlibrary/ingest/route.ts against bytes downloaded server-side.
 *
 * Known simplification: a pending WAL (`userData.db-wal`/`-shm`, only present
 * if the backup was made without a clean checkpoint) is NOT applied — sql.js's
 * public API has no supported way to attach a WAL sidecar file to a
 * byte-buffer-constructed Database (verified against its type definitions,
 * no `FS`/path-based open is exposed). We just read `userData.db` as committed.
 * In practice a real "Export" from JW Library's own backup menu already
 * checkpoints, so this only misses very-recently-changed data from a raw
 * copy of the app's data directory, not a normal export.
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import type {
  ParsedJwlibrary,
  JwlibraryLocation,
  JwlibraryNote,
  JwlibraryUserMark,
  JwlibraryBlockRange,
  JwlibraryTag,
  JwlibraryTagMap,
  JwlibraryBookmark,
  JwlibraryInputField,
} from "./types";

function toNum(v: SqlValue): number | null {
  return v === null || v === undefined ? null : Number(v);
}
function toStr(v: SqlValue): string | null {
  return v === null || v === undefined ? null : String(v);
}

function rowsToObjects(res: ReturnType<Database["exec"]>): Record<string, SqlValue>[] {
  if (res.length === 0) return [];
  const { columns, values } = res[0];
  return values.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function readLocation(row: Record<string, SqlValue>): JwlibraryLocation {
  return {
    bookNumber: toNum(row.BookNumber),
    chapterNumber: toNum(row.ChapterNumber),
    keySymbol: toStr(row.KeySymbol),
    mepsLanguage: toNum(row.MepsLanguage),
    issueTagNumber: toNum(row.IssueTagNumber),
    mepsDocumentId: toNum(row.DocumentId),
    track: toNum(row.Track),
    locationType: toNum(row.Type),
  };
}

const LOCATION_SELECT =
  "l.BookNumber, l.ChapterNumber, l.KeySymbol, l.MepsLanguage, l.IssueTagNumber, l.DocumentId, l.Track, l.Type";

/**
 * sql.js's default wasm auto-locate logic resolves a path relative to its
 * own bundled location, which breaks once this module runs inside Next's
 * server bundle (Turbopack rewrites `__dirname` to a virtual path — observed
 * as a literal nonexistent "C:\ROOT\..." at runtime). Reusing the same
 * `public/sql-wasm.wasm` the browser-side jwpub parser already ships (see
 * lib/jwpub/parser.ts) sidesteps the whole path-resolution problem: read the
 * real bytes ourselves via `process.cwd()`, which is stable at runtime
 * regardless of how the module got bundled.
 */
async function loadSqlJs() {
  const raw = fs.readFileSync(path.join(process.cwd(), "public", "sql-wasm.wasm"));
  const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return initSqlJs({ wasmBinary });
}

export async function parseJwlibrary(zipBytes: Uint8Array): Promise<ParsedJwlibrary> {
  const zip = await JSZip.loadAsync(zipBytes);

  const manifestEntry = zip.file("manifest.json");
  const manifest = manifestEntry ? JSON.parse(await manifestEntry.async("text")) : {};
  const backup = manifest.userDataBackup ?? {};

  const dbEntry =
    (typeof backup.databaseName === "string" ? zip.file(backup.databaseName) : null) ??
    zip.file(/\.db$/i)[0] ??
    null;
  if (!dbEntry) throw new Error("userData.db não encontrado dentro do .jwlibrary.");

  const dbBytes = await dbEntry.async("uint8array");

  const SQL = await loadSqlJs();
  const db = new SQL.Database(dbBytes);

  try {
    return {
      deviceName: (backup.deviceName as string | undefined) ?? null,
      schemaVersion: backup.schemaVersion ?? null,
      notes: readNotes(db),
      userMarks: readUserMarks(db),
      tags: readTags(db),
      tagMaps: readTagMaps(db),
      bookmarks: readBookmarks(db),
      inputFields: readInputFields(db),
    };
  } finally {
    db.close();
  }
}

function readNotes(db: Database): JwlibraryNote[] {
  let res;
  try {
    res = db.exec(
      `SELECT n.Guid, um.UserMarkGuid, n.Title, n.Content, n.BlockType, n.BlockIdentifier, n.Created, n.LastModified, ${LOCATION_SELECT}
       FROM Note n
       LEFT JOIN Location l ON n.LocationId = l.LocationId
       LEFT JOIN UserMark um ON n.UserMarkId = um.UserMarkId`
    );
  } catch {
    return [];
  }

  return rowsToObjects(res).map((row) => ({
    guid: String(row.Guid),
    userMarkGuid: toStr(row.UserMarkGuid),
    title: toStr(row.Title) ?? "",
    content: toStr(row.Content) ?? "",
    blockType: toNum(row.BlockType) ?? 0,
    blockIdentifier: toNum(row.BlockIdentifier),
    createdAt: toStr(row.Created) ?? "",
    lastModified: toStr(row.LastModified) ?? "",
    location: readLocation(row),
  }));
}

function readUserMarks(db: Database): JwlibraryUserMark[] {
  let markRows;
  try {
    markRows = rowsToObjects(
      db.exec(
        `SELECT um.UserMarkId, um.UserMarkGuid, um.ColorIndex, um.StyleIndex, um.Version, ${LOCATION_SELECT}
         FROM UserMark um
         LEFT JOIN Location l ON um.LocationId = l.LocationId`
      )
    );
  } catch {
    return [];
  }

  let rangesByMark = new Map<number, JwlibraryBlockRange[]>();
  try {
    const rangeRows = rowsToObjects(
      db.exec("SELECT UserMarkId, BlockType, Identifier, StartToken, EndToken FROM BlockRange")
    );
    rangesByMark = rangeRows.reduce((map, row) => {
      const markId = toNum(row.UserMarkId);
      if (markId === null) return map;
      const list = map.get(markId) ?? [];
      list.push({
        blockType: toNum(row.BlockType) ?? 0,
        identifier: toNum(row.Identifier) ?? 0,
        startToken: toNum(row.StartToken),
        endToken: toNum(row.EndToken),
      });
      map.set(markId, list);
      return map;
    }, rangesByMark);
  } catch {
    // BlockRange missing/empty — highlights still resolve, just without exact token ranges.
  }

  return markRows.map((row) => ({
    guid: String(row.UserMarkGuid),
    colorIndex: toNum(row.ColorIndex) ?? 0,
    styleIndex: toNum(row.StyleIndex) ?? 0,
    version: toNum(row.Version) ?? 0,
    location: readLocation(row),
    blockRanges: rangesByMark.get(toNum(row.UserMarkId) ?? -1) ?? [],
  }));
}

function readTags(db: Database): JwlibraryTag[] {
  let res;
  try {
    res = db.exec("SELECT TagId, Type, Name FROM Tag");
  } catch {
    return [];
  }
  return rowsToObjects(res).map((row) => ({
    localId: toNum(row.TagId) ?? -1,
    tagType: toNum(row.Type) ?? 1,
    name: toStr(row.Name),
  }));
}

function readTagMaps(db: Database): JwlibraryTagMap[] {
  let res;
  try {
    res = db.exec(
      `SELECT tm.TagId, tm.NoteId, tm.Position, n.Guid AS NoteGuid, ${LOCATION_SELECT}
       FROM TagMap tm
       LEFT JOIN Note n ON tm.NoteId = n.NoteId
       LEFT JOIN Location l ON tm.LocationId = l.LocationId
       WHERE tm.PlaylistItemId IS NULL`
    );
  } catch {
    return [];
  }

  return rowsToObjects(res).map((row) => ({
    tagLocalId: toNum(row.TagId) ?? -1,
    noteGuid: toStr(row.NoteGuid),
    location: row.NoteGuid ? null : readLocation(row),
    position: toNum(row.Position) ?? 0,
  }));
}

function readBookmarks(db: Database): JwlibraryBookmark[] {
  let res;
  try {
    res = db.exec(
      `SELECT b.Title, b.Snippet, b.Slot, b.BlockType, b.BlockIdentifier, ${LOCATION_SELECT}
       FROM Bookmark b
       LEFT JOIN Location l ON b.LocationId = l.LocationId`
    );
  } catch {
    return [];
  }

  return rowsToObjects(res).map((row) => ({
    title: toStr(row.Title) ?? "",
    snippet: toStr(row.Snippet),
    slot: toNum(row.Slot) ?? 0,
    blockType: toNum(row.BlockType) ?? 0,
    blockIdentifier: toNum(row.BlockIdentifier),
    location: readLocation(row),
  }));
}

function readInputFields(db: Database): JwlibraryInputField[] {
  let res;
  try {
    res = db.exec(
      `SELECT i.TextTag, i.Value, ${LOCATION_SELECT}
       FROM InputField i
       LEFT JOIN Location l ON i.LocationId = l.LocationId`
    );
  } catch {
    return [];
  }

  return rowsToObjects(res).map((row) => ({
    textTag: toStr(row.TextTag) ?? "",
    value: toStr(row.Value) ?? "",
    location: readLocation(row),
  }));
}
