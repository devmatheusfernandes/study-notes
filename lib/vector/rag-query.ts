import { createClient } from "@/lib/supabase/server";

export interface MatchResult {
  id: string;
  note_id: string | null;
  video_id: string | null;
  source_type: string;
  content: string;
  metadata: {
    title?: string;
    type?: string;
    chapterTitle?: string;
    documentId?: number;
    videoId?: string;
    videoUrl?: string;
    coverImage?: string;
    durationFormatted?: string;
    subtitlesUrl?: string;
  };
  similarity: number;
}

/**
 * Which end of the timeline the user is pointing at ("latest"/"oldest"), and
 * how many items in from that end ("penúltimo"/"segundo mais antigo" etc. are
 * not the edge itself, offsetFromEnd 0, but one step in, offsetFromEnd 1).
 */
export interface OrdinalConstraint {
  direction: "latest" | "oldest";
  offsetFromEnd: number;
}

export interface QueryConstraints {
  targetYear: number | null;
  targetNum: number | null;
  /** e.g. "a ultima adoracao matinal", "o video mais recente" -- no year/number given, just "give me the newest one". Kept as a plain boolean alongside `ordinal` since it's the overwhelmingly common case and reads clearer at call sites than `ordinal?.direction === "latest" && ordinal.offsetFromEnd === 0`. */
  wantsLatest: boolean;
  /** Non-null whenever the query points at a specific position from either end of a timeline: "último" (latest, 0), "penúltimo" (latest, 1), "antepenúltimo" (latest, 2), "primeiro"/"mais antigo" (oldest, 0), "segundo mais recente" (latest, 1), "terceiro mais antigo" (oldest, 2), etc. */
  ordinal: OrdinalConstraint | null;
}

const ORDINAL_STEMS: { stem: RegExp; value: number }[] = [
  { stem: /primeir/, value: 1 },
  { stem: /segund/, value: 2 },
  { stem: /terceir/, value: 3 },
  { stem: /quart/, value: 4 },
  { stem: /quint/, value: 5 },
];

/**
 * Parses ordinal/temporal-position language out of an already accent-stripped,
 * lowercased query. Order matters: "antepenultimo"/"penultimo" must be checked
 * before the bare "ultimo" fallback below them, since neither contains a
 * `\bultim` word boundary (accepted, not a coincidence to rely on) -- checking
 * the more specific compound words first just keeps the intent obvious.
 */
function parseOrdinalConstraint(norm: string): OrdinalConstraint | null {
  if (/\bantepenultim[ao]s?\b/.test(norm)) return { direction: "latest", offsetFromEnd: 2 };
  if (/\bpenultim[ao]s?\b/.test(norm)) return { direction: "latest", offsetFromEnd: 1 };

  // "segundo mais recente", "terceiro mais antigo", "o segundo vídeo mais
  // recente", etc. -- an ordinal word paired with an explicit direction, so
  // the offset can be any N. The optional `(?:\s+\w+)?` tolerates a single
  // noun sitting between the two (e.g. "vídeo", "boletim").
  const rankedMatch = norm.match(
    /\b(primeir|segund|terceir|quart|quint)[oa]s?(?:\s+\w+)?\s+(?:mais\s+)?(recente|nov[oa]|antig[oa]|velh[oa])/
  );
  if (rankedMatch) {
    const value = ORDINAL_STEMS.find((s) => s.stem.test(rankedMatch[1]))?.value ?? 1;
    const direction = /antig|velh/.test(rankedMatch[2]) ? "oldest" : "latest";
    return { direction, offsetFromEnd: value - 1 };
  }

  if (/\b(ultim[ao]s?|mais recente[s]?|mais nov[ao]s?|recentemente)\b/.test(norm)) {
    return { direction: "latest", offsetFromEnd: 0 };
  }

  if (/\b(primeir[ao]s?|mais antig[ao]s?|mais velh[ao]s?)\b/.test(norm)) {
    return { direction: "oldest", offsetFromEnd: 0 };
  }

  return null;
}

/** Portuguese description of an ordinal position, used to stamp a verified-fact annotation into the winning source's content -- see `rerankMatches` below. */
function describeOrdinal(ordinal: OrdinalConstraint): string {
  const n = ordinal.offsetFromEnd + 1;
  if (ordinal.direction === "latest") {
    if (n === 1) return "o vídeo mais recente";
    if (n === 2) return "o penúltimo vídeo (2º mais recente)";
    if (n === 3) return "o antepenúltimo vídeo (3º mais recente)";
    return `o ${n}º vídeo mais recente`;
  }
  if (n === 1) return "o vídeo mais antigo";
  return `o ${n}º vídeo mais antigo`;
}

export function parseQueryConstraints(query: string): QueryConstraints {
  const norm = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // 1. Extract 4-digit year (e.g. 2024, 2026, 2022)
  let targetYear: number | null = null;
  const yearMatch = norm.match(/\b(20[0-9]{2}|19[0-9]{2})\b/);
  if (yearMatch) {
    targetYear = parseInt(yearMatch[1], 10);
  }

  // Remove the year to avoid confusing bulletin number extraction
  const queryWithoutYear = targetYear ? norm.replace(String(targetYear), "") : norm;

  // 2. Extract bulletin / item number (e.g. "numero 2", "nº 2", "n.º 2", "n2", "boletim 2")
  let targetNum: number | null = null;
  const numMatch =
    queryWithoutYear.match(/(?:numero|num|n[.\sº°o]*|boletim|capitulo|parte|edicao)\s*(\d+)/i) ??
    queryWithoutYear.match(/\b(\d{1,2})\b/);

  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 200) {
      targetNum = num;
    }
  }

  // 3. Ordinal/temporal position -- "ultimo", "penultimo", "primeiro",
  // "mais antigo", "segundo mais recente", etc. Deliberately a separate
  // signal from year/number, since a query can say "a ultima" with no digits
  // at all.
  const ordinal = parseOrdinalConstraint(norm);
  const wantsLatest = ordinal !== null && ordinal.direction === "latest" && ordinal.offsetFromEnd === 0;

  return { targetYear, targetNum, wantsLatest, ordinal };
}

/**
 * `supabase` is only needed for the ordinal case ("ultimo"/"penultimo"/
 * "primeiro"/"mais antigo"/etc.) -- one extra lookup for `first_published` on
 * whatever video candidates semantic search already surfaced (never a fresh
 * broad query), so whichever of those sits at the requested position in the
 * timeline gets boosted to the top instead of just "whatever's most
 * semantically similar to the word 'recente'".
 */
export async function rerankMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  matches: MatchResult[]
): Promise<MatchResult[]> {
  const { targetYear, targetNum, ordinal } = parseQueryConstraints(query);
  if (targetYear === null && targetNum === null && !ordinal) return matches;

  let reranked: MatchResult[] = [];

  for (const m of matches) {
    const metaStr = typeof m.metadata === "string" ? m.metadata : JSON.stringify(m.metadata ?? {});
    const textToSearch = `${m.content} ${metaStr}`.toLowerCase();
    const itemConstraints = parseQueryConstraints(textToSearch);

    let scoreModifier = 0;
    let isYearConflicting = false;
    let isNumConflicting = false;

    // Check Year
    if (targetYear !== null) {
      if (textToSearch.includes(String(targetYear))) {
        scoreModifier += 0.4;
      } else if (itemConstraints.targetYear !== null && itemConstraints.targetYear !== targetYear) {
        isYearConflicting = true;
        scoreModifier -= 0.6;
      }
    }

    // Check Bulletin / Item Number
    if (targetNum !== null) {
      const numPatterns = [
        `n.º ${targetNum}`,
        `nº ${targetNum}`,
        `n.º${targetNum}`,
        `n. ${targetNum}`,
        `n ${targetNum}`,
        `numero ${targetNum}`,
        `nº${targetNum}`,
        `boletim ${targetNum}`,
        `— ${targetNum}`,
      ];

      const matchesNumPattern =
        numPatterns.some((pat) => textToSearch.includes(pat)) ||
        itemConstraints.targetNum === targetNum;

      if (matchesNumPattern) {
        scoreModifier += 0.5;
      } else if (itemConstraints.targetNum !== null && itemConstraints.targetNum !== targetNum) {
        isNumConflicting = true;
      }
    }

    // Severe penalty if bulletin number conflicts (e.g. n.º 5 when asking for n.º 2)
    if (isNumConflicting) {
      scoreModifier -= 0.8;
    }

    // Severe penalty if year conflicts (e.g. 2024 when asking for 2026)
    if (isYearConflicting) {
      scoreModifier -= 0.8;
    }

    // Double penalty if both conflict
    if (isYearConflicting && isNumConflicting) {
      scoreModifier -= 1.0;
    }

    reranked.push({
      ...m,
      similarity: m.similarity + scoreModifier,
    });
  }

  if (ordinal) {
    const videoMatches = reranked.filter((m) => m.source_type === "video" && m.video_id);
    const videoIds = [...new Set(videoMatches.map((m) => m.video_id!))];

    if (videoIds.length > 0) {
      const { data: videoDates } = await supabase
        .from("global_videos")
        .select("id, first_published")
        .in("id", videoIds);
      const publishedAt = new Map(
        (videoDates ?? []).map((v) => [v.id, v.first_published ? new Date(v.first_published).getTime() : 0])
      );

      // Sort the candidates the semantic search already surfaced along the
      // requested direction, then take whichever one sits at the requested
      // offset from that end -- "penultimo" (offsetFromEnd 1) is the second
      // entry once sorted newest-first, "segundo mais antigo" the second
      // entry sorted oldest-first, etc. Clamped so an offset past the end of
      // a short candidate list still resolves to the farthest one available
      // rather than to nothing.
      const sortedIds = [...videoIds].sort((a, b) => {
        const ta = publishedAt.get(a) ?? 0;
        const tb = publishedAt.get(b) ?? 0;
        return ordinal.direction === "latest" ? tb - ta : ta - tb;
      });
      const targetId = sortedIds[Math.min(ordinal.offsetFromEnd, sortedIds.length - 1)];
      const target = videoMatches.find((m) => m.video_id === targetId) ?? null;

      // A transcript never states its own air date, so boosting the target
      // video's *rank* alone isn't enough -- the model has no way to tell
      // which of several same-topic transcripts sits at the requested
      // position. Two things fix that: (1) drop every other same-topic video
      // entirely instead of just out-ranking it -- dozens of full transcripts
      // in context is both expensive and exactly what made the model reply
      // "I don't see which is the latest" instead of just answering; (2)
      // stamp the survivor's real publish date directly into its content, the
      // one piece of information nothing else in the pipeline carries
      // forward.
      if (target) {
        const targetTime = publishedAt.get(targetId!) ?? 0;
        const dateLabel =
          targetTime > 0
            ? new Date(targetTime).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
            : null;
        const descriptor = describeOrdinal(ordinal);
        reranked = reranked
          .filter((m) => m === target || m.source_type !== "video" || !videoIds.includes(m.video_id!))
          .map((m) =>
            m === target
              ? {
                  ...m,
                  similarity: m.similarity + 1.0,
                  content: dateLabel
                    ? `[Este é ${descriptor} sobre o tema pedido, publicado em ${dateLabel}]\n\n${m.content}`
                    : m.content,
                }
              : m
          );
      }
    }
  }

  // If we have an exact metadata match (similarity >= 0.95), filter strictly for exact matches (similarity >= 0.85)
  const hasExactMatch = reranked.some((m) => m.similarity >= 0.95);
  if (hasExactMatch) {
    return reranked
      .filter((m) => m.similarity >= 0.85)
      .sort((a, b) => b.similarity - a.similarity);
  }

  // Filter out matches whose penalized similarity dropped below 0.35 threshold
  const validMatches = reranked.filter((m) => m.similarity >= 0.35);
  return validMatches.sort((a, b) => b.similarity - a.similarity);
}

export function formatAllowedSourcesLabel(allowedSourceTypes: string[]): string {
  const typeMap: Record<string, string> = {
    nota: "suas notas",
    pdf: "seus PDFs/arquivos",
    jwpub: "suas publicações JWPUB",
    video: "seus vídeos JW",
    estudo_pessoal: "seu estudo pessoal",
    biblia: "a Bíblia",
  };

  const labels = allowedSourceTypes.map((t) => typeMap[t] || t);
  if (labels.length === 0 || labels.length === 6) {
    return "suas notas, publicações, vídeos, estudo pessoal e a Bíblia";
  }
  if (labels.length === 1) {
    return labels[0];
  }
  return `seus conteúdos (${labels.join(", ")})`;
}

/**
 * Category names a user might type verbatim, mapped to the `category_key`
 * JW.org itself assigns (already stored on every `global_videos` row by
 * scripts/seed-all-videos.mjs, just never queried against before) -- verified
 * against the live JW.org mediator API and the videos actually in this DB.
 * Deliberately more liberal than the "boletim" special case below: these
 * names aren't likely to show up as an incidental word in an unrelated
 * follow-up question the way "boletim" can, so a bare mention (no year or
 * "ultima") is still specific enough to justify filtering by it.
 */
const CATEGORY_KEYWORDS: { pattern: RegExp; categoryKey: string }[] = [
  { pattern: /adorac(?:ao|oes) matina(?:l|is)/, categoryKey: "VODPgmEvtMorningWorship" },
  { pattern: /formaturas? de gilead/, categoryKey: "VODPgmEvtGilead" },
  { pattern: /\bbroadcasting\b/, categoryKey: "StudioMonthlyPrograms" },
];

function detectCategoryKey(normalizedAccentStrippedQuery: string): string | null {
  for (const { pattern, categoryKey } of CATEGORY_KEYWORDS) {
    if (pattern.test(normalizedAccentStrippedQuery)) return categoryKey;
  }
  return null;
}

/** Escapes Postgres LIKE/ILIKE metacharacters so a literal "%" or "_" typed by the user doesn't act as a wildcard. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/**
 * Words in the query too generic/frequent to mean anything on their own --
 * filtered out before the title-keyword fallback below so "vídeos sobre Mark
 * Noumair" reduces to the two words that actually identify the video
 * ("mark", "noumair"), not "vídeos"/"sobre" which would match nearly
 * everything.
 */
const TITLE_SEARCH_STOPWORDS = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "em", "no", "na", "nos", "nas", "sobre", "com", "para", "por", "que", "qual", "quais",
  "quem", "como", "onde", "quando", "video", "videos", "resuma", "resumir", "resume",
  "mostre", "mostra", "mostrar", "me", "informacoes", "informacao", "fale", "falar",
  "conte", "contar", "titulo", "chamado", "chamada", "nome", "publicacao", "nota",
  "notas", "arquivo", "arquivos", "seja", "tem", "existe", "achar", "encontrar",
  "procura", "procurar", "isso", "essa", "esse", "esta", "este", "meu", "minha",
  "meus", "minhas", "qualquer", "algum", "alguma",
  // Ordinal/temporal and common verb forms (see parseQueryConstraints'
  // ordinal handling above) -- these show up in "qual foi o penúltimo
  // vídeo"-style questions that name a *position*, not a title, and would
  // otherwise falsely satisfy the >=2-word threshold below.
  "foi", "sao", "vai", "ser", "sera", "houve", "havia", "mais",
  "ultimo", "ultima", "penultimo", "penultima", "antepenultimo", "antepenultima",
  "primeiro", "primeira", "segundo", "segunda", "terceiro", "terceira",
  "recente", "recentemente", "novo", "nova", "antigo", "antiga", "velho", "velha",
  // Common request/wish verbs -- "quero vídeos com X" would otherwise force
  // "quero" itself into the required-in-title set below, and no real title
  // contains it, so the whole AND-match would silently find nothing despite
  // the actual name ("X") being right there. A hand-kept list is inherently
  // incomplete, but covers the overwhelmingly common ways this app's own
  // Portuguese-speaking users phrase "find me a video about X".
  "quero", "queres", "quer", "queremos", "querem", "queria", "queriam",
  "gostaria", "gostava", "gosto", "gostei", "preciso", "precisa", "precisamos",
  "procuro", "busco", "busca", "ache", "encontre", "consiga", "consigo",
  "consegue", "poderia", "pode", "podem", "deseja", "desejo", "ver", "vejo",
  "veja", "assistir", "assista", "curtir", "curta", "manda", "mande", "traga",
  "traz", "exiba", "apresente", "aqui", "ali", "algo", "coisa", "coisas",
]);

/**
 * Words specific enough to identify a title by themselves ("mark",
 * "noumair", "anatote") -- everything else in the sentence around them
 * ("vídeos sobre", "resuma o vídeo") is just how a person phrases a
 * question, not part of what they're naming. Requires at least 2 to trigger
 * the fallback below, for the same reason the bare "boletim" case doesn't:
 * a single generic word (e.g. "estudo") would match dozens of unrelated
 * titles as fake "exact" matches.
 */
function extractTitleKeywords(query: string): string[] {
  const words = query
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !TITLE_SEARCH_STOPWORDS.has(w));
  return [...new Set(words)];
}

export async function fetchExactMetadataMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  allowedTypes: string[]
): Promise<MatchResult[]> {
  const { targetYear, targetNum } = parseQueryConstraints(query);
  const norm = query.toLowerCase();
  const normStripped = norm.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const isBoletimSearch = norm.includes("boletim");
  const categoryKey = detectCategoryKey(normStripped);
  const titleKeywords = extractTitleKeywords(query);
  const hasKeywordSignal = titleKeywords.length >= 2;

  // A bare "boletim" mention with no year or number is too vague to justify
  // forcing every bulletin video in as a fake "exact" match (similarity
  // 0.99) — that's what turned a follow-up like "qual boletim especificamente
  // falou sobre isso" (no year/number of its own) into ~30 unrelated video
  // sources. Semantic vector search (match_hybrid_embeddings, called by the
  // caller) already ranks by actual content relevance for that case. A named
  // category match doesn't have that ambiguity, so it's allowed through on
  // its own below — as is a specific enough title-keyword match.
  if (targetYear === null && targetNum === null && !categoryKey && !hasKeywordSignal) {
    return [];
  }

  const results: MatchResult[] = [];

  if (allowedTypes.includes("video")) {
    function baseVideoQuery() {
      let q = supabase
        .from("global_videos")
        .select("id, title, content_text, video_url, cover_image, duration_formatted, subtitles_url");
      if (categoryKey) q = q.eq("category_key", categoryKey);
      if (isBoletimSearch) q = q.ilike("title", "%Boletim%");
      if (targetYear !== null) q = q.ilike("title", `%${targetYear}%`);
      return q;
    }

    // Every significant word must appear in the title -- e.g. "mark" AND
    // "noumair" -- rather than any one of them, so a query naming a specific
    // video doesn't pull in every other video that happens to share just one
    // of its words. Chaining .ilike() on the same column multiple times is
    // PostgREST's documented way to AND several conditions together.
    //
    // Without the trailing `.order().limit(30)`, an unordered slice risks
    // missing the actual most recent video entirely on a category/year match
    // with hundreds of rows — which the ordinal rerank step below depends on
    // being present.
    let videoQuery = baseVideoQuery();
    for (const word of titleKeywords) videoQuery = videoQuery.ilike("title", `%${escapeLikePattern(word)}%`);
    let { data: vids } = await videoQuery.order("first_published", { ascending: false, nullsFirst: false }).limit(30);

    // The stopword list above is inherently incomplete — a filler word that
    // slips through (an unanticipated verb, a name that also happens to be a
    // common noun, ...) would otherwise make the strict AND above silently
    // return nothing even though the video is right there. Retry once with
    // just the two longest keywords, on the theory that the actual
    // identifying words (a name, a distinctive term) are rarely the shortest
    // ones in the sentence.
    if ((!vids || vids.length === 0) && titleKeywords.length >= 3) {
      const longestTwo = [...titleKeywords].sort((a, b) => b.length - a.length).slice(0, 2);
      let retryQuery = baseVideoQuery();
      for (const word of longestTwo) retryQuery = retryQuery.ilike("title", `%${escapeLikePattern(word)}%`);
      ({ data: vids } = await retryQuery.order("first_published", { ascending: false, nullsFirst: false }).limit(30));
    }

    if (vids && vids.length > 0) {
      for (const v of vids) {
        const titleLower = v.title.toLowerCase();
        const vConstraints = parseQueryConstraints(titleLower);

        let isMatch = true;
        if (targetNum !== null && vConstraints.targetNum !== targetNum) {
          const numPats = [
            `n.º ${targetNum}`,
            `nº ${targetNum}`,
            `n.º${targetNum}`,
            `n. ${targetNum}`,
            `n ${targetNum}`,
            `— ${targetNum}`,
          ];
          if (!numPats.some((p) => titleLower.includes(p))) {
            isMatch = false;
          }
        }

        if (isMatch) {
          results.push({
            id: `exact-vid-${v.id}`,
            note_id: null,
            video_id: v.id,
            source_type: "video",
            content: v.content_text || `Vídeo: ${v.title}`,
            similarity: 0.99,
            metadata: {
              title: v.title,
              type: "video",
              videoId: v.id,
              videoUrl: v.video_url,
              coverImage: v.cover_image,
              durationFormatted: v.duration_formatted,
              subtitlesUrl: v.subtitles_url,
            },
          });
        }
      }
    }
  }

  return results;
}
