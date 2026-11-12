"use server";

/**
 * Backs the "@" menu's local title index (lib/notes/reference-title-index.ts).
 *
 * The index is every chapter/article title the user can cite (their own
 * publications + the shared Perspicaz/Guia) plus every video title — about
 * 9.000 short rows, measured ~0,7 MB as JSON. It is downloaded once, kept in
 * IndexedDB and searched in the browser, so typing after "@" never waits on a
 * round trip. Transcripts are deliberately NOT part of it (16 MB, and not what
 * this menu searches).
 *
 * Two actions: a cheap fingerprint (`getReferenceTitleIndexVersion`) the client
 * compares against its copy, and the full payload (`getReferenceTitleIndex`)
 * fetched only when they differ.
 */

import { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** One publication a chapter belongs to; chapters point at it by index to keep the payload small. */
export interface IndexedPublication {
  id: string;
  title: string;
  symbol: string;
  source: "own" | "global";
  noteId: string | null;
}

/** [publicationIndex, documentId, title] — a tuple, since 6.000+ objects with repeated key names are most of the payload. */
export type IndexedChapter = [number, number, string];

/** [videoId, title] */
export type IndexedVideo = [string, string];

export interface ReferenceTitleIndex {
  version: string;
  publications: IndexedPublication[];
  chapters: IndexedChapter[];
  videos: IndexedVideo[];
}

const PAGE = 1000; // PostgREST's default response cap

async function authed(): Promise<{ supabase: SupabaseClient; ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, ok: !!user };
}

async function count(supabase: SupabaseClient, table: string, column: string, readyOnly = false): Promise<number> {
  let query = supabase.from(table).select(column, { count: "exact", head: true });
  if (readyOnly) query = query.eq("status", "ready");
  const { count: total } = await query;
  return total ?? 0;
}

async function fingerprint(supabase: SupabaseClient): Promise<string> {
  const [ownPublications, ownChapters, globalChapters, videos] = await Promise.all([
    count(supabase, "jwpub_publications", "id", true),
    count(supabase, "jwpub_chapters", "document_id"),
    count(supabase, "global_publication_chapters", "document_id"),
    count(supabase, "global_videos", "id"),
  ]);
  return `${ownPublications}:${ownChapters}:${globalChapters}:${videos}`;
}

export async function getReferenceTitleIndexVersion(): Promise<{ version?: string; error?: string }> {
  const { supabase, ok } = await authed();
  if (!ok) return { error: "Sessão expirada." };
  return { version: await fingerprint(supabase) };
}

/** Reads a whole table in PAGE-sized slices — an index needs every row, unlike the limited searches it replaces. */
async function readAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error("index read failed");
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function getReferenceTitleIndex(): Promise<{ index?: ReferenceTitleIndex; error?: string }> {
  const { supabase, ok } = await authed();
  if (!ok) return { error: "Sessão expirada." };

  try {
    const version = await fingerprint(supabase);

    const [ownPublications, ownChapters, globalPublications, globalChapters, videos] = await Promise.all([
      readAll<{ id: string; note_id: string; title: string; symbol: string | null }>((from, to) =>
        supabase
          .from("jwpub_publications")
          .select("id, note_id, title, symbol")
          .eq("status", "ready")
          .order("id")
          .range(from, to)
      ),
      readAll<{ publication_id: string; document_id: number; title: string }>((from, to) =>
        supabase
          .from("jwpub_chapters")
          .select("publication_id, document_id, title")
          .order("publication_id")
          .order("position")
          .range(from, to)
      ),
      readAll<{ id: string; title: string; symbol: string | null }>((from, to) =>
        supabase.from("global_publications").select("id, title, symbol").order("id").range(from, to)
      ),
      readAll<{ publication_id: string; document_id: number; title: string }>((from, to) =>
        supabase
          .from("global_publication_chapters")
          .select("publication_id, document_id, title")
          .order("publication_id")
          .order("position")
          .range(from, to)
      ),
      readAll<{ id: string; title: string }>((from, to) =>
        supabase.from("global_videos").select("id, title").order("id").range(from, to)
      ),
    ]);

    const publications: IndexedPublication[] = [];
    const indexOf = new Map<string, number>();

    for (const p of ownPublications) {
      if (!p.symbol) continue; // same filter searchOwnChapterTitles applies
      indexOf.set(`own:${p.id}`, publications.length);
      publications.push({ id: p.id, title: p.title, symbol: p.symbol.toLowerCase(), source: "own", noteId: p.note_id });
    }
    for (const p of globalPublications) {
      indexOf.set(`global:${p.id}`, publications.length);
      publications.push({ id: p.id, title: p.title, symbol: (p.symbol ?? "").toLowerCase(), source: "global", noteId: null });
    }

    const chapters: IndexedChapter[] = [];
    for (const c of ownChapters) {
      const at = indexOf.get(`own:${c.publication_id}`);
      if (at !== undefined && c.title) chapters.push([at, c.document_id, c.title]);
    }
    for (const c of globalChapters) {
      const at = indexOf.get(`global:${c.publication_id}`);
      if (at !== undefined && c.title) chapters.push([at, c.document_id, c.title]);
    }

    return {
      index: {
        version,
        publications,
        chapters,
        videos: videos.filter((v) => v.title).map((v): IndexedVideo => [v.id, v.title]),
      },
    };
  } catch {
    return { error: "Não foi possível baixar o índice de títulos." };
  }
}
