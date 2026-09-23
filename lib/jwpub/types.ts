/** Shared between the browser-side parser and the server actions that persist it. */

export interface JwpubChapter {
  /** `Document.DocumentId` from the source SQLite — how `jwpub://` links address a chapter. */
  documentId: number;
  /** `Document.MepsDocumentId` — the globally-unique document id, how a `.jwlibrary` backup's `Location.DocumentId` addresses this chapter. Null if the column was missing. */
  mepsDocumentId: number | null;
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

/**
 * A resolved `BibleCitation` row from the archive's own SQLite, keyed by
 * `"<documentId>:<blockNumber>:<elementNumber>"` — see readBibleCitations in
 * parser.ts for why (the href itself doesn't carry a usable id). `firstVerseId`/
 * `lastVerseId` match `BibleVerseId` in data/NWT_structure.md (public.bible_verses.id),
 * so they need zero conversion at render time.
 */
export interface JwpubBibleCitation {
  firstVerseId: number;
  lastVerseId: number;
}

/**
 * A "quadro de destaque" — a self-contained excerpt (a whole story, an
 * encyclopedia article's paragraph, a boxed "What the Bible Says" panel)
 * embedded directly in the archive, distinct from a bare `jwpub://p/`
 * cross-reference: reading it needs no other publication at all.
 *
 * Keyed by its own `ExtractId`, which is exactly what the citing
 * `<a data-xtid="…">` in the source HTML carries — verified against the real
 * Research Guide archive by matching captions to visible link text
 * (`data-xtid="5792"` → Extract 5792, caption "ijwbq artigo 82 / Será que a
 * Bíblia está de acordo com a ciência?", under a link reading "Perguntas
 * Bíblicas Respondidas, artigos 82"). This was originally implemented as a
 * `HyperlinkId` lookup, which is a *different* archive-global id space:
 * `data-xtid="5807"` (Perspicaz vol. 1, at Gênesis 1:1) resolved through
 * `Hyperlink` 5807 to an unrelated 2004 Watchtower article, so every excerpt
 * the Guia tab showed was the wrong one.
 */
export interface JwpubExtract {
  extractId: number;
  html: string;
  /** `Extract.Caption` — pre-built markup naming the source, e.g. `<span class="eloc">it-1 “Criação” par. 4</span> <span class="etitle">Criação</span>`. The only place the cited article's NAME appears: a Perspicaz citation's own link text is just "Perspicaz, Volume 1,". */
  caption: string | null;
  refTitle: string | null;
  refSymbol: string | null;
  /** `Extract.RefMepsDocumentId` — the document this excerpt was taken from, so a reader showing it can also offer to open/download the full publication. */
  refMepsDocumentId: number | null;
}

/**
 * Everything a caller needs to turn a `data-xtid` on a citation link into
 * the excerpt(s) behind it.
 *
 * `citationGroups` exists because ONE citation link routinely stands for
 * several excerpts: the Research Guide's "Perspicaz, Volume 1," at Gênesis
 * 1:1 is a single `<a>` whose href names six different Perspicaz articles
 * (`jwpub://p/T:1200001061/5-5$p/T:1200001061/9-9$…`), and the archive has
 * six `DocumentExtract` rows for it — one per article — sharing one
 * `HyperlinkId`. The `<a>` itself only carries the FIRST one's id, so
 * resolving `data-xtid` alone shows one article and silently drops the other
 * five, which reads as "clicking Perspicaz always opens the same thing".
 * Keyed `"{documentId}:{paragraphOrdinal}:{extractId}"` because the same
 * excerpt can be cited more than once inside one document, under different
 * hyperlinks, and only the paragraph tells those apart.
 */
export interface JwpubExtractIndex {
  byExtractId: Map<number, JwpubExtract>;
  citationGroups: Map<string, number[]>;
}

/** The `citationGroups` key for one citation link. `paragraphOrdinal` is the `data-pid` of the paragraph the link sits in. */
export function extractCitationKey(documentId: number, paragraphOrdinal: number, extractId: number): string {
  return `${documentId}:${paragraphOrdinal}:${extractId}`;
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
  /** "<documentId>:<blockNumber>:<elementNumber>" → verse range. Empty when the archive has no BibleCitation table. */
  bibleCitations: Map<string, JwpubBibleCitation>;
  /** Embedded excerpts, resolvable from a citation's own `data-xtid`. Empty when the archive has no Extract/DocumentExtract tables — which is common (`lmd` has none), but far from universal: every one of the `mwb` apostila's 115 citations carries one, as does 52.8% of the Research Guide's. See JwpubExtractIndex. */
  extracts: JwpubExtractIndex;
}

/** What the reader needs to render its chapter list — deliberately without the HTML. */
export interface ChapterSummary {
  documentId: number;
  /** Same field as JwpubChapter — needed to build a jwlibrary Location when creating a note on a paragraph (see jwpub-reader.tsx's picking mode). */
  mepsDocumentId: number | null;
  position: number;
  title: string;
  hasContent: boolean;
}

export interface PublicationSummary {
  id: string;
  symbol: string;
  title: string;
  status: "ready" | "failed";
  /** Needed alongside `symbol`/a chapter's `mepsDocumentId` to build a jwlibrary Location — see lib/jwlibrary/resolve.ts's publicationKey. */
  mepsLanguageIndex: number | null;
  issueTagNumber: number | null;
}
