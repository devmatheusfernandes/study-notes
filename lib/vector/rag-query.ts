import { createClient } from "@/lib/supabase/server";
import { formatTodayPt } from "./today";
import { findBibleReferenceInText } from "@/lib/bible/parse-reference";

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
    /** Set on a video pulled in by fetchExactMetadataMatches' title-keyword fallback — see buildRagSystemPrompt, which treats a batch of these as a "find by name" listing request rather than a factual question one transcript answers. */
    matchedByTitleKeyword?: boolean;
    /** Title of the larger program a talk is also contained in ("JW Broadcasting — Junho de 2026"). */
    partOf?: string;
    /** ISO publication date of a video, filled by applyPublishPeriod so the model can judge "recente"/"este mês" instead of guessing. */
    publishedAt?: string;
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
  /**
   * True only when `targetNum` came from an explicit prefix word ("número
   * 2", "boletim 2", "edição 2") -- false when it's the bare `\d{1,2}`
   * fallback below picking up an incidental short number (a Bible chapter,
   * a verse, the leading "1"/"2"/"3" of a book name like "1 Coríntios").
   * `rerankMatches`' conflict-penalty logic must only trust the explicit
   * case: penalizing a candidate because its transcript happens to contain
   * some unrelated one/two-digit number turned a verified exact match (e.g.
   * a "1 Coríntios capítulo 9" query hitting the right Morning Worship talk)
   * into a rejected one -- confirmed empirically against the real talk
   * "Mark Scott: Estabeleça Alvos Que Honrem a Jeová (1 Cor. 9:26)", whose
   * transcript's own first incidental number didn't happen to be 9.
   */
  targetNumExplicit: boolean;
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

  // 2. Extract bulletin / item number (e.g. "numero 2", "nº 2", "n.º 2", "n2", "boletim 2").
  // Deliberately does NOT include "capitulo" -- that word means a Bible or
  // publication chapter, never a bulletin/edição number, and nothing
  // downstream actually checks for a "capítulo N" citation style; including
  // it here only fed a chapter number into the bulletin-numbering
  // conflict-check below.
  let targetNum: number | null = null;
  let targetNumExplicit = false;
  const explicitNumMatch = queryWithoutYear.match(/(?:numero|num|n[.\sº°o]*|boletim|parte|edicao)\s*(\d+)/i);
  const numMatch = explicitNumMatch ?? queryWithoutYear.match(/\b(\d{1,2})\b/);

  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 200) {
      targetNum = num;
      targetNumExplicit = explicitNumMatch !== null;
    }
  }

  // 3. Ordinal/temporal position -- "ultimo", "penultimo", "primeiro",
  // "mais antigo", "segundo mais recente", etc. Deliberately a separate
  // signal from year/number, since a query can say "a ultima" with no digits
  // at all.
  const ordinal = parseOrdinalConstraint(norm);
  const wantsLatest = ordinal !== null && ordinal.direction === "latest" && ordinal.offsetFromEnd === 0;

  return { targetYear, targetNum, targetNumExplicit, wantsLatest, ordinal };
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
  const { targetYear, targetNum, targetNumExplicit, ordinal } = parseQueryConstraints(query);
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

    // Check Bulletin / Item Number -- only when the query's number came from
    // an explicit bulletin/edição word (see targetNumExplicit above). A
    // bare-fallback number (a Bible chapter/verse digit, a book's leading
    // "1"/"2"/"3", ...) is too coincidental to justify rejecting a candidate
    // just because its own transcript happens to mention some unrelated
    // one/two-digit number.
    if (targetNum !== null && targetNumExplicit) {
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
        (itemConstraints.targetNumExplicit && itemConstraints.targetNum === targetNum);

      if (matchesNumPattern) {
        scoreModifier += 0.5;
      } else if (itemConstraints.targetNumExplicit && itemConstraints.targetNum !== targetNum) {
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
 * Several results that ALL came from the title-keyword fallback above is a
 * "find/list videos by this name" request, not a factual question one
 * transcript answers -- confirmed by testing "quero vídeos com mark
 * noumair" for real: with 26 matched talks (each forced to similarity 0.99,
 * so the ordinary "high-confidence" prompt below still applied) concatenated
 * as full transcripts, gpt-4o-mini still replied "não encontrei" despite the
 * explicit instruction not to, apparently because none of 26 disparate talks
 * individually "answers" a request that's really just asking whether
 * matching videos exist. A single keyword match (the "resuma o vídeo X" case)
 * deliberately does NOT take this path -- there the user does want the real
 * transcript summarized, not just a title listing.
 */
function isKeywordListing(matchRows: MatchResult[]): boolean {
  return (
    matchRows.length > 1 &&
    matchRows.every((m) => m.source_type === "video" && m.metadata?.matchedByTitleKeyword)
  );
}

/**
 * Builds the RAG system prompt for a chat/assistant completion from its
 * retrieved `matchRows` -- shared by both stream routes so the three answer
 * styles below (nothing found / listing / content) stay in sync instead of
 * risking the two copies drifting apart.
 */
export function buildRagSystemPrompt(
  matchRows: MatchResult[],
  sourcesLabel: string,
  notice?: string | null,
  options?: { citeSources?: boolean }
): string {
  return (
    `Data de hoje: ${formatTodayPt()}. Use-a para qualquer julgamento de tempo ("recente", "último", "este mês"): ` +
    `compare sempre com esta data e com as datas de publicação indicadas nas fontes, nunca com a sua própria noção de data.

` +
    (notice ? `AVISO DO SISTEMA DE BUSCA (fato verificado): ${notice}

` : "") +
    buildRagSystemPromptBody(matchRows, sourcesLabel, options?.citeSources ?? false)
  );
}

function buildRagSystemPromptBody(matchRows: MatchResult[], sourcesLabel: string, citeSources: boolean): string {
  if (matchRows.length === 0) {
    return (
      `Você é o assistente inteligente do Study Notes. O usuário pesquisou especificamente em ${sourcesLabel}, ` +
      `mas NÃO foi encontrado nenhum trecho relevante para a pergunta dele. ` +
      `Responda educadamente informando especificamente que não encontrou informações relevantes em ${sourcesLabel}.`
    );
  }

  if (isKeywordListing(matchRows)) {
    const titles = matchRows.map((m, idx) => `${idx + 1}. ${m.metadata?.title ?? "Vídeo"}`).join("\n");
    return (
      `Você é o assistente inteligente do Study Notes. O sistema de busca JÁ CONFIRMOU que os vídeos listados abaixo ` +
      `existem e correspondem ao nome/palavra-chave que o usuário pediu — isso é um FATO já verificado, não uma suposição sua. ` +
      `O pedido do usuário é para ENCONTRAR/LISTAR vídeos por nome, não para responder uma pergunta factual extraída do conteúdo ` +
      `de um deles específico. Confirme que os vídeos foram encontrados e liste os títulos abaixo — a interface já mostra os ` +
      `cartões de cada um separadamente, então não precisa descrever o conteúdo de cada vídeo em detalhe. ` +
      `NUNCA diga que não encontrou informações: os vídeos foram encontrados, estão listados abaixo. ` +
      `Responda em português, de forma breve.\n\n` +
      `VÍDEOS ENCONTRADOS (${matchRows.length}):\n${titles}`
    );
  }

  // A broad question ("quais boletins saíram em 2026?") can match dozens of
  // whole transcripts; sent in full that overflowed the model's context window
  // (144k tokens against a 128k limit) and the answer simply failed. Share a
  // fixed budget across the sources instead: a single exact match still gets
  // its transcript nearly whole, a long list gets a leading excerpt of each.
  const CONTEXT_CHAR_BUDGET = 48_000;
  const MAX_CONTEXT_SOURCES = 15;
  const contextRows = matchRows.slice(0, MAX_CONTEXT_SOURCES);
  const perSourceCap = Math.max(1_200, Math.floor(CONTEXT_CHAR_BUDGET / contextRows.length));
  const contextText = contextRows
    .map((m, idx) => {
      const label = m.metadata?.chapterTitle
        ? `${m.metadata.title} — ${m.metadata.chapterTitle}`
        : m.metadata?.title || "Conteúdo";
      const published =
        (m.metadata?.publishedAt
          ? ` — publicado em ${new Date(m.metadata.publishedAt).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`
          : "") + (m.metadata?.partOf ? ` — trecho de «${m.metadata.partOf}»` : "");
      const body = m.content.length > perSourceCap ? `${m.content.slice(0, perSourceCap)}…` : m.content;
      return `[Fonte ${idx + 1}: ${label}${published}]\n${body}`;
    })
    .join("\n\n---\n\n");

  // With several sources the model matched titles to the wrong dates inside the
  // long transcripts (n.º 1 reported with n.º 2's date). A compact index of
  // title + date up front gives it the facts without digging through the text.
  const sourceIndex =
    contextRows.length > 1
      ? `ÍNDICE DAS FONTES (título — data de publicação, fatos verificados):\n` +
        contextRows
          .map((m, idx) => {
            const date = m.metadata?.publishedAt
              ? new Date(m.metadata.publishedAt).toLocaleDateString("pt-BR", { timeZone: "UTC" })
              : "data não informada";
            return `${idx + 1}. ${m.metadata?.title || "Conteúdo"} — ${date}`;
          })
          .join("\n") +
        "\n\n"
      : "";

  // A similarity this high only happens for a forced exact match
  // (fetchExactMetadataMatches' year/número/category hits start at 0.99, and
  // the ordinal boost pushes the winner past that) — i.e. cases where the
  // retrieval layer has *already* confirmed relevance, not just a semantic
  // guess. Telling the model it's still free to hedge with "não foi
  // encontrado" in that situation was actively counterproductive: tested
  // empirically against a real "resuma a última adoração matinal" query, the
  // cautious wording below made gpt-4o-mini decline in roughly half of
  // repeated identical calls at the app's own temperature, even with the
  // correct, clearly-labeled video transcript sitting right there in
  // context — a more assertive prompt for just this case (no escape hatch
  // offered) answered correctly 5/5 times. The ordinary threshold-only case
  // below keeps the cautious wording, since a merely-above-threshold
  // semantic match can legitimately be a poor fit worth declining.
  const hasHighConfidenceMatch = matchRows.some((m) => m.similarity >= 0.95);

  // The search over-fetches (a dozen transcripts for one question), and the
  // UI lists every one as a source. Asking the model which it actually drew
  // on lets the route show only those — see SOURCES_MARKER_RE's consumer in
  // chats/[id]/stream/route.ts.
  const citeInstruction = citeSources
    ? `

AO FINAL da resposta, em uma última linha separada, escreva exatamente <<FONTES: N, N>> com os números das [Fonte N] ` +
      `que você realmente usou (somente as que sustentam a resposta; normalmente poucas). Se não usou nenhuma, escreva <<FONTES: nenhuma>>. ` +
      `Nunca mencione essa linha no texto da resposta.`
    : "";

  return (hasHighConfidenceMatch
    ? `Você é o assistente inteligente do Study Notes. Você recebeu abaixo o trecho de contexto exato que responde à pergunta do usuário — ` +
        `o sistema de busca já confirmou que esse é o conteúdo certo, incluindo quando um trecho começa com uma anotação entre colchetes ` +
        `(como "[Este é o vídeo mais recente sobre o tema pedido, publicado em ...]"): isso é um FATO já verificado, não uma suposição sua. ` +
        `Responda diretamente a pergunta do usuário usando esse conteúdo, em português, de forma clara e concisa, usando Markdown quando apropriado. ` +
        `Não invente detalhes que não estejam no trecho, mas TAMBÉM não diga que a informação não foi encontrada — ela foi.\n\n` +
        `${sourceIndex}CONTEXTO DOS CONTEÚDOS SELECIONADOS (${sourcesLabel.toUpperCase()}):\n\n${contextText}`
    : `Você é o assistente inteligente do Study Notes. Responda APENAS com base nos trechos de contexto fornecidos abaixo, ` +
        `extraídos de ${sourcesLabel}. NÃO invente informações que não estejam nos trechos. ` +
        `Se os trechos não contiverem a resposta exata para a pergunta, diga especificamente que a informação não foi encontrada em ${sourcesLabel}. ` +
        `Responda de forma clara, prestativa e concisa em português. Use formatação Markdown quando apropriado.\n\n` +
        `${sourceIndex}CONTEXTO DOS CONTEÚDOS SELECIONADOS (${sourcesLabel.toUpperCase()}):\n\n${contextText}`) + citeInstruction;
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

/** Accent-strips and lowercases a single word for stopword/exclusion comparisons -- kept separate from tokenizing a whole query (see `extractTitleKeywords`) since callers here only ever need to normalize one already-isolated word at a time. */
function stripAccentsLower(word: string): string {
  return word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

interface CategoryMatch {
  categoryKey: string;
  /** Accent-stripped words making up the matched phrase (e.g. {"adoracoes","matinais"}) -- see the exclusion in fetchExactMetadataMatches below. */
  matchedWords: Set<string>;
}

function detectCategoryKey(normalizedAccentStrippedQuery: string): CategoryMatch | null {
  for (const { pattern, categoryKey } of CATEGORY_KEYWORDS) {
    const match = pattern.exec(normalizedAccentStrippedQuery);
    if (match) {
      return { categoryKey, matchedWords: new Set(match[0].split(/\s+/).filter(Boolean)) };
    }
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
  // Words describing the *medium/act* rather than naming anything specific —
  // "discurso do Gerrit Lösch que falava sobre o tempo" would otherwise force
  // "discurso" and "falava" into the required set below, and neither a talk's
  // title nor its own transcript is likely to literally contain "discurso"
  // ("this speech") or "falava" ("was saying") — an unmatchable requirement
  // that made a real speaker+topic query find nothing.
  "discurso", "discursos", "palestra", "palestras", "apresentacao",
  "fala", "falava", "falou", "falam", "falando", "disse", "dizia",
  "aborda", "abordou", "abordando", "trata", "tratou", "tratando", "mencionou",
  "virar", "tornar", "sem", "ter", "sendo", "todo", "toda", "todos", "todas",
  // "E o boletim número 6 de 2026? Ele existe no banco?" -- the bulletin
  // itself is matched by the title filter (isBoletimSearch) and the number by
  // targetNum, so these must not ALSO be required as literal title/transcript
  // words, which no talk contains ("banco", "número") and silently emptied
  // the whole AND-match.
  "boletim", "boletins", "numero", "numeros", "banco", "base", "dados",
  "existem", "existir", "existia", "ele", "ela", "eles", "elas", "de", "ja", "agora",
  "vez", "mesmo", "pelo", "pela",
]);

/**
 * Words specific enough to identify a title by themselves ("mark",
 * "noumair", "anatote") -- everything else in the sentence around them
 * ("vídeos sobre", "resuma o vídeo") is just how a person phrases a
 * question, not part of what they're naming. Requires at least 2 to trigger
 * the fallback below, for the same reason the bare "boletim" case doesn't:
 * a single generic word (e.g. "estudo") would match dozens of unrelated
 * titles as fake "exact" matches.
 *
 * Returned words keep their original accents (only the length/stopword
 * check below uses the accent-stripped form) -- titles and transcripts in
 * the DB are stored with accents (`Coríntios`, `capítulo`), and a plain
 * ILIKE is accent-sensitive, so an accent-stripped keyword ("corintios")
 * would silently match zero rows even when the word is right there in the
 * text. Verified directly against the DB: `ILIKE '%corintios%'` matches 0
 * of 2460 videos while `ILIKE '%coríntios%'` matches 314 -- this alone was
 * making the whole exact-match fallback a no-op for any query containing an
 * accented Portuguese word, which is most of them.
 */
function extractTitleKeywords(query: string): string[] {
  const rawWords = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of rawWords) {
    const stripped = stripAccentsLower(w);
    if (stripped.length < 3 || TITLE_SEARCH_STOPWORDS.has(stripped)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    result.push(w);
  }
  return result;
}

export interface PublishPeriod {
  /** Inclusive YYYY-MM-DD bounds. */
  from: string;
  to: string;
}

/** The day after an inclusive YYYY-MM-DD bound, so `< dayAfter(to)` includes the whole last day. */
function dayAfter(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatPeriodPt(period: PublishPeriod): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const [fy, fm, fd] = period.from.split("-");
  const [ty, tm, td] = period.to.split("-");
  const lastDay = new Date(Date.UTC(Number(fy), Number(fm), 0)).getUTCDate();
  if (fy === ty && fm === tm && fd === "01" && Number(td) === lastDay) {
    return new Date(`${period.from}T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  if (fy === ty && fm === "01" && fd === "01" && tm === "12" && td === "31") return `o ano de ${fy}`;
  return period.from === period.to ? fmt(period.from) : `${fmt(period.from)} a ${fmt(period.to)}`;
}

/**
 * Stamps every video with its publication date (so the model can judge
 * "recente"/"este mês" against today) and enforces the publication window
 * on what retrieval returned. The exact-match
 * path already filters by it, but the semantic search knows nothing about
 * dates — it happily returned "Novembro de 2021" for "julho de 2021", and the
 * model then summarised the wrong video as if it were the one asked for.
 *
 * Videos published outside the window are dropped. When that leaves no video
 * at all, `notice` tells the model plainly that nothing exists for the period
 * and names the closest alternatives, so it answers "não existe" instead of
 * improvising.
 */
export async function applyPublishPeriod(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matches: MatchResult[],
  period: PublishPeriod | undefined,
  /** The search query — a named category in it ("broadcasting") decides which videos count as "closest". */
  query?: string
): Promise<{ matches: MatchResult[]; notice: string | null }> {
  const videoIds = [...new Set(matches.filter((m) => m.video_id).map((m) => m.video_id as string))];
  if (videoIds.length === 0) return { matches, notice: null };

  const { data } = await supabase.from("global_videos").select("id, title, first_published, duration_seconds").in("id", videoIds);
  const info = new Map((data ?? []).map((v) => [v.id, v]));

  // Talks live twice in the catalog: inside a bigger program (track 1 of a
  // `pub-jwb-138_T_<n>_VIDEO` family, e.g. the monthly JW Broadcasting) and as
  // their own video (tracks 2..n). Name the program a part belongs to, so the
  // model can say "este discurso faz parte do JW Broadcasting de junho de 2026".
  const parentOf = (id: string): string | null => {
    const m = id.match(/^(.*_)(\d+)(_VIDEO)$/);
    return m && m[2] !== "1" ? `${m[1]}1${m[3]}` : null;
  };
  const parentIds = [...new Set(videoIds.map(parentOf).filter((id): id is string => !!id))];
  const { data: parentRows } = parentIds.length
    ? await supabase.from("global_videos").select("id, title, duration_seconds").in("id", parentIds)
    : { data: [] as { id: string; title: string; duration_seconds: number | null }[] };
  const parents = new Map((parentRows ?? []).map((v) => [v.id, v]));
  const partOf = new Map<string, { id: string; title: string }>();
  for (const id of videoIds) {
    const parent = parents.get(parentOf(id) ?? "");
    // Only a genuinely larger program counts as a parent.
    if (parent && (parent.duration_seconds ?? 0) > (info.get(id)?.duration_seconds ?? 0)) {
      partOf.set(id, { id: parent.id, title: parent.title });
    }
  }
  for (const m of matches) {
    const published = m.video_id ? info.get(m.video_id)?.first_published : undefined;
    const parent = m.video_id ? partOf.get(m.video_id) : undefined;
    if (published || parent) {
      m.metadata = { ...m.metadata, ...(published ? { publishedAt: published } : {}), ...(parent ? { partOf: parent.title } : {}) };
    }
  }
  // Asking about a specific talk, the program that merely contains it is noise
  // next to the talk itself (it ranked equal and its transcript is 90 minutes).
  // Keep the program when the user is actually asking for the program.
  if (!/broadcasting|programa|transmiss/i.test(query ?? "")) {
    const presentParents = new Set([...partOf.values()].map((p) => p.id));
    const withoutContainers = matches.filter((m) => !(m.video_id && presentParents.has(m.video_id)));
    if (withoutContainers.length > 0) matches = withoutContainers;
  }
  if (!period) return { matches, notice: null };
  const from = Date.parse(`${period.from}T00:00:00Z`);
  const to = Date.parse(`${dayAfter(period.to)}T00:00:00Z`);
  const inPeriod = (id: string) => {
    const t = Date.parse(info.get(id)?.first_published ?? "");
    return !Number.isNaN(t) && t >= from && t < to;
  };

  const kept = matches.filter((m) => !m.video_id || inPeriod(m.video_id));
  if (kept.some((m) => m.video_id)) return { matches: kept, notice: null };

  // Closest real alternatives: the nearest videos before and after the window
  // within the category the semantic hits point to (monthly broadcasts for a
  // "julho de 2021" question), not whatever happened to rank highest.
  const { data: candidates } = await supabase
    .from("global_videos")
    .select("id, category_key")
    .in("id", videoIds);
  const tally = new Map<string, number>();
  for (const c of candidates ?? []) if (c.category_key) tally.set(c.category_key, (tally.get(c.category_key) ?? 0) + 1);
  const topCategory =
    (query ? detectCategoryKey(stripAccentsLower(query))?.categoryKey : undefined) ??
    [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const nearest: string[] = [];
  if (topCategory) {
    const base = () => supabase.from("global_videos").select("title, first_published").eq("category_key", topCategory);
    const [before, after] = await Promise.all([
      base().lt("first_published", period.from).order("first_published", { ascending: false }).limit(1),
      base().gte("first_published", dayAfter(period.to)).order("first_published", { ascending: true }).limit(1),
    ]);
    for (const v of [...(before.data ?? []), ...(after.data ?? [])]) {
      nearest.push(`${v.title} (publicado em ${new Date(v.first_published).toLocaleDateString("pt-BR", { timeZone: "UTC" })})`);
    }
  }

  return {
    matches: kept,
    notice:
      `O usuário pediu um vídeo publicado em ${formatPeriodPt(period)}, e NENHUM vídeo desse período existe no banco. ` +
      `Diga isso claramente. NÃO resuma, descreva nem atribua conteúdo de outro vídeo como se fosse o pedido.` +
      (nearest.length ? ` Se ajudar, mencione os mais próximos: ${nearest.join("; ")}.` : ""),
  };
}

export async function fetchExactMetadataMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  allowedTypes: string[],
  /** From the query planner: its keywords replace the stopword-based extraction, and its period narrows videos by publication date. */
  plan?: { keywords?: string[]; period?: PublishPeriod }
): Promise<MatchResult[]> {
  const { targetYear, targetNum, targetNumExplicit, ordinal } = parseQueryConstraints(query);
  // "boletin"/"boletins" typos (missing "m") are common on a phone keyboard
  // and would otherwise skip the bulletin path entirely.
  const norm = query.toLowerCase().replace(/\bboletin(s?)\b/g, (_m, pl) => (pl ? "boletins" : "boletim"));
  const normStripped = norm.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // "boletins" (plural) does not contain "boletim", so both spellings count.
  const isBoletimSearch = /boletim|boletins/.test(norm);
  const categoryMatch = detectCategoryKey(normStripped);
  const categoryKey = categoryMatch?.categoryKey ?? null;
  const period = plan?.period;
  const titleKeywords = plan?.keywords ?? extractTitleKeywords(norm);
  // When a category phrase matched ("adorações matinais" -> category_key
  // filter below), its own words describe the PROGRAM, not the talk -- a
  // Morning Worship talk's transcript essentially never repeats "adorações
  // matinais" verbatim, so requiring those words to also appear in
  // title/content_text (the AND-filter below) made a category match
  // combined with any real topic ("... com 1 Coríntios capítulo 9")
  // impossible to satisfy. Excluded here, from the AND-filter set only --
  // `titleKeywords` itself stays intact for the signal-gating checks below.
  const videoContentKeywords = categoryMatch
    ? titleKeywords.filter((w) => !categoryMatch.matchedWords.has(stripAccentsLower(w)))
    : titleKeywords;
  // The video catalog is shared and not scoped to any one person, so a
  // single generic word risks pulling in dozens of unrelated "exact"
  // matches — same reasoning as the bare "boletim" case below, hence >=2.
  // The caller's own notes/jwpub content (searched further down) is scoped
  // to just them via RLS, so a single distinctive word (a rare name like
  // "Rispa") is precise enough on its own without that same risk.
  const hasVideoKeywordSignal = titleKeywords.length >= 2;
  // A bare year/number ("2026", "6") says WHICH edition, never WHAT the
  // content is about: ILIKE '%2026%' over the caller's note chunks matched any
  // note that merely mentions the year (a JiuJitsu note, a one-word "Info"
  // note), listed as sources for "boletim número 6 de 2026". Those numbers are
  // already used by the video path above, so the note search only gets words.
  const noteKeywords = titleKeywords.filter((w) => !/^\d+$/.test(w));
  const hasNoteKeywordSignal = noteKeywords.length >= 1;

  // A specific "book chapter[:verse]" mention paired with a named category
  // ("adorações matinais com 1 Coríntios capítulo 9") gets its own precise
  // path below instead of the generic keyword-AND one -- talks cite their
  // theme scripture in the transcript itself ("Vamos ler 1 Coríntios
  // 9:26..."), so a "book chapter" substring is a much sharper signal than
  // ANDing "coríntios" (which shows up in unrelated cross-references across
  // dozens of talks) against the whole transcript. Gated on `categoryKey` so
  // this only fires for the narrow "named program + scripture" shape --
  // unscoped across the whole 2460-video catalog the same substring is far
  // noisier (verified empirically: "coríntios 9" alone matches 18 videos
  // catalog-wide vs. 3 once scoped to Morning Worship).
  const inlineBibleRef = categoryKey ? findBibleReferenceInText(query) : null;

  // A bare "boletim" mention with no year or number is too vague to justify
  // forcing every bulletin video in as a fake "exact" match (similarity
  // 0.99) — that's what turned a follow-up like "qual boletim especificamente
  // falou sobre isso" (no year/number of its own) into ~30 unrelated video
  // sources. Semantic vector search (match_hybrid_embeddings, called by the
  // caller) already ranks by actual content relevance for that case. A named
  // category match doesn't have that ambiguity, so it's allowed through on
  // its own below — as is a specific enough title-keyword match.
  // "o penúltimo boletim": an explicit position is specific enough on its own.
  if (targetYear === null && targetNum === null && !categoryKey && !period && !hasNoteKeywordSignal && !(isBoletimSearch && ordinal)) {
    return [];
  }

  const results: MatchResult[] = [];

  if (allowedTypes.includes("video") && inlineBibleRef) {
    const refPattern = `%${escapeLikePattern(inlineBibleRef.book.toLowerCase())} ${inlineBibleRef.chapter}%`;
    let refQuery = supabase
      .from("global_videos")
      .select("id, title, content_text, video_url, cover_image, duration_formatted, subtitles_url")
      .eq("category_key", categoryKey);
    if (period) refQuery = refQuery.gte("first_published", period.from).lt("first_published", dayAfter(period.to));
    const { data: refVids } = await refQuery
      .or(`title.ilike.${refPattern},content_text.ilike.${refPattern}`)
      .order("first_published", { ascending: false, nullsFirst: false })
      .limit(10);

    for (const v of refVids ?? []) {
      results.push({
        id: `exact-vid-ref-${v.id}`,
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
          matchedByTitleKeyword: false,
        },
      });
    }
  } else if (allowedTypes.includes("video") && (categoryKey || isBoletimSearch || targetYear !== null || period || hasVideoKeywordSignal)) {
    function baseVideoQuery() {
      let q = supabase
        .from("global_videos")
        .select("id, title, content_text, video_url, cover_image, duration_formatted, subtitles_url");
      if (categoryKey) q = q.eq("category_key", categoryKey);
      if (isBoletimSearch) q = q.ilike("title", "%Boletim%");
      if (period) {
        // The planner resolved a publication window ("julho de 2021", "este
        // mês"): filter on the real date, which also covers videos whose
        // title doesn't spell the month/year out.
        q = q.gte("first_published", period.from).lt("first_published", dayAfter(period.to));
      } else if (targetYear !== null) {
        q = q.ilike("title", `%${targetYear}%`);
      }
      return q;
    }

    // Every significant word must appear SOMEWHERE in the video -- but not
    // necessarily the title. "discurso do Gerrit Lösch que falava sobre o
    // tempo" names a speaker (almost always in the title, e.g. "Gerrit
    // Lösch: ...") AND a topic ("tempo") that's realistically only ever in
    // the transcript, never the title itself -- requiring "tempo" in the
    // title too made this find nothing despite the talk being right there.
    // So each word individually may satisfy title OR content_text (an OR
    // filter), while different words are still ANDed against each other
    // (one .or() call per word, each becoming its own top-level PostgREST
    // filter — multiple top-level filters are ANDed by default) — this is
    // effectively "search titles and search transcripts", combined, rather
    // than two separate passes the caller would have to reconcile itself.
    function withWordFilter<T extends { or: (s: string) => T }>(q: T, word: string): T {
      const pattern = `%${escapeLikePattern(word)}%`;
      return q.or(`title.ilike.${pattern},content_text.ilike.${pattern}`);
    }

    // Without the trailing `.order().limit(30)`, an unordered slice risks
    // missing the actual most recent video entirely on a category/year match
    // with hundreds of rows — which the ordinal rerank step below depends on
    // being present.
    let videoQuery = baseVideoQuery();
    for (const word of videoContentKeywords) videoQuery = withWordFilter(videoQuery, word);
    let { data: vids } = await videoQuery.order("first_published", { ascending: false, nullsFirst: false }).limit(30);

    // The stopword list above is inherently incomplete — a filler word that
    // slips through (an unanticipated verb, a name that also happens to be a
    // common noun, ...) would otherwise make the strict AND above silently
    // return nothing even though the video is right there. Retry once with
    // just the two longest keywords, on the theory that the actual
    // identifying words (a name, a distinctive term) are rarely the shortest
    // ones in the sentence.
    if ((!vids || vids.length === 0) && videoContentKeywords.length >= 3) {
      const longestTwo = [...videoContentKeywords].sort((a, b) => b.length - a.length).slice(0, 2);
      let retryQuery = baseVideoQuery();
      for (const word of longestTwo) retryQuery = withWordFilter(retryQuery, word);
      ({ data: vids } = await retryQuery.order("first_published", { ascending: false, nullsFirst: false }).limit(30));
    }

    // A video whose TITLE holds every keyword is the one the user named; a
    // transcript that merely uses the same words ("quatro lições ... homens"
    // inside a 90-minute broadcast) matches too, and used to tie with it at
    // 0.99. When a title match exists, transcript-only ones rank clearly below.
    const titleLower = (v: { title: string }) => stripAccentsLower(v.title);
    const keywordsInTitle = (v: { title: string }) =>
      videoContentKeywords.length > 0 && videoContentKeywords.every((w) => titleLower(v).includes(stripAccentsLower(w)));
    const anyTitleMatch = (vids ?? []).some(keywordsInTitle);

    if (vids && vids.length > 0) {
      for (const v of vids) {
        const titleLower = v.title.toLowerCase();
        const vConstraints = parseQueryConstraints(titleLower);

        let isMatch = true;
        if (targetNumExplicit && targetNum !== null && vConstraints.targetNum !== targetNum) {
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
            similarity: anyTitleMatch && !keywordsInTitle(v) ? 0.75 : 0.99,
            metadata: {
              title: v.title,
              type: "video",
              videoId: v.id,
              videoUrl: v.video_url,
              coverImage: v.cover_image,
              durationFormatted: v.duration_formatted,
              subtitlesUrl: v.subtitles_url,
              matchedByTitleKeyword: hasVideoKeywordSignal,
            },
          });
        }
      }
    }
  }

  // Same idea, for the user's own notes/PDFs/jwpub chapters -- semantic
  // search alone kept missing a note by a specific, low-frequency name
  // ("Tem algo nas minhas notas sobre Rispa?") even though the note-page's
  // own plain substring search finds it instantly. `notes.title`/`body` are
  // encrypted at rest (lib/encryption.ts) so an ILIKE against them directly
  // is impossible server-side — but `note_embeddings.content` is the
  // already-decrypted, already-chunked plaintext the vectorization pipeline
  // stored specifically to hand real text to the model (see
  // lib/vector/extractor.ts), and RLS already scopes every row to the
  // caller. That makes it the one plaintext-searchable surface for this
  // content, mirroring the video title-or-content check above.
  if (hasNoteKeywordSignal) {
    // Unlike the video path (an ALL-words-required AND, needed against a
    // shared catalog to avoid false positives), a longer natural-language
    // question ("A indicação para ancião depende de falar o idioma local?")
    // has several content words, and the actually-relevant note may use
    // different wording for some of them (that note talks about "servo
    // ministerial", not "ancião") -- requiring every word verbatim missed a
    // note that's clearly the right one. So this is a plain OR across words
    // to fetch candidates, then a majority-of-words score to keep only
    // chunks that are still a real, specific match rather than a single
    // stray word — safe to be this lenient specifically because it's scoped
    // to just the caller's own content (RLS), not a shared catalog.
    const orExpr = noteKeywords.map((w) => `content.ilike.%${escapeLikePattern(w)}%`).join(",");
    const { data: chunkRows } = await supabase
      .from("note_embeddings")
      .select("note_id, content, metadata, jwpub_chapter_id")
      .or(orExpr)
      .limit(30);

    const minHits = noteKeywords.length <= 2 ? noteKeywords.length : Math.ceil(noteKeywords.length / 2);
    const scored = (chunkRows ?? [])
      .map((row) => {
        const lower = row.content.toLowerCase();
        const hits = noteKeywords.filter((w) => lower.includes(w)).length;
        return { row, hits };
      })
      .filter((s) => s.hits >= minHits)
      .sort((a, b) => b.hits - a.hits);

    const seenNoteIds = new Set<string>();
    for (const { row, hits } of scored) {
      if (seenNoteIds.has(row.note_id)) continue; // one matching chunk per note is enough context
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const type = (meta.type as string | undefined) ?? "nota";
      if (!allowedTypes.includes(type)) continue;
      seenNoteIds.add(row.note_id);

      results.push({
        id: `exact-note-${row.note_id}-${seenNoteIds.size}`,
        note_id: row.note_id,
        video_id: null,
        source_type: type,
        content: row.content,
        // A partial (majority) match is still a strong signal here, but not
        // quite as certain as the video path's forced exact match — scaled
        // by how many of the significant words actually hit, floored at the
        // rerank/RAG_THRESHOLD cutoff (0.35) so a bare-minimum match still
        // clears it rather than getting silently dropped later.
        similarity: Math.max(0.4, Math.min(0.95, hits / noteKeywords.length)),
        metadata: {
          title: meta.title as string | undefined,
          type,
          chapterTitle: meta.chapterTitle as string | undefined,
          documentId: meta.documentId as number | undefined,
          matchedByTitleKeyword: true,
        },
      });
    }
  }

  return results;
}
