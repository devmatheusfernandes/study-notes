/**
 * Resolves a `.jwlibrary` Location against the user's own already-imported
 * `.jwpub` publications. Loaded once per ingest into an in-memory index
 * (a backup can carry hundreds of notes/highlights — resolving each one with
 * its own query would mean hundreds of round trips for no reason, since the
 * user's publication list is small and doesn't change mid-ingest).
 *
 * Bible references don't need this: `public.bible_verses` is a static global
 * table, looked up directly by book/chapter/verse wherever a note is
 * displayed (see app/(app)/bible-actions.ts's getBibleVerseByReference) —
 * there's no "was it imported yet" question for the Bible.
 */
import type { createClient } from "@/lib/supabase/server";
import type { JwlibraryLocation } from "./types";

interface PublicationEntry {
  publicationId: string;
  chaptersByMepsDocumentId: Map<number, string>;
}

export interface PublicationIndex {
  resolve(location: JwlibraryLocation): { publicationId: string | null; chapterId: string | null };
}

function publicationKey(symbol: string, mepsLanguage: number | null, issueTagNumber: number | null): string {
  return `${symbol.toLowerCase()}:${mepsLanguage ?? ""}:${issueTagNumber ?? 0}`;
}

export async function buildPublicationIndex(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<PublicationIndex> {
  const { data: publications } = await supabase
    .from("jwpub_publications")
    .select("id, symbol, meps_language_index, issue_tag_number")
    .eq("status", "ready");

  const byKey = new Map<string, PublicationEntry>();
  const byId = new Map<string, PublicationEntry>();

  for (const pub of publications ?? []) {
    const entry: PublicationEntry = { publicationId: pub.id, chaptersByMepsDocumentId: new Map() };
    byKey.set(publicationKey(pub.symbol, pub.meps_language_index, pub.issue_tag_number), entry);
    byId.set(pub.id, entry);
  }

  if (byId.size > 0) {
    const { data: chapters } = await supabase
      .from("jwpub_chapters")
      .select("id, publication_id, meps_document_id")
      .not("meps_document_id", "is", null)
      .in("publication_id", [...byId.keys()]);

    for (const chapter of chapters ?? []) {
      const entry = byId.get(chapter.publication_id);
      if (entry && chapter.meps_document_id !== null) {
        entry.chaptersByMepsDocumentId.set(chapter.meps_document_id, chapter.id);
      }
    }
  }

  return {
    resolve(location) {
      if (!location.keySymbol || location.mepsDocumentId === null) {
        return { publicationId: null, chapterId: null };
      }
      const entry = byKey.get(
        publicationKey(location.keySymbol, location.mepsLanguage, location.issueTagNumber)
      );
      if (!entry) return { publicationId: null, chapterId: null };
      const chapterId = entry.chaptersByMepsDocumentId.get(location.mepsDocumentId) ?? null;
      return { publicationId: entry.publicationId, chapterId };
    },
  };
}
