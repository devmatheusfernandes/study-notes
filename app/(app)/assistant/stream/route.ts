import { createClient } from "@/lib/supabase/server";
import { generateSingleEmbedding } from "@/lib/vector/openai";
import {
  fetchExactMetadataMatches,
  formatAllowedSourcesLabel,
  rerankMatches,
  type MatchResult,
} from "@/lib/vector/rag-query";
import OpenAI from "openai";

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
