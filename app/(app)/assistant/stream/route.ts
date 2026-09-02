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

  return { targetYear, targetNum };
}

function rerankMatches(query: string, matches: MatchResult[]): MatchResult[] {
  const { targetYear, targetNum } = parseQueryConstraints(query);
  if (targetYear === null && targetNum === null) return matches;

  const reranked: MatchResult[] = [];

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
  };

  const labels = allowedSourceTypes.map((t) => typeMap[t] || t);
  if (labels.length === 0 || labels.length === 4) {
    return "suas notas, publicações e vídeos";
  }
  if (labels.length === 1) {
    return labels[0];
  }
  return `seus conteúdos (${labels.join(", ")})`;
}

async function fetchExactMetadataMatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  allowedTypes: string[]
): Promise<MatchResult[]> {
  const { targetYear, targetNum } = parseQueryConstraints(query);
  const norm = query.toLowerCase();
  const isBoletimSearch = norm.includes("boletim");

  // A bare "boletim" mention with no year or number is too vague to justify
  // forcing every bulletin video in as a fake "exact" match (similarity
  // 0.99) — that's what turned a follow-up like "qual boletim especificamente
  // falou sobre isso" (no year/number of its own) into ~30 unrelated video
  // sources. Semantic vector search (match_hybrid_embeddings, called by the
  // caller) already ranks by actual content relevance for that case.
  if (targetYear === null && targetNum === null) {
    return [];
  }

  const results: MatchResult[] = [];

  if (allowedTypes.includes("video")) {
    let videoQuery = supabase
      .from("global_videos")
      .select("id, title, content_text, video_url, cover_image, duration_formatted, subtitles_url");

    if (isBoletimSearch) {
      videoQuery = videoQuery.ilike("title", "%Boletim%");
    }
    if (targetYear !== null) {
      videoQuery = videoQuery.ilike("title", `%${targetYear}%`);
    }

    const { data: vids } = await videoQuery.limit(30);

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
    : ["nota", "pdf", "jwpub", "video"];

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
        const matchRows = rerankMatches(question, rawMatches)
          .filter((m) => allowedSourceTypes.includes(m.source_type))
          .filter((m) => m.similarity >= RAG_THRESHOLD);

        // Extract unique sources with noteId, videoId & chapter info
        interface SourceItem {
          noteId?: string;
          videoId?: string;
          type: string;
          title: string;
          chapterTitle?: string;
          documentId?: number;
          videoUrl?: string;
          coverImage?: string;
          durationFormatted?: string;
          subtitlesUrl?: string;
          snippet?: string;
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

            const chapterTitle = meta.chapterTitle as string | undefined;
            const documentId = meta.documentId as number | undefined;

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

            const key = videoId ? `video:${videoId}` : `${noteId}:${chapterTitle ?? ""}`;
            if (!sourcesMap.has(key)) {
              sourcesMap.set(key, {
                ...(noteId ? { noteId } : {}),
                ...(videoId ? { videoId } : {}),
                type,
                title,
                ...(chapterTitle ? { chapterTitle } : {}),
                ...(documentId ? { documentId } : {}),
                ...(snippet ? { snippet } : {}),
                ...(videoUrl ? { videoUrl } : {}),
                ...(coverImage ? { coverImage } : {}),
                ...(durationFormatted ? { durationFormatted } : {}),
                ...(subtitlesUrl ? { subtitlesUrl } : {}),
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

        const systemPrompt =
          "Você é o assistente inteligente do Study Notes. Responda à pergunta do usuário de forma clara, prestativa e concisa em português. " +
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
