import "server-only";
import type OpenAI from "openai";
import type { createClient } from "@/lib/supabase/server";
import { BIBLE_BOOK_NAMES_PT, findBibleReferenceOccurrences, findBibleReferencesInNote } from "@/lib/bible/parse-reference";
import { parseVttToSegments } from "@/lib/video/video-utils";
import { stripHtmlTags } from "./chunker";
import { generateSingleEmbedding } from "./openai";
import { planSearchQuery, type PlannedQuery } from "./query-planner";
import {
  applyPublishPeriod,
  dayAfter,
  extractTitleKeywords,
  fetchExactMetadataMatches,
  parseQueryConstraints,
  rerankMatches,
  stripAccentsLower,
  withoutStopwords,
  type MatchResult,
  type PublishPeriod,
} from "./rag-query";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Everything the chat and the assistant dock retrieve for one question.
 *
 * The two stream routes used to carry their own copy of this pipeline, and it
 * had one retrieval strategy — embeddings plus an ILIKE over titles and
 * transcripts. Asked to stand in for jw.org/WOL it failed in ways that had
 * nothing to do with the model:
 *
 *  - the vector RPC timed out and the error was dropped, so "nothing found";
 *  - a word-for-word memory of a talk ("o piloto que confia nos instrumentos")
 *    is a full-text question, and Postgres full-text already existed for /bible;
 *  - Perspicaz and the Research Guide were imported but never searched;
 *  - "Mateus 24:14" was embedded as a sentence instead of looked up as a verse;
 *  - "quantas adorações matinais em 2026?" was answered by counting passages;
 *  - "esta semana" was never turned into the week's date range;
 *  - the best eight chunks overall were all the same kind of source.
 *
 * Each of those is its own lookup below, run in parallel, then merged.
 */
export interface RetrievalResult {
  matchRows: MatchResult[];
  /** A verified fact the answer must respect ("no video exists for that month"). */
  notice: string | null;
  /** Set for count/list questions: the catalog query's result, which then replaces the passages. */
  catalog: string | null;
  plan: PlannedQuery;
  embeddingTokens: number;
  embeddingCost: number;
}

export async function retrieveContext(opts: {
  supabase: Supabase;
  openai: OpenAI;
  userId: string;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
  allowedSourceTypes: string[];
  threshold: number;
  matchCount: number;
  /** Called once the question has been understood, before the searches start. */
  onPlanned?: (plan: PlannedQuery) => void;
}): Promise<RetrievalResult> {
  const { supabase, openai, userId, message, allowedSourceTypes, threshold, matchCount } = opts;
  const allowed = new Set(allowedSourceTypes);

  const plan = await planSearchQuery(openai, message, opts.history ?? []);
  opts.onPlanned?.(plan);
  const searchQuery = plan.searchQuery;
  const words = withoutReferenceWords(searchWords(plan, searchQuery), searchQuery);
  const ftsQuery = words.join(" ");
  // Perspicaz and the Research Guide are publications: they follow the "JWPUB" source filter.
  const wantsPublications = allowed.has("jwpub");

  let embeddingTokens = 0;
  let embeddingCost = 0;

  const [semantic, exact, ftsVideos, publications, guideExtracts, reference, catalog, week] = await Promise.all([
    safe("semantic", [] as MatchResult[], async () => {
      const { embedding, tokens, cost } = await generateSingleEmbedding(searchQuery);
      embeddingTokens = tokens;
      embeddingCost = cost;
      const { data, error } = await supabase.rpc("match_hybrid_embeddings", {
        query_embedding: embedding,
        user_id_param: userId,
        match_threshold: threshold,
        match_count: matchCount,
        allowed_types: allowedSourceTypes,
      });
      // This error used to be dropped — a timeout looked exactly like "no match".
      if (error) throw new Error(error.message);
      return (data ?? []) as MatchResult[];
    }),
    safe("exact", [] as MatchResult[], () =>
      fetchExactMetadataMatches(supabase, searchQuery, allowedSourceTypes, { keywords: plan.keywords, period: plan.period })
    ),
    safe("fts-videos", [] as MatchResult[], () =>
      allowed.has("video") && ftsQuery ? searchVideoTranscripts(supabase, ftsQuery, plan.period) : Promise.resolve([])
    ),
    safe("fts-publications", [] as MatchResult[], () =>
      wantsPublications && ftsQuery ? searchGlobalPublications(supabase, ftsQuery) : Promise.resolve([])
    ),
    safe("fts-guide", [] as MatchResult[], () =>
      wantsPublications && ftsQuery ? searchGuideExtracts(supabase, ftsQuery) : Promise.resolve([])
    ),
    safe("reference", [] as MatchResult[], () => lookupBibleReference(supabase, searchQuery, message, allowed)),
    safe("catalog", null as CatalogResult | null, () =>
      allowed.has("video") && plan.intent !== "answer" ? queryVideoCatalog(supabase, plan, searchQuery) : Promise.resolve(null)
    ),
    safe("week", null as WeekResult | null, () =>
      allowed.has("jwpub") ? lookupMeetingWeek(supabase, message) : Promise.resolve(null)
    ),
  ]);

  if (catalog) {
    return { matchRows: catalog.rows, notice: null, catalog: catalog.text, plan, embeddingTokens, embeddingCost };
  }

  // A video found by BOTH meaning and wording is a better bet than one found by either.
  const semanticVideoIds = new Set(semantic.filter((m) => m.video_id).map((m) => m.video_id));
  const ftsVideoIds = new Set(ftsVideos.map((m) => m.video_id));
  const boost = (m: MatchResult, ids: Set<string | null>) =>
    m.video_id && ids.has(m.video_id) ? { ...m, similarity: Math.min(0.94, m.similarity + 0.08) } : m;
  const videoAndOwn = [
    ...exact,
    ...semantic.map((m) => boost(m, ftsVideoIds)),
    ...ftsVideos.map((m) => boost(m, semanticVideoIds)),
  ];

  // rerankMatches judges years and edition numbers ("boletim 6 de 2026") — a
  // rule written for video titles. A publication excerpt or a verse that
  // happens to mention another year must not be penalised by it.
  const reranked = (await rerankMatches(supabase, searchQuery, videoAndOwn))
    .filter((m) => allowed.has(m.source_type))
    .filter((m) => m.similarity >= threshold);

  const fixed = [...(week?.rows ?? []), ...reference, ...publications, ...guideExtracts].filter(
    (m) => m.similarity >= threshold
  );

  // The retrieval layer named one exact video ("resuma a última adoração
  // matinal"): loosely related publications would only be noise next to it.
  const namedVideo = reranked.some((m) => m.source_type === "video" && m.similarity >= 0.95);
  const merged = [...reranked, ...(namedVideo ? fixed.filter((m) => m.similarity >= 0.85) : fixed)];

  // "Desta semana" names the meeting week, not a publication window for videos.
  const period = week ? undefined : plan.period;
  const { matches: dated, notice: periodNotice } = await applyPublishPeriod(supabase, merged, period, searchQuery);

  const matchRows = balanceSources(dated);
  await addVideoTimestamps(supabase, matchRows);

  return { matchRows, notice: week?.notice ?? periodNotice, catalog: null, plan, embeddingTokens, embeddingCost };
}

/** One lookup failing (a timeout, a missing table) must not take the whole answer down with it. */
async function safe<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`Chat retrieval — ${label} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Drops the words of a scripture citation from the full-text words. The verse
 * is fetched directly by lookupBibleReference; searched as a WORD, "Romanos"
 * of "Explique Romanos 8:28" matched "Império Romano" and a brother named Roman.
 */
function withoutReferenceWords(words: string[], searchQuery: string): string[] {
  const occurrences = findBibleReferenceOccurrences(searchQuery);
  if (occurrences.length === 0) return words;
  const cited = new Set(
    occurrences.flatMap((o) => stripAccentsLower(searchQuery.slice(o.charStart, o.charEnd)).split(/[^\p{L}\p{N}]+/u)).filter(Boolean)
  );
  return words.filter((w) => !cited.has(stripAccentsLower(w)) && !/^\d+$/.test(w));
}

/** The words that name what to find: the planner's, or the stopword-based guess when it gave none. */
function searchWords(plan: PlannedQuery, searchQuery: string): string[] {
  const fromPlanner = withoutStopwords(plan.keywords ?? []);
  return (fromPlanner.length > 0 ? fromPlanner : extractTitleKeywords(searchQuery)).slice(0, 6);
}

// ─── Full-text ────────────────────────────────────────────────────────────────

/**
 * Scores for full-text hits, placed on the same scale as cosine similarity
 * (text-embedding-3-small lands real matches around 0.45–0.70). `tier` is how
 * strictly the words matched — see chat_tsquery_tiers in migration 0052: 1 =
 * every word, 2 = all but one, 3 = any. A tier-3 hit is barely above the
 * threshold on purpose: it only matters when nothing better turned up.
 */
function ftsScore(tier: number, position: number, titleMatch = false, wordCount = 2): number {
  // With a single search word, "every word matched" only means the word occurs
  // somewhere in the text — worth a look, not worth ranking above the user's
  // own notes on the subject.
  if (wordCount <= 1 && !titleMatch) return 0.5 - position * 0.01;
  // A title carrying every word is a strong hit but not a NAMED one: it stays
  // under 0.95, the score retrieval reserves for "this is the exact item asked for".
  const base = titleMatch && tier === 1 ? 0.84 : tier === 1 ? 0.66 : tier === 2 ? 0.56 : 0.44;
  return base - position * 0.01;
}

async function searchVideoTranscripts(supabase: Supabase, query: string, period?: PublishPeriod): Promise<MatchResult[]> {
  const { data, error } = await supabase.rpc("chat_search_videos", {
    query_text: query,
    max_results: 6,
    published_from: period?.from ?? null,
    published_to: period?.to ?? null,
  });
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    title: string;
    cover_image: string | null;
    video_url: string | null;
    subtitles_url: string | null;
    duration_formatted: string | null;
    first_published: string | null;
    excerpt: string | null;
    title_match: boolean;
    tier: number;
  };
  return ((data ?? []) as Row[]).map((v, i) => ({
    id: `fts-vid-${v.id}`,
    note_id: null,
    video_id: v.id,
    source_type: "video",
    content: collapse(v.excerpt) || `Vídeo: ${v.title}`,
    similarity: ftsScore(v.tier, i, v.title_match, wordCount(query)),
    metadata: videoMetadata(v),
  }));
}

function videoMetadata(v: {
  id: string;
  title: string;
  cover_image?: string | null;
  video_url?: string | null;
  subtitles_url?: string | null;
  duration_formatted?: string | null;
  first_published?: string | null;
}): MatchResult["metadata"] {
  return {
    title: v.title,
    type: "video",
    videoId: v.id,
    ...(v.video_url ? { videoUrl: v.video_url } : {}),
    ...(v.cover_image ? { coverImage: v.cover_image } : {}),
    ...(v.duration_formatted ? { durationFormatted: v.duration_formatted } : {}),
    ...(v.subtitles_url ? { subtitlesUrl: v.subtitles_url } : {}),
    ...(v.first_published ? { publishedAt: v.first_published } : {}),
  };
}

/** Perspicaz and the 2026 Guia de Pesquisa topics (`global_publication_chapters`). */
async function searchGlobalPublications(supabase: Supabase, query: string): Promise<MatchResult[]> {
  const { data, error } = await supabase.rpc("chat_search_publications", { query_text: query, max_results: 5 });
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    symbol: string;
    publication_title: string;
    document_id: number;
    title: string;
    excerpt: string | null;
    lead: string | null;
    title_match: boolean;
    tier: number;
  };
  return ((data ?? []) as Row[])
    // "Any one of the words" over five thousand encyclopedia articles is noise
    // unless the article is actually named for it.
    .filter((r) => r.tier < 3 || r.title_match)
    .map((r, i) => ({
      id: `fts-pub-${r.id}`,
      note_id: null,
      video_id: null,
      source_type: "publicacao",
      // The article NAMED for the subject answers "quem foi X?" from its
      // opening; anywhere else the passage around the words is the useful part.
      content: collapse(r.title_match ? r.lead : r.excerpt) || r.title,
      similarity: ftsScore(r.tier, i, r.title_match, wordCount(query)),
      metadata: {
        title: r.publication_title,
        chapterTitle: r.title,
        type: "publicacao",
        href: `/bible?pub=${encodeURIComponent(r.symbol)}&doc=${r.document_id}`,
      },
    }));
}

/**
 * The Research Guide's embedded excerpts — 32k passages quoted from magazines,
 * books and Perspicaz. Not a publication the user can open here, so the source
 * links out to the article on WOL by its MEPS document id.
 */
async function searchGuideExtracts(supabase: Supabase, query: string): Promise<MatchResult[]> {
  const { data, error } = await supabase.rpc("chat_search_guide_extracts", { query_text: query, max_results: 8 });
  if (error) throw new Error(error.message);

  type Row = {
    extract_id: number;
    caption: string | null;
    ref_title: string | null;
    ref_meps_document_id: number | null;
    excerpt: string | null;
    tier: number;
  };
  const perDocument = new Map<string, number>();
  const rows: MatchResult[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (r.tier === 3) continue;
    // One article is often cited paragraph by paragraph; two passages of it are plenty.
    const docKey = String(r.ref_meps_document_id ?? r.caption ?? r.extract_id);
    const seen = perDocument.get(docKey) ?? 0;
    if (seen >= 2) continue;
    perDocument.set(docKey, seen + 1);

    rows.push({
      id: `fts-guide-${r.extract_id}`,
      note_id: null,
      video_id: null,
      source_type: "publicacao",
      content: r.excerpt ?? "",
      similarity: ftsScore(r.tier, rows.length, false, wordCount(query)) - 0.04,
      metadata: {
        title: r.caption || r.ref_title || "Publicação",
        type: "publicacao",
        ...(r.ref_meps_document_id
          ? { href: `https://wol.jw.org/wol/finder?docid=${r.ref_meps_document_id}&wtlocale=T` }
          : {}),
      },
    });
    if (rows.length >= 4) break;
  }
  return rows;
}

const wordCount = (query: string) => query.split(" ").filter(Boolean).length;

function collapse(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

// ─── Bible references ─────────────────────────────────────────────────────────

/**
 * A question that names a verse is a lookup, not a similarity search. Embedded
 * as a sentence, "Explique Romanos 8:28" pulled eight chapter-sized chunks of
 * Romans and the model (rightly) said it had found nothing; "quais vídeos
 * explicam Mateus 24:14?" never consulted `video_scripture_refs`, the table
 * that exists precisely to answer it.
 *
 * For a `chapter:verse` this returns the verse itself with its study notes,
 * what the Research Guide lists for it (with the first excerpts), and the
 * videos that cite it. For a bare chapter, just the videos.
 */
async function lookupBibleReference(
  supabase: Supabase,
  searchQuery: string,
  message: string,
  allowed: Set<string>
): Promise<MatchResult[]> {
  const found = findBibleReferencesInNote(searchQuery);
  const refs = (found.length > 0 ? found : findBibleReferencesInNote(message)).slice(0, 2);
  if (refs.length === 0) return [];

  const wantsVideos = /v[ií]deo|discurso|adora[cç][aã]o matinal|broadcasting/i.test(message);
  const rows: MatchResult[] = [];

  for (const ref of refs) {
    const book = BIBLE_BOOK_NAMES_PT[ref.bookOrder];
    const first = ref.startVerse;
    const last = first === null ? null : Math.min(ref.endVerse ?? first, first + 11);
    const label =
      first === null ? `${book} ${ref.chapter}` : last !== first ? `${book} ${ref.chapter}:${first}-${last}` : `${book} ${ref.chapter}:${first}`;

    const [verses, studyNotes, guide, videos] = await Promise.all([
      first !== null && allowed.has("biblia")
        ? supabase
            .from("bible_verses")
            .select("verse, text")
            .eq("book_order", ref.bookOrder)
            .eq("chapter", ref.chapter)
            .eq("is_superscription", false)
            .gte("verse", first)
            .lte("verse", last!)
            .order("verse")
        : null,
      first !== null && allowed.has("biblia")
        ? supabase
            .from("bible_study_notes")
            .select("verse, label_html, content_html")
            .eq("book_order", ref.bookOrder)
            .eq("chapter", ref.chapter)
            .gte("verse", first)
            .lte("verse", last!)
            .order("verse")
            .limit(6)
        : null,
      first !== null && allowed.has("jwpub")
        ? supabase
            .from("bible_research_guide")
            .select("content_html")
            .eq("book_order", ref.bookOrder)
            .eq("chapter", ref.chapter)
            .eq("verse", first)
            .limit(1)
        : null,
      allowed.has("video")
        ? supabase.rpc("get_chapter_videos", { p_book_order: ref.bookOrder, p_chapter: ref.chapter })
        : null,
    ]);

    const verseRows = (verses?.data ?? []) as { verse: number; text: string }[];
    if (verseRows.length > 0) {
      const notes = ((studyNotes?.data ?? []) as { verse: number; label_html: string | null; content_html: string | null }[])
        .map((n) => `Nota de estudo (${book} ${ref.chapter}:${n.verse}) — ${stripHtmlTags(n.label_html ?? "")}: ${stripHtmlTags(n.content_html ?? "").slice(0, 900)}`)
        .join("\n");
      rows.push({
        id: `ref-verse-${ref.bookOrder}-${ref.chapter}-${first}`,
        note_id: null,
        video_id: null,
        source_type: "biblia",
        content:
          verseRows.map((v) => `${book} ${ref.chapter}:${v.verse} — ${v.text}`).join("\n") + (notes ? `\n\n${notes}` : ""),
        similarity: 0.99,
        metadata: { title: label, type: "biblia", bookOrder: ref.bookOrder, chapter: ref.chapter, firstVerse: first },
      });
    }

    const guideHtml = (guide?.data?.[0] as { content_html: string } | undefined)?.content_html;
    if (guideHtml) {
      rows.push(await researchGuideRow(supabase, guideHtml, label, ref.bookOrder, ref.chapter, first!));
    }

    type ChapterVideo = {
      video_id: string;
      title: string;
      cover_image: string | null;
      video_url: string | null;
      subtitles_url: string | null;
      duration_formatted: string | null;
      first_published: string | null;
      source: string;
      verses: number[] | null;
      snippet: string | null;
    };
    const citing = ((videos?.data ?? []) as ChapterVideo[])
      .filter((v) => {
        if (first === null) return true;
        // A title-sourced row with no verse is the chapter as a whole ("Salmo 23").
        if (!v.verses || v.verses.length === 0) return v.source === "title";
        return v.verses.some((n) => n >= first && n <= last!);
      })
      // get_chapter_videos already orders theme-first, then newest.
      .slice(0, wantsVideos ? 8 : 3);

    const seenVideo = new Set<string>();
    for (const v of citing) {
      if (seenVideo.has(v.video_id)) continue;
      seenVideo.add(v.video_id);
      const isTheme = v.source === "title";
      rows.push({
        id: `ref-vid-${v.video_id}-${ref.bookOrder}-${ref.chapter}`,
        note_id: null,
        video_id: v.video_id,
        source_type: "video",
        content:
          (isTheme ? `Este vídeo tem ${label} como texto-tema.` : `Este vídeo cita ${label}.`) +
          (v.snippet ? ` Trecho em que o texto é lido: ${v.snippet}` : ""),
        similarity: isTheme ? 0.93 : 0.82,
        metadata: {
          ...videoMetadata({ ...v, id: v.video_id }),
          ...(v.snippet ? { seekSnippet: v.snippet } : {}),
        },
      });
    }
  }

  return rows;
}

/** What the Research Guide lists for one verse, with the first few excerpts it embeds written out. */
async function researchGuideRow(
  supabase: Supabase,
  guideHtml: string,
  label: string,
  bookOrder: number,
  chapter: number,
  verse: number
): Promise<MatchResult> {
  // One link can stand for several excerpts ("5807,5808,…"); the first of each is its lead.
  const extractIds = [...guideHtml.matchAll(/data-jwpub-extract="(\d+)/g)].map((m) => Number(m[1]));
  const firstIds = [...new Set(extractIds)].slice(0, 4);

  let excerpts = "";
  if (firstIds.length > 0) {
    const { data } = await supabase
      .from("bible_research_guide_extracts")
      .select("extract_id, caption, content_html")
      .in("extract_id", firstIds);
    const byId = new Map(((data ?? []) as { extract_id: number; caption: string | null; content_html: string | null }[]).map((e) => [e.extract_id, e]));
    excerpts = firstIds
      .map((id) => byId.get(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map((e) => `• ${stripHtmlTags(e.caption ?? "")}: ${stripHtmlTags(e.content_html ?? "").slice(0, 1300)}`)
      .join("\n\n");
  }

  return {
    id: `ref-guide-${bookOrder}-${chapter}-${verse}`,
    note_id: null,
    video_id: null,
    source_type: "publicacao",
    content:
      `O Guia de Pesquisa indica estas publicações para ${label}: ${stripHtmlTags(guideHtml).slice(0, 1500)}` +
      (excerpts ? `\n\nTrechos das primeiras publicações indicadas:\n${excerpts}` : ""),
    similarity: 0.97,
    metadata: {
      title: "Guia de Pesquisa",
      chapterTitle: label,
      type: "publicacao",
      href: `/bible?book=${bookOrder}&chapter=${chapter}&verse=${verse}`,
    },
  };
}

// ─── Catalog questions ────────────────────────────────────────────────────────

interface CatalogResult {
  text: string;
  rows: MatchResult[];
}

/** Program names as people type them, mapped to JW.org's own `category_key`. Broader than rag-query's list: this one only ever filters a count/list query. */
const CATALOG_CATEGORIES: { pattern: RegExp; key: string; label: string }[] = [
  { pattern: /adorac(?:ao|oes) matina(?:l|is)/, key: "VODPgmEvtMorningWorship", label: "Adoração Matinal" },
  { pattern: /formaturas? de gilead/, key: "VODPgmEvtGilead", label: "Formatura de Gileade" },
  { pattern: /\bbroadcastings?\b/, key: "StudioMonthlyPrograms", label: "JW Broadcasting (programas mensais)" },
  { pattern: /canticos? origina(?:l|is)/, key: "VODOriginalSongs", label: "Cânticos originais" },
  { pattern: /reuni(?:ao|oes) anua(?:l|is)/, key: "VODPgmEvtAnnMtg", label: "Reunião Anual" },
];

const CATALOG_LIST_LIMIT = 60;

/**
 * "Quantas adorações matinais saíram em 2026?" — a count over the catalog, not
 * something a retrieved passage can answer. Returns null when the question
 * names nothing this can filter by, so it falls back to ordinary retrieval.
 */
async function queryVideoCatalog(supabase: Supabase, plan: PlannedQuery, searchQuery: string): Promise<CatalogResult | null> {
  const norm = stripAccentsLower(searchQuery);
  const { targetYear } = parseQueryConstraints(searchQuery);
  const filters: string[] = [];

  const category = CATALOG_CATEGORIES.find((c) => c.pattern.test(norm));
  const isBoletim = /\bboleti[mn]s?\b/.test(norm);
  const isConvention = /\bcongressos?\b/.test(norm) && targetYear !== null;

  // Words left after the program's own name: a speaker, almost always.
  const categoryWords = new Set(
    (category ? (norm.match(category.pattern)?.[0] ?? "").split(/\s+/) : []).concat(["congresso", "congressos", "broadcasting", "broadcastings"])
  );
  const titleWords = withoutStopwords(plan.keywords ?? []).filter((w) => !categoryWords.has(stripAccentsLower(w)) && !/^\d+$/.test(w));

  let q = supabase
    .from("global_videos")
    .select("id, title, first_published, video_url, cover_image, duration_formatted, subtitles_url", { count: "exact" });

  if (isConvention) {
    q = q.eq("category_key", `${targetYear}Convention`);
    filters.push(`categoria: Congresso de ${targetYear}`);
  } else if (category) {
    q = q.eq("category_key", category.key);
    filters.push(`categoria: ${category.label}`);
  }
  if (isBoletim) {
    q = q.ilike("title", "%Boletim do Corpo Governante%");
    filters.push("Boletins do Corpo Governante");
  }

  if (plan.period) {
    q = q.gte("first_published", plan.period.from).lt("first_published", dayAfter(plan.period.to));
    filters.push(`publicados de ${formatDay(plan.period.from)} a ${formatDay(plan.period.to)}`);
  } else if (targetYear !== null && !isConvention) {
    if (isBoletim) {
      // Bulletins carry their year in the title ("Boletim … (2026) — n.º 4").
      q = q.ilike("title", `%(${targetYear})%`);
      filters.push(`do ano de ${targetYear}`);
    } else {
      q = q.gte("first_published", `${targetYear}-01-01`).lt("first_published", `${targetYear + 1}-01-01`);
      filters.push(`publicados em ${targetYear}`);
    }
  }

  for (const word of titleWords) {
    q = q.ilike("title", `%${word.replace(/[%_\\]/g, "")}%`);
  }
  if (titleWords.length > 0) filters.push(`com ${titleWords.map((w) => `"${w}"`).join(" e ")} no título`);

  if (filters.length === 0) return null;

  const { data, count, error } = await q.order("first_published", { ascending: false, nullsFirst: false }).limit(CATALOG_LIST_LIMIT);
  if (error) throw new Error(error.message);
  const total = count ?? data?.length ?? 0;
  // Filtering by title words ALONE is only right for a speaker, whose name
  // heads dozens of titles. "Liste os vídeos sobre neutralidade cristã" matched
  // the one title carrying those words and was reported as "Total: 1 vídeo" —
  // a topic, which the normal search answers far better.
  const onlyTitleWords = filters.length === 1 && titleWords.length > 0;
  if (titleWords.length > 0 && (total === 0 || (onlyTitleWords && total < 3))) return null;

  const vids = data ?? [];
  const list = vids.map((v, i) => `${i + 1}. ${v.title} — ${v.first_published ? formatDay(v.first_published.slice(0, 10)) : "sem data"}`).join("\n");
  const text =
    `CONSULTA AO CATÁLOGO DE VÍDEOS — filtros aplicados: ${filters.join("; ")}.\n` +
    `TOTAL: ${total} ${total === 1 ? "vídeo" : "vídeos"}.\n` +
    (total > 0
      ? `LISTA, do mais recente ao mais antigo${total > vids.length ? ` (os ${vids.length} mais recentes de ${total})` : ""}:\n${list}`
      : "Nenhum vídeo corresponde a esses filtros.");

  return {
    text,
    rows: vids.slice(0, 10).map((v) => ({
      id: `catalog-${v.id}`,
      note_id: null,
      video_id: v.id,
      source_type: "video",
      content: `Vídeo: ${v.title}`,
      similarity: 0.99,
      metadata: videoMetadata(v),
    })),
  };
}

function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-");
  return `${d}/${m}/${y}`;
}

// ─── "Esta semana" ────────────────────────────────────────────────────────────

interface WeekResult {
  rows: MatchResult[];
  notice: string;
}

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * The Monday–Sunday week a message points at, written the way the meeting
 * workbook titles its weeks ("9-15 de novembro", "30 de novembro–6 de
 * dezembro", "28 de dezembro de 2026–3 de janeiro de 2027"). Null when the
 * message names no week. Exported for the unit of behaviour that matters: the
 * label has to match those titles exactly or the lookup finds nothing.
 */
export function resolveMeetingWeek(message: string, now: Date = new Date()): { labels: string[]; year: number } | null {
  const norm = stripAccentsLower(message);
  let offset: number;
  if (/\b(?:proxima semana|semana (?:que vem|seguinte|proxima))\b/.test(norm)) offset = 1;
  else if (/\bsemana passada\b/.test(norm)) offset = -1;
  else if (/\b(?:n?d?es[st]a semana|semana atual)\b/.test(norm)) offset = 0;
  else return null;

  // Today as the user lives it (Brazil), as a UTC-midnight date for plain day arithmetic.
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7) + offset * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const month = (dt: Date) => MONTHS_PT[dt.getUTCMonth()];
  // The 1st is printed as an ordinal in these publications ("1.º-7 de dezembro").
  const dayForms = (dt: Date) => (dt.getUTCDate() === 1 ? ["1.º", "1º", "1"] : [String(dt.getUTCDate())]);

  const labels: string[] = [];
  for (const a of dayForms(monday)) {
    for (const b of dayForms(sunday)) {
      if (monday.getUTCFullYear() !== sunday.getUTCFullYear()) {
        labels.push(`${a} de ${month(monday)} de ${monday.getUTCFullYear()}–${b} de ${month(sunday)} de ${sunday.getUTCFullYear()}`);
      } else if (monday.getUTCMonth() !== sunday.getUTCMonth()) {
        labels.push(`${a} de ${month(monday)}–${b} de ${month(sunday)}`);
      } else {
        labels.push(`${a}-${b} de ${month(monday)}`);
      }
    }
  }
  return { labels, year: monday.getUTCFullYear() };
}

/**
 * "Qual é a programação da reunião desta semana?" — the workbook is imported
 * and its chapters are titled by week, but nothing ever worked out which week
 * "esta" is. Finds that chapter in the user's own publications (and the
 * Watchtower study article for the week, when the question is about it) and
 * hands the whole chapter over, not one 500-character chunk of it.
 */
async function lookupMeetingWeek(supabase: Supabase, message: string): Promise<WeekResult | null> {
  const week = resolveMeetingWeek(message);
  if (!week) return null;

  const norm = stripAccentsLower(message);
  const aboutWatchtower = /sentinela|fim de semana/.test(norm);
  const aboutMidweek = !aboutWatchtower || /meio de semana|vida e ministerio|apostila/.test(norm);

  type Chunk = { note_id: string; jwpub_chapter_id: string | null; chunk_index: number; content: string; metadata: Record<string, unknown> | null };
  const chapterIds = new Set<string>();

  if (aboutMidweek) {
    for (const label of week.labels) {
      const { data } = await supabase
        .from("note_embeddings")
        .select("jwpub_chapter_id")
        .ilike("metadata->>chapterTitle", `${label}%`)
        .not("jwpub_chapter_id", "is", null)
        .limit(4);
      for (const r of data ?? []) if (r.jwpub_chapter_id) chapterIds.add(r.jwpub_chapter_id);
      if (chapterIds.size > 0) break;
    }
  }
  if (aboutWatchtower) {
    for (const label of week.labels) {
      // A study article opens with its week: "9-15 DE NOVEMBRO DE 2026 CÂNTICO 36 …".
      const { data } = await supabase
        .from("note_embeddings")
        .select("jwpub_chapter_id")
        .ilike("content", `${label} de ${week.year}%`)
        .not("jwpub_chapter_id", "is", null)
        .limit(4);
      const before = chapterIds.size;
      for (const r of data ?? []) if (r.jwpub_chapter_id) chapterIds.add(r.jwpub_chapter_id);
      if (chapterIds.size > before) break;
    }
  }
  if (chapterIds.size === 0) return null;

  const [{ data: chunks }, { data: lockedRows }] = await Promise.all([
    supabase
      .from("note_embeddings")
      .select("note_id, jwpub_chapter_id, chunk_index, content, metadata")
      .in("jwpub_chapter_id", [...chapterIds])
      .order("chunk_index")
      .limit(400),
    supabase.rpc("locked_note_ids"),
  ]);
  const locked = new Set((lockedRows ?? []) as string[]);

  const byChapter = new Map<string, Chunk[]>();
  for (const c of (chunks ?? []) as Chunk[]) {
    if (!c.jwpub_chapter_id || locked.has(c.note_id)) continue;
    byChapter.set(c.jwpub_chapter_id, [...(byChapter.get(c.jwpub_chapter_id) ?? []), c]);
  }

  const rows: MatchResult[] = [];
  const seenTitles = new Set<string>();
  for (const [chapterId, parts] of byChapter) {
    const meta = parts[0].metadata ?? {};
    // The same issue imported twice is still one chapter.
    const dedupe = `${meta.title}|${meta.chapterTitle}`;
    if (seenTitles.has(dedupe)) continue;
    seenTitles.add(dedupe);
    rows.push({
      id: `week-${chapterId}`,
      note_id: parts[0].note_id,
      video_id: null,
      source_type: "jwpub",
      content: joinOverlappingChunks(parts.map((p) => p.content)).slice(0, 9000),
      similarity: 0.99,
      metadata: {
        title: meta.title as string | undefined,
        chapterTitle: meta.chapterTitle as string | undefined,
        documentId: meta.documentId as number | undefined,
        type: "jwpub",
      },
    });
  }
  if (rows.length === 0) return null;

  return {
    rows,
    notice: `A semana a que o usuário se refere é a de ${week.labels[0]} de ${week.year}. As fontes com esse título são o material dessa semana — responda a partir delas.`,
  };
}

/** Chunks are cut with an ~80-character overlap; stitched naively every seam would repeat a sentence. */
function joinOverlappingChunks(chunks: string[]): string {
  let out = "";
  for (const chunk of chunks) {
    let overlap = 0;
    const max = Math.min(160, out.length, chunk.length);
    for (let n = max; n >= 12; n--) {
      if (out.endsWith(chunk.slice(0, n))) {
        overlap = n;
        break;
      }
    }
    out += (out && overlap === 0 ? " " : "") + chunk.slice(overlap);
  }
  return out;
}

// ─── Balancing ────────────────────────────────────────────────────────────────

const MAX_SOURCES = 12;
const GUARANTEED_PER_KIND = 3;

function sourceBucket(m: MatchResult): string {
  if (m.source_type === "video" || m.source_type === "biblia" || m.source_type === "publicacao") return m.source_type;
  return "own";
}

/** What counts as "the same document" when capping how many passages one of them may contribute. */
function documentKey(m: MatchResult): string {
  if (m.video_id) return `video:${m.video_id}`;
  if (m.source_type === "biblia") return `biblia:${m.metadata?.bookOrder}:${m.metadata?.chapter}`;
  if (m.source_type === "publicacao") return `pub:${m.metadata?.href ?? m.metadata?.title}:${m.metadata?.chapterTitle ?? ""}`;
  return `own:${m.note_id ?? m.id}:${m.metadata?.chapterTitle ?? ""}`;
}

/**
 * The search used to keep the best eight passages overall, so one kind of
 * source crowded the rest out: asked for "vídeos, textos bíblicos e
 * publicações sobre humildade", it answered with no video at all. Every kind
 * that found something now keeps its best few; the remaining room goes to
 * whatever scored highest.
 */
function balanceSources(rows: MatchResult[]): MatchResult[] {
  const sorted = [...rows].sort((a, b) => b.similarity - a.similarity);

  // No single video, chapter or article gets more than two passages.
  const perDocument = new Map<string, number>();
  const candidates = sorted.filter((m) => {
    const key = documentKey(m);
    const n = perDocument.get(key) ?? 0;
    if (n >= 2) return false;
    perDocument.set(key, n + 1);
    return true;
  });

  const picked = new Set<MatchResult>();
  const perBucket = new Map<string, number>();
  for (const m of candidates) {
    const bucket = sourceBucket(m);
    const n = perBucket.get(bucket) ?? 0;
    if (n < GUARANTEED_PER_KIND) {
      picked.add(m);
      perBucket.set(bucket, n + 1);
    }
  }
  for (const m of candidates) {
    if (picked.size >= MAX_SOURCES) break;
    picked.add(m);
  }

  return candidates.filter((m) => picked.has(m)).slice(0, MAX_SOURCES);
}

// ─── Video timestamps ─────────────────────────────────────────────────────────

const MAX_SUBTITLE_FETCHES = 6;
/** Above this a video row is a whole transcript (the exact-match path), not a passage. */
const WHOLE_TRANSCRIPT_CHARS = 5000;

const normalizeForMatch = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Says WHERE in the video each passage is. Transcript chunks carry no timing —
 * the text was flattened out of the subtitles when it was indexed — so "em que
 * minuto ele fala disso?" had no answer and a video source always opened at
 * 00:00. Re-indexing ten thousand chunks with timestamps would cost a full
 * re-crawl; instead the subtitles of the handful of videos that made it into
 * the answer are fetched here and each passage is located in them.
 *
 * A passage gets `startTime` (shown to the model) and `seekSnippet` (the
 * subtitle line itself, which is what InlineVideoCard matches to seek). A row
 * holding a whole transcript gets `[MM:SS]` markers woven through it instead,
 * so the model can time any part of it.
 */
async function addVideoTimestamps(supabase: Supabase, rows: MatchResult[]): Promise<void> {
  const byUrl = new Map<string, MatchResult[]>();
  for (const m of rows) {
    const url = m.source_type === "video" ? m.metadata?.subtitlesUrl : undefined;
    if (!url) continue;
    if (!byUrl.has(url) && byUrl.size >= MAX_SUBTITLE_FETCHES) continue;
    byUrl.set(url, [...(byUrl.get(url) ?? []), m]);
  }
  if (byUrl.size === 0) return;
  // Timed transcripts are long; only worth it when the answer is about very few videos.
  const fewVideos = new Set(rows.filter((m) => m.video_id).map((m) => m.video_id)).size <= 3;
  /** Rows whose subtitles could not be read — timed by estimate below. */
  const untimed: MatchResult[] = [];

  await Promise.all(
    [...byUrl].map(async ([url, videoRows]) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        const segments = res.ok ? parseVttToSegments(await res.text()) : [];
        if (segments.length === 0) {
          untimed.push(...videoRows);
          return;
        }

        // One normalized string of the whole subtitle track, with each line's offset in it.
        const offsets: number[] = [];
        let joined = "";
        for (const seg of segments) {
          offsets.push(joined.length);
          joined += normalizeForMatch(seg.text) + " ";
        }
        const segmentAt = (charIndex: number) => {
          let i = offsets.length - 1;
          while (i > 0 && offsets[i] > charIndex) i--;
          return segments[i];
        };

        for (const m of videoRows) {
          if (m.content.length > WHOLE_TRANSCRIPT_CHARS) {
            if (!fewVideos) continue;
            let timed = "";
            let lastMark = -Infinity;
            for (const seg of segments) {
              if (seg.startTime - lastMark >= 60) {
                timed += `\n[${formatClock(seg.startTime)}] `;
                lastMark = seg.startTime;
              }
              timed += seg.text + " ";
            }
            m.content = `${leadingStamp(m.content)}Transcrição com marcadores de tempo [MM:SS]:${timed}`.trim();
            continue;
          }

          const at = locatePassage(joined, m.metadata?.seekSnippet ?? m.content);
          if (at < 0) continue;
          const seg = segmentAt(at);
          m.metadata = { ...m.metadata, startTime: formatClock(seg.startTime), seekSnippet: seg.text };
        }
      } catch {
        untimed.push(...videoRows);
      }
    })
  );

  if (untimed.length > 0) {
    try {
      await estimateTimestamps(supabase, untimed, fewVideos);
    } catch {
      // No timing at all — the passage is still a valid source.
    }
  }
}

/**
 * rerankMatches may have stamped a verified fact on top of a transcript ("[Este
 * é o vídeo mais recente …, publicado em …]"). The transcript is rebuilt with
 * time markers, so that line has to be carried over.
 */
function leadingStamp(content: string): string {
  return content.startsWith("[Este é ") ? `${content.slice(0, content.indexOf("]") + 1)}\n\n` : "";
}

/**
 * Where `passage` starts inside `haystack` (both compared normalized), or -1.
 * Tries the passage's opening words, then a little further in each time: a
 * first chunk starts with "Vídeo: <título>", and chunk boundaries can fall
 * mid-caption.
 */
function locatePassage(haystack: string, passage: string): number {
  const words = normalizeForMatch(passage).split(" ");
  for (const start of [0, 6, 12, 20, 32]) {
    const probe = words.slice(start, start + 7);
    if (probe.length < 5) break;
    const at = haystack.indexOf(probe.join(" "));
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * Timing for videos whose subtitle file is gone. The catalog stores each
 * video's subtitles URL as of the day it was crawled, and JW's CDN moves them:
 * the August 2026 broadcast's answers 404. With no timing in front of it the
 * model simply made a minute up (three different ones in three runs).
 *
 * Speech runs at a steady enough pace that a passage's position in the
 * transcript, scaled by the video's length, lands within a minute or so. Those
 * times are written with a leading "~" so the answer says "por volta de".
 */
async function estimateTimestamps(supabase: Supabase, rows: MatchResult[], fewVideos: boolean): Promise<void> {
  const ids = [...new Set(rows.map((m) => m.video_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const { data } = await supabase.from("global_videos").select("id, content_text, duration_seconds").in("id", ids);
  const videos = new Map(
    ((data ?? []) as { id: string; content_text: string | null; duration_seconds: number | null }[]).map((v) => [v.id, v])
  );

  for (const m of rows) {
    const video = videos.get(m.video_id ?? "");
    if (!video?.content_text || !video.duration_seconds) continue;
    const full = video.content_text;

    if (m.content.length > WHOLE_TRANSCRIPT_CHARS) {
      if (!fewVideos) continue;
      const secondsPerChar = video.duration_seconds / full.length;
      let timed = "";
      let lastMark = -Infinity;
      let position = 0;
      for (const paragraph of full.split(/\n+/)) {
        const at = position * secondsPerChar;
        if (at - lastMark >= 60) {
          timed += `\n[~${formatClock(at)}] `;
          lastMark = at;
        }
        timed += paragraph + " ";
        position += paragraph.length + 2;
      }
      m.content = `${leadingStamp(m.content)}Transcrição com marcadores de tempo APROXIMADOS [~MM:SS]:${timed}`.trim();
      continue;
    }

    const normalized = normalizeForMatch(full);
    const at = locatePassage(normalized, m.content);
    if (at < 0) continue;
    m.metadata = { ...m.metadata, startTime: `~${formatClock((at / normalized.length) * video.duration_seconds)}` };
  }
}

// ─── Sources for the UI ───────────────────────────────────────────────────────

export interface SourceItem {
  noteId?: string;
  videoId?: string;
  jwlibraryNoteId?: string;
  type: string;
  title: string;
  chapterTitle?: string;
  documentId?: number;
  videoUrl?: string;
  coverImage?: string;
  durationFormatted?: string;
  subtitlesUrl?: string;
  snippet?: string;
  bookOrder?: number;
  chapter?: number;
  firstVerse?: number;
  /** Where a source with no note/video id opens (global publication, Research Guide, WOL). */
  href?: string;
  /** "12:34" — where the cited passage starts in the video. */
  startTime?: string;
}

/**
 * The source cards for a set of retrieved rows — one per document, in rank
 * order. `rowKeys[i]` is the key of `matchRows[i]`'s card: the prompt numbers
 * its sources by row, and the chat maps the numbers the model cites back to
 * cards through it.
 */
export function buildSources(matchRows: MatchResult[]): { sources: Map<string, SourceItem>; rowKeys: string[] } {
  const sources = new Map<string, SourceItem>();
  const rowKeys: string[] = [];

  for (const match of matchRows) {
    let meta: Record<string, unknown> = {};
    if (typeof match.metadata === "string") {
      try {
        meta = JSON.parse(match.metadata) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    } else if (typeof match.metadata === "object" && match.metadata !== null) {
      meta = match.metadata as Record<string, unknown>;
    }

    const noteId = match.note_id ?? (meta.noteId as string | undefined) ?? undefined;
    const videoId = match.video_id ?? (meta.videoId as string | undefined) ?? undefined;
    const jwlibraryNoteId = meta.jwlibraryNoteId as string | undefined;
    const chapterTitle = meta.chapterTitle as string | undefined;
    const documentId = meta.documentId as number | undefined;
    const bookOrder = meta.bookOrder as number | undefined;
    const chapter = meta.chapter as number | undefined;
    const firstVerse = (meta.firstVerse as number | null | undefined) ?? undefined;
    const href = meta.href as string | undefined;
    const startTime = meta.startTime as string | undefined;

    let type = (meta.type as string | undefined) || match.source_type || "nota";
    if (type !== "publicacao" && (chapterTitle || documentId || type === "jwpub")) {
      type = "jwpub";
    }

    const title = (meta.title as string | undefined) || (type === "video" ? "Vídeo JW" : "Item");
    // For a video the snippet is what the player seeks by — the located
    // subtitle line when there is one.
    const snippet = (meta.seekSnippet as string | undefined) ?? (match.content ? match.content.trim() : undefined);

    const key = videoId
      ? `video:${videoId}`
      : jwlibraryNoteId
        ? `jwlibrary:${jwlibraryNoteId}`
        : type === "publicacao"
          ? `pub:${href ?? title}:${chapterTitle ?? ""}`
          : bookOrder !== undefined && chapter !== undefined
            ? `biblia:${bookOrder}:${chapter}`
            : `${noteId}:${chapterTitle ?? ""}`;
    rowKeys.push(key);
    if (sources.has(key)) continue;

    sources.set(key, {
      ...(noteId ? { noteId } : {}),
      ...(videoId ? { videoId } : {}),
      ...(jwlibraryNoteId ? { jwlibraryNoteId } : {}),
      type,
      title,
      ...(chapterTitle ? { chapterTitle } : {}),
      ...(documentId ? { documentId } : {}),
      ...(snippet ? { snippet: snippet.slice(0, 1200) } : {}),
      ...(meta.videoUrl ? { videoUrl: meta.videoUrl as string } : {}),
      ...(meta.coverImage ? { coverImage: meta.coverImage as string } : {}),
      ...(meta.durationFormatted ? { durationFormatted: meta.durationFormatted as string } : {}),
      ...(meta.subtitlesUrl ? { subtitlesUrl: meta.subtitlesUrl as string } : {}),
      ...(bookOrder !== undefined ? { bookOrder } : {}),
      ...(chapter !== undefined ? { chapter } : {}),
      ...(firstVerse !== undefined ? { firstVerse } : {}),
      ...(href ? { href } : {}),
      ...(startTime ? { startTime } : {}),
    });
  }

  return { sources, rowKeys };
}
