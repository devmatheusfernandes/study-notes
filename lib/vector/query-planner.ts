import "server-only";
import type OpenAI from "openai";
import { formatTodayPt } from "./today";

export interface PlannedQuery {
  /** What retrieval (embedding + exact-match parsing) should search for. */
  searchQuery: string;
  /**
   * Only the words that NAME what to find (a title, a person, a topic), as
   * judged by the model — undefined when planning failed, so retrieval falls
   * back to its own stopword heuristics. Never includes request verbs
   * ("resuma"), format words ("algumas frases"), time words ("último") or
   * bare numbers/years: retrieval ANDs these against titles/transcripts, so a
   * single filler word that no title contains ("lançado", "frases") used to
   * empty the match and drop the real latest video.
   */
  keywords?: string[];
  /**
   * The publication window the user is asking about, already resolved against
   * today's date ("este mês", "julho de 2021", "ano passado"), as inclusive
   * YYYY-MM-DD bounds. Absent when the question names no time window.
   */
  period?: { from: string; to: string };
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

Passo 3 — liste em "keywords" SÓ as palavras que NOMEIAM o que deve ser encontrado (título, pessoa, tema, termo): minúsculas, no máximo 5.
- NÃO inclua verbos/pedidos ("resuma", "fale", "procure", "mostre"), formato ou tamanho ("em algumas frases", "resumo", "lista"), palavras de tempo ou ordem ("último", "mais recente", "lançado", "novo", "primeiro"), números/anos, nem palavras genéricas ("vídeo", "boletim", "assunto").
- Exemplos: "resuma em algumas frases o último broadcasting lançado" -> ["broadcasting"]; "vídeos do Mark Sanderson sobre o tempo" -> ["mark","sanderson","tempo"]; "boletim número 6 de 2026" -> [].

Passo 4 — "period": se o usuário pede algo de um período em que foi LANÇADO/PUBLICADO ("de julho de 2021", "deste mês", "do mês passado", "de 2024", "da semana passada", "lançados em setembro"), resolva-o para datas reais e devolva {"from":"AAAA-MM-DD","to":"AAAA-MM-DD"} (limites inclusivos; um mês inteiro vai do dia 1 ao último dia; um ano do 01/01 ao 31/12). Se NÃO há período ("o último", "o mais recente" sem data), ou se a data faz parte do NOME de um evento ("Reunião Anual de 2021", "turma 150 de Gileade"), devolva null. "O último de 2024" -> o ano 2024 inteiro.

Hoje é {{HOJE}}. Use isso para entender "este mês", "este ano", "ano passado" (escreva o ano explícito na consulta quando fizer sentido), mas NÃO transforme "o último"/"o mais recente" em uma data.

Responda somente com JSON: {"followUp": true|false, "query": "...", "keywords": ["..."], "period": {"from":"AAAA-MM-DD","to":"AAAA-MM-DD"} | null}`;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parsePeriod(raw: unknown): { from: string; to: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { from, to } = raw as { from?: unknown; to?: unknown };
  if (typeof from !== "string" || typeof to !== "string") return undefined;
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return undefined;
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return undefined;
  return { from, to };
}

const MONTHS_PT = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const MONTH_YEAR =
  /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?((?:19|20)\d{2})\b/;

/** "julho de 2021" -> that whole month. Only the explicit month+year shape — a bare year is often part of an event's name. */
function inferMonthPeriod(...texts: string[]): { from: string; to: string } | undefined {
  for (const text of texts) {
    const norm = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const m = norm.match(MONTH_YEAR);
    if (!m) continue;
    const month = MONTHS_PT.indexOf(m[1]) + 1;
    const year = Number(m[2]);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
  }
  return undefined;
}

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
          { role: "system", content: PLANNER_PROMPT.replace("{{HOJE}}", formatTodayPt()) },
          {
            role: "user",
            content: `Histórico:\n${transcript || "(vazio)"}\n\nÚltima mensagem do usuário: ${message}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 200,
      },
      { timeout: PLANNER_TIMEOUT_MS }
    );

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { query?: unknown; keywords?: unknown; period?: unknown };
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim().toLowerCase())
          .filter((k) => k.length >= 2 && !/^\d+$/.test(k))
          .slice(0, 5)
      : undefined;
    const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    // The model occasionally forgets the period on an explicit "mês de ano"
    // (non-deterministic), so spelled-out months are also read by rule.
    const period = parsePeriod(parsed.period) ?? inferMonthPeriod(message, query);
    return {
      searchQuery: query && query.length <= 500 ? query : message,
      keywords,
      period,
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    console.error("Query planner failed, using raw message:", err);
    return fallback;
  }
}
