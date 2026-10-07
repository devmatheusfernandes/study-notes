import "server-only";
import type OpenAI from "openai";

export interface PlannedQuery {
  /** What retrieval (embedding + exact-match parsing) should search for. */
  searchQuery: string;
  promptTokens: number;
  completionTokens: number;
}

const PLANNER_MODEL = "gpt-4o-mini";
const PLANNER_TIMEOUT_MS = 6000;

const PLANNER_PROMPT = `Você prepara a consulta de busca de um assistente de estudo bíblico (notas, publicações, vídeos do JW.org e Bíblia) a partir da última mensagem do usuário e do histórico da conversa.

Passo 1 — decida se a última mensagem é uma CONTINUAÇÃO do histórico ou um ASSUNTO NOVO.
- Continuação: depende do contexto para fazer sentido ("procure de novo", "tente outra vez", "e o número 6?", "e em 2025?", "fale mais sobre isso", "esse vídeo", "e esse?").
- Assunto novo: tem sentido completo sozinha (um tema, nome, versículo ou pergunta próprios), mesmo que a conversa anterior fosse sobre outra coisa.

Passo 2 — escreva a consulta:
- Assunto novo: devolva a mensagem praticamente igual, só corrigindo erros de digitação e acentuação (ex.: "boletin" -> "boletim"). NUNCA acrescente nada do histórico.
- Continuação: traga o que estava implícito, usando o pedido MAIS RECENTE do usuário que ainda está em aberto (não misture vários pedidos antigos). "Procure de novo" repete exatamente essa busca. "E o número 6?" troca só o número da busca anterior.
- Preserve números de edição, anos, nomes de pessoas, livros/capítulos/versículos e termos como "mais recente", "último", "primeiro". Remova só a conversa ("pode", "por favor", "ele existe no banco?"), nunca o assunto.
- Não responda à pergunta e não invente fatos.

Exemplos (histórico -> última mensagem => consulta):
- [usuário: "boletim 6 de 2026?"] "procure de novo" => "boletim 6 de 2026"
- [usuário: "vídeos sobre sangue"] "e o número 3?" => "vídeos sobre sangue número 3"
- [usuário: "boletim 6 de 2026?"] "o que diz Mateus 24:14" => "o que diz Mateus 24:14"
- [vazio] "E o boletin 2 de 2025?" => "boletim 2 de 2025"

Responda somente com JSON: {"followUp": true|false, "query": "..."}`;

/**
 * Turns the user's latest message into a standalone search query using the
 * conversation so far. Retrieval used to see only the raw message, so a
 * follow-up like "Procure mais uma vez agora" (no subject of its own) searched
 * for nothing in particular, and typos like "boletin" slipped past every
 * keyword rule downstream. The answer itself is still generated from the
 * user's real message plus the history — only the *search* uses this rewrite.
 *
 * Never throws: any failure (timeout, bad JSON, empty output) falls back to
 * the original message, so retrieval is never worse than before.
 */
export async function planSearchQuery(
  openai: OpenAI,
  message: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<PlannedQuery> {
  const fallback: PlannedQuery = { searchQuery: message, promptTokens: 0, completionTokens: 0 };

  try {
    // Assistant turns are trimmed: all the planner needs from them is the
    // topic, and a long answer would only inflate cost.
    const transcript = history
      .slice(-6)
      .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.content.slice(0, 400)}`)
      .join("\n");

    const res = await openai.chat.completions.create(
      {
        model: PLANNER_MODEL,
        messages: [
          { role: "system", content: PLANNER_PROMPT },
          {
            role: "user",
            content: `Histórico:\n${transcript || "(vazio)"}\n\nÚltima mensagem do usuário: ${message}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 150,
      },
      { timeout: PLANNER_TIMEOUT_MS }
    );

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { query?: unknown };
    const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    return {
      searchQuery: query && query.length <= 500 ? query : message,
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    console.error("Query planner failed, using raw message:", err);
    return fallback;
  }
}
