import "server-only";
import OpenAI from "openai";

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("A variável de ambiente OPENAI_API_KEY não está definida.");
  }
  return new OpenAI({ apiKey });
}

// Model pricing: text-embedding-3-small = $0.02 / 1,000,000 tokens = $0.00002 / 1,000 tokens
const EMBEDDING_COST_PER_1K = 0.00002;

export interface EmbeddingsResult {
  embeddings: number[][];
  promptTokens: number;
  estimatedCostUsd: number;
}

export async function generateEmbeddings(inputs: string[]): Promise<EmbeddingsResult> {
  if (inputs.length === 0) {
    return { embeddings: [], promptTokens: 0, estimatedCostUsd: 0 };
  }

  const openai = getOpenAiClient();
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: inputs,
  });

  const embeddings = response.data.map((d) => d.embedding);
  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const estimatedCostUsd = (promptTokens / 1000) * EMBEDDING_COST_PER_1K;

  return {
    embeddings,
    promptTokens,
    estimatedCostUsd,
  };
}

export async function generateSingleEmbedding(input: string): Promise<{ embedding: number[]; tokens: number; cost: number }> {
  const result = await generateEmbeddings([input]);
  return {
    embedding: result.embeddings[0] ?? [],
    tokens: result.promptTokens,
    cost: result.estimatedCostUsd,
  };
}
