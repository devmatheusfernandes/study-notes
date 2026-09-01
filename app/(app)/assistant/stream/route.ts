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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json();
  const question = (body.question as string)?.trim();
  if (!question) {
    return new Response("Empty question", { status: 400 });
  }

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
        const { data: matches } = await supabase.rpc("match_hybrid_embeddings", {
          query_embedding: embedding,
          user_id_param: user.id,
          match_threshold: 0.15,
          match_count: 6,
        });

        const matchRows = (matches ?? []) as MatchResult[];

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
        }

        const sourcesMap = new Map<string, SourceItem>();
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
          const type = match.source_type || (meta.type as string | undefined) || "nota";
          const title = (meta.title as string | undefined) || (match as unknown as Record<string, unknown>).title as string || (type === "video" ? "Vídeo JW" : "Item");

          const chapterTitle = meta.chapterTitle as string | undefined;
          const documentId = meta.documentId as number | undefined;
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

        const systemPrompt =
          "Você é o assistente inteligente do Study Notes. Responda à pergunta do usuário de forma clara, prestativa e concisa. " +
          (contextText
            ? `Use os trechos de contexto fornecidos abaixo extraídos das notas e documentos do usuário para responder com precisão:\n\n${contextText}`
            : "Nenhum trecho de nota relevante foi encontrado no banco de dados para esta pergunta especificamente, responda com seu conhecimento geral de forma gentil.");

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
