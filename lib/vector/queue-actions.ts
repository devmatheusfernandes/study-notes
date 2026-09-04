"use server";

import { createClient } from "@/lib/supabase/server";
import { runVectorizationBatch } from "./processor";
import { decryptText } from "@/lib/encryption";

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
 * Enqueues a note for vectorization (or re-queues it if edited). Just
 * inserts a `pending` row — processing itself happens on the Vercel Cron's
 * schedule (see app/api/cron/vectorize/route.ts), or immediately if the user
 * clicks "Processar Agora" in Settings.
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
      // Content changed (or is brand new) → a fresh run, not a resume.
      total_chunks: null,
      processed_chunks: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "note_id" }
  );

  if (error) {
    console.error("Erro ao enfileirar nota para vetorização:", error);
    return { error: "Não foi possível enfileirar a nota." };
  }

  return {};
}

/**
 * Same as `enqueueNoteForVectorization`, for an Estudo Pessoal (jwlibrary)
 * note instead — a separate table from `notes`, so it goes in the
 * `jwlibrary_note_id` column instead of `note_id` (see
 * 0019_jwlibrary_and_bible_vectorization.sql).
 */
export async function enqueueJwlibraryNoteForVectorization(jwlibraryNoteId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada." };

  const { error } = await supabase.from("vectorization_queue").upsert(
    {
      user_id: user.id,
      jwlibrary_note_id: jwlibraryNoteId,
      note_id: null,
      status: "pending",
      attempts: 0,
      error: null,
      total_chunks: null,
      processed_chunks: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "jwlibrary_note_id" }
  );

  if (error) {
    console.error("Erro ao enfileirar nota de estudo pessoal para vetorização:", error);
    return { error: "Não foi possível enfileirar a nota." };
  }

  return {};
}

export interface VectorQueueItemDetails {
  id: string;
  noteId: string;
  noteTitle: string;
  noteType: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  error: string | null;
  processedChunks: number;
  totalChunks: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Manually runs one batch of the vectorization queue right now, scoped to
 * the caller's own rows (ordinary RLS on vectorization_queue — see
 * claim_vectorization_queue_batch in the migration). This is the "Processar
 * Agora" button's escape hatch in Settings; the Vercel Cron job
 * (app/api/cron/vectorize/route.ts) is what normally drains the queue in the
 * background without any user needing to click anything.
 */
export async function processVectorQueue(): Promise<{ processed: number; errors: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { processed: 0, errors: 0 };

  return runVectorizationBatch(supabase);
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
    total_chunks: null,
    processed_chunks: 0,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from("vectorization_queue")
    .upsert(queueRows, { onConflict: "note_id" });

  if (upsertError) {
    return { enqueued: 0, error: "Não foi possível enfileirar as notas." };
  }

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
    .select(
      "id, note_id, status, attempts, error, processed_chunks, total_chunks, created_at, updated_at, notes(title, type)"
    )
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
      processedChunks: item.processed_chunks,
      totalChunks: item.total_chunks,
      createdAt: new Date(item.created_at).getTime(),
      updatedAt: new Date(item.updated_at).getTime(),
    };
  });
}

/**
 * Resets a single queue item to pending — deliberately leaves
 * `processed_chunks` alone, so retrying a big publication that failed partway
 * through resumes from there instead of re-embedding (and re-billing) chunks
 * already saved. Actual processing happens on the next cron tick, or
 * instantly if the user also clicks "Processar Agora".
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
