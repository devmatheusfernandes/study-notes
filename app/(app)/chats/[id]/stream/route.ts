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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Verify conversation ownership via RLS
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("id, title")
    .eq("id", conversationId)
    .single();

  if (!conv) {
    return new Response("Not found", { status: 404 });
  }

  const body = await request.json();
  const message = (body.message as string)?.trim();
  const allowedSourceTypes = Array.isArray(body.allowedSourceTypes) && body.allowedSourceTypes.length > 0
    ? body.allowedSourceTypes
    : ["nota", "pdf", "jwpub", "video"];

  if (!message) {
    return new Response("Empty message", { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new Response("OPENAI_API_KEY not configured", { status: 500 });
  }

  // Get conversation history (last 10 messages for context)
  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(10);

  const history = (historyRows ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // 1. Generate query embedding
        const { embedding, tokens: queryTokens, cost: queryCost } =
          await generateSingleEmbedding(message);

        // Log embedding cost
        if (queryTokens > 0) {
          await supabase.from("ai_usage_logs").insert({
            user_id: user.id,
            operation_type: "chat_rag_embedding",
            model: "text-embedding-3-small",
            prompt_tokens: queryTokens,
            completion_tokens: 0,
            total_tokens: queryTokens,
            estimated_cost_usd: queryCost,
          });
        }

        // 2. Vector search (hybrid: personal notes + global videos)
        const RAG_THRESHOLD = 0.35;
        const { data: matches } = await supabase.rpc("match_hybrid_embeddings", {
          query_embedding: embedding,
          user_id_param: user.id,
          match_threshold: RAG_THRESHOLD,
          match_count: 8,
          allowed_types: allowedSourceTypes,
        });

        const rawMatches = (matches ?? []) as MatchResult[];
        const matchRows = rawMatches.filter((m) => m.similarity >= RAG_THRESHOLD);

        // 3. Build sources array with note & video IDs for linking
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

        // 4. Build system prompt — RAG-only, no hallucination
        let systemPrompt: string;

        if (matchRows.length > 0) {
          const contextText = matchRows
            .map((m, idx) => {
              const label = m.metadata?.chapterTitle
                ? `${m.metadata.title} — ${m.metadata.chapterTitle}`
                : m.metadata?.title || "Nota";
              return `[Fonte ${idx + 1}: ${label}]\n${m.content}`;
            })
            .join("\n\n---\n\n");

          systemPrompt =
            "Você é o assistente inteligente do Study Notes. Responda APENAS com base nos trechos de contexto fornecidos abaixo, " +
            "extraídos das notas e documentos do usuário. NÃO invente informações que não estejam nos trechos. " +
            "Se os trechos não contiverem a resposta exata, diga que a informação não foi encontrada nas notas. " +
            "Responda de forma clara, prestativa e concisa em português. Use formatação Markdown quando apropriado.\n\n" +
            "CONTEXTO DAS NOTAS DO USUÁRIO:\n\n" +
            contextText;
        } else {
          systemPrompt =
            "Você é o assistente inteligente do Study Notes. O usuário fez uma pergunta, " +
            "mas NÃO foi encontrado nenhum trecho relevante nos documentos e notas vetorizados dele. " +
            "Responda educadamente informando que não encontrou informações relevantes nas notas do usuário " +
            "e sugira que ele verifique se o conteúdo desejado foi vetorizado na página de Configurações.";
        }

        // 5. Build messages with history
        const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: message },
        ];

        const openai = new OpenAI({ apiKey });

        // Auto-generate title for "Nova conversa"
        if (conv.title === "Nova conversa") {
          void (async () => {
            try {
              const titleRes = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "system",
                    content:
                      "Crie um título muito curto de 3 a 5 palavras em português que resuma o tema da pergunta do usuário. Não use aspas, parênteses nem pontuação final.",
                  },
                  { role: "user", content: message },
                ],
                max_tokens: 20,
                temperature: 0.5,
              });
              const generatedTitle = titleRes.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, "");
              if (generatedTitle) {
                await supabase
                  .from("chat_conversations")
                  .update({ title: generatedTitle })
                  .eq("id", conversationId);
                sendEvent({ type: "title", title: generatedTitle });
              }
            } catch {
              // skip non-critical title generation errors
            }
          })();
        }

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: chatMessages,
          temperature: 0.3,
          max_tokens: 1200,
          stream: true,
          stream_options: { include_usage: true },
        });

        let fullContent = "";
        let promptTokens = 0;
        let completionTokens = 0;

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            sendEvent({ type: "delta", content: delta });
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens;
            completionTokens = chunk.usage.completion_tokens;
          }
        }

        // 7. Send sources
        if (sources.length > 0) {
          sendEvent({ type: "sources", sources });
        }

        // 8. Persist assistant message
        await supabase.from("chat_messages").insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: "assistant",
          content: fullContent,
          sources,
        });

        // Touch conversation updated_at
        await supabase
          .from("chat_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);

        // 9. Log chat completion cost
        const totalTokens = promptTokens + completionTokens;
        // gpt-4o-mini: $0.15/1M prompt, $0.60/1M completion
        const chatCostUsd =
          (promptTokens / 1_000_000) * 0.15 +
          (completionTokens / 1_000_000) * 0.6;

        if (totalTokens > 0) {
          await supabase.from("ai_usage_logs").insert({
            user_id: user.id,
            operation_type: "chat_rag_completion",
            model: "gpt-4o-mini",
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
            estimated_cost_usd: chatCostUsd,
          });
        }

        sendEvent({ type: "done" });
      } catch (err) {
        console.error("Chat stream error:", err);
        sendEvent({
          type: "error",
          content: "Ocorreu um erro ao gerar a resposta.",
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
