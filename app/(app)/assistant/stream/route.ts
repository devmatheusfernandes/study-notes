import { createClient } from "@/lib/supabase/server";
import { generateSingleEmbedding } from "@/lib/vector/openai";
import OpenAI from "openai";

interface MatchResult {
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

interface QueryConstraints {
  targetYear: number | null;
  targetNum: number | null;
  /** e.g. "a ultima adoracao matinal", "o video mais recente" -- no year/number given, just "give me the newest one". */
  wantsLatest: boolean;
}

function parseQueryConstraints(query: string): QueryConstraints {
  const norm = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

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

  // 3. "latest/most recent" -- deliberately a separate signal from year/number,
  // since a query can say "a ultima" with no digits at all.
  const wantsLatest = /\b(ultim[ao]s?|mais recente[s]?|mais nov[ao]s?|recentemente)\b/.test(norm);

  return { targetYear, targetNum, wantsLatest };
}

/**
 * `supabase` is only needed for the "latest" case -- one extra lookup for
 * `first_published` on whatever video candidates semantic search already
 * surfaced (never a fresh broad query), so whichever of those is newest gets
 * boosted to the top instead of just "whatever's most semantically similar
 * to the word 'recente'".
 */
async function rerankMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  matches: MatchResult[]
): Promise<MatchResult[]> {
  const { targetYear, targetNum, wantsLatest } = parseQueryConstraints(query);
  if (targetYear === null && targetNum === null && !wantsLatest) return matches;

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

  if (wantsLatest) {
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

      let newest: MatchResult | null = null;
      let newestTime = -1;
      for (const m of videoMatches) {
        const t = publishedAt.get(m.video_id!) ?? 0;
        if (t > newestTime) {
          newestTime = t;
          newest = m;
        }
      }

      // A transcript never states its own air date, so boosting the newest
      // video's *rank* alone isn't enough -- the model has no way to tell
      // which of several same-topic transcripts is actually the latest one.
      // Two things fix that: (1) drop every other same-topic video entirely
      // instead of just out-ranking it -- dozens of full transcripts in
      // context is both expensive and exactly what made the model reply "I
      // don't see which is the latest" instead of just answering; (2) stamp
      // the survivor's real publish date directly into its content, the one
      // piece of information nothing else in the pipeline carries forward.
      if (newest) {
        const dateLabel =
          newestTime > 0
            ? new Date(newestTime).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
            : null;
        reranked = reranked
          .filter((m) => m === newest || m.source_type !== "video" || !videoIds.includes(m.video_id!))
          .map((m) =>
            m === newest
              ? {
                  ...m,
                  similarity: m.similarity + 1.0,
                  content: dateLabel
                    ? `[Este é o vídeo mais recente sobre o tema pedido, publicado em ${dateLabel}]\n\n${m.content}`
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

function formatAllowedSourcesLabel(allowedSourceTypes: string[]): string {
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

async function fetchExactMetadataMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  allowedTypes: string[]
): Promise<MatchResult[]> {
  const { targetYear, targetNum } = parseQueryConstraints(query);
  const norm = query.toLowerCase();
  const normStripped = norm.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const isBoletimSearch = norm.includes("boletim");
  const categoryKey = detectCategoryKey(normStripped);

  // A bare "boletim" mention with no year or number is too vague to justify
  // forcing every bulletin video in as a fake "exact" match (similarity
  // 0.99) — that's what turned a follow-up like "qual boletim especificamente
  // falou sobre isso" (no year/number of its own) into ~30 unrelated video
  // sources. Semantic vector search (match_hybrid_embeddings, called by the
  // caller) already ranks by actual content relevance for that case. A named
  // category match doesn't have that ambiguity, so it's allowed through on
  // its own below.
  if (targetYear === null && targetNum === null && !categoryKey) {
    return [];
  }

  const results: MatchResult[] = [];

  if (allowedTypes.includes("video")) {
    let videoQuery = supabase
      .from("global_videos")
      .select("id, title, content_text, video_url, cover_image, duration_formatted, subtitles_url");

    if (categoryKey) {
      videoQuery = videoQuery.eq("category_key", categoryKey);
    }
    if (isBoletimSearch) {
      videoQuery = videoQuery.ilike("title", "%Boletim%");
    }
    if (targetYear !== null) {
      videoQuery = videoQuery.ilike("title", `%${targetYear}%`);
    }

    // Without this, `.limit(30)` takes whatever arbitrary 30 rows Postgres
    // happens to return first — a category can have hundreds of videos, so
    // an unordered slice risks missing the actual most recent one entirely,
    // which the "wantsLatest" rerank step below depends on being present.
    const { data: vids } = await videoQuery.order("first_published", { ascending: false, nullsFirst: false }).limit(30);

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Parsed once — a Request body stream can only be consumed once, so a
  // second `request.json()` later (there used to be one inside the
  // ReadableStream below) throws and gets silently swallowed, leaving every
  // question empty. Reuse this same parsed object instead.
  const body = (await request.json().catch(() => ({}))) as {
    question?: string;
    allowedSourceTypes?: string[];
  };
  const question = body.question?.trim() ?? "";
  if (!question) {
    return new Response("Empty question", { status: 400 });
  }
  const allowedSourceTypes = Array.isArray(body.allowedSourceTypes) && body.allowedSourceTypes.length > 0
    ? body.allowedSourceTypes
    : ["nota", "pdf", "jwpub", "video", "estudo_pessoal", "biblia"];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response("OPENAI_API_KEY not configured", { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // 1. Generate query embedding for similarity search
        const { embedding, tokens: queryTokens, cost: queryCost } =
          await generateSingleEmbedding(question);

        // Log query embedding AI usage
        if (queryTokens > 0) {
          await supabase.from("ai_usage_logs").insert({
            user_id: user.id,
            operation_type: "assistant_rag_embedding",
            model: "text-embedding-3-small",
            prompt_tokens: queryTokens,
            completion_tokens: 0,
            total_tokens: queryTokens,
            estimated_cost_usd: queryCost,
          });
        }

        // 2. Perform vector search RPC (hybrid: personal notes + global videos)
        const RAG_THRESHOLD = 0.35;
        const { data: matches } = await supabase.rpc("match_hybrid_embeddings", {
          query_embedding: embedding,
          user_id_param: user.id,
          match_threshold: RAG_THRESHOLD,
          match_count: 6,
          allowed_types: allowedSourceTypes,
        });

        const exactMatches = await fetchExactMetadataMatches(supabase, question, allowedSourceTypes);
        const rawMatches = [...exactMatches, ...((matches ?? []) as MatchResult[])];
        const matchRows = (await rerankMatches(supabase, question, rawMatches))
          .filter((m) => allowedSourceTypes.includes(m.source_type))
          .filter((m) => m.similarity >= RAG_THRESHOLD);

        // Extract unique sources with noteId, videoId & chapter info
        interface SourceItem {
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
        }

        const sourcesMap = new Map<string, SourceItem>();
        if (matchRows.length > 0) {
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

            let type = (meta.type as string | undefined) || match.source_type || "nota";
            if (chapterTitle || documentId || type === "jwpub") {
              type = "jwpub";
            }

            const title = (meta.title as string | undefined) || (match as unknown as Record<string, unknown>).title as string || (type === "video" ? "Vídeo JW" : "Item");

            const videoUrl = meta.videoUrl as string | undefined;
            const coverImage = meta.coverImage as string | undefined;
            const durationFormatted = meta.durationFormatted as string | undefined;
            const subtitlesUrl = meta.subtitlesUrl as string | undefined;
            const snippet = match.content ? match.content.trim() : undefined;

            const key = videoId
              ? `video:${videoId}`
              : jwlibraryNoteId
                ? `jwlibrary:${jwlibraryNoteId}`
                : bookOrder !== undefined && chapter !== undefined
                  ? `biblia:${bookOrder}:${chapter}`
                  : `${noteId}:${chapterTitle ?? ""}`;
            if (!sourcesMap.has(key)) {
              sourcesMap.set(key, {
                ...(noteId ? { noteId } : {}),
                ...(videoId ? { videoId } : {}),
                ...(jwlibraryNoteId ? { jwlibraryNoteId } : {}),
                type,
                title,
                ...(chapterTitle ? { chapterTitle } : {}),
                ...(documentId ? { documentId } : {}),
                ...(snippet ? { snippet } : {}),
                ...(videoUrl ? { videoUrl } : {}),
                ...(coverImage ? { coverImage } : {}),
                ...(durationFormatted ? { durationFormatted } : {}),
                ...(subtitlesUrl ? { subtitlesUrl } : {}),
                ...(bookOrder !== undefined ? { bookOrder } : {}),
                ...(chapter !== undefined ? { chapter } : {}),
                ...(firstVerse !== undefined ? { firstVerse } : {}),
              });
            }
          }
        }
        const sources = Array.from(sourcesMap.values());

        // 3. Build context for OpenAI Chat Completion
        let contextText = "";
        if (matchRows.length > 0) {
          contextText = matchRows
            .map((m, idx) => {
              const label = m.metadata?.chapterTitle
                ? `${m.metadata.title} — ${m.metadata.chapterTitle}`
                : m.metadata?.title || "Nota";
              return `[Fonte ${idx + 1}: ${label}]\n${m.content}`;
            })
            .join("\n\n---\n\n");
        }

        const sourcesLabel = formatAllowedSourcesLabel(allowedSourceTypes);

        // A similarity this high only happens for a forced exact match
        // (fetchExactMetadataMatches' year/número/category hits start at
        // 0.99, and the wantsLatest boost pushes the winner past that) — the
        // retrieval layer has already confirmed relevance, not just guessed
        // semantically. Tested empirically against a real "resuma a última
        // adoração matinal" query: a plainer "use os trechos abaixo" wording
        // still let gpt-4o-mini decline in some repeated identical calls at
        // this app's own temperature (0.3) even with the right, clearly
        // labeled content sitting in context; being explicit that a
        // bracketed annotation is an already-verified fact (not the model's
        // own guess) and telling it not to hedge fixed that in every trial.
        const hasHighConfidenceMatch = matchRows.some((m) => m.similarity >= 0.95);

        const systemPrompt =
          contextText && hasHighConfidenceMatch
            ? `Você é o assistente inteligente do Study Notes. Você recebeu abaixo o trecho de contexto exato que responde à pergunta do usuário — ` +
              `o sistema de busca já confirmou que esse é o conteúdo certo, incluindo quando um trecho começa com uma anotação entre colchetes ` +
              `(como "[Este é o vídeo mais recente sobre o tema pedido, publicado em ...]"): isso é um FATO já verificado, não uma suposição sua. ` +
              `Responda diretamente a pergunta do usuário usando esse conteúdo, em português, de forma clara e concisa, usando Markdown quando apropriado. ` +
              `Não invente detalhes que não estejam no trecho, mas TAMBÉM não diga que a informação não foi encontrada — ela foi.\n\n${contextText}`
            : "Você é o assistente inteligente do Study Notes. Responda à pergunta do usuário de forma clara, prestativa e concisa em português. " +
              (contextText
                ? `Use exclusivamente os trechos de contexto fornecidos abaixo, extraídos de ${sourcesLabel}, para responder com precisão:\n\n${contextText}`
                : `Você pesquisou especificamente em ${sourcesLabel}, mas nenhum trecho relevante foi encontrado para a pergunta dele. Responda educadamente informando especificamente que não encontrou informações em ${sourcesLabel}.`);

        // 4. Stream from OpenAI
        const openai = new OpenAI({ apiKey });
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
          temperature: 0.4,
          max_tokens: 700,
          stream: true,
          stream_options: { include_usage: true },
        });

        let promptTokens = 0;
        let completionTokens = 0;

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            sendEvent({ type: "delta", content: delta });
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens;
            completionTokens = chunk.usage.completion_tokens;
          }
        }

        // 5. Send sources
        if (sources.length > 0) {
          sendEvent({ type: "sources", sources });
        }

        // 6. Log Chat Completion AI Usage & Cost
        const totalTokens = promptTokens + completionTokens;
        const chatCostUsd =
          (promptTokens / 1_000_000) * 0.15 +
          (completionTokens / 1_000_000) * 0.6;

        if (totalTokens > 0) {
          await supabase.from("ai_usage_logs").insert({
            user_id: user.id,
            operation_type: "assistant_rag_chat",
            model: "gpt-4o-mini",
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            estimated_cost_usd: chatCostUsd,
          });
        }

        sendEvent({ type: "done" });
      } catch (err) {
        console.error("Assistant stream error:", err);
        sendEvent({
          type: "error",
          content: "Ocorreu um erro ao consultar o assistente.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
