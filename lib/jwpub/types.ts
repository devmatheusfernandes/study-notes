/** Shared between the browser-side parser and the server actions that persist it. */

export interface JwpubChapter {
  /** `Document.DocumentId` from the source SQLite — how `jwpub://` links address a chapter. */
  documentId: number;
  position: number;
  title: string;
  html: string;
  /** `jwpub-media://` filenames referenced by this chapter's HTML, before rewriting. */
  mediaRefs: string[];
}

export interface JwpubFootnote {
  footnoteId: number;
  html: string;
}

export interface JwpubPublicationMeta {
  symbol: string;
  title: string;
  mepsLanguageIndex: number | null;
  year: number | null;
  issueTagNumber: number | null;
}

export interface ParsedJwpub extends JwpubPublicationMeta {
  chapters: JwpubChapter[];
  footnotes: JwpubFootnote[];
  /** Media filename → the raw bytes pulled out of the archive, only for files actually referenced. */
  media: Map<string, Blob>;
}

/** What the reader needs to render its chapter list — deliberately without the HTML. */
export interface ChapterSummary {
  documentId: number;
  position: number;
  title: string;
  hasContent: boolean;
}

export interface PublicationSummary {
  id: string;
  symbol: string;
  title: string;
  status: "ready" | "failed";
}
