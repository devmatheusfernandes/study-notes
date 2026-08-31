"use server";

import { createClient } from "@/lib/supabase/server";
import type { AssistantSource } from "@/lib/store/assistant-store";

export interface AssistantReply {
  answer: string;
  sources: AssistantSource[];
  error?: string;
}

/**
 * PLACEHOLDER — returns a canned answer.
 *
 * There is no AI provider key configured yet (`.env` only holds the Supabase
 * keys), so this exists to give the assistant UI a real server round-trip and a
 * stable shape. Swap the body for the actual RAG call once a provider key is
 * added; the client contract (`AssistantReply`) shouldn't need to change.
 */
export async function askAssistant(question: string): Promise<AssistantReply> {
  const trimmed = question.trim();
  if (!trimmed) {
    return { answer: "", sources: [], error: "Escreva uma pergunta." };
  }

  // Every action that touches user data verifies the session itself — the proxy
  // check is optimistic only.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { answer: "", sources: [], error: "Sessão expirada. Entre novamente." };
  }

  await new Promise((resolve) => setTimeout(resolve, 700));

  return {
    answer:
      "O assistente ainda não está conectado a um provedor de IA — esta é uma resposta de exemplo. " +
      "Quando a integração estiver ativa, a resposta virá das suas próprias notas e arquivos, " +
      "com as fontes exatas listadas abaixo.",
    sources: [
      { type: "NOTA", title: "Resumo do capítulo 4" },
      { type: "XLSX", title: "Cronograma.xlsx" },
    ],
  };
}
