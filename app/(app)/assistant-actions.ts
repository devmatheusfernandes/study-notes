"use server";

import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { generateSingleEmbedding } from "@/lib/vector/openai";
import type { AssistantSource } from "@/lib/store/assistant-store";

export interface AssistantReply {
  answer: string;
  sources: AssistantSource[];
  error?: string;
}

interface MatchResult {
  id: string;
  note_id: string;
  content: string;
  metadata: { title?: string; type?: string; chapterTitle?: string; documentId?: number };
  similarity: number;
}

export async function askAssistant(question: string): Promise<AssistantReply> {
  const trimmed = question.trim();
  if (!trimmed) {
    return { answer: "", sources: [], error: "Escreva uma pergunta." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { answer: "", sources: [], error: "Sessão expirada. Entre novamente." };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      answer: "O assistente precisa da chave OPENAI_API_KEY configurada no ambiente para responder.",
      sources: [],
    };
  }

  try {
    // 1. Generate query embedding for similarity search
    const { embedding, tokens: queryTokens, cost: queryCost } = await generateSingleEmbedding(trimmed);

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

    // 2. Perform vector search RPC
    const { data: matches } = await supabase.rpc("match_embeddings", {
      query_embedding: embedding,
      match_threshold: 0.15,
      match_count: 6,
    });

    const matchRows = (matches ?? []) as MatchResult[];

    // Extract unique sources
    const sourcesMap = new Map<string, AssistantSource>();
    for (const match of matchRows) {
      const noteId = match.note_id;
      const title = match.metadata?.title || "Nota";
      const type = (match.metadata?.type || "NOTA").toUpperCase();
      const chapterTitle = match.metadata?.chapterTitle;
      const documentId = match.metadata?.documentId;
      const key = `${noteId}:${chapterTitle ?? ""}`;
      if (!sourcesMap.has(key)) {
        sourcesMap.set(key, {
          noteId,
          type,
          title,
          ...(chapterTitle ? { chapterTitle } : {}),
          ...(documentId ? { documentId } : {}),
        });
      }
    }
    const sources = Array.from(sourcesMap.values());

    // 3. Build context for OpenAI Chat Completion
    let contextText = "";
    if (matchRows.length > 0) {
      contextText = matchRows
        .map((m, idx) => `[Fonte ${idx + 1}: ${m.metadata?.title || "Nota"}]\n${m.content}`)
        .join("\n\n---\n\n");
    }

    const systemPrompt =
      "Você é o assistente inteligente do Study Notes. Responda à pergunta do usuário de forma clara, prestativa e concisa. " +
      (contextText
        ? `Use os trechos de contexto fornecidos abaixo extraídos das notas e documentos do usuário para responder com precisão:\n\n${contextText}`
        : "Nenhum trecho de nota relevante foi encontrado no banco de dados para esta pergunta especificamente, responda com seu conhecimento geral de forma gentil.");

    const openai = new OpenAI({ apiKey });
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: trimmed },
      ],
      temperature: 0.4,
      max_tokens: 600,
    });

    const answer = chatResponse.choices[0]?.message?.content?.trim() || "Não foi possível gerar uma resposta.";

    // 4. Log Chat Completion AI Usage & Cost
    const promptTokens = chatResponse.usage?.prompt_tokens ?? 0;
    const completionTokens = chatResponse.usage?.completion_tokens ?? 0;
    const totalTokens = chatResponse.usage?.total_tokens ?? 0;

    // gpt-4o-mini pricing: $0.15 / 1M prompt tokens, $0.60 / 1M completion tokens
    const chatCostUsd = (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.6;

    await supabase.from("ai_usage_logs").insert({
      user_id: user.id,
      operation_type: "assistant_rag_chat",
      model: "gpt-4o-mini",
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: chatCostUsd,
    });

    return { answer, sources };
  } catch (err) {
    console.error("Erro no assistente RAG:", err);
    return {
      answer: "Ocorreu um erro ao consultar o assistente.",
      sources: [],
      error: err instanceof Error ? err.message : "Erro interno",
    };
  }
}
