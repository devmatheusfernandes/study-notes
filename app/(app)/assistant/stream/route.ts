import { createClient } from "@/lib/supabase/server";
import { buildRagSystemPrompt, formatAllowedSourcesLabel } from "@/lib/vector/rag-query";
import { buildSources, retrieveContext } from "@/lib/vector/retrieve";
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

        // The dock has no conversation history, so planning is a one-shot
        // rewrite (typos, filler). The whole search — shared with
        // chats/[id]/stream/route.ts — lives in retrieveContext.
        const { matchRows, notice, catalog, embeddingTokens, embeddingCost } = await retrieveContext({
          supabase,
          openai,
          userId: user.id,
          message: question,
          allowedSourceTypes,
          threshold: 0.35,
          matchCount: 6,
        });
        logUsage("assistant_rag_embedding", "text-embedding-3-small", embeddingTokens, 0, embeddingCost);

        const sources = Array.from(buildSources(matchRows).sources.values());

        const sourcesLabel = formatAllowedSourcesLabel(allowedSourceTypes);
        const systemPrompt = buildRagSystemPrompt(matchRows, sourcesLabel, notice, { catalog });

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

        if (sources.length > 0) {
          sendEvent({ type: "sources", sources });
        }

        logUsage(
          "assistant_rag_chat",
          "gpt-4o-mini",
          promptTokens,
          completionTokens,
          (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.6
        );

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
