"use server";

import { createClient } from "@/lib/supabase/server";
import { extractContentForNote } from "./extractor";
import { generateEmbeddings } from "./openai";

export interface AiUsageStats {
  totalTokens: number;
  totalCostUsd: number;
  totalCostBrl: number;
  vectorizedNotesCount: number;
  vectorizedChunksCount: number;
  queuePendingCount: number;
  queueFailedCount: number;
}

/**
 * Enqueues a note for vectorization (or re-queues it if edited).
 */
export async function enqueueNoteForVectorization(noteId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("vectorization_queue").upsert(
    {
      user_id: user.id,
      note_id: noteId,
      status: "pending",
      attempts: 0,
      error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "note_id" }
  );

  if (error) {
    console.error("Erro ao enfileirar nota para vetorização:", error);
    return { error: "Não foi possível enfileirar a nota." };
  }

  // Fire-and-forget processing in background
  void processVectorQueue(user.id);
  return {};
}

import { decryptText } from "@/lib/encryption";

export interface VectorQueueItemDetails {
  id: string;
  noteId: string;
  noteTitle: string;
  noteType: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Processes pending items in the vectorization queue for a user.
 */
export async function processVectorQueue(targetUserId?: string): Promise<{ processed: number; errors: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = targetUserId ?? user?.id;
  if (!userId) return { processed: 0, errors: 0 };

  // Fetch pending items OR items stuck in 'processing'
  const { data: queueItems, error: fetchError } = await supabase
    .from("vectorization_queue")
    .select("id, note_id, attempts, status, updated_at")
    .eq("user_id", userId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(10);

  if (fetchError || !queueItems || queueItems.length === 0) {
    return { processed: 0, errors: 0 };
  }

  // Filter items: process 'pending', or 'processing' updated > 30s ago
  const now = Date.now();
  const itemsToProcess = queueItems.filter((item) => {
    if (item.status === "pending") return true;
    const lastUpdate = new Date(item.updated_at).getTime();
    return now - lastUpdate > 30_000;
  });

  if (itemsToProcess.length === 0) {
    return { processed: 0, errors: 0 };
  }

  let processedCount = 0;
  let errorCount = 0;

  for (const item of itemsToProcess) {
    // 1. Mark as processing
    await supabase
      .from("vectorization_queue")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", item.id);

    try {
      // 2. Extract text chunks
      const extracted = await extractContentForNote(item.note_id);

      if (!extracted || extracted.chunks.length === 0) {
        // Content not ready yet (e.g., JWPUB still ingesting chapters)
        await supabase
          .from("vectorization_queue")
          .update({
            status: "pending",
            attempts: item.attempts + 1,
            error: "Conteúdo da nota ainda não está pronto.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        continue;
      }

      // 3. Generate OpenAI Embeddings
      const texts = extracted.chunks.map((c) => c.content);
      const embeddingsResult = await generateEmbeddings(texts);

      // 4. Delete existing embeddings for this note before inserting fresh ones
      await supabase.from("note_embeddings").delete().eq("note_id", item.note_id);

      // 5. Insert new embeddings
      const vectorRows = extracted.chunks.map((chunk, index) => ({
        user_id: userId,
        note_id: item.note_id,
        jwpub_chapter_id: chunk.jwpubChapterId ?? null,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        embedding: embeddingsResult.embeddings[index],
        metadata: chunk.metadata,
      }));

      const { error: insertError } = await supabase.from("note_embeddings").insert(vectorRows);

      if (insertError) {
        throw new Error(`Falha ao salvar vetores no banco: ${insertError.message}`);
      }

      // 6. Log AI usage and cost
      if (embeddingsResult.promptTokens > 0) {
        await supabase.from("ai_usage_logs").insert({
          user_id: userId,
          note_id: item.note_id,
          operation_type: "vectorization",
          model: "text-embedding-3-small",
          prompt_tokens: embeddingsResult.promptTokens,
          completion_tokens: 0,
          total_tokens: embeddingsResult.promptTokens,
          estimated_cost_usd: embeddingsResult.estimatedCostUsd,
        });
      }

      // 7. Mark queue item as completed
      await supabase
        .from("vectorization_queue")
        .update({
          status: "completed",
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      processedCount++;
    } catch (err) {
      errorCount++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const nextAttempts = item.attempts + 1;
      const finalStatus = nextAttempts >= 3 ? "failed" : "pending";

      await supabase
        .from("vectorization_queue")
        .update({
          status: finalStatus,
          attempts: nextAttempts,
          error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }
  }

  return { processed: processedCount, errors: errorCount };
}

/**
 * Enqueues ALL active notes for the current user and triggers the queue worker.
 */
export async function revectorizeAllNotes(): Promise<{ enqueued: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { enqueued: 0, error: "Sessão expirada." };

  const { data: notes, error: fetchError } = await supabase
    .from("notes")
    .select("id")
    .eq("status", "active");

  if (fetchError || !notes || notes.length === 0) {
    return { enqueued: 0 };
  }

  const queueRows = notes.map((n) => ({
    user_id: user.id,
    note_id: n.id,
    status: "pending",
    attempts: 0,
    error: null,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from("vectorization_queue")
    .upsert(queueRows, { onConflict: "note_id" });

  if (upsertError) {
    return { enqueued: 0, error: "Não foi possível enfileirar as notas." };
  }

  void processVectorQueue(user.id);
  return { enqueued: notes.length };
}

/**
 * Returns AI Usage and Cost statistics for the settings screen.
 */
export async function getAiUsageStats(): Promise<AiUsageStats> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      totalTokens: 0,
      totalCostUsd: 0,
      totalCostBrl: 0,
      vectorizedNotesCount: 0,
      vectorizedChunksCount: 0,
      queuePendingCount: 0,
      queueFailedCount: 0,
    };
  }

  const [usageRes, embeddingsRes, queueRes] = await Promise.all([
    supabase.from("ai_usage_logs").select("total_tokens, estimated_cost_usd"),
    supabase.from("note_embeddings").select("note_id", { count: "exact" }),
    supabase.from("vectorization_queue").select("status"),
  ]);

  const usageLogs = usageRes.data ?? [];
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const log of usageLogs) {
    totalTokens += log.total_tokens || 0;
    totalCostUsd += Number(log.estimated_cost_usd) || 0;
  }

  const USD_TO_BRL_RATE = 5.5;
  const totalCostBrl = totalCostUsd * USD_TO_BRL_RATE;

  const vectorizedChunksCount = embeddingsRes.count ?? 0;

  // Unique notes count from note_embeddings
  const uniqueNotes = new Set((embeddingsRes.data ?? []).map((e) => e.note_id));
  const vectorizedNotesCount = uniqueNotes.size;

  const queueItems = queueRes.data ?? [];
  const queuePendingCount = queueItems.filter((q) => q.status === "pending" || q.status === "processing").length;
  const queueFailedCount = queueItems.filter((q) => q.status === "failed").length;

  return {
    totalTokens,
    totalCostUsd,
    totalCostBrl,
    vectorizedNotesCount,
    vectorizedChunksCount,
    queuePendingCount,
    queueFailedCount,
  };
}

/**
 * Returns full details of all items in the vectorization queue for the current user.
 */
export async function getVectorQueueDetails(): Promise<VectorQueueItemDetails[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data: queueItems, error } = await supabase
    .from("vectorization_queue")
    .select("id, note_id, status, attempts, error, created_at, updated_at, notes(title, type)")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error || !queueItems) return [];

  return queueItems.map((item) => {
    const noteData = item.notes as unknown as { title?: string; type?: string } | null;
    const decrypted = noteData?.title ? decryptText(noteData.title) : null;
    const noteTitle = decrypted || "Nota sem título";
    const noteType = noteData?.type || "nota";

    return {
      id: item.id,
      noteId: item.note_id,
      noteTitle,
      noteType,
      status: item.status as VectorQueueItemDetails["status"],
      attempts: item.attempts,
      error: item.error,
      createdAt: new Date(item.created_at).getTime(),
      updatedAt: new Date(item.updated_at).getTime(),
    };
  });
}

/**
 * Resets a single queue item to pending and triggers queue processing.
 */
export async function retryQueueItem(queueId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase
    .from("vectorization_queue")
    .update({
      status: "pending",
      attempts: 0,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", queueId)
    .eq("user_id", user.id);

  if (error) return { error: "Não foi possível reiniciar o item." };

  void processVectorQueue(user.id);
  return {};
}

/**
 * Resets all failed or stuck items to pending and triggers queue processing.
 */
export async function retryAllFailedQueueItems(): Promise<{ count: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { count: 0, error: "Sessão expirada." };

  const { data: updated, error } = await supabase
    .from("vectorization_queue")
    .update({
      status: "pending",
      attempts: 0,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .in("status", ["failed", "processing"])
    .select("id");

  if (error) return { count: 0, error: "Não foi possível reiniciar os itens." };

  void processVectorQueue(user.id);
  return { count: updated?.length ?? 0 };
}

/**
 * Deletes a queue item from vectorization_queue.
 */
export async function deleteQueueItem(queueId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase
    .from("vectorization_queue")
    .delete()
    .eq("id", queueId)
    .eq("user_id", user.id);

  return error ? { error: "Não foi possível remover da fila." } : {};
}
