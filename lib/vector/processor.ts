import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractContentForNote } from "./extractor";
import { generateEmbeddings } from "./openai";

/** Chunks per single OpenAI `embeddings.create` call — keeps every request a safe, bounded size regardless of how big the source publication is. */
export const EMBEDDING_BATCH_SIZE = 100;

/** Leaves headroom under a 60s serverless function budget for the rest of the tick's bookkeeping. */
export const MAX_TICK_DURATION_MS = 45_000;

/** How many queue items one tick claims — deliberately small; a huge publication can still eat a whole tick's time budget on its own. */
const DEFAULT_CLAIM_BATCH_SIZE = 5;

interface ClaimedQueueRow {
  id: string;
  user_id: string;
  note_id: string;
  attempts: number;
  processed_chunks: number;
  total_chunks: number | null;
}

/**
 * Atomically claims and works through a small batch of the vectorization
 * queue. Shared by the cron route (admin client, every user) and the
 * Settings "Processar Agora" button (per-request client, RLS-scoped to the
 * caller) — same logic either way, just a different Supabase client.
 *
 * Resumable by design: progress is persisted (`processed_chunks`) after
 * every OpenAI sub-batch, not just at the end, so a tick that runs out of
 * time, or a retry after a transient failure, continues from where it left
 * off instead of re-embedding (and re-billing) chunks already saved.
 */
export async function runVectorizationBatch(
  supabase: SupabaseClient,
  opts?: { batchSize?: number }
): Promise<{ processed: number; errors: number }> {
  const { data: claimed, error: claimError } = await supabase.rpc("claim_vectorization_queue_batch", {
    p_batch_size: opts?.batchSize ?? DEFAULT_CLAIM_BATCH_SIZE,
  });

  if (claimError) {
    console.error("Erro ao reivindicar itens da fila de vetorização:", claimError);
    return { processed: 0, errors: 1 };
  }

  const items = (claimed ?? []) as ClaimedQueueRow[];
  if (items.length === 0) return { processed: 0, errors: 0 };

  const tickDeadline = Date.now() + MAX_TICK_DURATION_MS;
  let processedCount = 0;
  let errorCount = 0;

  for (const item of items) {
    if (Date.now() > tickDeadline) break; // leaves remaining claimed items at 'processing' for this run or the next tick's stale-recovery

    try {
      const { data: noteCheck } = await supabase.from("notes").select("id").eq("id", item.note_id).single();
      if (!noteCheck) {
        await supabase.from("vectorization_queue").delete().eq("id", item.id);
        await supabase.from("note_embeddings").delete().eq("note_id", item.note_id);
        continue;
      }

      const extracted = await extractContentForNote(item.note_id, supabase);

      if (!extracted || extracted.chunks.length === 0) {
        await supabase
          .from("vectorization_queue")
          .update({
            status: "failed",
            attempts: item.attempts + 1,
            error: "Conteúdo da nota vazio ou ainda não pronto.",
          })
          .eq("id", item.id);
        errorCount++;
        continue;
      }

      const totalChunks = extracted.chunks.length;

      // A fresh run (new note, or re-enqueued because its content changed) —
      // any prior embeddings correspond to old content/offsets and must go.
      // A resume (processed_chunks > 0) must NOT wipe them — they're already-paid-for progress.
      if (item.processed_chunks === 0) {
        await supabase.from("note_embeddings").delete().eq("note_id", item.note_id);
      }

      let processedSoFar = item.processed_chunks;
      let ranOutOfTime = false;

      for (let offset = item.processed_chunks; offset < totalChunks; offset += EMBEDDING_BATCH_SIZE) {
        if (Date.now() > tickDeadline) {
          ranOutOfTime = true;
          break;
        }

        const slice = extracted.chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
        const embeddingsResult = await generateEmbeddings(slice.map((c) => c.content));

        const vectorRows = slice.map((chunk, i) => ({
          user_id: item.user_id,
          note_id: item.note_id,
          jwpub_chapter_id: chunk.jwpubChapterId ?? null,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          embedding: embeddingsResult.embeddings[i],
          metadata: chunk.metadata,
        }));

        const { error: insertError } = await supabase.from("note_embeddings").insert(vectorRows);
        if (insertError) throw new Error(`Falha ao salvar vetores no banco: ${insertError.message}`);

        processedSoFar = offset + slice.length;

        if (embeddingsResult.promptTokens > 0) {
          await supabase.from("ai_usage_logs").insert({
            user_id: item.user_id,
            note_id: item.note_id,
            operation_type: "vectorization",
            model: "text-embedding-3-small",
            prompt_tokens: embeddingsResult.promptTokens,
            completion_tokens: 0,
            total_tokens: embeddingsResult.promptTokens,
            estimated_cost_usd: embeddingsResult.estimatedCostUsd,
          });
        }

        // Persisted after every sub-batch (not just at the end) — this is
        // the durable resume point if the tick runs out of time or crashes.
        await supabase
          .from("vectorization_queue")
          .update({ total_chunks: totalChunks, processed_chunks: processedSoFar })
          .eq("id", item.id);
      }

      if (ranOutOfTime) {
        // Not done yet, but not stuck either — 'pending' (not 'processing')
        // so the very next tick's plain pending-claim picks it straight back
        // up, no need to wait for the stale-processing recovery window.
        await supabase.from("vectorization_queue").update({ status: "pending" }).eq("id", item.id);
        continue;
      }

      await supabase
        .from("vectorization_queue")
        .update({ status: "completed", error: null })
        .eq("id", item.id);
      processedCount++;
    } catch (err) {
      errorCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const nextAttempts = item.attempts + 1;
      const finalStatus = nextAttempts >= 3 ? "failed" : "pending";

      await supabase
        .from("vectorization_queue")
        .update({ status: finalStatus, attempts: nextAttempts, error: errorMessage })
        .eq("id", item.id);
    }
  }

  return { processed: processedCount, errors: errorCount };
}
