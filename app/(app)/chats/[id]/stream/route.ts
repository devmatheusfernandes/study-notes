import { createClient } from "@/lib/supabase/server";
import { buildRagSystemPrompt, formatAllowedSourcesLabel } from "@/lib/vector/rag-query";
import { buildSources, retrieveContext } from "@/lib/vector/retrieve";
import OpenAI from "openai";

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
  const allowedSourceTypes: string[] = Array.isArray(body.allowedSourceTypes) && body.allowedSourceTypes.length > 0
    ? body.allowedSourceTypes
    : ["nota", "pdf", "jwpub", "video", "estudo_pessoal", "biblia"];

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
    .order("created_at", { ascending: false })
    .limit(11);

  // Fetched newest-first so the limit keeps the LAST messages (ascending +
  // limit kept the first ones, i.e. the oldest, in a long conversation), then
  // flipped back to chronological order.
  let history = (historyRows ?? []).reverse().map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  // The client saves the user's message BEFORE calling this route, so the
  // history already ends with it. Left in, the model was sent the question
  // twice and the query planner mistook every first question for a follow-up.
  const lastTurn = history[history.length - 1];
  if (lastTurn && lastTurn.role === "user" && lastTurn.content.trim() === message) {
    history = history.slice(0, -1);
  }
  history = history.slice(-10);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      // Usage rows are bookkeeping: never worth holding the answer up for.
      function logUsage(operation: string, model: string, promptTokens: number, completionTokens: number, costUsd: number) {
        if (promptTokens + completionTokens <= 0) return;
        void supabase
          .from("ai_usage_logs")
          .insert({
            user_id: user!.id,
            operation_type: operation,
            model,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
            estimated_cost_usd: costUsd,
          })
          .then(() => undefined);
      }

      try {
        const openai = new OpenAI({ apiKey });

        // Progress labels the composer shows while the answer is prepared.
        // Wording follows what this request will actually search.
        const searchesVideos = allowedSourceTypes.includes("video");
        sendEvent({ type: "status", text: "Entendendo sua pergunta…" });

        // Planning (the message rewritten into a standalone search query using
        // the conversation so far) and every lookup live in retrieveContext.
        // Only retrieval uses the rewrite — the answer below still responds to
        // the user's real message.
        //
        // Threshold raised slightly from 0.35 — at 0.35, "Fontes" routinely
        // listed chunks that were only loosely on-topic, which the model then
        // correctly declined to answer from. See the `uncertain` flag below.
        const { matchRows, notice, catalog, plan, embeddingTokens, embeddingCost } = await retrieveContext({
          supabase,
          openai,
          userId: user.id,
          message,
          history,
          allowedSourceTypes,
          threshold: 0.42,
          matchCount: 8,
          onPlanned: () =>
            sendEvent({
              type: "status",
              text: searchesVideos ? "Procurando vídeos e fontes…" : "Procurando nas suas fontes…",
            }),
        });

        logUsage(
          "chat_rag_query_planner",
          "gpt-4o-mini",
          plan.promptTokens,
          plan.completionTokens,
          (plan.promptTokens / 1_000_000) * 0.15 + (plan.completionTokens / 1_000_000) * 0.6
        );
        logUsage("chat_rag_embedding", "text-embedding-3-small", embeddingTokens, 0, embeddingCost);

        // Source cards. `rowKeys` maps each matchRow to its card: the prompt
        // numbers its "[Fonte N]" by matchRow index, and the model cites those
        // numbers back.
        const { sources: sourcesMap, rowKeys } = buildSources(matchRows);
        const allSources = Array.from(sourcesMap.values());
        sendEvent({
          type: "status",
          text: allSources.length > 0 ? `Analisando ${allSources.length} ${allSources.length === 1 ? "fonte" : "fontes"}…` : "Preparando a resposta…",
        });

        // System prompt — shared with assistant/stream/route.ts so the
        // "nothing found" / "list of named matches" / "answer from content"
        // styles stay in sync.
        const sourcesLabel = formatAllowedSourcesLabel(allowedSourceTypes);
        const systemPrompt = buildRagSystemPrompt(matchRows, sourcesLabel, notice, { citeSources: !catalog, catalog });

        const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: message },
        ];

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

        // The model ends its answer with "<<FONTES: 1, 3>>" (see citeSources in
        // rag-query.ts). Hold that tail back from the stream: emit only the
        // text before the marker, plus nothing that could still turn into one.
        const MARKER = "<<FONTES";
        let emitted = 0;
        const safeEnd = (text: string) => {
          const at = text.indexOf(MARKER);
          if (at >= 0) return at;
          for (let n = Math.min(MARKER.length - 1, text.length); n > 0; n--) {
            if (MARKER.startsWith(text.slice(text.length - n))) return text.length - n;
          }
          return text.length;
        };

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            const end = safeEnd(fullContent);
            if (end > emitted) {
              sendEvent({ type: "delta", content: fullContent.slice(emitted, end) });
              emitted = end;
            }
          }
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens;
            completionTokens = chunk.usage.completion_tokens;
          }
        }

        // Send sources — flagged "uncertain" when the model itself hedged (per
        // the cautious-prompt wording, "a informação não foi encontrada")
        // despite something scoring above the threshold. Sources are what the
        // *search* found; this flag is whether the *model* actually confirmed
        // one of them answers the question — the two can disagree, and the UI
        // needs to show that distinction instead of presenting merely-similar
        // chunks as if they were it.
        // Flush anything held back that turned out not to be the marker.
        const markerAt = fullContent.indexOf(MARKER);
        if (markerAt < 0 && emitted < fullContent.length) {
          sendEvent({ type: "delta", content: fullContent.slice(emitted) });
        }
        const citedMatch = fullContent.match(/<<FONTES:\s*([^>]*)>>?/i);
        fullContent = (markerAt >= 0 ? fullContent.slice(0, markerAt) : fullContent).trimEnd();
        // Only what the model says it used. No/garbled marker, "nenhuma" or
        // numbers that match nothing → keep the full list rather than hide it.
        const cited = citedMatch
          ? new Set(
              (citedMatch[1].match(/\d+/g) ?? [])
                .map((n) => rowKeys[Number(n) - 1])
                .filter((k): k is string => Boolean(k))
            )
          : null;
        const sources =
          cited && cited.size > 0
            ? Array.from(sourcesMap.entries()).filter(([key]) => cited.has(key)).map(([, item]) => item)
            : allSources;
        const uncertain = sources.length > 0 && !catalog && /n[ãa]o\s+(foi|foram)\s+encontrad/i.test(fullContent);
        if (sources.length > 0) {
          sendEvent({ type: "sources", sources, uncertain });
        }

        // Persist assistant message
        await supabase.from("chat_messages").insert({
          conversation_id: conversationId,
          user_id: user.id,
          uncertain_sources: uncertain,
          role: "assistant",
          content: fullContent,
          sources,
        });

        // Touch conversation updated_at
        await supabase
          .from("chat_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);

        // gpt-4o-mini: $0.15/1M prompt, $0.60/1M completion
        logUsage(
          "chat_rag_completion",
          "gpt-4o-mini",
          promptTokens,
          completionTokens,
          (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.6
        );

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
