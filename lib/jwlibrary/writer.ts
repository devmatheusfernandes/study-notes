/**
 * Builds a fresh `userData.db` SQLite file from this user's Postgres-stored
 * jwlibrary data — the write-side counterpart to lib/jwlibrary/parser.ts,
 * used by app/(app)/jwlibrary/export/route.ts. Schema/columns follow
 * data/jwlibrary_schema.md exactly (Location/Note/UserMark/BlockRange/Tag/
 * TagMap/Bookmark/InputField/LastModified) so the result reimports cleanly,
 * both back into Study Notes and into the real JW Library app.
 *
 * Two deliberate departures from the documented schema, both purely
 * defensive (never cause data loss, only avoid a hard INSERT failure if our
 * empirically-reverse-engineered understanding of a constraint turns out to
 * be incomplete):
 *  - No UNIQUE constraint is declared on Location. The documented
 *    `UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type)` can't
 *    be right as the *only* dedup key for publication documents (it omits
 *    DocumentId, which is what actually distinguishes two chapters of the
 *    same publication) — so rows are deduped here by the *full* location
 *    tuple instead (a strict superset, never wrongly merges two distinct
 *    locations; worst case is a few redundant rows, which is harmless).
 *  - TagMap.Position is renumbered sequentially per tag at write time
 *    (0, 1, 2, …) rather than reusing whatever's stored in Postgres — every
 *    tag added through this app's own addTagToJwlibraryNote always writes
 *    position 0, which would violate the real schema's
 *    `UNIQUE(TagId, Position)` if written as-is for a tag used on more than
 *    one note.
 */
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import type {
  JwlibraryLocation,
  JwlibraryBlockRange,
  JwlibraryNote,
  JwlibraryUserMark,
  JwlibraryBookmark,
  JwlibraryInputField,
} from "./types";

export interface JwlibraryExportTag {
  /** Postgres uuid — used only to link tagMaps below, never written to the db itself. */
  id: string;
  tagType: number;
  name: string | null;
}

export interface JwlibraryExportTagMap {
  tagId: string;
  noteGuid: string | null;
  /** Set only when this tag applies to a bare location (no note attached) — mutually exclusive with noteGuid. */
  location: JwlibraryLocation | null;
}

export interface JwlibraryExportData {
  notes: JwlibraryNote[];
  userMarks: JwlibraryUserMark[];
  tags: JwlibraryExportTag[];
  tagMaps: JwlibraryExportTagMap[];
  bookmarks: JwlibraryBookmark[];
  inputFields: JwlibraryInputField[];
}

async function loadSqlJs() {
  const raw = fs.readFileSync(path.join(process.cwd(), "public", "sql-wasm.wasm"));
  const wasmBinary = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return initSqlJs({ wasmBinary });
}

const SCHEMA_SQL = `
CREATE TABLE Location(
  LocationId INTEGER PRIMARY KEY,
  BookNumber INTEGER,
  ChapterNumber INTEGER,
  DocumentId INTEGER,
  Track INTEGER,
  IssueTagNumber INTEGER NOT NULL DEFAULT 0,
  KeySymbol TEXT,
  MepsLanguage INTEGER,
  Type INTEGER NOT NULL,
  Title TEXT,
  Specialty TEXT,
  Edition TEXT
);
CREATE TABLE Note(
  NoteId INTEGER PRIMARY KEY,
  Guid TEXT NOT NULL UNIQUE,
  UserMarkId INTEGER,
  LocationId INTEGER,
  Title TEXT,
  Content TEXT,
  LastModified TEXT NOT NULL,
  Created TEXT NOT NULL,
  BlockType INTEGER NOT NULL DEFAULT 0,
  BlockIdentifier INTEGER,
  CHECK((BlockType = 0 AND BlockIdentifier IS NULL)
     OR (BlockType BETWEEN 1 AND 2 AND BlockIdentifier IS NOT NULL))
);
CREATE TABLE UserMark(
  UserMarkId INTEGER PRIMARY KEY,
  ColorIndex INTEGER NOT NULL,
  LocationId INTEGER NOT NULL,
  StyleIndex INTEGER NOT NULL,
  UserMarkGuid TEXT NOT NULL UNIQUE,
  Version INTEGER NOT NULL
);
CREATE TABLE BlockRange(
  BlockRangeId INTEGER PRIMARY KEY,
  BlockType INTEGER NOT NULL,
  Identifier INTEGER NOT NULL,
  StartToken INTEGER,
  EndToken INTEGER,
  UserMarkId INTEGER NOT NULL,
  CHECK(BlockType BETWEEN 1 AND 2)
);
CREATE TABLE Tag(
  TagId INTEGER PRIMARY KEY,
  Type INTEGER NOT NULL,
  Name TEXT
);
CREATE TABLE TagMap(
  TagMapId INTEGER PRIMARY KEY,
  PlaylistItemId INTEGER,
  LocationId INTEGER,
  NoteId INTEGER,
  TagId INTEGER NOT NULL,
  Position INTEGER NOT NULL,
  UNIQUE(TagId, Position),
  UNIQUE(TagId, NoteId),
  UNIQUE(TagId, LocationId),
  CHECK(
    (NoteId IS NULL AND LocationId IS NOT NULL) OR
    (LocationId IS NULL AND NoteId IS NOT NULL)
  )
);
CREATE TABLE Bookmark(
  BookmarkId INTEGER PRIMARY KEY,
  LocationId INTEGER NOT NULL,
  PublicationLocationId INTEGER NOT NULL,
  Slot INTEGER NOT NULL,
  Title TEXT NOT NULL,
  Snippet TEXT,
  BlockType INTEGER NOT NULL DEFAULT 0,
  BlockIdentifier INTEGER
);
CREATE TABLE InputField(
  LocationId INTEGER NOT NULL,
  TextTag TEXT NOT NULL,
  Value TEXT NOT NULL
);
CREATE TABLE LastModified(LastModified TEXT);
`;

export async function buildJwlibraryDatabase(data: JwlibraryExportData): Promise<Uint8Array> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  db.run(SCHEMA_SQL);

  let nextLocationId = 1;
  const locationIdByKey = new Map<string, number>();

  function getOrCreateLocationId(loc: JwlibraryLocation): number {
    const key = JSON.stringify([
      loc.bookNumber,
      loc.chapterNumber,
      loc.keySymbol,
      loc.mepsLanguage,
      loc.issueTagNumber,
      loc.mepsDocumentId,
      loc.track,
      loc.locationType,
    ]);
    const existing = locationIdByKey.get(key);
    if (existing !== undefined) return existing;

    const id = nextLocationId++;
    db.run(
      `INSERT INTO Location (LocationId, BookNumber, ChapterNumber, DocumentId, Track, IssueTagNumber, KeySymbol, MepsLanguage, Type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, loc.bookNumber, loc.chapterNumber, loc.mepsDocumentId, loc.track, loc.issueTagNumber ?? 0, loc.keySymbol, loc.mepsLanguage, loc.locationType ?? 0]
    );
    locationIdByKey.set(key, id);
    return id;
  }

  let nextUserMarkId = 1;
  const userMarkIdByGuid = new Map<string, number>();
  let nextBlockRangeId = 1;

  for (const mark of data.userMarks) {
    const id = nextUserMarkId++;
    userMarkIdByGuid.set(mark.guid, id);
    const locationId = getOrCreateLocationId(mark.location);
    db.run(`INSERT INTO UserMark (UserMarkId, ColorIndex, LocationId, StyleIndex, UserMarkGuid, Version) VALUES (?, ?, ?, ?, ?, ?)`, [
      id,
      mark.colorIndex,
      locationId,
      mark.styleIndex,
      mark.guid,
      mark.version,
    ]);

    for (const range of mark.blockRanges as JwlibraryBlockRange[]) {
      db.run(
        `INSERT INTO BlockRange (BlockRangeId, BlockType, Identifier, StartToken, EndToken, UserMarkId) VALUES (?, ?, ?, ?, ?, ?)`,
        [nextBlockRangeId++, range.blockType, range.identifier, range.startToken, range.endToken, id]
      );
    }
  }

  let nextNoteId = 1;
  const noteIdByGuid = new Map<string, number>();

  for (const note of data.notes) {
    const id = nextNoteId++;
    noteIdByGuid.set(note.guid, id);
    const locationId = getOrCreateLocationId(note.location);
    const userMarkId = note.userMarkGuid ? (userMarkIdByGuid.get(note.userMarkGuid) ?? null) : null;
    db.run(
      `INSERT INTO Note (NoteId, Guid, UserMarkId, LocationId, Title, Content, LastModified, Created, BlockType, BlockIdentifier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, note.guid, userMarkId, locationId, note.title, note.content, note.lastModified, note.createdAt, note.blockType, note.blockIdentifier]
    );
  }

  let nextTagId = 1;
  const tagIdByPgId = new Map<string, number>();
  for (const tag of data.tags) {
    const id = nextTagId++;
    tagIdByPgId.set(tag.id, id);
    db.run(`INSERT INTO Tag (TagId, Type, Name) VALUES (?, ?, ?)`, [id, tag.tagType, tag.name]);
  }

  // Position renumbered sequentially per tag — see the module doc comment.
  let nextTagMapId = 1;
  const positionByTagId = new Map<number, number>();
  for (const tagMap of data.tagMaps) {
    const tagId = tagIdByPgId.get(tagMap.tagId);
    if (tagId === undefined) continue;
    const noteId = tagMap.noteGuid ? (noteIdByGuid.get(tagMap.noteGuid) ?? null) : null;
    const locationId = !noteId && tagMap.location ? getOrCreateLocationId(tagMap.location) : null;
    if (!noteId && !locationId) continue; // neither side resolved — skip rather than violate the CHECK

    const position = positionByTagId.get(tagId) ?? 0;
    positionByTagId.set(tagId, position + 1);

    db.run(`INSERT INTO TagMap (TagMapId, LocationId, NoteId, TagId, Position) VALUES (?, ?, ?, ?, ?)`, [
      nextTagMapId++,
      locationId,
      noteId,
      tagId,
      position,
    ]);
  }

  // PublicationLocationId reuses the same resolved LocationId as LocationId —
  // lib/jwlibrary/parser.ts's readBookmarks never captured the original
  // "parent chapter" location separately from the bookmark's own location at
  // import time, so that distinction is already lost by the time data gets
  // here. Harmless for a passthrough re-export (no bookmark UI exists in
  // this app to create new ones), just not a byte-for-byte round trip.
  let nextBookmarkId = 1;
  for (const bookmark of data.bookmarks) {
    const locationId = getOrCreateLocationId(bookmark.location);
    db.run(
      `INSERT INTO Bookmark (BookmarkId, LocationId, PublicationLocationId, Slot, Title, Snippet, BlockType, BlockIdentifier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextBookmarkId++, locationId, locationId, bookmark.slot, bookmark.title, bookmark.snippet, bookmark.blockType, bookmark.blockIdentifier]
    );
  }

  for (const field of data.inputFields) {
    const locationId = getOrCreateLocationId(field.location);
    db.run(`INSERT INTO InputField (LocationId, TextTag, Value) VALUES (?, ?, ?)`, [locationId, field.textTag, field.value]);
  }

  db.run(`INSERT INTO LastModified (LastModified) VALUES (?)`, [new Date().toISOString().replace(/\.\d+Z$/, "Z")]);

  const bytes = db.export();
  db.close();
  return bytes;
}
