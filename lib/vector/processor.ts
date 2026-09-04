import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractContentForNote, extractContentForJwlibraryNote } from "./extractor";
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
  /** Exactly one of `note_id`/`jwlibrary_note_id` is set — enforced by a DB check constraint (see 0019_jwlibrary_and_bible_vectorization.sql). */
  note_id: string | null;
  jwlibrary_note_id: string | null;
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
  opts?: { batchSize?: number; deadline?: number }
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

  // A caller that loops (the daily cron, which drains the queue instead of
  // doing a single tick) passes one deadline shared by every call, so the
  // whole invocation stays inside the function's time budget. On its own,
  // each call just gets its own MAX_TICK_DURATION_MS.
  const tickDeadline = opts?.deadline ?? Date.now() + MAX_TICK_DURATION_MS;
  let processedCount = 0;
  let errorCount = 0;

  for (const item of items) {
    if (Date.now() > tickDeadline) break; // leaves remaining claimed items at 'processing' for this run or the next tick's stale-recovery

    const isJwlibrary = item.jwlibrary_note_id !== null;
    const contentTable = isJwlibrary ? "jwlibrary_notes" : "notes";
    const contentId = (isJwlibrary ? item.jwlibrary_note_id : item.note_id)!;
    // Which single column identifies this item's rows in note_embeddings —
    // deliberately NOT `.match({ note_id: item.note_id, jwlibrary_note_id: item.jwlibrary_note_id })`:
    // supabase-js's `.match()` sends a null value as `eq.null`, which never
    // matches a genuinely NULL column (needs `.is()` instead), so a filter on
    // the OTHER (always-null) owner column would silently zero out every
    // delete below. Filtering on just the one non-null owner column sidesteps
    // that entirely — it alone already uniquely identifies the row set.
    const ownerColumn = isJwlibrary ? "jwlibrary_note_id" : "note_id";
    // Still needed in full for the insert below, where both columns must be
    // written (one real id, one explicit null) to satisfy the DB's
    // exactly-one-owner check constraint.
    const embeddingOwnerColumns = { note_id: item.note_id, jwlibrary_note_id: item.jwlibrary_note_id };

    try {
      const { data: contentCheck } = await supabase.from(contentTable).select("id").eq("id", contentId).single();
      if (!contentCheck) {
        await supabase.from("vectorization_queue").delete().eq("id", item.id);
        await supabase.from("note_embeddings").delete().eq(ownerColumn, contentId);
        continue;
      }

      const extracted = isJwlibrary
        ? await extractContentForJwlibraryNote(contentId, supabase)
        : await extractContentForNote(contentId, supabase);

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
        await supabase.from("note_embeddings").delete().eq(ownerColumn, contentId);
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
          ...embeddingOwnerColumns,
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
