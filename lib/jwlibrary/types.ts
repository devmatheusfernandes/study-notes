/** Shared between the server-side parser and the resolver/ingest route. */

export interface JwlibraryLocation {
  bookNumber: number | null;
  chapterNumber: number | null;
  keySymbol: string | null;
  mepsLanguage: number | null;
  issueTagNumber: number | null;
  /** `Location.DocumentId` — the *global* MepsDocumentId, not the archive-internal one. */
  mepsDocumentId: number | null;
  track: number | null;
  locationType: number | null;
}

export interface JwlibraryBlockRange {
  blockType: number;
  identifier: number;
  startToken: number | null;
  endToken: number | null;
}

export interface JwlibraryUserMark {
  guid: string;
  colorIndex: number;
  styleIndex: number;
  version: number;
  location: JwlibraryLocation;
  blockRanges: JwlibraryBlockRange[];
}

export interface JwlibraryNote {
  guid: string;
  /** Links back to a JwlibraryUserMark by guid, if this note is attached to a highlight. */
  userMarkGuid: string | null;
  title: string;
  content: string;
  blockType: number;
  blockIdentifier: number | null;
  createdAt: string;
  lastModified: string;
  location: JwlibraryLocation;
}

export interface JwlibraryTag {
  /** `Tag.TagId` — only used to link `JwlibraryTagMap` rows during parsing, not persisted. */
  localId: number;
  tagType: number;
  name: string | null;
}

export interface JwlibraryTagMap {
  tagLocalId: number;
  noteGuid: string | null;
  /** Set only when this tag applies to a bare location (no note attached). */
  location: JwlibraryLocation | null;
  position: number;
}

export interface JwlibraryBookmark {
  title: string;
  snippet: string | null;
  slot: number;
  blockType: number;
  blockIdentifier: number | null;
  location: JwlibraryLocation;
}

export interface JwlibraryInputField {
  textTag: string;
  value: string;
  location: JwlibraryLocation;
}

export interface ParsedJwlibrary {
  deviceName: string | null;
  schemaVersion: number | null;
  notes: JwlibraryNote[];
  userMarks: JwlibraryUserMark[];
  tags: JwlibraryTag[];
  tagMaps: JwlibraryTagMap[];
  bookmarks: JwlibraryBookmark[];
  inputFields: JwlibraryInputField[];
}
